/**
 * The browser launcher, tested without ever starting a browser.
 *
 * WHY THIS FILE EXISTS. launch.mjs decides which page the probe attaches to, and getting that
 * wrong does not fail loudly. A run once attached to the initial blank document, found no WebMCP
 * on it, and reported every behaviour unobserved. Nought measurements is an instrument failure and
 * never a result. The matcher and the two waiters written to stop that happening again had no
 * tests, so nothing checked that they still refuse a blank page, and nothing checked that
 * waitForDocument waits for the second of its two conditions rather than the first.
 *
 * WHAT IS FAKED, AND WHY IT IS STILL A REAL TEST. waitForDocument takes a session object, so it is
 * handed a scripted one that answers a fixed sequence and records every call. waitForDebugger and
 * waitForPageTarget reach for the global fetch, which is replaced for the length of a single test
 * and put back in t.after, so a failed assertion cannot leak a stub into the test that follows.
 * The fakes assert the URL and the arguments they were handed, so they check behaviour rather than
 * merely standing in for it. None of them is built from the code under test.
 *
 * WHAT THESE TESTS FOUND. Written first against the matcher as it stood, they recorded two things
 * it did rather than accommodating them: a target at the origin root satisfied a matcher built for
 * a deep path on that origin, and a target carrying no URL matched anything at all. Both were the
 * about:blank failure class, where the guard excludes one literal string instead of requiring the
 * right page. The matcher has since been tightened to exact equality on a normalised URL and
 * waitForPageTarget now calls it rather than keeping a second copy of the comparison, so the
 * expectations below are the corrected ones. One half of the same looseness is still live in
 * waitForDocument and is recorded, not endorsed, in its own test near the end of that section.
 *
 * ONE SOCKET IS TOUCHED. waitForDebugger is aimed at a loopback port that was bound, read and
 * released a moment earlier, so the connection is refused straight away. Nothing leaves this
 * machine, no browser is started, and launchWithWebMCP is never called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  findChrome, waitForDebugger, waitForPageTarget, targetFor, waitForDocument,
} from '../../src/probe/launch.mjs';

/** The page a real run asks for, served from the same origin as the probe UI itself. */
const WANTED = 'http://127.0.0.1:8412/fixtures/subject.html';

/* ------------------------------------------------------------------ test doubles */

/**
 * A session that answers a scripted sequence and remembers how it was called.
 *
 * The last entry repeats for ever, so a test that expects convergence cannot quietly turn into a
 * test of the timeout by running off the end of its own script. An Error entry is thrown, which is
 * how a real session behaves while the page's context is being replaced by a navigation.
 */
function scriptedSession(script) {
  const calls = [];
  return {
    calls,
    async evaluate(expression, timeoutMs) {
      calls.push({ expression, timeoutMs });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

/** What the page reports about itself, in the shape waitForDocument parses. */
function document(url, readyState) {
  return JSON.stringify({ url, readyState });
}

/**
 * Replace the global fetch for one test and put the real one back afterwards.
 *
 * @returns {string[]} the URLs asked for, in order, so a test can assert the endpoint
 */
function stubFetch(t, handler) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return handler(asked.length);
  };
  t.after(() => { globalThis.fetch = real; });
  return asked;
}

/** A JSON response of the shape the browser's own endpoints return. */
function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

/** A loopback port that was just released, so connecting to it is refused at once. */
function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/* ------------------------------------------------------------------ findChrome */

/**
 * The port these tests name, used nowhere else in this repository.
 *
 * WHY IT IS A CONSTANT AND WHY THE ASSERTIONS DERIVE FROM IT. Every test below that names a port
 * replaces fetch, so no socket is opened and the number is only ever a value that has to reappear
 * in the URL the code builds. Writing that URL out by hand is what makes a port change look like a
 * broken test: the call was moved to a different port once and the assertion still named the old
 * one, which is a test failing for a reason that is not about the code. So the expected URL is
 * built from the same constant the call is given, and changing the constant cannot break anything.
 *
 * 9411 is the launcher default and 9412 is the port the readiness script drives a real browser on.
 * This is neither, so a readiness run in flight cannot be mistaken for a stub.
 */
const PROBE_PORT = 9787;

test('an explicit browser path that exists is used as given', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-launch-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, 'chrome.exe');
  fs.writeFileSync(binary, 'not really a browser');

  assert.equal(findChrome(binary), binary);
});

test('an explicit browser path that does not exist returns null rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-launch-test-'));
  const missing = path.join(dir, 'no-such-browser.exe');
  fs.rmSync(dir, { recursive: true, force: true });

  // A throw here would reach the user as a stack trace instead of the sentence launchWithWebMCP
  // writes, which names the flag to pass and says why Firefox and Safari are not an option.
  assert.equal(findChrome(missing), null);
});

test('the search either finds a path that exists or says null, and never something in between', () => {
  // This machine may or may not have a browser, so the assertion is on the contract rather than on
  // the answer: whatever comes back is either null or a path that is really there. A returned
  // undefined, or a stale path from the table, would be a spawn failure much further downstream.
  const found = findChrome();
  if (found === null) return;
  assert.equal(typeof found, 'string');
  assert.ok(found.length > 0, 'an empty path would be spawned and fail with an unhelpful error');
  assert.ok(fs.existsSync(found), `findChrome returned ${found}, which does not exist`);
});

/* ------------------------------------------------------------------ targetFor */

test('the matcher accepts the exact URL it was asked for', () => {
  assert.equal(targetFor(WANTED)({ url: WANTED }), true);
});

test('a trailing slash on either side is not a different page', () => {
  assert.equal(targetFor('http://127.0.0.1:8412/app')({ url: 'http://127.0.0.1:8412/app/' }), true);
  assert.equal(targetFor('http://127.0.0.1:8412/app/')({ url: 'http://127.0.0.1:8412/app' }), true);
});

test('a fragment on either side is not a different page', () => {
  // The browser reports the fragment on the target once the page has been navigated, and a run can
  // be asked for a URL that carries one. Neither is a mismatch, because a fragment never changes
  // which document was fetched.
  assert.equal(targetFor(WANTED)({ url: `${WANTED}#top` }), true);
  assert.equal(targetFor(`${WANTED}#top`)({ url: WANTED }), true);
});

test('the matcher refuses about:blank, which is the whole reason it exists', () => {
  // The measured incident. Chrome opens about:blank and navigates afterwards, so attaching to the
  // first page target found a blank document and reported every behaviour unobserved.
  assert.equal(targetFor(WANTED)({ url: 'about:blank' }), false);

  // The second line is what actually holds the guard in place, and it was worth finding out.
  // Delete the guard and the line above still passes, because no http URL equals about:blank and
  // the comparison refuses it anyway. The guard bites only where the comparison would say yes,
  // which is a run pointed at about:blank itself. Refusing that is right: a blank document carries
  // no registration to measure, so ok there would be nought measurements dressed up as a pass.
  assert.equal(targetFor('about:blank')({ url: 'about:blank' }), false);
});

test('the matcher refuses an unrelated origin and a different port', () => {
  assert.equal(targetFor(WANTED)({ url: 'https://elsewhere.test/fixtures/subject.html' }), false);
  assert.equal(targetFor(WANTED)({ url: 'http://127.0.0.1:9999/fixtures/subject.html' }), false);
});

test('a target at the origin root does NOT match a matcher built for a deep path', () => {
  // Recorded as a defect when this file was written, and fixed rather than accommodated. The
  // comparison used to strip a trailing slash and then prefix test the other way round, so
  // http://127.0.0.1:8412/ satisfied a matcher built for /fixtures/subject.html. The runner serves
  // its own page and the subject frame from that one loopback origin, so both targets exist at
  // once and whichever the browser listed first would have been driven. Same class as the
  // about:blank incident: the guard excluded one literal string rather than requiring the right
  // page. It is exact equality on the normalised URL now.
  assert.equal(targetFor(WANTED)({ url: 'http://127.0.0.1:8412/' }), false);
  assert.equal(targetFor(WANTED)({ url: 'http://127.0.0.1:8412' }), false);
});

test('a near miss on the same origin is a different page, not a near miss', () => {
  // Prefix matching accepted both of these, and neither is caught by the origin root test above.
  // A page whose path merely starts with the one asked for belongs to somebody else.
  assert.equal(targetFor('http://127.0.0.1:8412/app')({ url: 'http://127.0.0.1:8412/apple' }), false);
  assert.equal(targetFor(WANTED)({ url: `${WANTED}/nested` }), false);
});

test('a target carrying no URL matches nothing', () => {
  // Also recorded as a defect here and then fixed rather than accommodated. It used to match
  // anything at all, because String(target.url || '') is the empty string and every string starts
  // with the empty string. All three shapes reach the matcher from a target list.
  assert.equal(targetFor(WANTED)({}), false);
  assert.equal(targetFor(WANTED)({ url: '' }), false);
  assert.equal(targetFor(WANTED)({ url: null }), false);

  // The other half of the same guard, and the only thing holding it now that the comparison is
  // exact. A matcher built from a URL that never arrived must match nothing, rather than matching
  // every blank target on the strength of two empty strings being equal.
  assert.equal(targetFor('')({ url: '' }), false);
});

/* ------------------------------------------------------------------ waitForDocument */

test('waitForDocument waits for the right URL and for readyState, not just the first', async () => {
  // Both conditions have to hold. The target list reports the new URL before the page's own
  // context has committed to it, so a check on the URL alone still runs against the blank document.
  const session = scriptedSession([
    document('about:blank', 'complete'),
    document(WANTED, 'loading'),
    document(WANTED, 'complete'),
  ]);

  const result = await waitForDocument(session, WANTED, 5000);

  assert.equal(result.ok, true);
  assert.equal(result.url, WANTED);
  assert.equal(result.readyState, 'complete');
  assert.equal(session.calls.length, 3, 'it settled on an answer it should have rejected');
  assert.ok(result.waitedMs >= 200, `waitedMs was ${result.waitedMs}, so it did not poll at all`);
});

test('waitForDocument asks the document about itself, with its own short timeout', async () => {
  const session = scriptedSession([document(WANTED, 'complete')]);
  await waitForDocument(session, WANTED, 5000);

  const [first] = session.calls;
  assert.match(first.expression, /document\.URL/);
  assert.match(first.expression, /document\.readyState/);
  assert.equal(first.timeoutMs, 5000,
    'a per evaluate timeout is what stops one hung page eating the whole deadline');
});

test('a document stuck on loading is given up on, and reports what it last saw', async () => {
  const session = scriptedSession([document(WANTED, 'loading')]);

  const result = await waitForDocument(session, WANTED, 600);

  assert.equal(result.ok, false);
  assert.equal(result.url, WANTED, 'the caller needs to know the URL was right and the load was not');
  assert.equal(result.readyState, 'loading');
  assert.ok(result.waitedMs >= 600, `waitedMs was ${result.waitedMs}, less than the deadline`);
});

test('a page that never leaves about:blank is given up on rather than accepted', async () => {
  const session = scriptedSession([document('about:blank', 'complete')]);

  const result = await waitForDocument(session, WANTED, 600);

  assert.equal(result.ok, false, 'about:blank was reported as the page under test');
  assert.equal(result.url, 'about:blank');
  assert.ok(session.calls.length > 1, 'it should have asked more than once inside the deadline');
});

test('waitForDocument refuses a blank document even when that is what was asked for', async () => {
  // A degenerate request, and the only thing holding the guard in place. For any http URL the
  // ordinary comparison already refuses about:blank, so deleting the explicit guard changes
  // nothing and no other test here notices. It bites only when about:blank is the URL requested,
  // and refusing that is right: a blank document has no registration to measure, so reporting it
  // loaded would be nought measurements dressed up as a pass.
  const session = scriptedSession([document('about:blank', 'complete')]);

  const result = await waitForDocument(session, 'about:blank', 400);

  assert.equal(result.ok, false);
  assert.equal(result.url, 'about:blank');
});

test('RECORDED, NOT ENDORSED: waitForDocument still accepts the origin root', async () => {
  // targetFor and waitForPageTarget were tightened to exact equality on a normalised URL.
  // waitForDocument was not. It still prefix tests both ways, so a document at
  // http://127.0.0.1:8412/, which is the runner's own page on the same origin, satisfies a wait
  // for /fixtures/subject.html. The two siblings now disagree about which page is the right page,
  // and this module's opening docblock exists because two copies of a rule drifted apart once
  // before. When this one is brought into line, flip the expectation to false.
  const session = scriptedSession([document('http://127.0.0.1:8412/', 'complete')]);

  const result = await waitForDocument(session, WANTED, 400);

  assert.equal(result.ok, true);
  assert.equal(result.url, 'http://127.0.0.1:8412/');
});

test('a session that throws mid navigation is asked again rather than being fatal', async () => {
  // Runtime.evaluate genuinely fails while the context is swapped, and an undefined answer is what
  // a real session returns when the result carries no value. Both are normal, and neither is an
  // outcome to report.
  const session = scriptedSession([
    new Error('Runtime.evaluate: context was destroyed'),
    undefined,
    document(WANTED, 'complete'),
  ]);

  const result = await waitForDocument(session, WANTED, 5000);

  assert.equal(result.ok, true);
  assert.equal(session.calls.length, 3);
});

test('a session that only ever answers nonsense gives up with empty fields, not a throw', async () => {
  const session = scriptedSession(['<html>this is not JSON</html>']);

  const result = await waitForDocument(session, WANTED, 500);

  assert.equal(result.ok, false);
  assert.equal(result.url, '');
  assert.equal(result.readyState, '');
  assert.ok(result.waitedMs >= 500);
});

/* ------------------------------------------------------------------ waitForDebugger */

test('a port with nothing on it returns ok false with how long it waited', async () => {
  const port = await freeLoopbackPort();

  const result = await waitForDebugger(port, 400);

  assert.equal(result.ok, false, `something answered on port ${port}, so this test proved nothing`);
  assert.equal(result.browser, null);
  assert.ok(result.waitedMs >= 400, `waitedMs was ${result.waitedMs}, less than the deadline`);
  // The point of the return value. The copy that failed on a CI runner raised a bare
  // ECONNREFUSED, which says nothing about whether waiting longer would have helped.
  assert.equal(typeof result.waitedMs, 'number');
});

test('the debugger poll asks the version endpoint and keeps asking until it answers', async (t) => {
  const asked = stubFetch(t, (call) => {
    if (call === 1) throw new Error('connect ECONNREFUSED');
    if (call === 2) return jsonResponse({}, false);
    return jsonResponse({ Browser: 'HeadlessChrome/120.0.0.0' });
  });

  const result = await waitForDebugger(PROBE_PORT, 5000);

  assert.equal(result.ok, true);
  assert.equal(result.browser, 'HeadlessChrome/120.0.0.0');
  assert.equal(asked.length, 3, 'a refusal or a non ok response is not an answer');
  assert.deepEqual(new Set(asked), new Set([`http://127.0.0.1:${PROBE_PORT}/json/version`]));
  assert.ok(result.waitedMs >= 200, 'it returned without ever waiting between attempts');
});

test('a browser that answers without naming itself is still up', async (t) => {
  stubFetch(t, () => jsonResponse({}));

  const result = await waitForDebugger(PROBE_PORT, 2000);

  assert.equal(result.ok, true);
  assert.equal(result.browser, '', 'an unknown name is not the same as nothing listening');
});

/* ------------------------------------------------------------------ waitForPageTarget */

test('the page target is waited for by name, past a blank one and a browser still starting', async (t) => {
  const asked = stubFetch(t, (call) => {
    if (call === 1) throw new Error('connect ECONNREFUSED');
    if (call === 2) return jsonResponse([{ type: 'page', url: 'about:blank' }]);
    return jsonResponse([
      { type: 'page', url: 'about:blank' },
      { type: 'page', url: WANTED },
      { type: 'background_page', url: 'chrome-extension://abc/background.html' },
    ]);
  });

  const result = await waitForPageTarget(PROBE_PORT, WANTED, 5000);

  assert.equal(result.ok, true);
  assert.equal(result.url, WANTED);
  assert.deepEqual(result.seen, ['about:blank', WANTED],
    'only page targets are candidates, so the extension page must not be in the list');
  assert.equal(asked.length, 3);
  assert.deepEqual(new Set(asked), new Set([`http://127.0.0.1:${PROBE_PORT}/json`]));
});

test('a browser that only ever holds about:blank is a failure, not a page', async (t) => {
  // The incident, at the level above waitForDocument. Reporting ok here is what produced a run
  // with every behaviour unobserved.
  stubFetch(t, () => jsonResponse([{ type: 'page', url: 'about:blank' }]));

  const result = await waitForPageTarget(PROBE_PORT, WANTED, 600);

  assert.equal(result.ok, false);
  assert.equal(result.url, null);
  assert.deepEqual(result.seen, ['about:blank'],
    'what was there instead is the only useful thing to print when this fails');
  assert.ok(result.waitedMs >= 600);
});

test('waitForPageTarget refuses a blank target even when that is what was asked for', async (t) => {
  // The same degenerate case, and again the only test that holds this guard in place.
  stubFetch(t, () => jsonResponse([{ type: 'page', url: 'about:blank' }]));

  const result = await waitForPageTarget(PROBE_PORT, 'about:blank', 400);

  assert.equal(result.ok, false);
  assert.equal(result.url, null);
});

test('a fragment on the requested URL still finds the target', async (t) => {
  stubFetch(t, () => jsonResponse([{ type: 'page', url: WANTED }]));

  const result = await waitForPageTarget(PROBE_PORT, `${WANTED}#section`, 2000);

  assert.equal(result.ok, true);
  assert.equal(result.url, WANTED);
});

test('the origin root is NOT accepted as a deep page under test', async (t) => {
  // Recorded as a defect when this file was written, and fixed rather than accommodated. The
  // runner serves the page and its subject frame from one loopback origin, so a run whose fixture
  // tab had not navigated yet could attach to the UI and measure it. waitForPageTarget now uses
  // the same exact matcher targetFor does, so the target this waits for and the target
  // openSession attaches to cannot be two different pages.
  stubFetch(t, () => jsonResponse([{ type: 'page', url: 'http://127.0.0.1:8412/' }]));

  const result = await waitForPageTarget(PROBE_PORT, WANTED, 600);

  assert.equal(result.ok, false, 'the origin root was accepted as a page at a deep path');
  assert.deepEqual(result.seen, ['http://127.0.0.1:8412/'],
    'what it did see is still reported, so the message names the wrong page rather than nothing');
});

test('a target list that never parses ends in a refusal, not a throw', async (t) => {
  stubFetch(t, () => ({ ok: true, json: async () => { throw new Error('not JSON'); } }));

  const result = await waitForPageTarget(PROBE_PORT, WANTED, 500);

  assert.equal(result.ok, false);
  assert.deepEqual(result.seen, [], 'nothing was ever read, so nothing should be claimed as seen');
});
