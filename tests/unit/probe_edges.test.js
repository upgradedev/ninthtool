/**
 * The edges of the probe: the defaults, the host object lookup, and the surfaces that are simply
 * odd rather than hostile.
 *
 * WHY THESE ARE WORTH TESTS. Every branch here is a fallback the probe takes when a page gives it
 * less than it expected: a tool with no description, a schema with no properties, an answer that is
 * not a value at all. None of them is exotic. A page that publishes a tool with no origin is a page
 * somebody shipped, and a measurement instrument that throws on it measures nothing that day.
 *
 * `findModelContext` gets tests here because it is the first thing that runs on a real page and the
 * only thing standing between "this browser has no WebMCP" and a run that reports success over a
 * null context. That confusion is named in the file header of src/probe/observe.js as the reason
 * the probe was rewritten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll, findModelContext } from '../../src/probe/observe.js';
import { makeHost, conformingHost, readOnlyTool, declarativeTool } from './fake_host.mjs';

const ORIGIN = 'https://host.test';

async function run(host, only, over = {}) {
  return observeAll(host.ctx, {
    meta: { url: `${ORIGIN}/`, userAgent: 'node' }, only, expectedOrigin: ORIGIN, ...over,
  });
}

function rowOf(transcript, id) {
  const row = transcript.observations[id];
  assert.ok(row, `${id} was not observed. Errors: ${transcript.errors.join(' | ') || 'none'}`);
  return row;
}

/* ------------------------------------------------------------------ finding the host object */

test('findModelContext prefers the document, and names where it found the host', () => {
  const ctx = { getTools() { return []; } };
  assert.deepEqual(findModelContext({ modelContext: ctx }, { modelContext: {} }),
    { ctx, where: 'document.modelContext', reason: null });
});

test('findModelContext falls back to the navigator, which the draft attaches nothing to today', () => {
  const ctx = { getTools() { return []; } };
  const found = findModelContext({}, { modelContext: ctx });
  assert.equal(found.ctx, ctx);
  assert.equal(found.where, 'navigator.modelContext');
});

test('findModelContext says plainly that there is no host, instead of carrying on with null', () => {
  // THE DEFECT THE PROBE WAS REWRITTEN FOR. Pointed at a browser with no WebMCP, the tool this
  // grew from printed "api: null" and exited zero. A run that proved nothing looked exactly like a
  // run that proved everything.
  const nothing = findModelContext({}, {});
  assert.equal(nothing.ctx, null);
  assert.equal(nothing.where, null);
  assert.match(nothing.reason, /This browser exposes no WebMCP host object/);
  assert.match(nothing.reason, /chrome:\/\/flags\/#enable-webmcp-testing/);
});

test('findModelContext with no arguments at all reads the ambient globals, and finds none in node', () => {
  const nothing = findModelContext();
  assert.equal(nothing.ctx, null);
  assert.match(nothing.reason, /no WebMCP host object/);
});

/* ------------------------------------------------------------------ defaults */

test('a run with no meta records what it could not learn as null, rather than inventing it', async () => {
  const transcript = await observeAll(conformingHost().ctx, { only: ['A2'] });
  assert.equal(transcript.meta.url, null);
  assert.equal(transcript.meta.userAgent, null);
  assert.equal(transcript.meta.api, 'document.modelContext');
});

test('a run with no scope runs every step its authorisation permits, and says which', async () => {
  // `only` absent means everything. The three form steps still need their own authorisation, so
  // they are refused by name rather than quietly dropped.
  const host = makeHost({ pageTools: [readOnlyTool('read_state'), readOnlyTool('read_notes')] });
  const transcript = await observeAll(host.ctx, {
    meta: { url: `${ORIGIN}/`, userAgent: 'node' },
    allow: { toolCalls: true },
    expectedOrigin: ORIGIN,
  });
  assert.equal(transcript.scope.requestedBehaviours, null,
    'an unscoped run must record that nothing in particular was asked for');
  assert.deepEqual(transcript.scope.refusedSteps, ['formValidation', 'staleRequired', 'humanHold']);
  for (const id of ['C1', 'C3', 'C4']) {
    assert.match(transcript.skipped[id], /submitting a form was not authorised/);
    assert.equal(transcript.observations[id], undefined, `${id} was observed without authorisation`);
  }
  for (const id of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B5', 'C2', 'D1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
    assert.ok(transcript.observations[id], `${id} was not observed by a full run: ${transcript.errors.join(' | ')}`);
  }
});

/* ------------------------------------------------------------------ surfaces that give less */

test('a tool with no description and no origin is read as empty strings, not as a crash', async () => {
  const page = [
    readOnlyTool('read_state', { title: 'Read the state' }),
    { name: 'anonymous_tool', noOrigin: true, inputSchema: { type: 'object', properties: {} } },
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P3', 'P4']);
  const bare = transcript.pageTools.find((t) => t.name === 'anonymous_tool');
  assert.equal(bare.origin, '', 'a missing origin was carried through as something other than empty');
  assert.deepEqual(rowOf(transcript, 'P3').undescribedTools, ['anonymous_tool']);
  assert.deepEqual(rowOf(transcript, 'P4').fromOtherDocuments, []);
});

test('P3 survives a tool with no schema and a property declared as nothing', async () => {
  const page = [
    readOnlyTool('read_state'),
    readOnlyTool('schemaless', { inputSchema: undefined }),
    readOnlyTool('half_declared', {
      inputSchema: { type: 'object', properties: { id: null }, required: ['id'] },
    }),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P3']);
  assert.deepEqual(rowOf(transcript, 'P3').undescribedParams, ['half_declared.id'],
    'a property declared as null was either skipped or crashed the row');
});

test('A3 reports an empty list when the host drops the annotations object itself', async () => {
  // Thinning the object and removing it are different answers, and the row must not read the
  // second as the first by way of a TypeError.
  const transcript = await run(makeHost({ dropAnnotations: true }), ['A3', 'B3']);
  assert.deepEqual(rowOf(transcript, 'A3').returnedAnnotationKeys, []);
  assert.deepEqual(rowOf(transcript, 'B3').returnedAnnotationKeys, []);
});

test('P5 calls a tool that answers nothing at all ignored, because both answers matched', async () => {
  // The tool resolves with no value whatever it is sent. Nothing distinguishes the broken call
  // from the well formed one, which is the only outcome that PROVES the input was not read.
  const page = [readOnlyTool('says_nothing', { async run() { return undefined; } })];
  const transcript = await run(makeHost({ pageTools: page }), ['P5'], { allow: { toolCalls: true } });
  const p5 = rowOf(transcript, 'P5');
  assert.deepEqual(p5.attempted, ['says_nothing']);
  assert.deepEqual(p5.ignored, ['says_nothing: omitting id changed nothing in the answer']);
  assert.deepEqual(p5.refused, []);
  assert.deepEqual(p5.inconclusive, []);
});

test('P5 skips a tool that requires a property its own schema declares nowhere', async () => {
  const page = [readOnlyTool('required_but_undeclared', {
    inputSchema: { type: 'object', required: ['id'] },
  })];
  const transcript = await run(makeHost({ pageTools: page }), ['P5'], { allow: { toolCalls: true } });
  const p5 = rowOf(transcript, 'P5');
  assert.deepEqual(p5.attempted, []);
  assert.match(p5.skipped.join(' | '),
    /required_but_undeclared: requires "id" which is not in its own properties/);
});

test('P6 reads oracles whose schemas declare almost nothing, and still answers', async () => {
  // P6 synthesises arguments for EVERY read only tool, including ones P5 would have skipped, so
  // the argument builder meets shapes the rest of the probe never hands it.
  const page = [
    readOnlyTool('no_schema', { inputSchema: undefined }),
    readOnlyTool('odd_schema', {
      inputSchema: {
        type: 'object',
        properties: { id: null, ok: { type: 'boolean', description: 'a flag' } },
        required: 'id',
      },
    }),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.deepEqual(p6.oracles, ['no_schema', 'odd_schema']);
  assert.equal(p6.stable, true, `the control was not stable: ${p6.unstable.join(', ')}`);
  assert.deepEqual(p6.controlAnswered, ['no_schema', 'odd_schema']);
});

test('P6 records an oracle answering with nothing as an answer, not as a failure to answer', async () => {
  const page = [
    readOnlyTool('says_nothing', { async run() { return undefined; } }),
    readOnlyTool('read_notes'),
  ];
  const transcript = await run(makeHost({ pageTools: page }), ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.deepEqual(p6.controlAnswered, ['says_nothing', 'read_notes'],
    'a tool that resolved with nothing was counted as one that never answered');
  assert.deepEqual(p6.controlUnanswered, []);
});

test('P6 skips an oracle that left the surface after the control reads', async () => {
  // Two control reads is two calls each. The tool goes on the second, so the control is stable and
  // the attribution loop finds nothing to call.
  const host = makeHost({
    pageTools: [readOnlyTool('read_state'), readOnlyTool('read_notes')],
    vanishAfter: { name: 'read_state', calls: 2 },
  });
  const transcript = await run(host, ['P6'], { allow: { toolCalls: true } });
  const p6 = rowOf(transcript, 'P6');
  assert.equal(p6.stable, true, `the control was not stable: ${p6.unstable.join(', ')}`);
  assert.deepEqual(p6.selfChanged, [],
    'a tool that was never called in the loop was still blamed for its own drift');
  assert.equal(host.counts.byName.read_state, 2,
    'the tool that left the surface was called again after leaving it');
});

/* ------------------------------------------------------------------ what a scoped run leaves alone */

test('selecting a your-page row never registers a tool of our own', async () => {
  const host = makeHost({ pageTools: [readOnlyTool('read_state'), declarativeTool('nt_form_answers')] });
  await run(host, ['P1', 'P2', 'P3', 'P4', 'B4', 'D2']);
  assert.equal(host.counts.registered, 0,
    'a metadata only run put a tool on the surface it was measuring');
  assert.equal(host.counts.calls, 0, 'a metadata only run called something');
});
