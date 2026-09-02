/**
 * --keep-open, driven through the real command line runner, without a browser.
 *
 * WHAT WAS WRONG. The flag promised to leave the browser running and it closed everything. Three
 * lines did it: the loopback server was closed unconditionally, the launcher's cleanup was
 * registered against process `exit`, and the runner's last statement was an unconditional
 * `process.exit(exitCode)`. `process.exit()` emits `exit`, so the cleanup ran, so the browser was
 * killed and its throwaway profile deleted immediately after the run said they had been left
 * alone. Reproduced before this test existed by calling the real launcher, not calling close(),
 * and calling process.exit(0): the profile directory was gone afterwards.
 *
 * WHY THIS TEST IS THE REAL RUNNER AND NOT A FUNCTION LIFTED OUT OF IT. A decision extracted into
 * a testable helper proves nothing about whether the runner calls it. So this spawns
 * bin/ninthtool.mjs itself, with the arguments a reader would type, and asserts the thing a reader
 * cares about: while it is still running, the origin it printed answers on a real socket.
 *
 * WHAT STANDS IN FOR CHROME. Nothing is installed and no browser is started. `--chrome` is pointed
 * at node.exe, which exits at once on Chrome's flags exactly as a browser that refused to start
 * would, and a small HTTP server answers the two debugging endpoints the runner asks for:
 *
 *   /json/version  refused for the first 1500 ms, so the runner's own check for somebody else
 *                  already on the port sees an empty port, and its real wait then succeeds
 *   /json          one page target at the URL the runner said it was serving, carrying no
 *                  webSocketDebuggerUrl, so openSession refuses it at once and the run reaches
 *                  its teardown in about two seconds instead of thirty
 *
 * The run therefore FAILS, and that is deliberate: --keep-open is most useful on a run that went
 * wrong, and a failed run is the one whose surfaces a reader most wants to still be there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const RUNNER = path.join(ROOT, 'bin/ninthtool.mjs');
const WINDOWS = process.platform === 'win32';

/** A loopback port that was bound and released, so nothing is on it. */
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * The two debugging endpoints, answered the way a browser coming up answers them.
 *
 * @returns {Promise<{port: number, close: function(): void, sees: function(string): void}>}
 */
async function fakeDebugger() {
  const port = await freePort();
  let firstAsk = 0;
  let subject = null;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/json/version')) {
      if (!firstAsk) firstAsk = Date.now();
      // Not up yet. The runner refuses a port somebody else is already on, and it decides that in
      // its first 900 ms, so answering before then would make it refuse to start at all.
      if (Date.now() - firstAsk < 1500) { res.writeHead(503); res.end('not yet'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'FakeBrowser/1.0' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(subject ? [{ type: 'page', url: subject }] : []));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { port, close: () => server.close(), sees: (url) => { subject = url; } };
}

/** Wait for a line matching `pattern` on either stream, or fail saying what was seen instead. */
function waitForLine(child, pattern, timeoutMs, seen) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `nothing matched ${pattern} in ${timeoutMs} ms. The runner said:\n${seen.text}`,
    )), timeoutMs);
    const look = () => {
      const found = seen.text.match(pattern);
      if (found) { clearTimeout(timer); resolve(found); }
    };
    seen.onChange = look;
    look();
  });
}

/** Collect both streams into one growing string, so an assertion can quote the whole run. */
function collect(child) {
  const seen = { text: '', onChange: () => {} };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { seen.text += chunk; seen.onChange(); });
  }
  return seen;
}

test('--keep-open leaves the loopback server answering while the runner is still up', async (t) => {
  const browser = await fakeDebugger();
  t.after(() => browser.close());

  const child = spawn(process.execPath, [RUNNER,
    '--keep-open', '--port', String(browser.port), '--chrome', process.execPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const seen = collect(child);
  t.after(() => { try { child.kill(); } catch { /* already gone */ } });

  // The runner names the page it is serving before it opens a browser, which is the only way
  // anything outside it can know the port the operating system handed it.
  const serving = await waitForLine(child, /serving this repository's own page at (\S+)/, 20000, seen);
  browser.sees(serving[1]);

  const origin = (await waitForLine(child,
    /--keep-open, the page is still served from (\S+)/, 30000, seen))[1];
  const profile = (await waitForLine(child,
    /--keep-open, its throwaway profile is (.+)/, 5000, seen))[1].trim();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));

  // Long enough that an unconditional process.exit() in the runner would already have happened.
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(child.exitCode, null,
    `the runner exited ${child.exitCode} after promising to stay open. It said:\n${seen.text}`);

  const response = await fetch(`${origin}/index.html`);
  assert.equal(response.status, 200,
    'the page the kept open browser is reading stopped being served');
  assert.match(await response.text(), /<html/i, 'the origin answered with something that is not the page');

  // And it is the browser's profile, still there, not a directory the runner deleted underneath it.
  assert.equal(fs.existsSync(profile), true,
    `${profile} was deleted while the browser was supposed to still be using it`);

  /* --------------------------------------------- and now stop it, which is the other half */

  const ended = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  if (WINDOWS) {
    // Windows has no signal delivery, so a parent cannot send Ctrl+C. What this half still holds
    // everywhere is that the origin goes away with the process rather than outliving it.
    console.log('  [windows] the runner was ended with TerminateProcess, which runs no cleanup');
    child.kill();
    await ended;
  } else {
    console.log('  [posix] a real SIGINT was sent, the way a reader presses Ctrl+C');
    child.kill('SIGINT');
    assert.equal(await ended, 130, 'an interrupted run should exit 130');
    assert.equal(fs.existsSync(profile), false,
      `${profile} survived the interruption, so --keep-open leaks a profile per run`);
  }

  await assert.rejects(() => fetch(`${origin}/index.html`),
    'the loopback origin still answers after the runner ended, so a socket was left behind');
});

test('--keep-open against somebody else url stays up with no server of its own to hold it', async (t) => {
  /*
   * THE OTHER HALF, AND THE ONLY THING keepAlive() EXISTS FOR. Given a URL, the runner starts no
   * loopback server, so once the report is printed nothing is left holding the event loop. Not
   * calling process.exit() is therefore not enough on its own: the process would drain and end a
   * moment later, the exit hook would run, and the browser would be killed for a second reason.
   * The test above cannot see this, because there the runner's own server holds the loop.
   */
  const page = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>somebody else page</body></html>');
  });
  const pagePort = await freePort();
  await new Promise((resolve) => page.listen(pagePort, '127.0.0.1', resolve));
  t.after(() => page.close());
  const subject = `http://127.0.0.1:${pagePort}/theirs.html`;

  const browser = await fakeDebugger();
  browser.sees(subject);
  t.after(() => browser.close());

  const child = spawn(process.execPath, [RUNNER, subject,
    '--keep-open', '--port', String(browser.port), '--chrome', process.execPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const seen = collect(child);
  t.after(() => { try { child.kill(); } catch { /* already gone */ } });

  const profile = (await waitForLine(child,
    /--keep-open, its throwaway profile is (.+)/, 30000, seen))[1].trim();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));

  assert.doesNotMatch(seen.text, /still served from/,
    'the runner served a page of its own for a run that was given a URL');

  // An event loop with nothing ref'd in it drains on the next turn, so a second is generous.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  assert.equal(child.exitCode, null,
    `the runner ended by itself after ${child.exitCode}, so the browser it promised to keep `
    + `was killed by the exit hook. It said:\n${seen.text}`);
  assert.equal(fs.existsSync(profile), true, `${profile} was removed while the run was still up`);
});
