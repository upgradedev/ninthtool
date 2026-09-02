/**
 * The run state machine in src/ui/app.js, driven for real rather than described.
 *
 * WHY THIS FILE EXISTS. Two defects were measured on this page and both lived in this state
 * machine. A second run that failed handed the previous run's counts back to the screen AND to
 * `nt_run_audit`, so a tool whose whole subject is pages that report success when they failed was
 * doing exactly that. Separately, a host that observed nothing at all was announced as
 * "0 of 20 promises broken", and `nt_get_findings` was published on the strength of it, which
 * handed an agent an empty answer shaped like a result. Neither defect is visible in the shape of
 * the code. Both are orderings, so both need a run.
 *
 * HOW A BROWSER MODULE IS RUN IN NODE. `app.js` exports nothing and calls `boot()` at import time,
 * which is why tests/unit/group_copy.test.js reads its constants out of the source. There is a way
 * in, though, and it is the page's own argument: `boot()` publishes `nt_run_audit` on whatever
 * WebMCP host object it discovers, and that tool calls `runAudit()`. So this file supplies a host
 * double and a small DOM double, imports the module, and then drives the state machine through the
 * same tool an agent would use. Nothing is asserted against the source text. No export was added
 * to shipping code, and if one were ever needed here it would mean the harness was wrong.
 *
 * THE DOUBLES ARE BUILT TO FAIL. The host double honours the abort signal in the options bag, so
 * "withdrawn" is a tool leaving the map rather than a call being recorded. The element names and
 * their starting visibility come out of index.html, so the double cannot invent a control the
 * shipped page lacks, and an unknown name resolves to null instead of springing into being. Every
 * fixture asserts its own counts before the consequence is asserted, because a malformed
 * observation degrades every row to not-applicable, which quietly moves the run into the error
 * branch and would leave the weaker assertions green.
 *
 * WATCHED FAILING. Every test below has been turned red by at least one deliberate breakage of
 * app.js, run in a scratch copy of the tree, including both measured defects: moving
 * `withdrawFindingsTool()` below the first await reddens the ordering test, and letting a failed
 * run keep the previous answer reddens the stale-result test.
 *
 * WHAT SURVIVES, AND WHY IT IS THE MODULE RATHER THAN THIS FILE. Two classes of single-line
 * breakage change nothing any surface can observe, so no test can catch them.
 *
 * The entry block at the top of `runAudit` does three things the `catch` then does again: clearing
 * `lastResult`, withdrawing the findings tool, and hiding the summary. Remove any one of those from
 * the `catch` alone and nothing moves, because the entry block already did it and nothing
 * republished in between. Only removing BOTH halves of the clearing reproduces the measured defect,
 * and that combination is covered.
 *
 * Both guards in `publishFindingsTool` are unreachable from `runAudit`. It is only ever called
 * after the error branch has returned, so `!lastResult` cannot be true there, and a run where total
 * equals notApplicable is classified `error` and returns before publishing. Delete either guard on
 * its own and this file stays green. What is covered behaviourally is the early return in the error
 * branch: publish from there with the second guard also gone and the nothing-measured test reddens.
 *
 * A reader who mutates one of those lines, sees green and concludes this file is worthless would be
 * drawing the wrong conclusion from the right observation. Two assertions that genuinely could not
 * fail were found in review and are marked where they were replaced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BEHAVIOURS, MEASURED_AGAINST } from '../../src/judge/behaviours.js';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '../..');

/**
 * How many rows the catalogue holds. Taken from the catalogue rather than written as 20, so that
 * adding a behaviour does not turn this file red for the wrong reason. The numbers that describe
 * the state machine itself, two rows measured with one kept and one broken, stay written out.
 */
const CATALOGUE = BEHAVIOURS.length;

/**
 * The controls the shipped page actually carries, and which of them start hidden. Read from
 * index.html so the double is coupled to the page rather than to this file's imagination. If
 * app.js starts asking for an element index.html does not declare, the run crashes here the way it
 * would crash in a browser. The hidden attribute matters as much as the name: a double that
 * defaults every element to visible turns "the summary is hidden until there is a result" into an
 * assertion that cannot fail.
 */
const PAGE_ELEMENTS = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .matchAll(/<[^>]*data-el="([^"]+)"[^>]*>/g)]
  .map((m) => ({ name: m[1], hidden: /\shidden(\s|>|=)/.test(m[0]) }));

/* ------------------------------------------------------------------ the doubles */

/**
 * Enough of a DOM node for this module, and no more.
 *
 * `textContent` is a real accessor, not a plain property, because the module clears a container by
 * assigning the empty string to it. That is how renderGroups blanks the catalogue at the top of a
 * run, and a plain property would leave the stale cards in place and hide the very thing being
 * tested.
 */
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.children = [];
    this.own = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }

  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join('');
  }

  set textContent(value) {
    this.children.length = 0;
    this.own = value === undefined || value === null ? '' : String(value);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  /** Every node at or below this one, so a test can count cards by class. */
  descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

let mountCount = 0;

/**
 * Boot the page against doubles and hand back the handles a test needs.
 *
 * @param {object} options
 * @param {boolean} [options.host] false to boot in a browser with no WebMCP host object
 * @param {string} [options.refuseToRegister] a tool name the host double rejects
 */
async function mount(options = {}) {
  const elements = new Map(PAGE_ELEMENTS.map(({ name, hidden }) => {
    const node = new FakeNode('div');
    node.hidden = hidden;
    return [name, node];
  }));
  const lookups = [];

  const doc = {
    querySelector(selector) {
      const match = /^\[data-el="(.+)"\]$/.exec(selector);
      const name = match ? match[1] : null;
      const node = name && elements.has(name) ? elements.get(name) : null;
      lookups.push({ selector, name, found: Boolean(node) });
      return node;
    },
    createElement: (tag) => new FakeNode(tag),
  };

  /** The host double. A tool is on the surface until its signal fires, which is what withdrawal is. */
  const tools = new Map();
  const registered = [];
  const ctx = {
    async registerTool(descriptor, opts) {
      registered.push(descriptor.name);
      if (options.refuseToRegister === descriptor.name) {
        throw new Error('the host refused this registration');
      }
      const signal = opts && opts.signal;
      if (signal && signal.aborted) return;
      tools.set(descriptor.name, descriptor);
      if (signal) signal.addEventListener('abort', () => { tools.delete(descriptor.name); });
    },
  };
  if (options.host !== false) doc.modelContext = ctx;

  const windowListeners = new Map();
  const win = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };

  const previous = new Map();
  for (const [name, value] of [['document', doc], ['navigator', { userAgent: 'NodeDouble/1.0' }],
    ['window', win]]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const subject = elements.get('subject');
  subject.src = 'https://ninthtool.invalid/fixtures/subject.html';
  subject.contentWindow = null;

  mountCount += 1;
  // A fresh query string gives a fresh module instance, because the state machine lives in module
  // scope and a second test must not inherit the first one's lastResult. The relative imports
  // inside app.js carry no query, so behaviours, verdict and observe stay cached and shared.
  await import(new URL(`../../src/ui/app.js?fresh=${mountCount}`, import.meta.url).href);
  await flush();
  await flush();

  return {
    elements,
    tools,
    lookups,
    registered,
    subject,
    el: (name) => elements.get(name),
    fireKey: (key) => {
      for (const fn of windowListeners.get('keydown') || []) fn({ key });
    },
    /** Call one of this page's own tools the way a visitor's agent would. */
    call: async (name, input) => {
      const descriptor = tools.get(name);
      assert.ok(descriptor, `${name} is not on the tool surface`);
      return descriptor.execute(input);
    },
    dispose() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

/** The first text payload of a tool result, parsed. */
const payload = (result) => JSON.parse(result.content[0].text);

/** Count the cards the page rendered that carry a verdict class. */
function verdictCards(host) {
  const cards = host.descendants().filter((n) => n.tagName === 'article');
  return {
    total: cards.length,
    pass: cards.filter((c) => c.className.includes('v-pass')).length,
    fail: cards.filter((c) => c.className.includes('v-fail')).length,
    notApplicable: cards.filter((c) => c.className.includes('v-na')).length,
    // A by-design card is rendered and countable like any other. It is not a pass and not a
    // failure, and a counter that could not see it would let the class go missing unnoticed.
    byDesign: cards.filter((c) => c.className.includes('v-design')).length,
  };
}

/* ------------------------------------------------------------------ transcripts */

const META = {
  api: 'document.modelContext',
  url: 'https://ninthtool.invalid/fixtures/subject.html',
  userAgent: 'NodeDouble/1.0',
};

/** One row kept, one row broken, nothing unobserved. The judge calls this complete. */
const complete = () => ({
  meta: { ...META },
  scope: { requestedBehaviours: ['A1', 'A2'] },
  observations: {
    A1: { argCount: 2, optionsTypeof: 'object', hasSignal: true },
    A2: { inputSchemaTypeof: 'undefined' },
  },
  errors: [],
});

/** Two rows measured, one asked for and never observed. Partial, but a real result. */
const partial = () => ({
  meta: { ...META },
  scope: { requestedBehaviours: ['A1', 'A2', 'B2'] },
  observations: {
    A1: { argCount: 2, optionsTypeof: 'object', hasSignal: true },
    A2: { inputSchemaTypeof: 'undefined' },
  },
  errors: [],
});

/**
 * The measured shape of the defect. A host object exists, the environment identifies itself, and
 * not one behaviour was observed through it. This is the run that used to be announced as zero
 * promises broken.
 */
const nothingMeasured = () => ({
  meta: { ...META },
  scope: { requestedBehaviours: ['A1', 'A2'] },
  observations: {},
  errors: [],
});

/** A subject frame whose probe returns the given transcript, with an optional peek at call time. */
function subjectFor(transcript, onEntry) {
  return {
    async __ninthtool_observe() {
      if (onEntry) onEntry();
      return transcript;
    },
  };
}

/* ------------------------------------------------------------------ boot */

test('boot renders the catalogue and publishes the three standing tools', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  // If this fails, every later test is asserting against a module that never finished booting.
  assert.deepEqual(page.registered, ['nt_list_behaviours', 'nt_explain_behaviour', 'nt_run_audit']);
  assert.equal(page.tools.size, 3, 'nt_get_findings must not exist before an audit has run');

  // The double reads its starting visibility out of index.html. If that parse ever silently found
  // nothing, every hidden assertion in this file would go quiet, so it is checked once here.
  assert.deepEqual(PAGE_ELEMENTS.filter((e) => e.hidden).map((e) => e.name).sort(),
    ['blocker', 'summary']);
  assert.equal(page.el('status').textContent, 'Ready. Three tools published, so your own agent can run this.');

  assert.equal(verdictCards(page.el('groups')).total, BEHAVIOURS.length,
    'the catalogue renders every behaviour before any run');
  assert.equal(verdictCards(page.el('groups')).pass, 0, 'nothing is a verdict before a run');
  assert.equal(page.el('summary').hidden, true);
  assert.match(page.el('catalogue-lede').textContent, new RegExp(`^${CATALOGUE} behaviours[.]`));
});

test('every element the page asks for is one index.html declares', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());
  await page.call('nt_run_audit', {});
  page.fireKey('Escape');

  const missing = page.lookups.filter((l) => !l.found);
  assert.deepEqual(missing, [], 'app.js queried an element the shipped page does not carry');
  assert.ok(page.lookups.length > 0, 'no element was looked up, so this assertion proves nothing');
});

test('with no host object the control is disabled and the reason is rendered beside it', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  assert.equal(page.el('run').disabled, true);
  assert.equal(page.el('blocker').hidden, false, 'a disabled control with no reason is a gate to null');
  assert.match(page.el('blocker').textContent, /chrome:\/\/flags\/#enable-webmcp-testing/);
  assert.ok(page.el('blocker').textContent.includes(MEASURED_AGAINST));
  // THIS LINE REPLACES `assert.equal(page.tools.size, 0)`, WHICH COULD NOT FAIL. With no host
  // object the double's context is never attached to the document or the navigator, so app.js holds
  // no reference to it and nothing the page could do would ever put an entry in that map. It was an
  // assertion about an object the module under test cannot reach. What can fail is whether boot
  // stopped at the guard: run on past it and publishStandingTools is handed a null context, and the
  // status line says so instead.
  assert.equal(page.el('status').textContent, 'The audit cannot run here.');
  // The page is never blank. A judge on a browser without the flag still sees what this is.
  assert.equal(verdictCards(page.el('groups')).total, BEHAVIOURS.length);
});

/* ------------------------------------------------------------------ a run that works */

test('a complete run publishes the findings tool and both surfaces say the same thing', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());

  const parsed = payload(await page.call('nt_run_audit', {}));

  // The fixture first. A degraded transcript would push this into the error branch and the
  // assertions below would pass for the wrong reason.
  assert.deepEqual(parsed.counts, {
    total: 2, pass: 1, fail: 1, notApplicable: 0, byDesign: 0, outOfScope: CATALOGUE - 2, catalogue: CATALOGUE,
  });
  assert.equal(parsed.state, 'complete');
  assert.equal(parsed.partial, false);
  assert.deepEqual(parsed.broken,
    ['A2 inputSchema is written as an object and read back as a string']);
  assert.match(parsed.run.id, /^run-1-\d+$/);

  // The screen and the tool agree, which is the property that was broken.
  assert.equal(page.el('status').textContent,
    'Done. 1 of 2 promises broken. The tool nt_get_findings is now published.');
  assert.equal(page.el('summary').hidden, false);
  assert.match(page.el('tiles').textContent, /promises broken/);
  assert.match(page.el('env').textContent, new RegExp(parsed.run.id));
  assert.deepEqual(verdictCards(page.el('groups')), {
    total: CATALOGUE, pass: 1, fail: 1, notApplicable: 0, byDesign: 0,
  });

  assert.ok(page.tools.has('nt_get_findings'), 'the ninth tool appears when there are findings');
});

test('the findings tool returns this run, filters, and refuses an argument nobody declared', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());
  await page.call('nt_run_audit', {});

  const all = payload(await page.call('nt_get_findings', {}));
  assert.equal(all.findings.length, BEHAVIOURS.length, 'nothing disappears from the report');
  assert.equal(all.state, 'complete');
  assert.equal(all.partial, false);
  assert.equal(all.counts.fail, 1);

  const broken = payload(await page.call('nt_get_findings', { only: 'broken' }));
  assert.deepEqual(broken.findings.map((f) => f.id), ['A2']);
  const kept = payload(await page.call('nt_get_findings', { only: 'kept' }));
  assert.deepEqual(kept.findings.map((f) => f.id), ['A1']);

  // Row P5. The browser enforces nothing on a script registered tool, so the page validates.
  const refused = await page.call('nt_get_findings', { only: 'broken', sneaky: 1 });
  assert.match(refused.content[0].text, /^Refused\./);
  assert.match(refused.content[0].text, /was sent sneaky/);
  assert.match(refused.content[0].text, /Nothing was read and nothing changed\./);
});

test('a partial run publishes the findings tool and never uses success wording', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(partial());

  const parsed = payload(await page.call('nt_run_audit', {}));
  assert.deepEqual(parsed.counts, {
    total: 3, pass: 1, fail: 1, notApplicable: 1, byDesign: 0, outOfScope: CATALOGUE - 3, catalogue: CATALOGUE,
  });
  assert.equal(parsed.state, 'incomplete');
  assert.equal(parsed.partial, true);
  assert.equal(parsed.complete, false);

  const status = page.el('status').textContent;
  assert.match(status, /^PARTIAL\./);
  // NOT `startsWith('Done.')`, which the line above already settles and which therefore could not
  // fail on its own. Success wording anywhere in the line is what would mislead a reader who skims
  // to the end of it, so the whole line is checked.
  assert.ok(!/\bDone\b/.test(status), `an incomplete run read as a finished one: ${status}`);
  assert.match(status, /1 could not be observed/);
  assert.match(page.el('env').textContent, /INCOMPLETE: everySelectedObserved/);

  assert.ok(page.tools.has('nt_get_findings'));
  assert.equal(payload(await page.call('nt_get_findings', {})).partial, true,
    'a partial answer must be labelled partial wherever it is read');
});

/* ------------------------------------------------------------------ nothing measured */

test('a host that measured nothing is not a host that found nothing', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(nothingMeasured());

  const result = await page.call('nt_run_audit', {});
  const parsed = payload(result);

  assert.equal(parsed.state, 'error');
  assert.equal(parsed.measured, false);
  assert.equal(result.isError, true);
  assert.equal(parsed.counts, undefined, 'a run that measured nothing has no counts to report');
  assert.match(parsed.said, /This is not a finding of zero defects\./);

  // THE MEASURED DEFECT, ON THE SCREEN. This said "0 of 20 promises broken".
  const status = page.el('status').textContent;
  assert.ok(!/promises broken/.test(status), `the status announced a count: ${status}`);
  assert.match(status, /^Nothing could be measured here\./);
  assert.match(status, /nt_get_findings has not been published\./);

  // AND THE SAME DEFECT ON THE TOOL SURFACE. The ninth tool used to appear here.
  assert.equal(page.tools.has('nt_get_findings'), false);
  assert.equal(page.tools.size, 3);

  // The tiles say what happened rather than counting to zero.
  const tiles = page.el('tiles').textContent;
  assert.match(tiles, /unobserved, nothing measured/);
  assert.ok(!/promises broken/.test(tiles), `the tiles announced a count: ${tiles}`);
  assert.equal(page.el('blocker').hidden, false);
  // BOTH SCOPES ARE NAMED. The old text asserted "this browser exposed a WebMCP host object"
  // without saying which document it meant, and printed that directly above "host object none".
  const blocker = page.el('blocker').textContent;
  assert.match(blocker, /The top document exposed /);
  assert.match(blocker, /The subject frame at https:\/\/ninthtool\.invalid\/fixtures\/subject\.html/);
  assert.ok(!/most common cause/.test(blocker),
    `the page is guessing at a cause again: ${blocker}`);
});

/*
 * THE SHAPE THE CHATGPT DESKTOP IN-APP BROWSER ACTUALLY RETURNED.
 *
 * Measured 2026-09-02 on the live URL, Chromium 151: the top document exposed
 * `document.modelContext` and published three tools, while the same-origin subject frame exposed
 * none at load time and again at click time. `fixtures/subject.html` therefore takes its early
 * return, and the transcript carries `api: null`, no observations, and ONE error holding the
 * reason. The suite's own page then threw that reason away and printed a guess instead.
 *
 * `nothingMeasured()` above could not catch it: it carries a full `META` and `errors: []`, so it
 * never exercised the branch that matters. This is that branch.
 */
const hostObjectAbsentInFrame = () => ({
  meta: {
    api: null,
    url: 'https://upgradedev.github.io/ninthtool/fixtures/subject.html',
    userAgent: 'Chromium/151 in-app',
  },
  scope: { requestedBehaviours: ['A1', 'A2'] },
  observations: {},
  errors: ['This browser exposes no WebMCP host object. Chrome and Edge need the feature enabled '
    + 'at chrome://flags/#enable-webmcp-testing, and the page must be a secure context and origin '
    + 'isolated.'],
});

test('the reason on screen is the one the transcript measured, not a guess at a cause', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  const transcript = hostObjectAbsentInFrame();
  page.subject.contentWindow = subjectFor(transcript);

  const parsed = payload(await page.call('nt_run_audit', {}));
  assert.equal(parsed.state, 'error');
  assert.equal(page.tools.has('nt_get_findings'), false,
    'a run that measured nothing must not publish findings');

  const blocker = page.el('blocker').textContent;

  // THE MEASURED REASON, VERBATIM. This is the assertion that fails if anyone goes back to
  // narrating a cause: the string has to come from the transcript, so a hardcoded sentence
  // cannot satisfy it.
  assert.ok(blocker.includes(transcript.errors[0]),
    `the measured reason was discarded. Blocker said: ${blocker}`);

  // AND THE TWO SCOPES ARE DISTINGUISHED, which is what made the old screen self-contradictory.
  assert.match(blocker, /The subject frame at https:\/\/upgradedev\.github\.io\/ninthtool\/fixtures\/subject\.html exposed no host object/);
  assert.ok(!/most common cause/.test(blocker), `the page is guessing again: ${blocker}`);
  assert.ok(!/does not implement the declarative half/.test(blocker),
    'that clause asserted a mechanism this run never observed');
});

/* ------------------------------------------------------------------ the stale result */

test('a failed second run returns nothing rather than the first run answer', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  page.subject.contentWindow = subjectFor(complete());
  const first = payload(await page.call('nt_run_audit', {}));
  assert.equal(first.counts.total, 2, 'the first run must succeed or this test proves nothing');
  assert.ok(page.tools.has('nt_get_findings'));

  // The subject goes away, exactly as it did when this was measured.
  page.subject.contentWindow = null;
  const result = await page.call('nt_run_audit', {});
  const parsed = payload(result);

  assert.equal(parsed.state, 'error');
  assert.equal(parsed.measured, false);
  assert.equal(result.isError, true);
  assert.equal(parsed.counts, undefined, 'the previous run counts came back');
  assert.match(parsed.run.id, /^run-2-\d+$/, 'a failed run still gets its own identity');
  assert.notEqual(parsed.run.id, first.run.id);

  assert.equal(page.tools.has('nt_get_findings'), false, 'a stale answer is still readable');
  assert.equal(page.el('summary').hidden, true);
  assert.match(page.el('status').textContent, /no earlier result is being shown/);
  assert.match(page.el('status').textContent, /has not finished loading/);
  assert.deepEqual(verdictCards(page.el('groups')), { total: CATALOGUE, pass: 0, fail: 0, notApplicable: 0, byDesign: 0 },
    'the cards still carried the previous verdicts');
  assert.equal(page.el('run').disabled, false, 'the control must come back after a failure');

  // The last place a stale result can hide. Escape clears only when there is something to clear, so
  // after a failed run it must do nothing at all. If the first run's result survived the catch, this
  // key would replace the honest failure text with "Cleared", which is the page offering to throw
  // away a result it is not supposed to be holding.
  const said = page.el('status').textContent;
  page.fireKey('Escape');
  assert.equal(page.el('status').textContent, said,
    'Escape found something to clear, so the failed run is still holding the first run result');
});

test('entering running clears the answer and withdraws the tool before anything is awaited', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  page.subject.contentWindow = subjectFor(complete());
  await page.call('nt_run_audit', {});
  assert.ok(page.tools.has('nt_get_findings'), 'the first run must publish or the peek below is empty');

  // The peek happens inside the probe call, which is the first await in runAudit. Whatever is true
  // here was true before the state machine yielded. Move withdrawFindingsTool below that await and
  // this test fails, which is the whole point of it.
  let atEntry = null;
  page.subject.contentWindow = subjectFor(complete(), () => {
    atEntry = {
      toolPublished: page.tools.has('nt_get_findings'),
      cards: verdictCards(page.el('groups')),
      summaryHidden: page.el('summary').hidden,
      status: page.el('status').textContent,
    };
  });

  await page.call('nt_run_audit', {});

  assert.ok(atEntry, 'the probe was never entered, so nothing was observed about the ordering');
  assert.equal(atEntry.toolPublished, false,
    'nt_get_findings was still readable while the second run was in flight');
  assert.deepEqual(atEntry.cards, { total: CATALOGUE, pass: 0, fail: 0, notApplicable: 0, byDesign: 0 },
    'the previous verdicts were still on the screen while the second run was in flight');
  assert.equal(atEntry.summaryHidden, true);
  assert.match(atEntry.status, /Previous findings have been cleared/);
});

test('the escape key withdraws the tool and only when there is something to clear', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  // Nothing to clear yet, so the key must do nothing at all.
  page.fireKey('Escape');
  assert.equal(page.el('status').textContent, 'Ready. Three tools published, so your own agent can run this.');

  page.subject.contentWindow = subjectFor(complete());
  await page.call('nt_run_audit', {});
  assert.ok(page.tools.has('nt_get_findings'));

  page.fireKey('a');
  assert.ok(page.tools.has('nt_get_findings'), 'any key at all cleared the findings');

  page.fireKey('Escape');
  assert.equal(page.tools.has('nt_get_findings'), false);
  assert.equal(page.tools.size, 3, 'the standing tools must survive a clear');
  assert.equal(page.el('summary').hidden, true);
  assert.equal(page.el('status').textContent,
    'Cleared. nt_get_findings has been withdrawn from the tool surface.');
  assert.deepEqual(verdictCards(page.el('groups')), { total: CATALOGUE, pass: 0, fail: 0, notApplicable: 0, byDesign: 0 });
});

/**
 * A host that refuses the registration.
 *
 * FINDING, REPORTED RATHER THAN ASSERTED. `publishFindingsTool` catches the refusal and appends the
 * reason to the status line, but `runAudit` then assigns over that line on both the complete and
 * the partial path, and the error path returns before publishing at all. So the reason is
 * overwritten in every reachable case and the page announces "The tool nt_get_findings is now
 * published" about a tool that is not on the surface. That is the same class of defect this suite
 * exists to catch, on this page, and it is raised separately.
 *
 * This test asserts only what is true today, so it stays green when the status line is fixed. It is
 * deliberately silent about the exact wording for that reason.
 */
test('a refused findings registration leaves the measurement intact and the tool off the surface', async (t) => {
  const page = await mount({ refuseToRegister: 'nt_get_findings' });
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());

  const parsed = payload(await page.call('nt_run_audit', {}));
  assert.equal(parsed.state, 'complete', 'a refused registration does not invalidate the measurement');
  assert.deepEqual(parsed.counts, {
    total: 2, pass: 1, fail: 1, notApplicable: 0, byDesign: 0, outOfScope: CATALOGUE - 2, catalogue: CATALOGUE,
  });

  // The registration was attempted and it did not take.
  assert.ok(page.registered.includes('nt_get_findings'));
  assert.equal(page.tools.has('nt_get_findings'), false);
  assert.equal(page.tools.size, 3);

  // The refusal did not throw out of runAudit, so the summary still shows the run it measured.
  assert.equal(page.el('summary').hidden, false);
  assert.match(page.el('tiles').textContent, /promises broken/);
});

test('a run is repeatable and each one gets an identity nothing else can be mistaken for', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());

  const one = payload(await page.call('nt_run_audit', {}));
  const two = payload(await page.call('nt_run_audit', {}));

  assert.notEqual(one.run.id, two.run.id);
  assert.match(one.run.id, /^run-1-/);
  assert.match(two.run.id, /^run-2-/);
  assert.equal(two.run.subject, 'https://ninthtool.invalid/fixtures/subject.html');
  assert.equal(two.run.catalogueMeasuredAgainst, MEASURED_AGAINST);
  assert.deepEqual(two.counts, one.counts, 'the same transcript must judge the same way twice');

  // Both surfaces report the same run identity. That is all this line pins, and the weaker claim is
  // the honest one: capturing `lastRun` at publish time instead of reading it at call time is
  // indistinguishable here, because the tool is withdrawn and re-registered on every publish, so
  // the closure and the module variable cannot drift apart on any path a caller can reach. What it
  // does catch is the findings tool dropping or renaming the field, which turns this line red.
  assert.equal(payload(await page.call('nt_get_findings', {})).run.id, two.run.id);
});

test('nt_run_audit refuses an argument nobody declared, and does not run', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());
  page.subject.contentWindow = subjectFor(complete());

  const refused = await page.call('nt_run_audit', { force: true });
  assert.match(refused.content[0].text, /^Refused\./);
  assert.match(refused.content[0].text, /declares no parameters and was sent force/);

  // Nothing ran, so the page is still where boot left it.
  assert.equal(page.el('status').textContent, 'Ready. Three tools published, so your own agent can run this.');
  assert.equal(page.el('summary').hidden, true);
  assert.equal(page.tools.size, 3);
});

/* ------------------------------------------------------- the page's own P5 row, on the page */

/*
 * THE DEFECT THIS SUITE MEASURES, IN THE SUITE'S OWN TOOLS.
 *
 * Behaviour P5 asks whether a read-only tool demonstrably refuses a call that breaks its own
 * required list. `nt_explain_behaviour` declares `required: ['id']`. It was answering anyway:
 * `onlyDeclared` filtered UNDECLARED keys and never read the schema's `required`, so `{}` passed
 * validation, `undefined` was coerced to `''`, and the tool returned "No behaviour ...".
 *
 * That is why P5 abstains on this page rather than passing, and it is why `docs/evidence.md` saying
 * "They do now" of argument checking was false. The handler comment claimed "this handler validates
 * its own argument. Every tool on this page does." It validated half of one thing.
 *
 * A page that ships an auditor for this exact behaviour and then fails it is the finding. It is
 * fixed rather than explained away, and these are the tests that hold it fixed.
 */
test('a tool that declares required refuses when it is missing, and says so', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  const result = await page.call('nt_explain_behaviour', {});
  const said = result.content[0].text;

  assert.match(said, /^Refused\./,
    `nt_explain_behaviour declares required: ['id'] and answered without one: ${said}`);
  assert.match(said, /\bid\b/, 'the refusal must name the argument that was missing');
  assert.ok(!/Known ids:/.test(said),
    'it answered the question instead of refusing, which is exactly what P5 measures');
});

test('the refusal is a result, not a throw, because B1 measured that throwing erases the reason', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  // Must not reject. B1 measured that a thrown error reaches the caller as UnknownError with the
  // page's own reason gone, so every refusal on this page is a returned result.
  const result = await page.call('nt_explain_behaviour', {});
  assert.ok(result && result.content && result.content[0], 'the refusal was not a readable result');
});

test('a required argument present but empty is still a refusal', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  // The coercion that hid the defect: String(undefined || '') and String('' ) are the same value,
  // so a check that only tested for the KEY would still answer here.
  const said = (await page.call('nt_explain_behaviour', { id: '   ' })).content[0].text;
  assert.match(said, /^Refused\./, `an empty required argument was accepted: ${said}`);
});

test('every property a tool declares required is one onlyDeclared actually enforces', async (t) => {
  const page = await mount();
  t.after(() => page.dispose());

  // THE DRIFT GUARD. The defect was a schema saying `required: ['id']` while the handler enforced a
  // different, shorter contract. This walks the SHIPPED schemas and calls each tool with that
  // property removed, so adding a `required` to any tool without enforcing it fails here.
  let checked = 0;
  for (const [name, descriptor] of page.tools) {
    const schema = descriptor && descriptor.inputSchema;
    const required = (schema && schema.required) || [];
    if (!required.length) continue;
    const said = (await page.call(name, {})).content[0].text;
    assert.match(said, /^Refused\./,
      `${name} declares required: ${JSON.stringify(required)} but answered without them`);
    checked += 1;
  }
  assert.ok(checked > 0,
    'no tool on this page declares a required property, so this guard proved nothing. If that is '
    + 'deliberate the guard should be deleted rather than left passing vacuously');
});
