/**
 * The page. It renders the catalogue, runs the audit against the subject frame, and publishes this
 * page's own tools so a visitor's agent can do all of it without touching the screen.
 *
 * THIS PAGE PRACTISES THE BEHAVIOUR IT IS NAMED FOR. `nt_get_findings` does not exist until an
 * audit has produced findings, and it is WITHDRAWN when they are cleared. It is registered with the
 * signal in the options bag, which is the only place that works, and behaviour C2 exists because
 * putting it anywhere else fails silently. The tool count in the status line moves when it happens,
 * so the ninth tool appearing and disappearing is visible rather than described.
 *
 * NOTHING IS GATED TO NULL. If there is no WebMCP host object the run control is disabled and the
 * reason is rendered beside it, in words, with what to do about it. The catalogue renders either
 * way, so the page is never blank and a judge who arrives on a browser without the flag still sees
 * what this is.
 */
import { BEHAVIOURS, GROUPS, headlineCounts, MEASURED_AGAINST, MEASURED_ON } from '../judge/behaviours.js';
import { judge } from '../judge/verdict.js';
import { findModelContext } from '../probe/observe.js';

const el = (name) => document.querySelector(`[data-el="${name}"]`);

/** What each group is, in one sentence, because the difference between them is the whole argument. */
const GROUP_COPY = {
  'your-page': {
    heading: 'Your page',
    note: 'These read the tools this page publishes, snapshotted before the probe registered '
      + 'anything of its own. They are the rows a build should go red on, because they are the ones '
      + 'a page author can fix. Everything below them is the host, and is the same wherever you '
      + 'point this.',
  },
  'spec-divergence': {
    heading: 'The browser diverges from the specification it implements',
    note: 'The W3C draft and Chromium’s own IDL say one thing and the shipping build does '
      + 'another. A page written to the documented contract breaks.',
  },
  'standard-gap': {
    heading: 'The standard provides no way to do it',
    note: 'Not defects in any browser. Gaps, and the more interesting half, because the draft '
      + 'flags one of them itself.',
  },
  'silent-trap': {
    heading: 'It works, but the obvious way to write it fails silently',
    note: 'Nothing is thrown and nothing is logged. The page believes it did the thing.',
  },
  holds: {
    heading: 'And these hold',
    note: 'A suite that only ever prints failures cannot be trusted to notice a pass, so the '
      + 'things that work are reported too.',
  },
};

const VERDICT_CLASS = { pass: 'v-pass', fail: 'v-fail', 'not-applicable': 'v-na' };
const VERDICT_WORD = { pass: 'HOLDS', fail: 'BROKEN', 'not-applicable': 'NOT RUN' };


/**
 * Refuse an argument object this page did not declare.
 *
 * WHY EVERY TOOL ON THIS PAGE CALLS THIS. Behaviour C3 measured that the browser enforces nothing
 * at all on a script registered tool: a declared `required` is ignored and a declared string
 * accepts 123. So the schema is documentation, and the only validation that exists is the one the
 * page writes. Row P5 checks whether a page did, and this page failed its own row P5 on the first
 * run that measured it: both read only tools accepted a property that was in nobody's schema.
 *
 * The refusal returns a normal result rather than throwing, because behaviour B1 measured that
 * throwing erases the message. A caller gets the reason this way, and reads it as a result, which
 * is the least bad of the two options the standard offers.
 *
 * @param {object} input whatever the caller sent
 * @param {string[]} allowed the property names this tool declares
 * @returns {{ok: true, value: object}|{ok: false, said: string}}
 */
function onlyDeclared(input, allowed) {
  const given = input && typeof input === 'object' ? input : {};
  const unknown = Object.keys(given).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    return {
      ok: false,
      said: `Refused. This tool declares ${allowed.length ? allowed.join(', ') : 'no parameters'}`
        + ` and was sent ${unknown.join(', ')}. Nothing was read and nothing changed.`,
    };
  }
  return { ok: true, value: given };
}

/** The refusal shape every tool on this page uses, in one place. */
function refuse(said) {
  return { content: [{ type: 'text', text: said }] };
}

/** The last judged result, and the handle that withdraws the tool that reads it. */
let lastResult = null;
let findingsToolController = null;

/* ------------------------------------------------------------------ rendering */

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

/** One card. Before a run it shows the catalogue entry; after one it shows the verdict. */
function renderCard(behaviour, finding) {
  const verdict = finding ? finding.verdict : null;
  const card = text('article', `card ${verdict ? VERDICT_CLASS[verdict] : ''}`);

  const top = text('div', 'card-top');
  top.append(text('span', 'chip', behaviour.id));
  if (verdict) top.append(text('span', 'verdict', VERDICT_WORD[verdict]));
  // NOT "a defect in the page". Four of the six your-page rows hold, so that wording rendered a
  // green HOLDS chip beside the words "a defect" on the same line. This field names WHAT WAS
  // MEASURED, not what was concluded, and the command line runner already words it correctly.
  top.append(text('span', 'subject-tag',
    behaviour.subject === 'browser' ? 'measured on the browser' : 'measured on the page under test'));
  top.append(text('h3', 'card-title', behaviour.title));
  card.append(top);

  card.append(text('p', 'card-why', behaviour.why));

  const kv = text('div', 'kv');
  const row = (key, value, extraClass) => {
    const line = document.createElement('div');
    line.append(text('span', 'k', key));
    line.append(text('span', `v ${extraClass || ''}`, value));
    kv.append(line);
  };

  if (finding && verdict !== 'not-applicable') {
    row('Expected', finding.expected);
    row('Observed', finding.observed, 'observed');
  } else if (finding) {
    row('Expected', finding.expected);
    row('Not run', finding.reason || 'no observation');
  } else {
    row('Promise', behaviour.promise);
    row(`On ${MEASURED_AGAINST}`, behaviour.measured);
  }
  card.append(kv);

  const repro = text('div', 'repro');
  const pre = text('pre', 'cmd');
  pre.append(text('code', null, behaviour.reproduce));
  repro.append(pre);
  card.append(repro);

  return card;
}

/** The whole catalogue, grouped, with findings folded in when there are any. */
function renderGroups(result) {
  const host = el('groups');
  host.textContent = '';
  const byId = new Map((result ? result.findings : []).map((f) => [f.id, f]));

  for (const group of GROUPS) {
    const members = BEHAVIOURS.filter((b) => b.group === group);
    if (!members.length) continue;
    // A group added to the catalogue with no copy here used to throw inside the render and leave
    // the whole page blank, which is the worst possible failure for a page whose only job is to
    // show you something. tests/unit/group_copy.test.js now fails at authoring time instead, and
    // this fallback means even that mistake renders the group rather than nothing.
    const copy = GROUP_COPY[group] || { heading: group, note: '' };
    const section = text('section', 'group');
    section.append(text('h3', 'group-h', copy.heading));
    if (copy.note) section.append(text('p', 'group-note', copy.note));
    const cards = text('div', 'cards');
    for (const behaviour of members) cards.append(renderCard(behaviour, byId.get(behaviour.id) || null));
    section.append(cards);
    host.append(section);
  }
}

function renderSummary(result) {
  const tiles = el('tiles');
  tiles.textContent = '';
  const add = (value, label, cls) => {
    const tile = text('div', `tile ${cls || ''}`);
    tile.append(text('b', null, String(value)));
    tile.append(text('span', null, label));
    tiles.append(tile);
  };
  add(result.counts.fail, 'promises broken', 'is-fail');
  add(result.counts.pass, 'promises kept', 'is-pass');
  if (result.counts.notApplicable) add(result.counts.notApplicable, 'could not be run', 'is-na');
  add(result.counts.total, 'behaviours tested');

  el('env').textContent = `${result.environment.userAgent || 'unknown browser'}`
    + ` · host object ${result.environment.api || 'none'}`
    + ` · subject ${result.environment.url || 'unknown'}`
    + (result.complete ? '' : ' · INCOMPLETE, some behaviours were never observed');
  el('summary').hidden = false;
}

/* ------------------------------------------------------------------ running */

async function runAudit() {
  const button = el('run');
  const status = el('status');
  button.disabled = true;
  status.textContent = 'Driving the subject page.';

  try {
    const frame = el('subject');
    const inner = frame.contentWindow;
    if (!inner || typeof inner.__ninthtool_observe !== 'function') {
      throw new Error('The subject page has not finished loading. Give it a moment and try again.');
    }
    const transcript = await inner.__ninthtool_observe();
    const result = judge(transcript);
    lastResult = result;

    renderGroups(result);
    renderSummary(result);
    await publishFindingsTool();

    const broken = result.counts.fail;
    status.textContent = `Done. ${broken} of ${result.counts.total} promises broken.`
      + (transcript.errors && transcript.errors.length
        ? ` ${transcript.errors.length} behaviour(s) could not be observed.` : '')
      + ' The tool nt_get_findings is now published.';
  } catch (error) {
    status.textContent = `The audit did not finish: ${String((error && error.message) || error)}`;
  } finally {
    button.disabled = false;
  }
}

function clearFindings() {
  lastResult = null;
  renderGroups(null);
  el('summary').hidden = true;
  withdrawFindingsTool();
  el('status').textContent = 'Cleared. nt_get_findings has been withdrawn from the tool surface.';
}

/* ------------------------------------------------------------------ this page's own tools */

/**
 * The conditional tool, done the way that works.
 *
 * THE SIGNAL GOES IN THE OPTIONS BAG, THE SECOND ARGUMENT. Putting it on the descriptor is the
 * natural mistake, it throws nothing, and the tool then stays on the surface for ever. That is
 * behaviour C2, and this function is the corrected version of it.
 */
async function publishFindingsTool() {
  const found = findModelContext(document, navigator);
  if (!found.ctx || !lastResult) return;
  withdrawFindingsTool();
  findingsToolController = new AbortController();
  try {
    await found.ctx.registerTool({
      name: 'nt_get_findings',
      description: 'Read the findings from the audit that has just run on this page. Returns one '
        + 'entry per behaviour with its verdict, what was expected, what was observed and the '
        + 'command that reproduces it. Only published after an audit has produced findings.',
      inputSchema: {
        type: 'object',
        properties: {
          only: {
            type: 'string',
            enum: ['all', 'broken', 'kept', 'not-run'],
            description: 'Which findings to return. Defaults to all.',
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input) {
        const checked = onlyDeclared(input, ['only']);
        if (!checked.ok) return refuse(checked.said);
        const only = checked.value.only || 'all';
        const want = { broken: 'fail', kept: 'pass', 'not-run': 'not-applicable' }[only];
        const chosen = want ? lastResult.findings.filter((f) => f.verdict === want) : lastResult.findings;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              environment: lastResult.environment,
              counts: lastResult.counts,
              complete: lastResult.complete,
              findings: chosen,
            }, null, 1),
          }],
        };
      },
    }, { signal: findingsToolController.signal });
  } catch (error) {
    el('status').textContent += ` (the findings tool could not be published: ${error.message})`;
  }
}

function withdrawFindingsTool() {
  if (findingsToolController) {
    findingsToolController.abort();
    findingsToolController = null;
  }
}

/** The tools this page always publishes. */
async function publishStandingTools(ctx) {
  const counts = headlineCounts();

  await ctx.registerTool({
    name: 'nt_list_behaviours',
    description: 'List every WebMCP behaviour this suite tests, with the group it belongs to and '
      + 'whether it is a fact about the browser or a defect in the page under test.',
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          enum: [...GROUPS, 'all'],
          description: 'Restrict to one group. Defaults to all.',
        },
      },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input) {
      const checked = onlyDeclared(input, ['group']);
      if (!checked.ok) return refuse(checked.said);
      const group = checked.value.group || 'all';
      const chosen = group === 'all' ? BEHAVIOURS : BEHAVIOURS.filter((b) => b.group === group);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            measuredAgainst: MEASURED_AGAINST,
            measuredOn: MEASURED_ON,
            counts,
            behaviours: chosen.map((b) => ({
              id: b.id, group: b.group, subject: b.subject, title: b.title, promise: b.promise,
            })),
          }, null, 1),
        }],
      };
    },
  });

  await ctx.registerTool({
    name: 'nt_explain_behaviour',
    description: 'Explain one behaviour in full: what a page is promising, what the specification '
      + 'says, what was measured against the shipping browser, why it matters, and the command '
      + 'that reproduces it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The behaviour id, for example B1 or C2. Case insensitive.',
        },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input) {
      // The browser enforces nothing on a script registered tool, which is behaviour C3, so this
      // handler validates its own argument. Every tool on this page does.
      const checked = onlyDeclared(input, ['id']);
      if (!checked.ok) return refuse(checked.said);
      const wanted = String(checked.value.id || '').trim().toUpperCase();
      const behaviour = BEHAVIOURS.find((b) => b.id === wanted);
      if (!behaviour) {
        return {
          content: [{
            type: 'text',
            text: `No behaviour "${wanted}". Known ids: ${BEHAVIOURS.map((b) => b.id).join(', ')}.`,
          }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(behaviour, null, 1) }] };
    },
  });

  await ctx.registerTool({
    name: 'nt_run_audit',
    description: 'Run the conformance audit against the subject page in the frame on this page, '
      + 'and return the counts. It drives forms on a subject page hosted by this site, so it is '
      + 'not read only, but it writes nothing that outlives the page and sends nothing anywhere.',
    inputSchema: { type: 'object', properties: {} },
    // Honest rather than convenient. The audit submits forms on the subject page, so it is not
    // read only, and saying otherwise would be exactly the kind of dishonest annotation this
    // suite exists to catch.
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      const checked = onlyDeclared(input, []);
      if (!checked.ok) return refuse(checked.said);
      await runAudit();
      if (!lastResult) return { content: [{ type: 'text', text: 'The audit did not finish.' }] };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            counts: lastResult.counts,
            complete: lastResult.complete,
            environment: lastResult.environment,
            broken: lastResult.findings.filter((f) => f.verdict === 'fail').map((f) => `${f.id} ${f.title}`),
          }, null, 1),
        }],
      };
    },
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const counts = headlineCounts();
  el('catalogue-lede').textContent =
    `${counts.total} behaviours. ${counts.yourPage} read the tools this page publishes and are the `
    + `ones a page author can fix. The other ${counts.browserSubject} are the host: `
    + `${counts.specDivergence} where the browser diverges from the specification it implements, `
    + `${counts.standardGap} the standard cannot express at all, ${counts.silentTrap} that fail `
    + `silently when written the obvious way, and ${counts.holds} that hold. Run the audit above to `
    + 'replace the stored measurement with what your own browser does.';

  renderGroups(null);

  const found = findModelContext(document, navigator);
  if (!found.ctx) {
    // H2 and H3. The control is disabled and the reason is beside it, in words, with the fix.
    el('run').disabled = true;
    el('status').textContent = 'The audit cannot run here.';
    const blocker = el('blocker');
    blocker.textContent = `${found.reason} The catalogue below still shows every behaviour and what `
      + `was measured on ${MEASURED_AGAINST}, so nothing on this page is hidden from you.`;
    blocker.hidden = false;
    return;
  }

  el('run').addEventListener('click', runAudit);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lastResult) clearFindings();
  });

  try {
    await publishStandingTools(found.ctx);
    el('status').textContent = 'Ready. Three tools published, so your own agent can run this.';
  } catch (error) {
    el('status').textContent = `Ready, but this page could not publish its own tools: ${error.message}`;
  }
}

boot();
