/**
 * Find a Chromium browser, start it with WebMCP on, and wait until it is actually answering.
 *
 * WHY THIS IS ITS OWN MODULE. Two callers need it, the command line runner and the readiness gate,
 * and they had a copy each. The copies then disagreed: one waited 4000 ms for the debugging port
 * and the other 2500 ms, and the shorter one failed on a CI runner with
 * `connect ECONNREFUSED 127.0.0.1:9412`. A fixed sleep is a guess about somebody else's machine.
 *
 * SO IT POLLS RATHER THAN SLEEPS. `waitForDebugger` asks the browser's own version endpoint until
 * it answers or the deadline passes, which is fast on a quick machine and patient on a slow one,
 * and when it gives up it says how long it waited instead of failing with a bare refusal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Where a Chromium browser usually lives, per platform, most preferred first. */
const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ],
};

/**
 * The first Chromium browser on this machine, or null.
 * @param {string} [explicit] a path to use instead of searching
 * @returns {string|null}
 */
export function findChrome(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  for (const candidate of CANDIDATES[process.platform] || CANDIDATES.linux) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ask the browser's version endpoint until it answers.
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, waitedMs: number, browser: (string|null)}>}
 */
export async function waitForDebugger(port, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const info = await response.json();
        return { ok: true, waitedMs: Date.now() - started, browser: String(info.Browser || '') };
      }
    } catch {
      // Not up yet. That is the normal case for the first second or two.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { ok: false, waitedMs: Date.now() - started, browser: null };
}

/** Sleep without yielding the event loop, so a cleanup running from an exit hook can wait. */
function sleepBlocking(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Remove a throwaway profile directory, retrying while it is busy, and REPORT a failure.
 *
 * WHY IT RETRIES. `child.kill()` returns as soon as the signal is sent, not when the browser has
 * finished dying, and until then the browser still holds handles inside its own profile. Measured
 * on Windows against a directory holding one open handle, `fs.rmSync(dir, {recursive: true,
 * force: true, maxRetries: 3})` throws ENOTEMPTY. The old code ran exactly that call inside a bare
 * `catch {}`, so the directory stayed on disk and nothing said so.
 *
 * WHY IT BLOCKS RATHER THAN AWAITS. The one path that most needs this is the process exit hook,
 * and an exit hook cannot await. So the wait between attempts is a blocking one. The operating
 * system releases the handles whether or not this process is running its event loop, which is why
 * blocking here still converges.
 *
 * IT NEVER THROWS. A cleanup that throws from an exit hook replaces the exit code the run earned.
 * The outcome is returned instead, and the caller is expected to say something when it is false.
 *
 * @param {string} profile
 * @param {{deadlineMs?: number, retryMs?: number}} [options]
 * @returns {{removed: boolean, attempts: number, waitedMs: number, lastError: (string|null)}}
 */
export function removeProfile(profile, { deadlineMs = 2000, retryMs = 100 } = {}) {
  const started = Date.now();
  let attempts = 0;
  let lastError = null;
  for (;;) {
    attempts += 1;
    try {
      // force:true makes an already removed directory a success, so this is safe to call twice.
      fs.rmSync(profile, { recursive: true, force: true });
      return { removed: true, attempts, waitedMs: Date.now() - started, lastError: null };
    } catch (error) {
      lastError = (error && error.code) || String((error && error.message) || error);
    }
    if (Date.now() - started >= deadlineMs) {
      return { removed: false, attempts, waitedMs: Date.now() - started, lastError };
    }
    sleepBlocking(retryMs);
  }
}

/**
 * The ways a run ends that would otherwise skip the exit hook, and the code each one exits with.
 *
 * SIGINT WAS THE ONLY ONE HANDLED, AND THAT LEAKED. A process ended with an ordinary SIGTERM,
 * which is what a timeout, a job runner or `kill <pid>` sends, never emits `exit`, so the profile
 * stayed on disk. The numbers are the usual 128 plus the signal number, so a caller can still tell
 * what stopped the run.
 *
 * SIGBREAK IS WINDOWS ONLY AND SO IS ITS ABSENCE ELSEWHERE. It is what Ctrl+Break sends, and it is
 * the second of the two interruptions a Windows console can produce. Registering it on a platform
 * that has no such signal throws ERR_UNKNOWN_SIGNAL, so the table is built for the platform it is
 * running on rather than filtered afterwards.
 *
 * WHAT THIS STILL CANNOT COVER, STATED RATHER THAN IMPLIED. Windows has no signal delivery: a
 * programmatic kill there is TerminateProcess, which runs nothing in the target. Measured, on the
 * fixed code: a child ended with `child.kill('SIGTERM')` on Windows still leaves its profile.
 * That is an operating system property and no in process cleanup can change it. The handlers below
 * cover Ctrl+C and Ctrl+Break on Windows, and every one of these signals on Linux and macOS.
 */
export const TERMINATION_SIGNALS = process.platform === 'win32'
  ? { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 }
  : { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * Run `close` when this process ends, however it ends.
 *
 * @param {function(): void} close
 * @returns {function(): void} unregister, which removes every listener this added and no others
 */
export function registerTeardown(close) {
  const handlers = new Map();
  for (const [signal, code] of Object.entries(TERMINATION_SIGNALS)) {
    const handler = () => { close(); process.exit(code); };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.on('exit', close);
  return () => {
    process.off('exit', close);
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

/**
 * Launch a browser with WebMCP enabled, in a throwaway profile, and wait for it to answer.
 *
 * `--no-sandbox` is passed only when running as root, which is how some containers run and how
 * Chrome refuses to start there. It is not passed on an ordinary machine, because weakening a
 * browser sandbox by default to make a script convenient is not a trade this repository makes.
 *
 * @param {{url: string, port?: number, chrome?: string, timeoutMs?: number}} options
 * @returns {Promise<{child: object, browser: string, profile: string, waitedMs: number,
 *                    close: function(): void}>}
 */
export async function launchWithWebMCP({ url, port = 9411, chrome, timeoutMs = 30000 }) {
  const binary = findChrome(chrome);
  if (!binary) {
    throw new Error('no Chrome or Edge on this machine. WebMCP needs a Chromium browser; '
      + 'Firefox and Safari have no implementation. Pass one with --chrome PATH.');
  }

  /*
   * REFUSE A PORT SOMEBODY ELSE IS ON.
   *
   * waitForDebugger asks the port whether a browser is answering, and any browser answers. A stale
   * Chrome from an earlier run, or somebody's own debugging session, would be adopted silently and
   * driven: the probe would measure a page nobody asked about and report it confidently. Checking
   * first costs one short request and turns that into a refusal naming what is already there.
   */
  const occupant = await waitForDebugger(port, 900);
  if (occupant.ok) {
    throw new Error(`something is already listening on the debugging port ${port}: `
      + `${occupant.browser || 'an unknown browser'}. This will not attach to a browser it did not `
      + 'start, because driving another session would measure a page nobody asked about. Close it, '
      + 'or pass --port with a free one.');
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-'));
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-features=WebMCP',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) flags.push('--no-sandbox');
  flags.push(url);

  const child = spawn(binary, flags, { stdio: 'ignore' });

  /*
   * THE PROFILE IS REMOVED ON EVERY PATH, including the ones nobody plans for.
   *
   * Each run made a throwaway profile directory and never deleted it. Measured on this machine
   * after one afternoon: 79 of them in TEMP, each holding a browser profile. close() removes it
   * now, and the same cleanup is registered against process exit and against every signal that
   * would otherwise end the run without it, because the run that most needs cleaning up is the one
   * somebody interrupted.
   *
   * TWO WAYS IT STILL LEAKED, BOTH MEASURED AND BOTH FIXED HERE. Only SIGINT was handled, so an
   * ordinary kill skipped the cleanup entirely. And the removal itself was one attempt inside a
   * bare `catch {}`, so a profile the dying browser still held stayed on disk in silence.
   * registerTeardown covers the first and removeProfile covers the second, and a removal that
   * still fails is now printed with the path rather than swallowed.
   */
  let cleaned = false;
  let unregister = () => {};
  const close = () => {
    if (cleaned) return;
    cleaned = true;
    try { child.kill(); } catch { /* already gone */ }
    const removal = removeProfile(profile);
    if (!removal.removed) {
      /*
       * fs.writeSync AND NOT console.error, FOR THE SAME REASON THE REPORT EXISTS AT ALL.
       *
       * This runs from a process exit hook, and process.exit() drops writes that have not gone
       * yet. Whether a console.error has gone yet is not a property of this code: it depends on
       * the platform and on whether stderr is a file, a terminal or a pipe. So the message that
       * replaces a silent leak could itself be silently lost, which is the same defect one layer
       * up. writeSync does not depend on any of that.
       *
       * AND THE TEST DOES NOT HOLD THIS PARTICULAR LINE, WHICH IS WORTH SAYING. Reverting it to
       * console.error was mutated in and the test survived, because on this platform a pipe write
       * happens to complete anyway. The change is kept because the guarantee should not come from
       * which stream a reader happened to attach.
       */
      fs.writeSync(2, `ninthtool: the throwaway profile ${profile} is still on disk after `
        + `${removal.attempts} attempts over ${removal.waitedMs} ms (${removal.lastError}). `
        + `Nothing else is in it, so it is safe to delete by hand.\n`);
    }
    unregister();
  };
  unregister = registerTeardown(close);

  const up = await waitForDebugger(port, timeoutMs);
  if (!up.ok) {
    close();
    throw new Error(`${binary} did not open a debugging port on ${port} within ${up.waitedMs} ms. `
      + 'The browser may have refused to start, or another process may hold the port.');
  }
  return { child, browser: up.browser, profile, waitedMs: up.waitedMs, close };
}

/**
 * Wait until the browser has a page target for the URL we asked it to open.
 *
 * WHY THIS EXISTS. Chrome opens `about:blank` first and navigates afterwards. Attaching to the
 * first page target therefore raced the navigation, and a run against a real site attached to a
 * blank document, found no WebMCP on it and reported all fourteen behaviours unobserved. It did not
 * report a false pass, which is the instrument behaving correctly, but nought measurements is an
 * instrument failure and never a result. So the target is now waited for by name.
 *
 * @param {(string|number)} port
 * @param {string} url the URL that was opened
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, url: (string|null), seen: string[], waitedMs: number}>}
 */
export async function waitForPageTarget(port, url, timeoutMs = 30000) {
  const started = Date.now();
  let seen = [];
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      seen = targets.filter((t) => t.type === 'page').map((t) => String(t.url));
      // The same rule targetFor uses, so the target this waits for and the target openSession
      // attaches to cannot be two different pages.
      const match = targetFor(url);
      const hit = seen.find((u) => match({ url: u }));
      if (hit) {
        return { ok: true, url: hit, seen, waitedMs: Date.now() - started };
      }
    } catch {
      // The browser is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, url: null, seen, waitedMs: Date.now() - started };
}

/**
 * Normalise a URL for comparison: drop the fragment and any trailing slashes, and nothing else.
 *
 * Query strings are KEPT, because a different query is a different page as far as anything this
 * drives is concerned.
 */
function normaliseUrl(value) {
  return String(value === undefined || value === null ? '' : value).split('#')[0].replace(/\/+$/, '');
}

/**
 * A target matcher for openSession, for the page this launcher was asked to open.
 *
 * IT USED TO PREFIX MATCH IN BOTH DIRECTIONS, AND THAT WAS TWO DEFECTS.
 *
 * A test written against it found them and recorded them rather than accommodating them. First, a
 * target at the origin root matched a matcher built for a deep path, because the clause that
 * stripped a trailing slash then tested the other way round: `http://host/` satisfied a matcher for
 * `http://host/fixtures/subject.html`. The runner serves the page and its subject frame from one
 * loopback origin, so both targets exist at once and whichever the browser listed first would have
 * been driven. That is the about:blank class of bug again: the guard excluded one literal string
 * rather than requiring the right page.
 *
 * Second, a target carrying no url matched anything at all, because every string starts with the
 * empty string.
 *
 * It is exact equality on the normalised URL now. A page that is not the page asked for is not a
 * near miss to be accepted, it is the wrong page.
 */
export function targetFor(url) {
  const wanted = normaliseUrl(url);
  return (target) => {
    const seen = normaliseUrl(target && target.url);
    if (!seen || seen === 'about:blank') return false;
    return seen === wanted;
  };
}

/**
 * Wait until the attached page's own document is the one we asked for and has finished loading.
 *
 * WHY THE TARGET LIST IS NOT ENOUGH. Chrome's /json endpoint reports the new URL on a page target
 * before that page's JavaScript context has committed to it. Attaching on the strength of the
 * target list and evaluating immediately therefore ran against the initial blank document: bare
 * `location.href` came back as `about:blank` while `document.title` was already the real page, and
 * the probe found no WebMCP and reported all fourteen behaviours unobserved. It refused to report a
 * result rather than reporting a wrong one, which is the instrument behaving correctly, but nought
 * measurements is an instrument failure and never a finding.
 *
 * So readiness is asked of the document itself, from inside the page, which is the only place that
 * knows.
 *
 * @param {object} session an attached CDP session
 * @param {string} url the URL that should be loaded
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, url: string, readyState: string, waitedMs: number}>}
 */
export async function waitForDocument(session, url, timeoutMs = 30000) {
  const started = Date.now();
  let last = { url: '', readyState: '' };
  while (Date.now() - started < timeoutMs) {
    try {
      const seen = JSON.parse(await session.evaluate(
        'JSON.stringify({ url: document.URL, readyState: document.readyState })', 5000,
      ));
      last = seen;
      // THE SAME MATCHER THE OTHER TWO USE. This kept its own loose prefix test after targetFor
      // and waitForPageTarget were made exact, so for one commit the function that decides "are we
      // on the right page" and the function that decides "attach to this target" disagreed about
      // what the right page is. A test recorded that rather than accommodating it. One copy of the
      // rule now serves all three, which is what this module's opening docblock is about.
      const matches = targetFor(url)({ url: seen.url });
      if (matches && seen.readyState === 'complete') {
        return { ok: true, url: seen.url, readyState: seen.readyState, waitedMs: Date.now() - started };
      }
    } catch {
      // The context is being replaced by the navigation. Ask again.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { ok: false, url: last.url, readyState: last.readyState, waitedMs: Date.now() - started };
}
