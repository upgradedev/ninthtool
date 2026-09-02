/**
 * What the fixture gate does once OWNERSHIP is already proved.
 *
 * tests/unit/fixture_ownership.test.js covers the outer refusal: a run that cannot prove it owns
 * the page never gets as far as the four identity checks, so nothing is submitted whatever the
 * page claims. That is the important half and it is already tested.
 *
 * THIS FILE COVERS THE HALF UNDERNEATH IT. When the runner DID serve the fixture itself, the four
 * checks still have to run, and each of their refusals is a separate path that nothing drove:
 * two documents publishing one name, a document that fails a check outright, the cached refusal a
 * second row gets instead of a second attempt, and the nonce echo that must arrive before a second
 * call is sent. Each is a place where a page could be written to, so each gets a test that counts
 * the writes rather than reading the verdict.
 *
 * THE COUNTER IS THE ASSERTION. Every test here asserts on how many times the page's own tools
 * were called, not on what the transcript said about it. A verdict is the probe's opinion of its
 * own behaviour; the count is the behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll, FIXTURE_FORM_ANSWERS, FIXTURE_FORM_SILENT } from '../../src/probe/observe.js';
import { FIXTURE_MARKER, MARKER_KEY, NONCE_KEY, FIXTURE_PATH, HANDLER_LOG_KEY }
  from '../../src/probe/fixture_identity.js';
import { makeHost, readOnlyTool } from './fake_host.mjs';

const ORIGIN = 'https://owned.test';

/**
 * A page that satisfies the identity checks unless told otherwise, and counts what happens to it.
 *
 * Nothing here is a trick: origin, path and marker are all public constants of this repository,
 * which is exactly why the four of them together are not enough on their own and ownership is
 * proved separately.
 */
const FULL_SCHEMA = {
  type: 'object',
  properties: {
    witness_name: { type: 'string', description: 'Full name.' },
    age: { type: 'number', minimum: 18, maximum: 120, description: 'Age in years.' },
    severity: { type: 'string', enum: ['dent', 'write_off'], description: 'How bad.' },
  },
  required: ['witness_name'],
};

function fixtureLikePage({
  marker = FIXTURE_MARKER, pathname = FIXTURE_PATH, origin = ORIGIN,
  echoNonce = true, duplicate = false, omitForm = false, retainsValues = false,
  schema = FULL_SCHEMA, keepsHandlerLog = false, rejectsCall = 0, host = {},
} = {}) {
  const counts = { submissions: 0 };
  // What a FORM does that a function does not: the fields still hold what was put in them last
  // time, so a call that omits a property submits the previous value rather than nothing. That is
  // the whole subject of behaviour C1.
  const fields = {};
  const win = { location: { pathname } };
  if (marker !== undefined) win[MARKER_KEY] = { marker, path: pathname };
  if (keepsHandlerLog) win[HANDLER_LOG_KEY] = [];

  const form = (name) => ({
    name,
    description: 'Records the answers on the bundled fixture.',
    inputSchema: schema,
    origin,
    window: win,
    async run(input) {
      counts.submissions += 1;
      if (retainsValues) Object.assign(fields, input);
      const saw = retainsValues ? { ...fields } : input;
      // THE CHANNEL THAT SURVIVES A REJECTION. The handler writes down what it was handed BEFORE
      // anything is resolved, which is the only way behaviour C1 can see a handler that reads a
      // stale value and then refuses.
      if (keepsHandlerLog) win[HANDLER_LOG_KEY].push({ saw });
      if (counts.submissions === rejectsCall) throw new Error('this call is refused');
      const nonce = win[NONCE_KEY];
      return echoNonce && nonce
        ? `Recorded ${JSON.stringify(saw)} nonce=${nonce}`
        : `Recorded ${JSON.stringify(saw)}`;
    },
  });

  const tools = omitForm ? [readOnlyTool('read_state')] : [form(FIXTURE_FORM_ANSWERS)];
  if (duplicate) tools.push(form(FIXTURE_FORM_ANSWERS));
  if (!omitForm) tools.push(form(FIXTURE_FORM_SILENT));
  return { counts, win, host: makeHost({ pageTools: tools, origin, ...host }) };
}

/** Run with ownership already proved, which is what the command line does for its own bundle. */
async function runOwned(page, only, over = {}) {
  return observeAll(page.host.ctx, {
    meta: { url: `${ORIGIN}${FIXTURE_PATH}`, userAgent: 'node' },
    only,
    allow: { toolCalls: true, fixtureForms: true },
    expectedOrigin: ORIGIN,
    expectedPath: FIXTURE_PATH,
    fixtureOwnership: 'served-by-runner',
    ...over,
  });
}

test('two documents publishing one name is a refusal, because there is no safe way to pick', async () => {
  // `toolNamed` took the first match and ignored the rest, so two documents publishing the same
  // name silently resolved to whichever the host happened to list first, and that one was written
  // to. Ambiguity is now the answer rather than an ordering.
  const page = fixtureLikePage({ duplicate: true });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 0, 'a form was submitted on an ambiguous name');
  assert.match(transcript.errors.join(' | '),
    /2 tools are published under the name nt_form_answers, so which document would be written to is ambiguous/);
  assert.equal(transcript.scope.fixture[FIXTURE_FORM_ANSWERS].trusted, false);
});

test('ownership alone does not authorise a write: the four checks still have to hold', async () => {
  // OWNERSHIP IS NOT A BYPASS. This page is served by the runner and still fails on origin, so
  // nothing is submitted and the reason names the check rather than the row.
  const page = fixtureLikePage({ origin: 'https://somewhere-else.test' });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 0, 'a page that failed the origin check was written to');
  assert.match(transcript.errors.join(' | '), /this page is not the bundled fixture/);
  assert.match(transcript.scope.fixture[FIXTURE_FORM_ANSWERS].reason,
    /the tool's origin is https:\/\/somewhere-else.test/);
});

test('a document carrying no build marker is refused, and the marker is named', async () => {
  const page = fixtureLikePage({ marker: 'not.the.bundled.marker' });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 0);
  assert.match(transcript.scope.fixture[FIXTURE_FORM_ANSWERS].reason,
    new RegExp(`does not carry the bundled fixture marker ${FIXTURE_MARKER}`));
});

test('a second row gets the cached refusal rather than a second attempt at the same page', async () => {
  /*
   * ONE DECISION PER TOOL, TAKEN ONCE. Two rows want the same form. The first resolves the
   * identity and refuses; the second must be refused from the cache with the same reason, and
   * must not re-run the checks, because the checks write the nonce and repeating that is pointless.
   */
  const page = fixtureLikePage({ origin: 'https://somewhere-else.test' });
  const transcript = await runOwned(page, ['C3', 'C1']);
  assert.equal(page.counts.submissions, 0);
  const errors = transcript.errors.join(' | ');
  assert.match(errors, /C3: this page is not the bundled fixture/);
  assert.match(errors, /C1: this page is not the bundled fixture/);
  assert.equal(Object.keys(transcript.scope.fixture).length, 1,
    'the refusal was recorded more than once, so it was decided more than once');
});

test('the nonce echo gates the SECOND call, and exactly one call is made without it', async () => {
  /*
   * THE ORDERING DEFECT, STATED AS A COUNT. The unforgeable check can only be read by calling the
   * tool, and for a form that call is the submission. So the promise is narrow and exact: one call
   * goes out, its answer is checked for this run's nonce, and when the echo is not there nothing
   * further is sent. The run's own error text has to say so too.
   */
  const page = fixtureLikePage({ echoNonce: false });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 1,
    'a page that never echoed the nonce received more than the one call that asks for it');
  assert.equal(transcript.observations.C1, undefined, 'C1 was scored on a handler it had not proved');
  assert.match(transcript.errors.join(' | '),
    /the form answered without echoing this run's nonce.*One call was made and no further call was sent/);
});

test('a fixture that does echo is measurable, and C1 records how it knows', async () => {
  const page = fixtureLikePage({ echoNonce: true });
  const transcript = await runOwned(page, ['C1']);
  const c1 = transcript.observations.C1;
  assert.ok(c1, `C1 was not observed: ${transcript.errors.join(' | ')}`);
  assert.equal(c1.nonceEchoed, true);
  assert.equal(page.counts.submissions, 2, 'the row sends the proving call and then the stale one');
  assert.equal(c1.handlerTelemetry, 'unavailable',
    'a page that keeps no handler log must be reported as one that could not be looked at');
  assert.equal(c1.handlerSawStaleValue, false,
    'this handler echoes only what it was handed, so there was no stale value to find');
});

test('a page that publishes no such tool is refused by name, not by absence', async () => {
  const page = fixtureLikePage({ omitForm: true });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 0);
  assert.equal(transcript.scope.fixture[FIXTURE_FORM_ANSWERS].reason, 'no such tool on this surface');
});

test('a run that was told no origin and no path refuses rather than comparing a value with itself', async () => {
  // Comparing against the document that loaded would compare a value with itself and trust
  // anything. With nothing to compare against, the answer is unknown and unknown is a refusal.
  const page = fixtureLikePage();
  const transcript = await runOwned(page, ['C1'], { expectedOrigin: undefined, expectedPath: undefined });
  assert.equal(page.counts.submissions, 0);
  assert.match(transcript.scope.fixture[FIXTURE_FORM_ANSWERS].reason,
    /the audit target's origin is unknown/);
});

/* ------------------------------------------------------------------ C1, the stale value channel */

test('C1 sees a handler that READ the stale value and then refused', async () => {
  /*
   * THE SHAPE THIS ROW COULD NOT SEE, AND THE WORST ONE. The leak used to be detectable only by
   * finding the seeded value inside the RESOLVED answer. A rejected call has no answer, so a
   * handler that read the stale value and then rejected was recorded as clean and the row passed.
   *
   * Here the handler records what it was handed, then refuses the second call. The row has to
   * report the leak from the handler's own log rather than from an answer that never arrived.
   */
  const page = fixtureLikePage({ keepsHandlerLog: true, rejectsCall: 2, retainsValues: true });
  const transcript = await runOwned(page, ['C1']);
  const c1 = transcript.observations.C1;
  assert.ok(c1, `C1 was not observed: ${transcript.errors.join(' | ')}`);
  assert.equal(c1.settled, 'rejected', 'the second call was expected to be refused');
  assert.equal(c1.handlerTelemetry, 'read', 'the handler log was there and was not read');
  assert.equal(c1.handlerCallsObserved, 1, 'the row must read only the entries its second call added');
  assert.equal(c1.handlerSawStaleValue, true,
    'a handler that read the stale value and then refused was recorded as clean');
  assert.equal(c1.staleValue, 'M. Okafor');
  assert.equal(c1.callerSaw, '', 'a refused call has no answer, and none may be invented for it');
});

test('C1 sends nothing further when the very first call is refused', async () => {
  // No answer means no echo, and no echo means the handler is not proved. One call went out.
  const page = fixtureLikePage({ rejectsCall: 1 });
  const transcript = await runOwned(page, ['C1']);
  assert.equal(page.counts.submissions, 1);
  assert.equal(transcript.observations.C1, undefined);
  assert.match(transcript.errors.join(' | '), /answered without echoing this run's nonce/);
});

/* ------------------------------------------------------------------ C3, the constraint matrix */

test('C3 reads a schema the host hands back as text, not only as an object', async () => {
  const page = fixtureLikePage({ host: { schemaReadBack: 'string' } });
  const transcript = await runOwned(page, ['C3']);
  const c3 = transcript.observations.C3;
  assert.ok(c3, `C3 was not observed: ${transcript.errors.join(' | ')}`);
  assert.equal(JSON.parse(c3.formSchema).required[0], 'witness_name',
    'a schema delivered as text was not parsed back into the contract the row mirrors');
});

test('C3 reports a constraint neither side declares as not comparable, never as agreement', async () => {
  /*
   * THE FAIL OPEN AN AUDIT WAS RIGHT TO REJECT. The row used to pass whenever the two booleans
   * matched, which meant it passed when NEITHER path enforced anything. A schema that expresses no
   * constraint at all is the clearest version of that: there is nothing to compare, and saying so
   * is the only honest answer.
   */
  const page = fixtureLikePage({ schema: { type: 'object' } });
  const transcript = await runOwned(page, ['C3']);
  const c3 = transcript.observations.C3;
  assert.ok(c3, `C3 was not observed: ${transcript.errors.join(' | ')}`);
  assert.deepEqual(c3.constraints.map((c) => c.declared), [false, false, false, false]);
  for (const constraint of c3.constraints) {
    assert.equal(constraint.script, 'not-declared', constraint.name);
    assert.equal(constraint.form, 'not-declared', constraint.name);
    assert.equal(constraint.detail, 'the schema does not express this constraint');
  }
  assert.equal(page.counts.submissions, 0, 'bad calls were sent for constraints nobody declared');
});

test('C3 reports both paths enforcing when the host really checks the declared schema', async () => {
  // The other end of the matrix. `unknownProperty` is only a constraint when the schema says
  // additionalProperties is false, so this schema says it, and then all four are comparable.
  const page = fixtureLikePage({
    schema: { ...FULL_SCHEMA, additionalProperties: false },
    host: { enforceSchema: true },
  });
  const transcript = await runOwned(page, ['C3']);
  const c3 = transcript.observations.C3;
  assert.ok(c3, `C3 was not observed: ${transcript.errors.join(' | ')}`);
  assert.deepEqual(c3.constraints.map((c) => c.name),
    ['required', 'type', 'enumerated', 'unknownProperty']);
  for (const constraint of c3.constraints) {
    assert.equal(constraint.declared, true, `${constraint.name} was not declared by this schema`);
    assert.equal(constraint.script, 'enforced', constraint.name);
    assert.equal(constraint.form, 'enforced', constraint.name);
    assert.equal(constraint.detail, 'the script path refused it');
  }
  assert.equal(c3.scriptPathEnforces, true);
  assert.equal(c3.formPathEnforces, true);
});

test('C4 reports what the silent form did, and touches only that form', async () => {
  const page = fixtureLikePage();
  const transcript = await runOwned(page, ['C4']);
  const c4 = transcript.observations.C4;
  assert.ok(c4, `C4 was not observed: ${transcript.errors.join(' | ')}`);
  assert.equal(c4.settled, 'resolved');
  assert.ok(Object.prototype.hasOwnProperty.call(transcript.scope.fixture, FIXTURE_FORM_SILENT),
    'C4 was judged without the silent form ever being proved in its own right');
  assert.equal(transcript.scope.fixture[FIXTURE_FORM_ANSWERS], undefined,
    'C4 proved a tool it had no reason to touch');
});
