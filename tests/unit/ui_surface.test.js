/**
 * Every surface src/ui/app.js has, walked through ONE boot of the page.
 *
 * WHY A SECOND UI FILE EXISTS, AND WHY IT IS SHAPED THE OPPOSITE WAY.
 *
 * tests/unit/ui_state.test.js drives the run state machine, and it mounts a fresh module instance
 * per test so one test cannot inherit another's `lastResult`. That is the right shape for what it
 * asserts, and it has a measurement consequence: node writes one coverage record per module
 * INSTANCE, so seventeen mounts produce seventeen partial records of `src/ui/app.js`, each holding
 * only the paths its own test needed. The best of them read 78.27 lines and 64.20 branches on
 * a5f98e0. No test added to that file can lift those numbers, because a new test brings a new
 * instance with it.
 *
 * So this file boots the page ONCE and walks the rest of the module in that instance: the three
 * standing tools called with valid, defaulted, blank, numeric and undeclared arguments, a complete
 * run, a partial run, two runs that measured nothing, four ways for a run to fail, and the clear
 * key. The tests below therefore share one page ON PURPOSE and depend on the order they are written
 * in, which is the order node runs them in within a single file.
 *
 * NOTHING HERE IS A SMOKE TEST. Every step asserts what the page said, and where the module
 * publishes the same fact twice, on the screen and through a tool, both are read and compared.
 * Three of these tests were watched failing against deliberate breakages of app.js, recorded in the
 * pull request that added this file.
 *
 * THE DOUBLES ARE THE SAME SHAPE AS THE ONES NEXT DOOR, and they are written out again rather than
 * shared through a helper module. A helper under tests/unit is itself measured by the coverage
 * gate, and a second file importing it would put a partially executed record of it in the report.
 * The duplication is visible; a third copy would be a reason to extract it.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BEHAVIOURS, GROUPS, MEASURED_AGAINST } from '../../src/judge/behaviours.js';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '../..');

/** How many rows the catalogue holds, read from the catalogue so a new behaviour is not a failure. */
const CATALOGUE = BEHAVIOURS.length;

/**
 * The controls the shipped page carries, and which of them start hidden, read out of index.html.
 * A double that invents an element the page lacks, or that defaults everything to visible, turns
 * "the summary is hidden until there is a result" into an assertion that cannot fail.
 */
const PAGE_ELEMENTS = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .matchAll(/<[^>]*data-el="([^"]+)"[^>]*>/g)]
  .map((m) => ({ name: m[1], hidden: /\shidden(\s|>|=)/.test(m[0]) }));

/* ------------------------------------------------------------------ the doubles */

/**
 * Enough of a DOM node for this module and no more.
 *
 * `textContent` is a real accessor rather than a plain property, because the module clears a
 * container by assigning the empty string to it. A plain property would leave the stale cards in
 * place, and every assertion about what a run replaced would pass without the code doing anything.
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

/**
 * Boot the page against doubles, once, and hand back the handles every test below shares.
 *
 * The host double honours the abort signal in the options bag, so withdrawal is a tool leaving the
 * map rather than a call being recorded.
 */
async function mount() {
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

  const tools = new Map();
  const registered = [];
  doc.modelContext = {
    async registerTool(descriptor, opts) {
      registered.push(descriptor.name);
      const signal = opts && opts.signal;
      if (signal && signal.aborted) return;
      tools.set(descriptor.name, descriptor);
      if (signal) signal.addEventListener('abort', () => { tools.delete(descriptor.name); });
    },
  };

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

  await import(new URL('../../src/ui/app.js?surface=1', import.meta.url).href);
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

/** The first text payload of a tool result. */
const said = (result) => result.content[0].text;
/** The same payload, parsed. */
const payload = (result) => JSON.parse(said(result));

/** Count the cards the page rendered that carry a verdict class. */
function verdictCards(host) {
  const cards = host.descendants().filter((n) => n.tagName === 'article');
  return {
    total: cards.length,
    pass: cards.filter((c) => c.className.includes('v-pass')).length,
    fail: cards.filter((c) => c.className.includes('v-fail')).length,
    notApplicable: cards.filter((c) => c.className.includes('v-na')).length,
    byDesign: cards.filter((c) => c.className.includes('v-design')).length,
  };
}

/** The key and value text of every row the cards rendered, so a label can be asserted by name. */
function keyRows(host) {
  return host.descendants()
    .filter((n) => n.tagName === 'span' && n.className === 'k')
    .map((n) => n.textContent);
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

/** Two rows measured, a third asked for and never observed. Partial, but a real result. */
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
 * A run that identified nothing about itself and observed nothing.
 *
 * `meta` is empty rather than merely null valued, because the judge stringifies what it is given:
 * `meta.url = null` reaches the page as the STRING "null", which is truthy, and the fallbacks in
 * the environment line would never run. An absent key is the only input that produces a null.
 */
const anonymousAndUnmeasured = () => ({
  meta: {},
  scope: { requestedBehaviours: ['A1', 'A2'] },
  observations: {},
  errors: [],
});

/** Nothing observed, but the transcript says why, which is the sentence the page must print. */
const REFUSAL = 'This browser exposes no WebMCP host object in the subject frame.';
const unmeasuredWithReason = () => ({
  meta: { api: null, url: 'https://upgradedev.github.io/ninthtool/fixtures/subject.html', userAgent: 'Chromium/151' },
  scope: { requestedBehaviours: ['A1', 'A2'] },
  observations: {},
  errors: [REFUSAL],
});

/** A subject frame whose probe returns the given transcript. */
const subjectFor = (transcript) => ({ async __ninthtool_observe() { return transcript; } });

/** A subject frame whose probe rejects with the given value, which need not be an Error. */
const subjectThrowing = (thrown) => ({
  async __ninthtool_observe() { throw thrown; },
});

/* ------------------------------------------------------------------ the one page */

let page = null;

before(async () => { page = await mount(); });

/* ------------------------------------------------------------------ boot */

test('boot renders the catalogue and publishes the three standing tools', () => {
  assert.deepEqual(page.registered, ['nt_list_behaviours', 'nt_explain_behaviour', 'nt_run_audit']);
  assert.equal(page.tools.size, 3, 'nt_get_findings must not exist before an audit has run');
  assert.equal(page.el('status').textContent,
    'Ready. Three tools published, so your own agent can run this.');
  assert.equal(page.el('run').disabled, false);
  assert.equal(page.el('blocker').hidden, true, 'nothing is blocked on a page that can run');
  assert.equal(page.el('summary').hidden, true);
  assert.equal(verdictCards(page.el('groups')).total, CATALOGUE,
    'the catalogue renders every behaviour before any run');
  assert.equal(verdictCards(page.el('groups')).pass, 0, 'nothing is a verdict before a run');

  // Before a run each card offers the stored measurement rather than a verdict, and the label
  // carries the browser it was measured against.
  assert.ok(keyRows(page.el('groups')).includes('Promise'));
  assert.ok(keyRows(page.el('groups')).includes(`On ${MEASURED_AGAINST}`));
  assert.match(page.el('catalogue-lede').textContent, new RegExp(`^${CATALOGUE} behaviours[.]`));
});

/* ------------------------------------------------------------------ nt_list_behaviours */

test('nt_list_behaviours defaults to every group and narrows to one when asked', async () => {
  // Called with NO argument at all, which is what an agent that reads the schema and sends nothing
  // does. The handler has to treat a missing bag as an empty one rather than reading a property
  // off undefined.
  const all = payload(await page.call('nt_list_behaviours'));
  assert.equal(all.behaviours.length, CATALOGUE);
  assert.equal(all.measuredAgainst, MEASURED_AGAINST);
  assert.equal(all.counts.total, CATALOGUE);

  const group = GROUPS[0];
  const narrowed = payload(await page.call('nt_list_behaviours', { group }));
  const expected = BEHAVIOURS.filter((b) => b.group === group);
  assert.ok(expected.length > 0 && expected.length < CATALOGUE,
    `the catalogue must hold more than one group for this to prove anything, ${group} holds all of it`);
  assert.deepEqual(narrowed.behaviours.map((b) => b.id), expected.map((b) => b.id));

  // Explicit "all" is the same answer as no argument, which is what the enum promises.
  assert.equal(payload(await page.call('nt_list_behaviours', { group: 'all' })).behaviours.length,
    CATALOGUE);
});

test('nt_list_behaviours refuses an argument nobody declared and names the one it does', async () => {
  const refused = said(await page.call('nt_list_behaviours', { group: 'all', colour: 'red' }));
  assert.match(refused, /^Refused\./);
  assert.match(refused, /This tool declares group and was sent colour\./);
  assert.match(refused, /Nothing was read and nothing changed\./);
});

/* ------------------------------------------------------------------ nt_explain_behaviour */

test('nt_explain_behaviour answers on a known id, case insensitively', async () => {
  const wanted = BEHAVIOURS[0];
  const found = payload(await page.call('nt_explain_behaviour', { id: wanted.id.toLowerCase() }));
  assert.equal(found.id, wanted.id);
  assert.equal(found.title, wanted.title);
  assert.equal(found.reproduce, wanted.reproduce,
    'the command that reproduces a row is the reason this tool exists');
});

test('an id that is not in the catalogue is answered with the ids that are', async () => {
  const answer = said(await page.call('nt_explain_behaviour', { id: 'ZZ9' }));
  assert.match(answer, /^No behaviour "ZZ9"\./);
  for (const b of BEHAVIOURS) {
    assert.ok(answer.includes(b.id), `${b.id} is in the catalogue and was not offered`);
  }
});

test('a required argument that is missing, null or blank is refused, and a number is not an id', async () => {
  /*
   * THE PAGE'S OWN P5 ROW. `onlyDeclared` once filtered UNDECLARED keys and never read the
   * schema's `required`, so `{}` passed validation, `undefined` was coerced to the empty string,
   * and the tool answered. Each shape below defeats a different half hearted version of the check:
   * a key test alone lets `{id: null}` through, and a truthiness test alone lets `{id: '   '}`
   * through.
   */
  for (const input of [{}, { id: null }, { id: undefined }, { id: '   ' }]) {
    const answer = said(await page.call('nt_explain_behaviour', input));
    assert.match(answer, /^Refused\./, `${JSON.stringify(input)} was answered instead of refused`);
    assert.match(answer, /This tool requires id and id was missing or blank\./);
    assert.ok(!/Known ids:/.test(answer),
      'it answered the question instead of refusing, which is exactly what P5 measures');
  }

  // A NUMBER IS NOT BLANK AND IS NOT AN ID. It clears the required check, because the schema says
  // a string and the browser enforces nothing, and it must not be coerced into a catalogue entry.
  // This is the one input that reaches `String(value || '')` with a falsy value.
  const numeric = said(await page.call('nt_explain_behaviour', { id: 0 }));
  assert.match(numeric, /^No behaviour ""\./,
    `a numeric id was turned into something: ${numeric}`);
});

test('an undeclared argument is refused even when the required one is present', async () => {
  const refused = said(await page.call('nt_explain_behaviour', { id: BEHAVIOURS[0].id, verbose: true }));
  assert.match(refused, /^Refused\./);
  assert.match(refused, /was sent verbose\./);
});

/* ------------------------------------------------------------------ a complete run */

test('a complete run agrees with itself on the screen and through the tool', async () => {
  page.subject.contentWindow = subjectFor(complete());
  const parsed = payload(await page.call('nt_run_audit', {}));

  // The fixture first. A degraded transcript would take the error branch and everything below
  // would pass for the wrong reason.
  assert.deepEqual(parsed.counts, {
    total: 2, pass: 1, fail: 1, notApplicable: 0, byDesign: 0, outOfScope: CATALOGUE - 2, catalogue: CATALOGUE,
  });
  assert.equal(parsed.state, 'complete');
  assert.equal(parsed.partial, false);
  assert.match(parsed.run.id, /^run-1-\d+$/);
  assert.equal(parsed.run.subject, 'https://ninthtool.invalid/fixtures/subject.html');

  assert.equal(page.el('status').textContent,
    'Done. 1 of 2 promises broken. The tool nt_get_findings is now published.');
  assert.equal(page.el('summary').hidden, false);
  assert.match(page.el('tiles').textContent, /promises broken/);
  assert.match(page.el('tiles').textContent, /promises kept/);
  assert.ok(!/could not be run/.test(page.el('tiles').textContent),
    'a run with nothing unobserved must not render the unobserved tile');
  assert.match(page.el('env').textContent, new RegExp(parsed.run.id));
  assert.deepEqual(verdictCards(page.el('groups')),
    { total: CATALOGUE, pass: 1, fail: 1, notApplicable: 0, byDesign: 0 });

  // A judged card names what was measured rather than what the catalogue stored.
  assert.ok(keyRows(page.el('groups')).includes('Observed'));
  assert.ok(page.tools.has('nt_get_findings'), 'the ninth tool appears when there are findings');
});

test('the findings tool filters by verdict and refuses what it does not declare', async () => {
  const all = payload(await page.call('nt_get_findings', {}));
  assert.equal(all.findings.length, CATALOGUE, 'nothing disappears from the report');
  assert.equal(all.state, 'complete');
  assert.equal(all.counts.fail, 1);

  const broken = payload(await page.call('nt_get_findings', { only: 'broken' }));
  assert.deepEqual(broken.findings.map((f) => f.verdict), ['fail']);
  const kept = payload(await page.call('nt_get_findings', { only: 'kept' }));
  assert.deepEqual(kept.findings.map((f) => f.verdict), ['pass']);
  const notRun = payload(await page.call('nt_get_findings', { only: 'not-run' }));
  assert.deepEqual(notRun.findings, [],
    'this run observed everything it selected, so there is nothing to report as not run');

  // An unknown filter name is not a filter. It falls through to the whole report rather than
  // silently returning nothing, which would read as a clean run.
  assert.equal(payload(await page.call('nt_get_findings', { only: 'nonsense' })).findings.length,
    CATALOGUE);

  const refused = said(await page.call('nt_get_findings', { only: 'broken', sneaky: 1 }));
  assert.match(refused, /^Refused\./);
  assert.match(refused, /This tool declares only and was sent sneaky\./);
});

/* ------------------------------------------------------------------ clearing */

test('the clear key withdraws the tool, and only when there is something to clear', async () => {
  page.fireKey('a');
  assert.ok(page.tools.has('nt_get_findings'), 'any key at all cleared the findings');

  page.fireKey('Escape');
  assert.equal(page.tools.has('nt_get_findings'), false);
  assert.equal(page.tools.size, 3, 'the standing tools must survive a clear');
  assert.equal(page.el('summary').hidden, true);
  assert.equal(page.el('status').textContent,
    'Cleared. nt_get_findings has been withdrawn from the tool surface.');
  assert.deepEqual(verdictCards(page.el('groups')),
    { total: CATALOGUE, pass: 0, fail: 0, notApplicable: 0, byDesign: 0 });

  // A second press has nothing to clear and must leave the line where the first press left it,
  // rather than announcing a withdrawal that did not happen.
  page.el('status').textContent = 'untouched';
  page.fireKey('Escape');
  assert.equal(page.el('status').textContent, 'untouched');
});

/* ------------------------------------------------------------------ a partial run */

test('a partial run publishes the tool, labels itself partial and never uses success wording', async () => {
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
  assert.ok(!/\bDone\b/.test(status), `an incomplete run read as a finished one: ${status}`);
  assert.match(status, /1 could not be observed/);

  // The unobserved tile only exists on a run that has something unobserved to report.
  assert.match(page.el('tiles').textContent, /could not be run/);
  assert.match(page.el('env').textContent, /INCOMPLETE: everySelectedObserved/);

  // A row that was not run says so, and gives the reason, rather than showing a blank observation.
  assert.ok(keyRows(page.el('groups')).includes('Not run'));
  assert.equal(verdictCards(page.el('groups')).notApplicable, 1);

  assert.equal(payload(await page.call('nt_get_findings', {})).partial, true,
    'a partial answer must be labelled partial wherever it is read');
  assert.deepEqual(payload(await page.call('nt_get_findings', { only: 'not-run' })).findings.map((f) => f.id),
    ['B2']);
});

/* ------------------------------------------------------------------ nothing measured */

test('a run that measured nothing reports that, and identifies what it could not identify', async () => {
  page.subject.contentWindow = subjectFor(anonymousAndUnmeasured());
  const result = await page.call('nt_run_audit', {});
  const parsed = payload(result);

  assert.equal(parsed.state, 'error');
  assert.equal(parsed.measured, false);
  assert.equal(result.isError, true);
  assert.equal(parsed.counts, undefined, 'a run that measured nothing has no counts to report');
  assert.match(parsed.said, /This is not a finding of zero defects\./);

  const status = page.el('status').textContent;
  assert.match(status, /^Nothing could be measured here\./);
  assert.ok(!/promises broken/.test(status), `the status announced a count: ${status}`);
  assert.match(status, /nt_get_findings has not been published\./);
  assert.equal(page.tools.has('nt_get_findings'), false);

  // The tiles say what happened rather than counting to zero.
  const tiles = page.el('tiles').textContent;
  assert.match(tiles, /unobserved, nothing measured/);
  assert.match(tiles, /behaviours this browser could run/);
  assert.ok(!/promises broken/.test(tiles), `the tiles announced a count: ${tiles}`);

  // THE ENVIRONMENT LINE NAMES WHAT IT DOES NOT KNOW. This transcript carries no url, no user
  // agent and no host object, and each has to render as a word rather than as an empty gap or the
  // string "null".
  const env = page.el('env').textContent;
  assert.match(env, /unknown browser/);
  assert.match(env, /host object none/);
  assert.match(env, /subject unknown/);
  assert.ok(!/null/.test(env), `a null reached the screen as text: ${env}`);

  // With no reason in the transcript there is nothing to quote, so the sentence ends rather than
  // trailing a colon into nothing.
  const blocker = page.el('blocker').textContent;
  assert.equal(page.el('blocker').hidden, false);
  assert.match(blocker, /The top document exposed document\.modelContext\./);
  assert.match(blocker, /exposed no host object\. Every row below/);
  assert.ok(!/most common cause/.test(blocker), `the page is guessing at a cause: ${blocker}`);
});

test('the reason on screen is the one the transcript measured, not a guess at a cause', async () => {
  page.subject.contentWindow = subjectFor(unmeasuredWithReason());
  assert.equal(payload(await page.call('nt_run_audit', {})).state, 'error');

  const blocker = page.el('blocker').textContent;
  // The string has to come out of the transcript, so a hardcoded sentence cannot satisfy this.
  assert.ok(blocker.includes(REFUSAL), `the measured reason was discarded. Blocker said: ${blocker}`);
  assert.match(blocker,
    /The subject frame at https:\/\/upgradedev\.github\.io\/ninthtool\/fixtures\/subject\.html exposed no host object: /);
  assert.equal(page.tools.has('nt_get_findings'), false,
    'a run that measured nothing must not publish findings');
});

/* ------------------------------------------------------------------ runs that fail */

test('a subject frame that is not there fails the run and says so, holding no earlier answer', async () => {
  // Restore a real result first, so the failure below has something it could wrongly keep.
  page.subject.contentWindow = subjectFor(complete());
  const good = payload(await page.call('nt_run_audit', {}));
  assert.equal(good.counts.total, 2, 'the first run must succeed or this test proves nothing');
  assert.ok(page.tools.has('nt_get_findings'));

  page.subject.contentWindow = null;
  const result = await page.call('nt_run_audit', {});
  const parsed = payload(result);

  assert.equal(parsed.state, 'error');
  assert.equal(result.isError, true);
  assert.equal(parsed.counts, undefined, 'the previous run counts came back');
  assert.notEqual(parsed.run.id, good.run.id, 'a failed run still gets its own identity');
  assert.equal(page.tools.has('nt_get_findings'), false, 'a stale answer is still readable');
  assert.equal(page.el('summary').hidden, true);
  assert.match(page.el('status').textContent, /no earlier result is being shown/);
  assert.match(page.el('status').textContent, /has not finished loading/);
  assert.equal(page.el('run').disabled, false, 'the control must come back after a failure');
});

test('a frame that loaded without the probe script fails the same way as no frame at all', async () => {
  // A window object exists and the function on it does not. That is a different condition from a
  // missing frame and it has to reach the same refusal, because the run cannot measure either.
  page.subject.contentWindow = { location: { href: 'about:blank' } };
  const parsed = payload(await page.call('nt_run_audit', {}));
  assert.equal(parsed.state, 'error');
  assert.match(page.el('status').textContent, /did not run its script/);
});

test('a probe that rejects is reported with whatever it rejected with, Error or not', async () => {
  page.subject.contentWindow = subjectThrowing(new Error('the frame went away mid run'));
  assert.equal(payload(await page.call('nt_run_audit', {})).state, 'error');
  assert.match(page.el('status').textContent, /the frame went away mid run$/);

  // NOT AN ERROR OBJECT. A page can reject with anything, and behaviour B1 is the row about a
  // reason being erased on the way to the caller, so this page must not erase one itself.
  page.subject.contentWindow = subjectThrowing('a bare string, thrown');
  assert.equal(payload(await page.call('nt_run_audit', {})).state, 'error');
  assert.match(page.el('status').textContent, /a bare string, thrown$/);

  // And a rejection carrying nothing at all still leaves a readable line rather than crashing the
  // handler that is trying to describe it.
  page.subject.contentWindow = subjectThrowing(null);
  assert.equal(payload(await page.call('nt_run_audit', {})).state, 'error');
  assert.match(page.el('status').textContent, /^The audit did not finish/);
});

test('a frame with no source still gets a run identity, with the subject recorded as absent', async () => {
  page.subject.src = '';
  page.subject.contentWindow = null;
  const parsed = payload(await page.call('nt_run_audit', {}));
  assert.equal(parsed.state, 'error');
  assert.equal(parsed.run.subject, null,
    'a run against nothing must record nothing rather than inventing a URL');
  page.subject.src = 'https://ninthtool.invalid/fixtures/subject.html';
});

test('nt_run_audit refuses an argument nobody declared, and does not run', async () => {
  const before2 = page.el('status').textContent;
  const refused = said(await page.call('nt_run_audit', { force: true }));
  assert.match(refused, /^Refused\./);
  assert.match(refused, /This tool declares no parameters and was sent force\./);
  assert.equal(page.el('status').textContent, before2, 'the refused call ran the audit anyway');
});

/* ------------------------------------------------------------------ the page as a whole */

test('every element the page ever asked for is one index.html declares', () => {
  // Placed last on purpose: by now this one boot has rendered the catalogue, three shapes of
  // result, four failures and a clear, so the lookup log covers every branch that touches the DOM.
  const missing = page.lookups.filter((l) => !l.found);
  assert.deepEqual(missing, [], 'app.js queried an element the shipped page does not carry');
  assert.ok(page.lookups.length > 50,
    `only ${page.lookups.length} lookups were recorded, so this walk did not exercise the page`);
  page.dispose();
});
