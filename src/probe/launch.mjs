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
   * now, and the same cleanup is registered against process exit and against SIGINT, because the
   * run that most needs cleaning up is the one somebody interrupted.
   */
  let cleaned = false;
  const onSignal = () => { close(); process.exit(130); };
  const close = () => {
    if (cleaned) return;
    cleaned = true;
    try { child.kill(); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); }
    catch { /* the browser may still hold a handle, and TEMP is swept eventually */ }
    process.off('exit', close);
    process.off('SIGINT', onSignal);
  };
  process.on('exit', close);
  process.on('SIGINT', onSignal);

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
  const wanted = String(url).replace(/#.*$/, '');
  const started = Date.now();
  let seen = [];
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      seen = targets.filter((t) => t.type === 'page').map((t) => String(t.url));
      const hit = seen.find((u) => u === wanted || u.startsWith(wanted) || wanted.startsWith(u.replace(/\/$/, '')));
      if (hit && hit !== 'about:blank') {
        return { ok: true, url: hit, seen, waitedMs: Date.now() - started };
      }
    } catch {
      // The browser is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, url: null, seen, waitedMs: Date.now() - started };
}

/** A target matcher for openSession, for the page this launcher was asked to open. */
export function targetFor(url) {
  const wanted = String(url).replace(/#.*$/, '');
  return (target) => {
    const seen = String(target.url || '');
    return seen !== 'about:blank' && (seen === wanted || seen.startsWith(wanted) || wanted.startsWith(seen.replace(/\/$/, '')));
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
  const wanted = String(url).replace(/#.*$/, '');
  const started = Date.now();
  let last = { url: '', readyState: '' };
  while (Date.now() - started < timeoutMs) {
    try {
      const seen = JSON.parse(await session.evaluate(
        'JSON.stringify({ url: document.URL, readyState: document.readyState })', 5000,
      ));
      last = seen;
      const matches = seen.url === wanted || seen.url.startsWith(wanted) || wanted.startsWith(seen.url.replace(/\/$/, ''));
      if (matches && seen.url !== 'about:blank' && seen.readyState === 'complete') {
        return { ok: true, url: seen.url, readyState: seen.readyState, waitedMs: Date.now() - started };
      }
    } catch {
      // The context is being replaced by the navigation. Ask again.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { ok: false, url: last.url, readyState: last.readyState, waitedMs: Date.now() - started };
}
