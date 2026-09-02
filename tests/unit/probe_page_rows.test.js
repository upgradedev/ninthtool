/**
 * The your-page rows, driven against real surfaces instead of transcripts.
 *
 * WHAT THESE ROWS ARE. B4 and D2 read a form derived tool. P1 to P4 read the snapshot the probe
 * takes BEFORE it registers anything of its own. P5 and P6 call the page's own read only tools.
 * All of it lives in src/probe/observe.js and none of it was driven by a test until now, so the
 * only thing under test was src/judge/verdict.js reading a transcript somebody typed.
 *
 * THE SNAPSHOT ORDER IS ITSELF A CLAIM, and it is asserted here rather than assumed: every
 * your-page finding is judged against the surface as it was before the probe touched it. If the
 * snapshot moved after registration, `toolCount` would include the probe's own tools and every
 * finding about "your tools" would be partly a finding about ours.
 *
 * P6 GETS THE MOST ATTENTION HERE, because its own comments name two defects it has already had:
 * it passed on a run in which every read only tool rejected every call, and an earlier version
 * skipped a tool when reading its own answer and then blamed whichever tool was called next. Both
 * are shapes a fake host can produce in a few lines and a hand written transcript cannot produce
 * at all, since the transcript IS the thing that would have been wrong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { makeHost, readOnlyTool, declarativeTool } from './fake_host.mjs';

const META = { url: 'https://host.test/', userAgent: 'node' };
const ORIGIN = 'https://host.test';

async function run(host, only, over = {}) {
  return observeAll(host.ctx, { meta: META, only, expectedOrigin: ORIGIN, ...over });
}

function rowOf(transcript, id) {
  const row = transcript.observations[id];
  assert.ok(row, `${id} was not observed. Errors: ${transcript.errors.join(' | ') || 'none'}`);
  return row;
}

/** A page that reports itself well: two annotated read only tools and one form. */
const tidyPage = () => [
  readOnlyTool('read_state'),
  readOnlyTool('read_notes'),
  declarativeTool('nt_form_answers'),
];

/* ------------------------------------------------------------------ B4 and D2 */

test('B4 names the form derived tool and reports that it carries no annotations', async () => {
  const transcript = await run(makeHost({ pageTools: tidyPage() }), ['B4']);
  assert.deepEqual(rowOf(transcript, 'B4'), {
    annotationsTypeof: 'undefined', toolName: 'nt_form_answers',
  });
});

test('B4 falls back to whatever form derived tool the page publishes', async () => {
  // The row still measures something on a page of your own, which is the whole reason for the
  // fallback. It must name WHICH tool it read, or the finding cannot be checked.
  const page = [readOnlyTool('read_state'), declarativeTool('contact_us_form')];
  const transcript = await run(makeHost({ pageTools: page }), ['B4', 'D2']);
  assert.equal(rowOf(transcript, 'B4').toolName, 'contact_us_form');
  assert.equal(rowOf(transcript, 'D2').toolName, 'contact_us_form');
});

test('B4 and D2 report nothing at all on a page with no form derived tool', async () => {
  const page = [readOnlyTool('read_state'), readOnlyTool('read_notes')];
  const transcript = await run(makeHost({ pageTools: page }), ['B4', 'D2']);
  assert.equal(transcript.observations.B4, undefined);
  assert.equal(transcript.observations.D2, undefined);
  assert.match(transcript.errors.join(' | '), /B4: this page publishes no form derived tool/);
  assert.match(transcript.errors.join(' | '), /D2: this page publishes no form derived tool/);
});

test('D2 hands back the synthesised schema itself, not a summary of it', async () => {
  const transcript = await run(makeHost({ pageTools: tidyPage() }), ['D2']);
  const d2 = rowOf(transcript, 'D2');
  assert.deepEqual(d2.schema.required, ['witness_name'],
    'the schema a reader has to check for themselves was not carried through');
});

/* ------------------------------------------------------------------ P1 to P4 */

test('P1, P2, P3 and P4 have nothing to report about a page that reports itself well', async () => {
  const transcript = await run(makeHost({ pageTools: tidyPage() }), ['P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(rowOf(transcript, 'P1'), {
    toolCount: 3,
    withoutAnnotations: ['nt_form_answers'],
    withoutReadOnlyHint: [],
    readOnlyCount: 2,
  });
  assert.deepEqual(rowOf(transcript, 'P2'), { toolCount: 3, unusableSchemas: [] });
  assert.deepEqual(rowOf(transcript, 'P3'), { toolCount: 3, undescribedTools: [], undescribedParams: [] });
  assert.deepEqual(rowOf(transcript, 'P4'), { toolCount: 3, fromOtherDocuments: [] });
});

test('P1 separates a tool with no annotations from one whose annotations omit the hint', async () => {
  // Two different findings that used to be easy to collapse into one. A form derived tool CANNOT
  // carry annotations, which is behaviour B4 and not the page author's fault. A script registered
  // tool that carries an annotations object and leaves readOnlyHint out is a choice.
  const page = [
    readOnlyTool('read_state'),
    readOnlyTool('do_something', { annotations: {} }),
    declarativeTool('nt_form_answers'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P1']);
  assert.deepEqual(rowOf(transcript, 'P1'), {
    toolCount: 3,
    withoutAnnotations: ['nt_form_answers'],
    withoutReadOnlyHint: ['do_something'],
    readOnlyCount: 1,
  });
});

test('P2 names every way a schema is unusable, one line per tool', async () => {
  const page = [
    readOnlyTool('parses_badly', { inputSchema: '{ this is not json' }),
    readOnlyTool('wrong_type', { inputSchema: { type: 'array', description: 'a list' } }),
    readOnlyTool('no_schema_at_all', { inputSchema: undefined }),
    readOnlyTool('read_state'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P2']);
  const p2 = rowOf(transcript, 'P2');
  assert.equal(p2.toolCount, 4);
  assert.equal(p2.unusableSchemas.length, 3, p2.unusableSchemas.join(' | '));
  assert.match(p2.unusableSchemas[0], /^parses_badly: schema did not parse/);
  assert.match(p2.unusableSchemas[1], /^wrong_type: schema type is "array", not object/);
  assert.equal(p2.unusableSchemas[2], 'no_schema_at_all: no schema');
});

test('P3 counts a short description as no description, and names each undescribed parameter', async () => {
  const page = [
    readOnlyTool('terse', { description: 'reads' }),
    readOnlyTool('unlabelled', {
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, note: { type: 'string', description: '  ' } },
        required: ['id'],
      },
    }),
    readOnlyTool('read_state'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P3']);
  const p3 = rowOf(transcript, 'P3');
  assert.deepEqual(p3.undescribedTools, ['terse']);
  assert.deepEqual(p3.undescribedParams, ['unlabelled.id', 'unlabelled.note'],
    'a description of only whitespace was accepted as a description');
});

test('P4 names the tools that came from another document, with their origin', async () => {
  // The finding, not an accident: a page that embeds a frame gets that frame's tools on its own
  // surface, and whoever calls them cannot see that they belong to somebody else.
  const page = [
    readOnlyTool('read_state'),
    declarativeTool('nt_form_answers', { window: { location: { pathname: '/frame.html' } }, origin: 'https://frame.test' }),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P4']);
  assert.deepEqual(rowOf(transcript, 'P4'), {
    toolCount: 2,
    fromOtherDocuments: ['nt_form_answers (origin https://frame.test)'],
  });
});

test('P4 does not count a tool whose document could not be reached at all', async () => {
  // Unknown and elsewhere are two different answers. `fromThisDocument` is null when the window
  // threw, and the row filters on `=== false`, so an unreadable document is not an accusation.
  const page = [readOnlyTool('read_state'), readOnlyTool('opaque', { windowThrows: true })];
  const transcript = await run(makeHost({ pageTools: page }), ['P4']);
  assert.deepEqual(rowOf(transcript, 'P4').fromOtherDocuments, []);
  const opaque = transcript.pageTools.find((t) => t.name === 'opaque');
  assert.equal(opaque.fromThisDocument, null,
    'an unreachable document was recorded as a definite answer');
});

test('every your-page row reports not applicable on a page that publishes no tools', async () => {
  const transcript = await run(makeHost({ pageTools: [] }), ['P1', 'P2', 'P3', 'P4']);
  for (const id of ['P1', 'P2', 'P3', 'P4']) {
    assert.equal(transcript.observations[id], undefined, `${id} reported a clean sheet on an empty page`);
    assert.match(transcript.errors.join(' | '),
      new RegExp(`${id}: this page publishes no WebMCP tools`));
  }
});

test('the snapshot is taken before the probe registers anything of its own', async () => {
  // THE ORDER IS THE CLAIM. Selecting a register-mode row alongside a your-page row must not make
  // the page look as though it published the probe's tools.
  const host = makeHost({ pageTools: tidyPage() });
  const transcript = await run(host, ['A2', 'P1']);
  assert.equal(rowOf(transcript, 'P1').toolCount, 3,
    'the probe counted its own tools as the page\'s');
  assert.deepEqual(transcript.pageTools.map((t) => t.name),
    ['read_state', 'read_notes', 'nt_form_answers']);
  assert.ok(host.counts.registered >= 1, 'no probe tool was registered, so the order proves nothing');
});

/* ------------------------------------------------------------------ P5, the skip reasons */

test('P5 says why it left each tool alone, in that tool\'s own words', async () => {
  const page = [
    readOnlyTool('no_required', {
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'which' } } },
    }),
    readOnlyTool('requires_a_ghost', {
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'which' } },
        required: ['ghost'],
      },
    }),
    readOnlyTool('not_read_only', { annotations: {} }),
    declarativeTool('nt_form_answers'),
  ];
  const host = makeHost({ pageTools: page });
  const transcript = await run(host, ['P5'], { allow: { toolCalls: true } });
  const p5 = rowOf(transcript, 'P5');
  assert.deepEqual(p5.attempted, [], 'a tool with nothing breakable was called anyway');
  assert.equal(host.counts.calls, 0, 'P5 called a tool it had already decided to skip');
  const reasons = p5.skipped.join(' | ');
  assert.match(reasons, /not_read_only: not marked readOnlyHint/);
  assert.match(reasons, /nt_form_answers: carries no annotations/);
  assert.match(reasons, /no_required: declares no required properties, so there is nothing to break/);
  assert.match(reasons, /requires_a_ghost: requires "ghost" which is not in its own properties/);
});

test('P5 calls a different answer inconclusive rather than a refusal', async () => {
  // A tool that echoes its arguments answers a broken call differently from a well formed one.
  // That is consistent with validation and equally consistent with echoing, and an earlier
  // version of this row counted it as a pass.
  const seen = [];
  const page = [readOnlyTool('echoes', {
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'which one' },
        ready: { type: 'boolean', description: 'whether it is ready' },
        tags: { type: 'array', description: 'labels' },
      },
      required: ['id', 'tags'],
    },
    async run(input) { seen.push(input); return `you sent ${JSON.stringify(input)}`; },
  })];
  const transcript = await run(makeHost({ pageTools: page }), ['P5'], { allow: { toolCalls: true } });
  const p5 = rowOf(transcript, 'P5');
  assert.deepEqual(p5.attempted, ['echoes']);
  assert.deepEqual(p5.refused, []);
  assert.deepEqual(p5.ignored, []);
  assert.equal(p5.inconclusive.length, 1, p5.inconclusive.join(' | '));
  assert.match(p5.inconclusive[0], /answered differently, which is consistent with a refusal/);

  // The arguments the probe synthesised, read from the handler rather than guessed. A boolean gets
  // false, and a shape this code does not understand gets a string only because the tool said the
  // property was required.
  assert.equal(seen.length, 4, 'the counterbalanced plan is four calls');
  assert.deepEqual(seen[0], { id: 'ninthtool', ready: false, tags: 'ninthtool' });
  assert.deepEqual(seen[1], { ready: false, tags: 'ninthtool' },
    'the broken call must differ from the well formed one by the required property alone');
});

/* ------------------------------------------------------------------ P6, the differential */

/** Two read only tools that always answer the same thing. */
const steadyPair = () => [readOnlyTool('read_state'), readOnlyTool('read_notes')];

test('P6 reports a stable surface where nothing moved anything', async () => {
  const transcript = await run(makeHost({ pageTools: steadyPair() }), ['P6'], { allow: { toolCalls: true } });
  assert.deepEqual(rowOf(transcript, 'P6'), {
    oracleCount: 2,
    oracles: ['read_state', 'read_notes'],
    stable: true,
    unstable: [],
    moved: [],
    selfChanged: [],
    controlAnswered: ['read_state', 'read_notes'],
    controlUnanswered: [],
  });
});

test('P6 records that NOTHING answered when every oracle rejects, instead of a clean sheet', async () => {
  /*
   * THE DEFECT THIS ROW HAS ALREADY HAD, reproduced. "[rejected]" is a constant, so two control
   * reads of a page whose read only tools reject everything agree with each other, `moved` comes
   * back empty, and the row used to be a confident pass on a run in which nothing was ever read.
   *
   * The transcript has to carry the difference. `controlAnswered` empty with `stable: true` is
   * what lets the judge abstain rather than pass.
   */
  const refuses = (name) => readOnlyTool(name, {
    async run() { throw new Error('this tool refuses every call'); },
  });
  const transcript = await run(makeHost({ pageTools: [refuses('read_state'), refuses('read_notes')] }),
    ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, true, 'two identical rejections are a stable control, which is the trap');
  assert.deepEqual(p6.moved, []);
  assert.deepEqual(p6.controlAnswered, [],
    'a run in which no oracle ever answered reported an oracle answering');
  assert.deepEqual(p6.controlUnanswered,
    ['read_state: rejected then rejected', 'read_notes: rejected then rejected'],
    'how each control read ended must survive, or all-reject and a mixture become the same row');
});

test('P6 abstains when the control reads already disagree, without blaming a tool', async () => {
  let n = 0;
  const page = [
    readOnlyTool('read_state', { async run() { n += 1; return `state ${n}`; } }),
    readOnlyTool('read_notes'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, false);
  assert.deepEqual(p6.unstable, ['read_state']);
  assert.deepEqual(p6.moved, [], 'an unstable surface was still used to attribute a change');
  assert.deepEqual(p6.selfChanged, []);
});

test('P6 calls an oracle that left the surface gone, not answered', async () => {
  const host = makeHost({ pageTools: steadyPair(), vanishAfter: { name: 'read_notes', calls: 1 } });
  const transcript = await run(host, ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, false);
  assert.deepEqual(p6.unstable, ['read_notes']);
  assert.ok(p6.controlUnanswered.includes('read_notes: resolved then gone from the surface'),
    `a tool that left the surface was not named as gone: ${p6.controlUnanswered.join(' | ')}`);
});

test('P6 attributes a change to the tool whose call caused it', async () => {
  // The tool answers the same thing every time and quietly moves state a SECOND tool reports. That
  // is the only shape this row can honestly claim, and it is the one it exists for.
  let state = 'clean';
  let calls = 0;
  const page = [
    readOnlyTool('a_toggle', {
      async run() { calls += 1; if (calls >= 3) state = 'touched'; return 'a_toggle: steady'; },
    }),
    readOnlyTool('b_watcher', { async run() { return `b_watcher sees ${state}`; } }),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, true, `the control was not stable: ${p6.unstable.join(', ')}`);
  assert.deepEqual(p6.moved, ['a_toggle changed what b_watcher answers']);
  assert.deepEqual(p6.selfChanged, []);
  assert.deepEqual(p6.controlAnswered, ['a_toggle', 'b_watcher']);
});

test('P6 names a tool whose OWN answer drifted rather than blaming the next one called', async () => {
  /*
   * THE OTHER DEFECT THIS ROW HAS HAD. An earlier version skipped self observation, so a tool
   * whose own answer drifts was invisible and the drift landed on whichever tool was called next.
   * Self observation is now reported under its own name.
   */
  let calls = 0;
  const page = [
    readOnlyTool('drifter', { async run() { calls += 1; return calls >= 4 ? 'v2' : 'v1'; } }),
    readOnlyTool('read_notes'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, true, `the control was not stable: ${p6.unstable.join(', ')}`);
  assert.deepEqual(p6.selfChanged, ['drifter: its own answer changed between reads']);
  assert.deepEqual(p6.moved, [], 'a tool\'s own drift was blamed on another tool');
});

test('P6 refuses to run a differential with one oracle, and says how many it found', async () => {
  const page = [readOnlyTool('read_state'), declarativeTool('nt_form_answers')];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  assert.equal(transcript.observations.P6, undefined);
  assert.match(transcript.errors.join(' | '),
    /P6: this page publishes 1 read only tool\(s\), and a differential needs at least two/);
});
