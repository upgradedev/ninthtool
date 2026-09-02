/**
 * Nothing is written to a page this run cannot prove it owns, and the proof happens FIRST.
 *
 * THE DEFECT. The four identity checks ended by WRITING a nonce onto the document and returning
 * trusted. The echo, the only unforgeable half, was read from the answer to the first call, and on
 * a form tool that call IS the submission. Identity was therefore confirmed one write too late.
 *
 * Reproduced in a real browser against a page served at the expected path, carrying the build
 * marker (a public constant in this repository), publishing the expected tool names, and never
 * reading the nonce:
 *
 *   fixture identity : trusted true, "origin, document path, build marker and nonce channel all hold"
 *   form submissions : 1
 *
 * and the run's own error text admitted it: "One call was made and no further call was sent".
 *
 * WHY THERE IS NO CLEVERER CHECK. Everything a page exposes here is copyable: the tool name, the
 * pathname, the schema, the marker. The nonce is not, but reading it back requires calling the
 * tool. WebMCP offers no challenge a document must answer BEFORE it is invoked, so no ordering
 * makes an arbitrary page provable. Writing is therefore bound to a fixture this runner owns.
 *
 * These drive the real observeAll, because the defect was in WHEN the check ran rather than in
 * what it returned, and a hand written transcript cannot express an ordering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { FIXTURE_MARKER, MARKER_KEY, FIXTURE_PATH } from '../../src/probe/fixture_identity.js';

const ORIGIN = 'https://x.test';

/** A page imitating the fixture as closely as anything public allows, counting what happens to it. */
function imitation({
  marker = FIXTURE_MARKER, pathname = FIXTURE_PATH, origin = ORIGIN,
  echoNonce = false, duplicate = false, otherWindow = false,
} = {}) {
  const counts = { submissions: 0, calls: 0 };
  const store = {};
  const win = {
    location: { pathname },
    get [MARKER_KEY]() { return marker === undefined ? undefined : { marker, path: pathname }; },
    set [MARKER_KEY](v) { store[MARKER_KEY] = v; },
  };
  const proxy = new Proxy(win, {
    get: (t, k) => (k in t ? t[k] : store[k]),
    set: (t, k, v) => { store[k] = v; return true; },
  });
  const elsewhere = { location: { pathname }, other: true };

  const make = (name) => ({
    name,
    description: 'copied',
    inputSchema: {
      type: 'object',
      properties: {
        witness_name: { type: 'string', description: 'name' },
        age: { type: 'number', minimum: 18, maximum: 120, description: 'age' },
        severity: { type: 'string', enum: ['dent'], description: 'how bad' },
      },
      required: ['witness_name'],
    },
    origin,
    get window() { return otherWindow ? elsewhere : proxy; },
  });

  const tools = [make('nt_form_answers'), make('nt_form_silent')];
  if (duplicate) tools.push(make('nt_form_answers'));

  return {
    counts,
    ctx: {
      async getTools() { return tools.slice(); },
      async registerTool(d) {
        tools.push({ ...d, origin, get window() { return proxy; } });
        return { name: d.name };
      },
      async executeTool(tool, argsJson) {
        counts.calls += 1;
        if (String(tool.name).indexOf('nt_form_') === 0) {
          // A submission is a WRITE. This is the number that has to stay at zero.
          counts.submissions += 1;
          const nonce = store.__ninthtoolNonce;
          return echoNonce && nonce ? `Recorded ${argsJson} nonce=${nonce}` : `submitted ${argsJson}`;
        }
        return 'ok';
      },
    },
  };
}

async function run(page, over = {}) {
  return observeAll(page.ctx, {
    meta: { url: `${ORIGIN}${FIXTURE_PATH}`, userAgent: 'node' },
    only: ['C1', 'C3', 'C4'],
    allow: { toolCalls: true, fixtureForms: true },
    expectedOrigin: ORIGIN,
    expectedPath: FIXTURE_PATH,
    ...over,
  });
}

/** Every refused case leaves BOTH counters at zero, not merely the verdict at not-applicable. */
function assertUntouched(page, label) {
  assert.equal(page.counts.submissions, 0,
    `${label}: a form was submitted on a page this run cannot prove it owns`);
  assert.equal(page.counts.calls, 0,
    `${label}: a page tool was called on a page this run cannot prove it owns`);
}

test('1. correct path and copied marker, no nonce echo: nothing is submitted', async () => {
  // THE REPRODUCTION. Under the old order this page received a submission before the echo was read.
  const page = imitation({ echoNonce: false });
  const transcript = await run(page);
  assertUntouched(page, 'copied marker without an echo');
  assert.match(transcript.errors.join(' '), /cannot prove/);
});

test('2. correct names and schema in another document: nothing is submitted', async () => {
  const page = imitation({ otherWindow: true });
  await run(page);
  assertUntouched(page, 'a different document');
});

test('3. a duplicated tool name: nothing is submitted', async () => {
  const page = imitation({ duplicate: true });
  await run(page);
  assertUntouched(page, 'duplicate names');
});

test('4. the wrong target window: nothing is submitted', async () => {
  const page = imitation({ otherWindow: true });
  await run(page, { expectedWindow: { not: 'the same object' } });
  assertUntouched(page, 'wrong window');
});

test('5. the wrong origin: nothing is submitted', async () => {
  const page = imitation({ origin: 'https://somewhere-else.test' });
  await run(page);
  assertUntouched(page, 'wrong origin');
});

test('6. a fixture this runner served itself is still measurable', async () => {
  // OWNERSHIP IS NOT A BYPASS OF THE OTHER CHECKS. It permits the first call; the nonce echo still
  // has to hold for the row to be judged at all.
  const owned = imitation({ echoNonce: true });
  const transcript = await run(owned, { fixtureOwnership: 'served-by-runner' });
  assert.ok(owned.counts.submissions > 0,
    'the fixture this runner serves itself must still be measurable, or the rows are dead');
  assert.ok(transcript.observations.C1,
    `C1 was not observed on our own fixture: ${transcript.errors.join('; ')}`);
});

test('7. a foreign page with read only authorisation only: zero submissions', async () => {
  const page = imitation({ echoNonce: false });
  await run(page, { allow: { toolCalls: true, fixtureForms: false } });
  assert.equal(page.counts.submissions, 0, 'a read only authorisation submitted a form');
});

test('8. form authorisation without provable identity: still zero submissions', async () => {
  // THE ONE THAT MATTERS MOST. An explicit flag must not turn an unverified page into the fixture.
  const page = imitation({ echoNonce: true });
  await run(page, { allow: { toolCalls: true, fixtureForms: true } });
  assertUntouched(page, 'authorised but unproven');
});

test('an echo that would have arrived cannot authorise the write that fetches it', async () => {
  // The old defect stated as a property: a page that WOULD echo correctly is still not written to,
  // because the echo was never obtainable without writing first.
  const page = imitation({ echoNonce: true });
  await run(page);
  assertUntouched(page, 'a page that would have echoed');
});
