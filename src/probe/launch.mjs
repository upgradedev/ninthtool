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
  const close = () => { try { child.kill(); } catch { /* already gone */ } };

  const up = await waitForDebugger(port, timeoutMs);
  if (!up.ok) {
    close();
    throw new Error(`${binary} did not open a debugging port on ${port} within ${up.waitedMs} ms. `
      + 'The browser may have refused to start, or another process may hold the port.');
  }
  return { child, browser: up.browser, profile, waitedMs: up.waitedMs, close };
}
