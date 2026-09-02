/**
 * The reading surface, driven rather than described.
 *
 * WHY THIS FILE EXISTS. This page was measured as a document: 3,721 words, about thirteen screens,
 * and three interactive elements on the whole of it, one of them a button that most visitors cannot
 * press. Twenty behaviour cards in six groups were rendered fully open at all times with no way to
 * jump to one, and the screen a visitor without the flag actually lands on told them to go and find
 * a different browser and offered them nothing they could do where they were.
 *
 * Three things were changed and each of them is a claim, so each of them gets a test that can fail:
 *
 *   1. the blocker carries the working command, and it is the command the README ships
 *   2. the cards arrive folded and open on demand, with nothing removed
 *   3. the index reaches every group and every one of the twenty rows
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. Nothing about the run state machine, which
 * tests/unit/ui_state.test.js owns and which none of this touches. The one property this file does
 * assert about it is the negative: the index is built once, from the catalogue, so a run that
 * blanks and re-renders the cards cannot leave it pointing at rows that are not there.
 *
 * THE DOUBLE IS BUILT TO FAIL, on the same terms as the two that came before it. Element names and
 * their starting visibility are read out of index.html, so it cannot invent a control the shipped
 * page lacks, and an unknown name resolves to null rather than springing into being. `navigator` is
 * a parameter, because the copy control has two branches and a double that always has a clipboard
 * can only ever prove one of them.
 *
 * WATCHED FAILING. Every test below was turned red once, deliberately, in a scratch copy of the
 * tree. The mutations and what each one reddened are recorded in the pull request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BEHAVIOURS, GROUPS } from '../../src/judge/behaviours.js';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * The controls the shipped page carries, which of them start hidden, and what the page already
 * wrote inside them.
 *
 * THE STATIC TEXT MATTERS AS MUCH AS THE NAME. `[data-el="npx-command"]` is not a control the
 * script fills in; it is a line of shipped markup that the copy control reads back. A double that
 * starts every element empty would let the copy control copy an empty string and still pass, which
 * is the shape of fixture that proves nothing. So the inner text is read out of index.html, for the
 * elements simple enough to read it from, and the rest start empty as before.
 */
const PAGE_HTML = read('index.html');
const PAGE_ELEMENTS = [...PAGE_HTML.matchAll(/<([a-z]+)[^>]*data-el="([^"]+)"[^>]*>/g)]
  .map((m) => {
    const closing = PAGE_HTML.indexOf(`</${m[1]}>`, m.index + m[0].length);
    const inner = closing === -1 ? '' : PAGE_HTML.slice(m.index + m[0].length, closing);
    return {
      name: m[2],
      hidden: /\shidden(\s|>|=)/.test(m[0]),
      // Only when the element holds plain text. Anything with markup inside it is left empty
      // rather than guessed at, because a half parsed double is worse than an honest blank.
      text: /[<>]/.test(inner) ? '' : inner,
    };
  });

test('the double reads the shipped page rather than inventing one', () => {
  // If this parse ever silently found nothing, every assertion in this file would go quiet.
  assert.ok(PAGE_ELEMENTS.length >= 10, `only ${PAGE_ELEMENTS.length} elements were parsed`);
  assert.deepEqual(PAGE_ELEMENTS.filter((e) => e.hidden).map((e) => e.name).sort(),
    ['blocker', 'summary']);
  const command = PAGE_ELEMENTS.find((e) => e.name === 'npx-command');
  assert.ok(command && command.text.trim(), 'the double would hand the copy control an empty string');
});

/* ------------------------------------------------------------------ the doubles */

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.children = [];
    this.own = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
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

  /** What a click is, on a node that has one. A node with no listener is a control that does nothing. */
  async click() {
    const fns = this.listeners.get('click') || [];
    assert.notEqual(fns.length, 0, `${this.tagName}.${this.className} has no click listener at all`);
    for (const fn of fns) await fn();
  }
}

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

let mountCount = 0;

/**
 * Boot the page against doubles.
 *
 * @param {object} [options]
 * @param {boolean} [options.host] false to boot in a browser with no WebMCP host object
 * @param {object|null} [options.clipboard] the clipboard `navigator` exposes, null for none
 */
async function mount(options = {}) {
  const elements = new Map(PAGE_ELEMENTS.map(({ name, hidden, text }) => {
    const node = new FakeNode('div');
    node.hidden = hidden;
    node.own = text;
    return [name, node];
  }));

  const doc = {
    querySelector(selector) {
      const match = /^\[data-el="(.+)"\]$/.exec(selector);
      const name = match ? match[1] : null;
      return name && elements.has(name) ? elements.get(name) : null;
    },
    createElement: (tag) => new FakeNode(tag),
  };

  const tools = new Map();
  const ctx = {
    async registerTool(descriptor, opts) {
      const signal = opts && opts.signal;
      if (signal && signal.aborted) return;
      tools.set(descriptor.name, descriptor);
      if (signal) signal.addEventListener('abort', () => { tools.delete(descriptor.name); });
    },
  };
  if (options.host !== false) doc.modelContext = ctx;

  const nav = { userAgent: 'NodeDouble/1.0' };
  if (options.clipboard) nav.clipboard = options.clipboard;

  const previous = new Map();
  for (const [name, value] of [['document', doc], ['navigator', nav],
    ['window', { addEventListener() {} }]]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const subject = elements.get('subject');
  subject.src = 'https://ninthtool.invalid/fixtures/subject.html';
  subject.contentWindow = null;

  mountCount += 1;
  await import(new URL(`../../src/ui/app.js?reading=${mountCount}`, import.meta.url).href);
  await flush();
  await flush();

  const el = (name) => elements.get(name);
  const cards = () => el('groups').descendants().filter((n) => n.tagName === 'article');
  return {
    el,
    cards,
    tools,
    /** Every fold the render produced, in order, one per card. */
    folds: () => cards().map((card) => {
      const found = [card, ...card.descendants()].filter((n) => n.tagName === 'details');
      assert.equal(found.length, 1, `${card.id} does not hold exactly one fold`);
      return found[0];
    }),
    /** Every anchor in the index, with the href it carries. */
    indexLinks: () => el('index').descendants().filter((n) => n.tagName === 'a'),
    dispose() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

/* ------------------------------------------------------------------ the command in the blocker */

/**
 * The one line the README tells a reader to run, taken from the README rather than written twice.
 *
 * THE SAME DEVICE THE FLAGSHIP SENTENCE USES. Two copies of a command line drift, and the copy that
 * drifts is always the one nobody runs. So the README is the source and the page is checked
 * against it, which means a change to either one that is not a change to both fails here.
 */
function commandFromReadme() {
  const line = read('README.md').split('\n')
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith('npx --yes '));
  assert.ok(line, 'the README no longer carries an npx command, so there is nothing to check against');
  return line;
}

test('the blocker carries the command the README ships, word for word', () => {
  const command = commandFromReadme();
  const page = read('index.html');
  assert.ok(page.includes(command),
    `index.html does not carry the command the README ships:\n  ${command}`);

  // And in the element the copy control reads, not merely somewhere on the page.
  const block = /<code data-el="npx-command">([^<]*)<\/code>/.exec(page);
  assert.ok(block, 'the page has no [data-el="npx-command"] for the copy control to read');
  assert.equal(block[1].trim(), command,
    'the command the copy control would copy is not the command the README ships');

  // It has to be inside the panel the blocker owns. A command sitting anywhere else on a fifteen
  // screen page is not an answer to "this browser cannot run the audit".
  const panel = /<div class="blocker-do" data-el="blocker-do">([\s\S]*?)<\/div>\s*<\/div>/.exec(page);
  assert.ok(panel, 'the blocker no longer carries a panel of its own');
  assert.ok(panel[1].includes(command), 'the command is on the page but not inside the blocker panel');
});

test('the terminal route is offered on the screen that needs it and withdrawn on the one that does not', async (t) => {
  const blocked = await mount({ host: false });
  t.after(() => blocked.dispose());
  assert.equal(blocked.el('blocker').hidden, false, 'a disabled control with no reason is a gate to null');
  assert.equal(blocked.el('blocker-do').hidden, false,
    'the reader who cannot run the audit is the reader the command exists for');
  blocked.dispose();

  const runnable = await mount();
  t.after(() => runnable.dispose());
  assert.equal(runnable.el('blocker').hidden, true, 'nothing is blocked on a page that can run');
  assert.equal(runnable.el('blocker-do').hidden, true,
    'a browser that can run the audit here does not need to be sent to a terminal');
});

test('the copy control copies what the page shows, and reports what it did', async (t) => {
  const written = [];
  const page = await mount({ host: false, clipboard: { async writeText(value) { written.push(value); } } });
  t.after(() => page.dispose());

  assert.equal(page.el('copy-command').disabled, false, 'a clipboard exists, so nothing is blocked');
  await page.el('copy-command').click();
  assert.deepEqual(written, [commandFromReadme()],
    'the control copied something other than the command on the page');
  assert.match(page.el('copy-said').textContent, /Copied/);
});

test('a clipboard that refuses is reported in words, and a browser with none disables the control', async (t) => {
  const refusing = await mount({
    host: false,
    clipboard: { async writeText() { throw new Error('the user denied it'); } },
  });
  t.after(() => refusing.dispose());
  await refusing.el('copy-command').click();
  assert.match(refusing.el('copy-said').textContent, /the user denied it/,
    'the refusal was swallowed, so the control failed silently');
  assert.match(refusing.el('copy-said').textContent, /select the line above/,
    'a refusal with no way forward is the dead end this panel exists to remove');
  refusing.dispose();

  const none = await mount({ host: false });
  t.after(() => none.dispose());
  assert.equal(none.el('copy-command').disabled, true);
  assert.match(none.el('copy-said').textContent, /no clipboard/,
    'a disabled control with no reason beside it is a gate to null');
});

/* ------------------------------------------------------------------ the fold */

test('every behaviour card arrives folded, and nothing has been taken out of it', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  const cards = page.cards();
  assert.equal(cards.length, BEHAVIOURS.length, 'the catalogue no longer renders in full');
  const folds = page.folds();
  assert.deepEqual(folds.filter((f) => f.open).map((f, i) => i), [],
    'a card is open before the reader has asked for it, which is the state this change removed');

  // NOTHING WAS DELETED, WHICH IS THE HALF A COLLAPSE TEST USUALLY FORGETS. Progressive disclosure
  // that quietly drops the reproduce command is not disclosure, it is deletion with a chevron.
  for (const behaviour of BEHAVIOURS) {
    const card = cards.find((c) => c.id === `row-${behaviour.id}`);
    assert.ok(card, `${behaviour.id} has no card`);
    const text = card.textContent;
    for (const [what, value] of [['why', behaviour.why], ['promise', behaviour.promise],
      ['measurement', behaviour.measured], ['reproduce command', behaviour.reproduce]]) {
      assert.ok(text.includes(value), `${behaviour.id} lost its ${what} when the card was folded`);
    }
  }
});

test('the fold controls open and close every row, and say which they did', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  await page.el('expand-all').click();
  assert.equal(page.folds().filter((f) => f.open).length, BEHAVIOURS.length,
    'opening every row left some of them shut');
  assert.match(page.el('fold-said').textContent, new RegExp(`All ${BEHAVIOURS.length} rows are open`));

  await page.el('collapse-all').click();
  assert.equal(page.folds().filter((f) => f.open).length, 0, 'closing every row left some of them open');
  assert.match(page.el('fold-said').textContent, /Nothing was removed/);

  // AND NOT INTO THE RUN'S LIVE REGION. Writing fold chatter into [data-el="status"] would overwrite
  // the only line that says what an audit found, and announce it to a screen reader mid run.
  assert.ok(!/rows are open|rows are closed/.test(page.el('status').textContent),
    'the fold is writing into the run status line');
});

/* ------------------------------------------------------------------ the index */

test('the index reaches every group and every one of the twenty rows', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  const links = page.indexLinks();
  const hrefs = links.map((a) => a.href);

  // Every group the catalogue actually populates has a jump link, and it lands on a section that
  // the render really produced. An anchor to an id nothing carries is a link to the top of the page.
  const sectionIds = new Set(page.el('groups').descendants()
    .filter((n) => n.tagName === 'section').map((n) => n.id));
  const populated = GROUPS.filter((group) => BEHAVIOURS.some((b) => b.group === group));
  assert.ok(populated.length >= 2, 'fewer than two groups are populated, so this proves nothing');
  for (const group of populated) {
    assert.ok(hrefs.includes(`#${group ? `group-${group}` : ''}`),
      `the index has no jump link for the ${group} group`);
    assert.ok(sectionIds.has(`group-${group}`),
      `the index points at #group-${group} and the render puts that id on nothing`);
  }

  // And every behaviour, by id, landing on the card that carries it.
  const cardIds = new Set(page.cards().map((c) => c.id));
  for (const behaviour of BEHAVIOURS) {
    assert.ok(hrefs.includes(`#row-${behaviour.id}`), `the index cannot reach ${behaviour.id}`);
    assert.ok(cardIds.has(`row-${behaviour.id}`),
      `the index points at #row-${behaviour.id} and no card carries that id`);
  }
});

test('every anchor written into the page lands on something the page carries', () => {
  /*
   * THE SECTION NAV IS MARKUP, SO NO MOUNT CAN SEE IT, AND IT STILL HAS TO RESOLVE.
   *
   * The sticky bar at the top is seven plain anchors in index.html. Renaming a section's id is a
   * one character edit that leaves the link looking exactly the same and quietly sends the reader
   * to the top of the page instead. Found that way: deleting id="behaviours" from the findings
   * section broke the busiest link in the bar and every test in this repository stayed green.
   */
  const hrefs = [...PAGE_HTML.matchAll(/<a\s+href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5, `only ${hrefs.length} anchors were found, so this proves nothing`);
  const ids = new Set([...PAGE_HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const dangling = hrefs.filter((target) => !ids.has(target));
  assert.deepEqual(dangling, [],
    'these anchors point at an id nothing on the page carries, so they scroll to the top instead');
});

test('a jump to a row opens the row it lands on', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  const wanted = BEHAVIOURS[BEHAVIOURS.length - 1].id;
  const link = page.indexLinks().find((a) => a.href === `#row-${wanted}`);
  assert.ok(link, `there is no index link for ${wanted}`);
  await link.click();

  const cards = page.cards();
  const target = cards.find((c) => c.id === `row-${wanted}`);
  const fold = [target, ...target.descendants()].find((n) => n.tagName === 'details');
  assert.equal(fold.open, true, 'arriving at a folded row is arriving at a headline');
  assert.equal(page.folds().filter((f) => f.open).length, 1,
    'jumping to one row opened rows the reader did not ask for');
});

test('a run replaces every fold, and opens only the rows it found broken', async (t) => {
  /*
   * THE ONE CROSSING NEITHER SUITE COVERED.
   *
   * tests/unit/ui_state.test.js drives runs and never touches a fold. Everything above drives folds
   * and never runs. The interaction between them is a real ordering: `renderGroups` blanks the
   * cards at the top of a run and rebuilds them, so the fold registry has to be emptied and refilled
   * or "open every row" is left holding twenty nodes that are no longer on the page. That is the
   * stale-answer shape this module has already had once, in `lastResult`, and arguing it from the
   * code is what let it happen the first time.
   */
  const page = await mount();
  t.after(() => page.dispose());

  page.el('subject').contentWindow = {
    async __ninthtool_observe() {
      return {
        meta: {
          api: 'document.modelContext',
          url: 'https://ninthtool.invalid/fixtures/subject.html',
          userAgent: 'NodeDouble/1.0',
        },
        scope: { requestedBehaviours: ['A1', 'A2'] },
        observations: {
          A1: { argCount: 2, optionsTypeof: 'object', hasSignal: true },
          A2: { inputSchemaTypeof: 'undefined' },
        },
        errors: [],
      };
    },
  };

  await page.el('expand-all').click();
  assert.equal(page.folds().filter((f) => f.open).length, BEHAVIOURS.length,
    'the fixture did not manage to open the rows, so the run below replaces nothing');

  const audit = page.tools.get('nt_run_audit');
  assert.ok(audit, 'the standing tools are not published, so this fixture is not booted');
  await audit.execute({});

  const cards = page.cards();
  assert.equal(cards.length, BEHAVIOURS.length, 'the run did not render the catalogue back');
  const broken = cards.filter((c) => c.className.includes('v-fail'));
  assert.equal(broken.length, 1, 'this fixture is meant to produce exactly one broken row');

  const folds = page.folds();
  assert.equal(folds.length, BEHAVIOURS.length, 'the fold registry did not follow the re-render');
  assert.equal(folds.filter((f) => f.open).length, 1,
    'either the run left the reader with rows they did not ask for, or the broken row is shut');

  // And the registry is the NEW nodes, not the ones the run discarded. Closing every row has to
  // close the rows that are on the page.
  await page.el('collapse-all').click();
  assert.equal(page.folds().filter((f) => f.open).length, 0,
    'the fold controls are holding nodes the run replaced');
  // The count the control reports is the registry's own length, so this is the assertion that
  // actually sees a registry the run failed to empty: it would say forty.
  assert.match(page.el('fold-said').textContent,
    new RegExp(`All ${BEHAVIOURS.length} rows are closed`),
    'the fold controls are counting rows that are no longer on the page');
});

test('the index is built from the catalogue and not from the page it points at', async (t) => {
  const page = await mount({ host: false });
  t.after(() => page.dispose());

  /*
   * THE PROPERTY THAT KEEPS THE INDEX OUT OF THE RUN LIFECYCLE.
   *
   * `renderGroups` blanks and rebuilds every card at the top of a run. If the index were derived
   * from those nodes it would have to be rebuilt too, and a run that failed between the blanking
   * and the rebuild would leave a navigation pointing at rows that are not on the page. It is built
   * from BEHAVIOURS instead, so the only thing that has to hold is that the render puts the same
   * ids back. That is what this asserts: re-render, and the same anchors still resolve.
   */
  const before = page.indexLinks().map((a) => a.href);
  assert.equal(page.cards().length, BEHAVIOURS.length,
    'the fixture never booted, so clearing the cards below proves nothing');

  // The same thing renderGroups does at the top of every run, and nothing more.
  page.el('groups').textContent = '';
  assert.equal(page.cards().length, 0, 'the fixture did not manage to blank the cards');

  const after = page.indexLinks().map((a) => a.href);
  assert.deepEqual(after, before,
    'the index changed when the cards were cleared, so it is derived from them');
  assert.ok(after.length >= BEHAVIOURS.length, 'the index lost links it had before');
});
