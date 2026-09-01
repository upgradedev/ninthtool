/**
 * Proving that the page about to have a form submitted on it is the fixture this repository ships.
 *
 * WHY THIS FILE EXISTS, AND IT IS THE MOST IMPORTANT ONE HERE. Two rows submit a form, which is a
 * write. Until now the only thing separating "our subject page" from "a stranger's page" was the
 * public tool name `nt_form_answers`. An audit pointed the runner at an unrelated page that
 * declared that name and watched it get submitted twice. The suite was performing external writes
 * while its own README said it never does.
 *
 * A name a stranger can type is not an identity. What follows is four independent checks, and all
 * four must hold before anything is submitted:
 *
 *   1. ORIGIN. The tool's `origin` equals the origin the runner was asked to audit. Cross origin
 *      contributes no tools at all, so this is cheap, but it rules out a tool that arrived from
 *      somewhere unexpected.
 *   2. DOCUMENT IDENTITY. The registering document is reachable through `tool.window` and its path
 *      ends with the fixture's own path. A tool registered by some other document on the same
 *      origin fails here.
 *   3. BUILD MARKER. That document carries `__ninthtoolFixture` with the exact marker string below.
 *      The marker is a constant in this repository, so a page that has not deliberately copied our
 *      fixture does not have it.
 *   4. NONCE ECHO. The runner writes a fresh random nonce onto the fixture document, and the
 *      fixture's own submit handler echoes it back inside the tool's answer. This is the
 *      unforgeable half: a page that merely declares the name, or that copied our marker without
 *      copying the handler, cannot produce a value it was handed one millisecond earlier through a
 *      channel it does not read.
 *
 * A page failing any of the four is not written to, and the rows that needed it report
 * `not-applicable` with the check that failed. That is the honest answer and it is also the safe
 * one.
 *
 * WHAT THIS IS NOT. It is not a security boundary against a hostile same origin page that has read
 * this file and implemented the echo on purpose. Nothing running inside a page can be. It is a
 * boundary against the realistic case: an ordinary page that happens to use a name we also use.
 */

/** The marker the bundled fixture sets on its own window. Asserted by a test against the fixture. */
export const FIXTURE_MARKER = 'ninthtool.fixture.v1';

/** The path the bundled fixture is served from, relative to the origin root. */
export const FIXTURE_PATH = '/fixtures/subject.html';

/** Where the runner writes the per run nonce, and where the fixture reads it from. */
export const NONCE_KEY = '__ninthtoolNonce';

/** Where the fixture publishes its marker. */
export const MARKER_KEY = '__ninthtoolFixture';

/**
 * Decide whether a tool may have its form submitted, and say exactly why not when it may not.
 *
 * This runs inside the page, so it is handed live objects rather than a serialised snapshot.
 *
 * @param {object} tool a RegisteredTool from getTools()
 * @param {{expectedOrigin: string, nonce: string}} options
 * @returns {{trusted: boolean, reason: string, checks: object}}
 */
export function checkFixtureIdentity(tool, options) {
  const checks = { origin: false, document: false, marker: false, nonceWritten: false };
  const expected = String(options.expectedOrigin || '');
  const nonce = String(options.nonce || '');

  if (!tool) return { trusted: false, reason: 'no such tool on this surface', checks };

  // 1. origin
  const origin = String(tool.origin === undefined ? '' : tool.origin);
  if (!expected || origin !== expected) {
    return {
      trusted: false,
      checks,
      reason: `the tool's origin is ${origin || 'unknown'} and the audit target's origin is `
        + `${expected || 'unknown'}`,
    };
  }
  checks.origin = true;

  // 2. the registering document, reached through the tool itself
  let win = null;
  let path = '';
  try {
    win = tool.window;
    path = String(win.location.pathname);
  } catch (error) {
    return {
      trusted: false,
      checks,
      reason: `the registering document could not be reached: ${String((error && error.message) || error)}`,
    };
  }
  /*
   * THE DOCUMENT ITSELF, NOT A STRING THAT RESEMBLES IT.
   *
   * This was `path.endsWith(FIXTURE_PATH)`, so any origin we were pointed at could serve
   * `/attacker/fixtures/subject.html`, carry the marker, and be handed the nonce.
   *
   * Replacing it with `path === FIXTURE_PATH` was WRONG and was caught by running it: GitHub Pages
   * serves this project under `/ninthtool/`, so the real fixture's path is
   * `/ninthtool/fixtures/subject.html` and the live deployment refused itself. A constant cannot
   * describe where the fixture lives, which is why the suffix test existed in the first place.
   *
   * So the check is now identity rather than spelling. The probe runs INSIDE the document that
   * publishes these form tools, in both transports: the page calls `observeAll` inside the subject
   * iframe, and the command line runner evaluates it in the top document it navigated to. A tool
   * registered by any other document is not the fixture we are running in, whatever its path says.
   * `expectedWindow` is that identity; `expectedPath` is the same fact spelled out for the report
   * and a second gate for hosts where a Window comparison is unavailable.
   */
  if (options.expectedWindow && win !== options.expectedWindow) {
    return {
      trusted: false,
      checks,
      reason: `the tool was registered by a different document than the one being audited, so it `
        + `is not the fixture this run is inside`,
    };
  }
  const expectedPath = String(options.expectedPath || '');
  if (!expectedPath) {
    return { trusted: false, checks, reason: 'no expected fixture path was supplied for this run' };
  }
  // TWO SEPARATE CONDITIONS, REPORTED SEPARATELY. Reporting them as one produced the reason "the
  // tool was registered by /, and this run's fixture is /", which reads as a match and refuses.
  if (path !== expectedPath) {
    return {
      trusted: false,
      checks,
      reason: `the tool was registered by ${path}, and this run asked to audit ${expectedPath}`,
    };
  }
  if (!path.endsWith(FIXTURE_PATH)) {
    return {
      trusted: false,
      checks,
      reason: `${path} is not the bundled fixture, whose path ends with ${FIXTURE_PATH}`,
    };
  }
  checks.document = true;

  // 3. the build marker
  let marker = null;
  try { marker = win[MARKER_KEY] && win[MARKER_KEY].marker; } catch { marker = null; }
  if (marker !== FIXTURE_MARKER) {
    return {
      trusted: false,
      checks,
      reason: `that document does not carry the bundled fixture marker ${FIXTURE_MARKER}`,
    };
  }
  checks.marker = true;

  // 4. hand it the nonce. The echo is checked at the call site, on the tool's own answer, because
  // only the answer proves the fixture's handler ran.
  if (!nonce) return { trusted: false, checks, reason: 'no nonce was generated for this run' };
  try {
    win[NONCE_KEY] = nonce;
  } catch (error) {
    return {
      trusted: false,
      checks,
      reason: `the nonce could not be handed to that document: ${String((error && error.message) || error)}`,
    };
  }
  checks.nonceWritten = true;

  return { trusted: true, reason: 'origin, document path, build marker and nonce channel all hold', checks };
}

/**
 * Whether a tool's answer proves the bundled fixture's own handler produced it.
 *
 * @param {string} answer whatever executeTool resolved with
 * @param {string} nonce the nonce handed to the document
 * @returns {boolean}
 */
export function answerCarriesNonce(answer, nonce) {
  if (!nonce) return false;
  return String(answer === undefined || answer === null ? '' : answer).includes(nonce);
}

/** A fresh nonce. Long enough that a page cannot guess it, short enough to read in a report. */
export function makeNonce(random) {
  const pick = typeof random === 'function' ? random : Math.random;
  return `nt-${pick().toString(36).slice(2, 12)}${pick().toString(36).slice(2, 12)}`;
}
