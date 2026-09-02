/**
 * The browser rows, measured rather than described.
 *
 * WHAT WAS UNTESTED. Every row in the A, B, C and D groups is produced by src/probe/observe.js
 * registering a tool, calling it, and writing down what came back. Until now nothing drove that
 * code. The suite tested src/judge/verdict.js against hand written transcripts, which proves the
 * judge reads a transcript correctly and proves nothing about whether the transcript is what the
 * host did. Measured before this file: src/probe/observe.js at 66.33 percent of lines, from
 * `node --experimental-test-coverage --test tests/unit` on commit 369c769, this branch's base.
 *
 * THE PROPERTY EACH TEST ASSERTS. The same probe, run against two hosts that differ in one named
 * way, produces two transcripts that differ in exactly that way. That is falsifiable in both
 * directions: a probe that hardcodes an answer fails against the host that does the other thing,
 * and a probe that reads the wrong field fails against both.
 *
 * WHY THE TWO PROFILES. `conformingHost` keeps the catalogue's promises. `chrome152Host` does what
 * Chrome 152.0.7977.65 was measured doing on 2026-09-01, transcribed in
 * tests/support/transcripts.mjs. Nothing here invents a behaviour: each setting is one row of that
 * measurement.
 *
 * A TRAP WORTH NAMING. `observeAll` catches everything a step throws into `transcript.errors` and
 * carries on. A test that asserts only on `observations[id]` therefore passes vacuously when the
 * fake host is broken, because `observations[id]` is undefined and so is the field being read. So
 * every test here goes through `rowOf`, which fails with the recorded error text when the row is
 * absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { conformingHost, chrome152Host, makeHost } from './fake_host.mjs';

const META = { url: 'https://host.test/', userAgent: 'node' };

/** Run the real probe against a host, scoped to the rows named. */
async function run(host, only, over = {}) {
  return observeAll(host.ctx, {
    meta: META, only, expectedOrigin: 'https://host.test', ...over,
  });
}

/**
 * One observation, or a failure carrying the reason it is missing.
 *
 * WITHOUT THIS EVERY TEST BELOW CAN PASS BY ACCIDENT. A step that throws is recorded in
 * `transcript.errors` and leaves no observation, so `transcript.observations.A1.argCount` is a
 * TypeError in a test but `assert.equal(observations.A1 && observations.A1.argCount, undefined)`
 * would quietly hold. Reading the row through here turns a broken fake into a named failure.
 */
function rowOf(transcript, id) {
  const row = transcript.observations[id];
  assert.ok(row, `${id} was not observed. Errors: ${transcript.errors.join(' | ') || 'none'}`);
  return row;
}

/* ------------------------------------------------------------------ A1, the callback arity */

test('A1 reports two arguments and a signal when the host hands the handler two arguments', async () => {
  const transcript = await run(conformingHost(), ['A1']);
  assert.deepEqual(rowOf(transcript, 'A1'), { argCount: 2, optionsTypeof: 'object', hasSignal: true });
});

test('A1 reports one argument and no signal against the host that hands only the input', async () => {
  // THE MEASURED CASE. Chrome 152 calls the handler with the input alone, so a tool cannot see the
  // abort signal the standard says it gets. A probe that reported the standard rather than the
  // host would give the same answer here as above.
  const transcript = await run(chrome152Host(), ['A1']);
  assert.deepEqual(rowOf(transcript, 'A1'), { argCount: 1, optionsTypeof: 'undefined', hasSignal: false });
});

test('A1 refuses to report an arity when the handler never ran', async () => {
  // A host can answer a call without reaching the page's code. There is no arity to report then,
  // and inventing one would be the worst outcome, so the row is absent and the reason is recorded.
  const transcript = await run(makeHost({ neverRunsHandlers: true }), ['A1']);
  assert.equal(transcript.observations.A1, undefined,
    'an arity was reported for a handler that never ran');
  assert.match(transcript.errors.join(' | '), /A1: the handler never ran/);
});

/* ------------------------------------------------- A2, what type inputSchema comes back as */

test('A2 reports the type the surface actually gives back for inputSchema', async () => {
  const asObject = await run(conformingHost(), ['A2']);
  assert.deepEqual(rowOf(asObject, 'A2'), { inputSchemaTypeof: 'object' });

  const asString = await run(chrome152Host(), ['A2']);
  assert.deepEqual(rowOf(asString, 'A2'), { inputSchemaTypeof: 'string' },
    'a schema registered as an object came back as a string, and the row has to say so');
});

/* --------------------------------------------- A3 and B3, which annotations survive registration */

test('A3 lists every annotation name the host kept, and B3 reads its own subset', async () => {
  const sent = ['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'destructiveHint',
    'idempotentHint', 'openWorldHint'];

  const kept = await run(conformingHost(), ['A3', 'B3']);
  assert.deepEqual(rowOf(kept, 'A3').returnedAnnotationKeys, sent,
    'a host that keeps every annotation must be reported as keeping every annotation');

  const dropped = await run(chrome152Host(), ['A3', 'B3']);
  assert.deepEqual(rowOf(dropped, 'A3').returnedAnnotationKeys,
    ['readOnlyHint', 'untrustedContentHint']);

  // B3 and A3 read different subsets of ONE registration, which is the point of the comment in
  // observe.js: six tools to ask one question would be six times the side effect.
  const b3 = rowOf(dropped, 'B3');
  assert.deepEqual(b3.sentAnnotationKeys, sent);
  assert.deepEqual(b3.returnedAnnotationKeys, ['readOnlyHint', 'untrustedContentHint']);
  assert.deepEqual(b3.subject, ['destructiveHint', 'idempotentHint', 'openWorldHint'],
    'B3 must own only the three names that were never part of this standard');
  assert.deepEqual(b3.measuredElsewhere, { consequentialHint: 'A3' },
    'consequentialHint belongs to A3, and counting it twice made one fact into two broken promises');
});

test('A3 and B3 come from ONE registration, so selecting both calls the surface once', async () => {
  // The side effect is the claim. If someone splits this into a tool per annotation name, the
  // count moves and this fails.
  const host = chrome152Host();
  await run(host, ['A3', 'B3']);
  assert.equal(host.counts.registered, 1,
    `A3 and B3 together registered ${host.counts.registered} tools, and one is the whole design`);
});

/* --------------------------------------------------------- B1 and B2, can a refusal reach anyone */

test('B1 records all three refusal routes reaching the caller intact on a host that keeps them', async () => {
  const transcript = await run(conformingHost(), ['B1']);
  const routes = rowOf(transcript, 'B1').routes;
  assert.equal(routes.length, 3, 'three routes are the row');
  assert.deepEqual(routes.map((r) => r.route), [
    'return { isError: true }', 'throw Error', 'reject DOMException("InvalidStateError")',
  ]);
  for (const route of routes) {
    assert.equal(route.settled, 'rejected', `${route.route} did not reach the caller as a rejection`);
    assert.equal(route.pageMessageSurvived, true, `${route.route} lost the page's own words`);
  }
  assert.equal(routes[2].errName, 'InvalidStateError',
    'a named DOMException must keep its name when the host keeps refusals intact');
});

test('B1 records the envelope resolving and the reason being erased on the measured host', async () => {
  // THE FINDING. An isError envelope comes back as a successful answer, so nothing downstream can
  // tell that the page meant to refuse, and the two routes that do reject arrive with the page's
  // words replaced.
  const transcript = await run(chrome152Host(), ['B1']);
  const routes = rowOf(transcript, 'B1').routes;
  assert.equal(routes[0].settled, 'resolved', 'the isError envelope was expected to resolve here');
  assert.equal(routes[0].errName, null);
  for (const route of routes) {
    assert.equal(route.pageMessageSurvived, false,
      `${route.route} kept the page's words, which this host does not do`);
  }
  assert.deepEqual(routes.slice(1).map((r) => r.errName), ['UnknownError', 'UnknownError']);
});

test('B2 is the first route of B1 and is written by the same step', async () => {
  const transcript = await run(chrome152Host(), ['B2']);
  const b2 = rowOf(transcript, 'B2');
  assert.equal(b2.settled, 'resolved');
  // Selecting B2 alone still runs the step that produces it, and that step also writes B1.
  assert.equal(transcript.observations.B1.routes[0].settled, b2.settled,
    'B2 and B1 route one disagree, and they are the same measurement');
  assert.ok(b2.callerSaw.includes('REFUSED_STALE'),
    'the caller saw nothing of what the page said');
});

test('B1 requires BOTH halves, so a rejection carrying no page words is not a survival', async () => {
  // The rule in observe.js is `settled === 'rejected' AND text includes the reason`. A host that
  // rejects with its own words satisfies one half only, and must not be scored as the other.
  const transcript = await run(chrome152Host(), ['B1']);
  const thrown = rowOf(transcript, 'B1').routes[1];
  assert.equal(thrown.settled, 'rejected');
  assert.equal(thrown.pageMessageSurvived, false,
    'a rejection alone was counted as the page reason surviving');
});

/* ------------------------------------------------------------------ B5, text or data */

test('B5 reports a bare string as a string and, on this host, an object as an object', async () => {
  const transcript = await run(conformingHost(), ['B5']);
  const b5 = rowOf(transcript, 'B5');
  assert.equal(b5.stringReturn.typeofValue, 'string');
  assert.equal(b5.stringReturn.parsesAsJson, false);
  assert.equal(b5.objectReturn.typeofValue, 'object',
    'a host that passes an object through must be reported as passing an object through');
});

test('B5 reports an object flattened to JSON text when the host serialises it', async () => {
  // THE MEASURED CASE. Everything comes back as a string, so a caller cannot tell a tool that
  // answered with data from one that answered with text that happens to look like data.
  const transcript = await run(chrome152Host(), ['B5']);
  const b5 = rowOf(transcript, 'B5');
  assert.equal(b5.objectReturn.typeofValue, 'string');
  assert.equal(b5.objectReturn.parsesAsJson, true);
  assert.equal(b5.stringReturn.typeofValue, 'string');
  assert.equal(b5.stringReturn.parsesAsJson, false,
    'a plain sentence was read as JSON, which would erase the distinction the row measures');
});

/* ------------------------------------------------------------------ C2, the ninth tool */

test('C2 sees both withdrawal routes work when the host honours both', async () => {
  const transcript = await run(conformingHost(), ['C2']);
  assert.deepEqual(rowOf(transcript, 'C2'), {
    optionsBag: { presentBefore: true, presentAfter: false },
    onDescriptor: { presentBefore: true, presentAfter: false },
  });
});

test('C2 separates the documented channel from the one that silently does nothing', async () => {
  // THE FINDING, AND THE ROW'S WHOLE REASON TO EXIST. A signal in the options bag withdraws the
  // tool. The same signal written on the descriptor, which is how it gets written when the
  // descriptor already looks like an options object, leaves the tool on the surface.
  const transcript = await run(chrome152Host(), ['C2']);
  const c2 = rowOf(transcript, 'C2');
  assert.deepEqual(c2.optionsBag, { presentBefore: true, presentAfter: false });
  assert.deepEqual(c2.onDescriptor, { presentBefore: true, presentAfter: true },
    'a signal on the descriptor withdrew the tool, so the two channels are indistinguishable here');
});

/* ------------------------------------------------------------------ D1, the lifecycle event */

test('D1 counts one event on registration and one on withdrawal', async () => {
  const transcript = await run(conformingHost(), ['D1']);
  assert.deepEqual(rowOf(transcript, 'D1'), { onRegister: 1, onWithdraw: 1 });
});

test('D1 counts no withdrawal event on a host that only announces registration', async () => {
  const transcript = await run(conformingHost({ toolchange: 'register' }), ['D1']);
  assert.deepEqual(rowOf(transcript, 'D1'), { onRegister: 1, onWithdraw: 0 },
    'a withdrawal nobody was told about was counted as an announcement');
});

test('D1 counts nothing on a host that never fires the event, and does not report a pass', async () => {
  const transcript = await run(conformingHost({ toolchange: 'none' }), ['D1']);
  assert.deepEqual(rowOf(transcript, 'D1'), { onRegister: 0, onWithdraw: 0 });
});

test('D1 removes its own listener, whatever the host did', async () => {
  // The probe's `finally` calls removeEventListener. A conformance instrument that leaves a
  // listener on the surface it measured has changed the thing it was measuring.
  const host = conformingHost();
  await run(host, ['D1']);
  const before = host.counts.withdrawn;
  host.publish({ name: 'after_the_run', description: 'published later', inputSchema: { type: 'object' } });
  host.remove('after_the_run');
  assert.equal(host.counts.withdrawn, before + 1,
    'the host stopped counting withdrawals, so this assertion is not measuring what it claims');
});

/* ------------------------------------------------------ the probe takes its own tools back off */

test('every tool the probe registered is gone from the surface when the run returns', async () => {
  // Stated in the file header of observe.js as a property of the file rather than a setting, and
  // therefore worth a test that would notice it becoming untrue.
  const host = conformingHost();
  await run(host, ['A1', 'A2', 'A3', 'B1', 'B5', 'C2']);
  assert.ok(host.counts.registered >= 6,
    `only ${host.counts.registered} tools were registered, so this run did not exercise the rows`);
  assert.deepEqual(host.names(), [],
    `the probe left ${host.names().join(', ')} on the surface it had just measured`);
});

/* ------------------------------------------------------ scope, authorisation and what is refused */

test('a scoped run touches only the rows asked for', async () => {
  const host = conformingHost();
  const transcript = await run(host, ['A2']);
  assert.deepEqual(Object.keys(transcript.observations), ['A2']);
  assert.equal(host.counts.calls, 0, 'reading a tool\'s metadata called it');
  assert.deepEqual(transcript.scope.requestedBehaviours, ['A2']);
  assert.deepEqual(transcript.scope.steps, ['schemaRoundTrip']);
});

test('a row needing authorisation it was not given is refused with the reason, not passed', async () => {
  const host = conformingHost();
  const transcript = await run(host, ['P5'], { allow: {} });
  assert.equal(transcript.observations.P5, undefined);
  assert.deepEqual(transcript.scope.refusedSteps, ['pageRequired']);
  assert.match(transcript.skipped.P5, /was not authorised/);
  assert.equal(host.counts.calls, 0, 'an unauthorised run still called a tool on the page');
});

test('a surface that cannot be read is recorded as unreadable rather than as an empty page', async () => {
  const transcript = await run(makeHost({ getToolsThrows: true }), ['P1']);
  assert.match(transcript.errors.join(' | '), /could not read the page's own tools/);
  assert.equal(transcript.observations.P1, undefined,
    'a page whose surface could not be read was reported as having no tools');
  assert.deepEqual(transcript.pageTools, []);
});
