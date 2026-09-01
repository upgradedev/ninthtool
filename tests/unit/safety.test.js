/**
 * The two modules that decide what this suite is allowed to touch.
 *
 * These exist because of two measured incidents, both from an adversarial audit of commit
 * `42b7f72`. Pointed at a page that declared the bundled fixture's tool name, the runner submitted
 * two forms on it. Asked for one behaviour, it ran all twenty and called a stranger's read only
 * handler twice. Both are now structural, and both are asserted here rather than trusted.
 *
 * `steps.js` and `fixture_identity.js` are pure, so all of this runs without a browser. The end to
 * end proof against a real hostile page is `tests/integration/side_effect_isolation.mjs`, which
 * needs Chrome and is run separately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS, STEP_ORDER, stepsFor, behavioursFrom, modesFor, refusedModes, permittedSteps, MODES,
} from '../../src/probe/steps.js';
import {
  checkFixtureIdentity, answerCarriesNonce, makeNonce, FIXTURE_MARKER, FIXTURE_PATH, MARKER_KEY,
} from '../../src/probe/fixture_identity.js';
import { BEHAVIOUR_IDS } from '../../src/judge/behaviours.js';

/* ------------------------------------------------------------------ the step table */

test('every behaviour in the catalogue is produced by exactly one step', () => {
  const produced = STEP_ORDER.flatMap((name) => STEPS[name].produces || []);
  const missing = BEHAVIOUR_IDS.filter((id) => !produced.includes(id));
  assert.deepEqual(missing, [], 'these behaviours have no step that observes them');

  const duplicated = produced.filter((id, i) => produced.indexOf(id) !== i);
  assert.deepEqual(duplicated, [], 'these behaviours are produced by more than one step');

  const orphans = produced.filter((id) => !BEHAVIOUR_IDS.includes(id));
  assert.deepEqual(orphans, [], 'a step produces a behaviour that is not in the catalogue');
});

test('every step declares a mode the runner knows how to authorise', () => {
  for (const name of STEP_ORDER) {
    assert.ok(MODES.includes(STEPS[name].mode), `${name} has mode "${STEPS[name].mode}"`);
  }
});

test('selecting one behaviour selects one step, and its dependencies', () => {
  assert.deepEqual(stepsFor(['A1']), ['arity']);
  assert.deepEqual(behavioursFrom(stepsFor(['A1'])), ['A1']);

  // C3's form half depends on the script half, which is a separate step.
  assert.deepEqual(stepsFor(['C3']).sort(), ['formValidation', 'scriptValidation'].sort());
});

test('selecting a behaviour whose step produces two selects both, and nothing else', () => {
  // A3 and B3 come from one registration, so asking for one must run the other rather than
  // judging it against data the run never gathered.
  assert.deepEqual(stepsFor(['B3']), ['annotations']);
  assert.deepEqual(behavioursFrom(stepsFor(['B3'])).sort(), ['A3', 'B3']);
});

test('selecting nothing selects everything', () => {
  assert.deepEqual(stepsFor(null), [...STEP_ORDER]);
  assert.deepEqual(stepsFor([]), [...STEP_ORDER]);
});

test('A1 needs no authorisation and touches nothing belonging to the page', () => {
  const steps = stepsFor(['A1']);
  assert.deepEqual(modesFor(steps), ['register']);
  assert.deepEqual(refusedModes(steps, {}), [], 'A1 must run with no flags at all');
  assert.deepEqual(permittedSteps(steps, {}), ['arity']);
});

test('P5 and P6 need explicit authorisation to call the page under test', () => {
  for (const id of ['P5', 'P6']) {
    const steps = stepsFor([id]);
    assert.deepEqual(modesFor(steps), ['readonly-call']);
    assert.deepEqual(refusedModes(steps, {}), ['readonly-call'], `${id} must be refused by default`);
    assert.deepEqual(permittedSteps(steps, {}), [], `${id} must not run unauthorised`);
    assert.deepEqual(permittedSteps(steps, { toolCalls: true }).length, 1);
  }
});

test('selecting P5 does not select P6 or any form', () => {
  const steps = stepsFor(['P5']);
  assert.deepEqual(steps, ['pageRequired']);
  assert.ok(!behavioursFrom(steps).includes('P6'));
  assert.ok(!modesFor(steps).includes('fixture-form'));
});

test('the rows that submit a form are refused by default and need their own flag', () => {
  for (const id of ['C1', 'C3', 'C4']) {
    const steps = stepsFor([id]);
    assert.ok(modesFor(steps).includes('fixture-form'), `${id} must be marked as submitting a form`);
    assert.ok(refusedModes(steps, {}).includes('fixture-form'), `${id} must be refused by default`);
    assert.ok(refusedModes(steps, { toolCalls: true }).includes('fixture-form'),
      `${id} must not be unlocked by --allow-tool-calls, which is a weaker authorisation`);
    assert.deepEqual(refusedModes(steps, { fixtureForms: true, toolCalls: true }), []);
  }
});

test('a full run with no authorisation still runs every metadata and register row', () => {
  const steps = permittedSteps(stepsFor(null), {});
  const ids = behavioursFrom(steps);
  for (const id of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5', 'C2', 'D1', 'D2', 'P1', 'P2', 'P3', 'P4']) {
    assert.ok(ids.includes(id), `${id} needs no authorisation and should still be observed`);
  }
  for (const id of ['C1', 'C3', 'C4', 'P5', 'P6']) {
    assert.ok(!ids.includes(id), `${id} touches the page under test and must be refused by default`);
  }
});

/* ------------------------------------------------------------------ fixture identity */

/** A fake tool object, with a window whose properties the checks read. */
function toolLike({ origin, pathname, marker, throwOnWindow = false, throwOnWrite = false }) {
  const win = {
    location: { pathname },
    set [MARKER_KEY](v) { if (throwOnWrite) throw new Error('sealed'); },
    get [MARKER_KEY]() { return marker === undefined ? undefined : { marker }; },
  };
  const store = {};
  const proxy = new Proxy(win, {
    get: (t, k) => (k in t ? t[k] : store[k]),
    set: (t, k, v) => { if (throwOnWrite) throw new Error('sealed'); store[k] = v; return true; },
  });
  return {
    name: 'nt_form_answers',
    origin,
    get window() { if (throwOnWindow) throw new Error('cross origin'); return proxy; },
  };
}

const GOOD = { expectedOrigin: 'https://example.test', nonce: 'nt-abc123' };

test('the bundled fixture passes all four checks', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: FIXTURE_PATH, marker: FIXTURE_MARKER }),
    GOOD,
  );
  assert.equal(verdict.trusted, true, verdict.reason);
  assert.deepEqual(verdict.checks, { origin: true, document: true, marker: true, nonceWritten: true });
});

test('a page that merely declares the tool name is refused', () => {
  // The exact incident: an unrelated page using nt_form_answers had two forms submitted to it.
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: '/', marker: undefined }),
    GOOD,
  );
  assert.equal(verdict.trusted, false);
  assert.match(verdict.reason, /registered by \//);
  assert.equal(verdict.checks.document, false);
});

test('the right path without the build marker is refused', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: FIXTURE_PATH, marker: undefined }),
    GOOD,
  );
  assert.equal(verdict.trusted, false);
  assert.match(verdict.reason, /marker/);
  assert.equal(verdict.checks.marker, false);
});

test('the wrong marker value is refused', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: FIXTURE_PATH, marker: 'something.else' }),
    GOOD,
  );
  assert.equal(verdict.trusted, false);
  assert.equal(verdict.checks.marker, false);
});

test('a tool from another origin is refused before anything else is read', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://elsewhere.test', pathname: FIXTURE_PATH, marker: FIXTURE_MARKER }),
    GOOD,
  );
  assert.equal(verdict.trusted, false);
  assert.equal(verdict.checks.origin, false);
  assert.equal(verdict.checks.document, false, 'nothing further should have been examined');
});

test('an unreachable registering document is refused rather than assumed safe', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: FIXTURE_PATH, throwOnWindow: true }),
    GOOD,
  );
  assert.equal(verdict.trusted, false);
  assert.match(verdict.reason, /could not be reached/);
});

test('a run with no nonce is refused, because the echo could not be checked', () => {
  const verdict = checkFixtureIdentity(
    toolLike({ origin: 'https://example.test', pathname: FIXTURE_PATH, marker: FIXTURE_MARKER }),
    { expectedOrigin: 'https://example.test', nonce: '' },
  );
  assert.equal(verdict.trusted, false);
  assert.match(verdict.reason, /nonce/);
});

test('a missing tool is refused', () => {
  assert.equal(checkFixtureIdentity(null, GOOD).trusted, false);
});

test('the echo is what proves the fixture handler ran', () => {
  assert.equal(answerCarriesNonce('Recorded {"a":1} nonce=nt-abc123', 'nt-abc123'), true);
  assert.equal(answerCarriesNonce('this page submitted its form', 'nt-abc123'), false,
    'an impostor that submits without echoing must not be treated as the fixture');
  assert.equal(answerCarriesNonce('anything', ''), false, 'an empty nonce can never be satisfied');
  assert.equal(answerCarriesNonce(null, 'nt-abc123'), false);
});

test('a nonce is long enough not to be guessed and different every time', () => {
  const a = makeNonce();
  const b = makeNonce();
  assert.notEqual(a, b);
  assert.ok(a.length >= 12, `nonce ${a} is too short to be unguessable`);
  assert.match(a, /^nt-/);
});

test('the fixture page carries the marker the checks require', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
  );
  const fixture = fs.readFileSync(path.join(root, 'fixtures/subject.html'), 'utf8');
  assert.match(fixture, /MARKER_KEY\]\s*=\s*\{\s*marker:\s*FIXTURE_MARKER/,
    'the bundled fixture must set the marker, or nothing will ever be trusted');
  assert.match(fixture, /NONCE_KEY\]/,
    'the bundled fixture must echo the nonce, or the fourth check can never pass');
});
