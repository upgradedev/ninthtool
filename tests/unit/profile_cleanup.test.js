/**
 * The throwaway browser profile, and whether a run actually takes it away again.
 *
 * WHAT WAS WRONG, MEASURED BEFORE ANY OF THIS WAS WRITTEN. Two separate leaks, both silent.
 *
 * One: the removal was a single `fs.rmSync(dir, {recursive: true, force: true, maxRetries: 3})`
 * inside a bare `catch {}`. `child.kill()` returns when the signal is sent, not when the browser
 * has finished dying, so on Windows the profile is still held at that moment and that call throws.
 * Reproduced against the real launcher with one open handle inside the profile: the directory was
 * still on disk when the process ended and nothing had been printed.
 *
 * Two: only SIGINT was registered, so a run ended by an ordinary SIGTERM never emitted `exit` and
 * never cleaned up at all.
 *
 * WHAT IS FAKED AND WHY IT IS STILL A REAL TEST. No browser is started and none is needed. The
 * child processes below call the REAL launchWithWebMCP: its "browser" is node.exe, which exits at
 * once on Chrome's flags exactly as a browser that refused to start would, and a plain HTTP server
 * is raced onto the debugging port so the launcher's own poll for /json/version succeeds. The
 * launcher cannot tell the difference, because all it does is spawn a binary and ask a port. So
 * the profile below is made by the shipped code, registered by the shipped code and removed by the
 * shipped code, and the assertions are made from a DIFFERENT process reading the filesystem.
 *
 * WHAT THIS CANNOT PROVE ON WINDOWS, SAID RATHER THAN SKIPPED. Windows has no signal delivery, so
 * a parent cannot send a child a real SIGINT there. The interrupted case therefore raises the
 * signal inside the child on Windows, which exercises the registration and the handler but not the
 * operating system's delivery, and sends a real signal on Linux and macOS, which is what CI runs.
 * Each test prints which of the two it did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { removeProfile, registerTeardown, TERMINATION_SIGNALS } from '../../src/probe/launch.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const LAUNCH_URL = pathToFileURL(path.join(ROOT, 'src/probe/launch.mjs')).href;
const WINDOWS = process.platform === 'win32';

/** A directory of the shape the launcher makes, for the cases that do not go through it. */
function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-cleanup-test-'));
}

/* ------------------------------------------------------------------ removeProfile */

test('a profile that nothing is holding is removed on the first attempt', () => {
  const dir = temporaryDirectory();
  fs.writeFileSync(path.join(dir, 'Local State'), '{}');
  fs.mkdirSync(path.join(dir, 'Default'));

  const outcome = removeProfile(dir);

  assert.equal(outcome.removed, true, outcome.lastError || 'no error was reported');
  assert.equal(outcome.attempts, 1, 'an idle directory should not need a second try');
  assert.equal(fs.existsSync(dir), false);
});

test('removing a profile that is already gone is a success, not an error', () => {
  const dir = temporaryDirectory();
  fs.rmSync(dir, { recursive: true, force: true });

  // close() can run twice, once from the caller and once from the exit hook. The second call must
  // not print a failure about a directory the first call correctly removed.
  const outcome = removeProfile(dir);

  assert.equal(outcome.removed, true);
  assert.equal(outcome.lastError, null);
});

test('a removal that cannot succeed is REPORTED, retried, and never thrown', () => {
  // THE DEFECT THIS REPLACES was one attempt inside `catch {}`, so a profile that stayed on disk
  // left no trace at all. This case is deliberately artificial: a path holding a NUL byte is
  // refused by the runtime itself, identically on every platform and for every user including
  // root, so what it holds is the CONTRACT, that a removal which cannot succeed is retried,
  // reported and never thrown. The real world version of the same failure is the held handle in
  // the test below, and that one only bites on Windows.
  //
  // An over-long path was tried here first and does NOT work: on Windows it comes back as ENOENT,
  // which `force: true` correctly treats as already gone, so the test passed while proving
  // nothing. That is recorded rather than quietly replaced.
  const impossible = path.join(os.tmpdir(), `ninthtool${String.fromCharCode(0)}cannot-exist`);

  const outcome = removeProfile(impossible, { deadlineMs: 400, retryMs: 50 });

  assert.equal(outcome.removed, false, 'an unremovable path was reported as removed');
  assert.ok(outcome.lastError, 'the caller has nothing to print without the reason');
  assert.ok(outcome.attempts > 1,
    `it gave up after ${outcome.attempts} attempt(s), so it did not retry at all`);
  assert.ok(outcome.waitedMs >= 400,
    `it waited ${outcome.waitedMs} ms, which is less than the deadline it was given`);
});

test('a profile held by another process is removed once that process lets go', async (t) => {
  // THE REAL FAILURE, END TO END, WITH A SECOND PROCESS DOING THE HOLDING. The holder exits after
  // 600 ms while removeProfile is inside its blocking retry, so nothing in this process can help
  // it: the handle is released by the operating system, which is the whole reason a blocking
  // retry converges at all.
  const dir = temporaryDirectory();
  const held = path.join(dir, 'Local State');
  fs.writeFileSync(held, '{}');

  const holder = spawn(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs';
     const fd = fs.openSync(${JSON.stringify(held)}, 'r+');
     process.stdout.write('HOLDING\\n');
     setTimeout(() => { fs.closeSync(fd); process.exit(0); }, 600);`,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { try { holder.kill(); } catch { /* already gone */ } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await new Promise((resolve) => holder.stdout.on('data', (chunk) => {
    if (String(chunk).includes('HOLDING')) resolve();
  }));

  const outcome = removeProfile(dir, { deadlineMs: 6000, retryMs: 100 });

  assert.equal(outcome.removed, true, `it gave up with ${outcome.lastError}`);
  assert.equal(fs.existsSync(dir), false);
  if (WINDOWS) {
    // Windows refuses to remove a directory holding an open handle, so getting here at all took
    // more than one attempt. That is the case the retry was written for.
    assert.ok(outcome.attempts > 1,
      'Windows removed a held directory on the first attempt, which it does not do, so this test '
      + 'is no longer exercising the retry');
    console.log(`  [windows] the retry converged after ${outcome.attempts} attempts`);
  } else {
    // POSIX unlinks a file that is still open, so one attempt is the correct outcome here and a
    // retry would prove nothing. Asserting otherwise would be asserting a Windows quirk on Linux.
    console.log(`  [posix] an open handle does not block removal, attempts ${outcome.attempts}`);
  }
});

/* ------------------------------------------------------------------ registerTeardown */

test('the teardown is registered against exit and against every signal that would skip it', () => {
  const before = ['exit', ...Object.keys(TERMINATION_SIGNALS)]
    .map((event) => [event, process.listenerCount(event)]);

  const unregister = registerTeardown(() => {});

  for (const [event, count] of before) {
    assert.equal(process.listenerCount(event), count + 1,
      `${event} has no teardown listener, so a run ended that way leaves its profile behind`);
  }

  unregister();

  for (const [event, count] of before) {
    assert.equal(process.listenerCount(event), count,
      `${event} still carries a listener after unregister, so two runs in one process pile up`);
  }
});

test('SIGTERM is covered, because an ordinary kill is not SIGINT', () => {
  // Named on its own because this is the leak. Only SIGINT was handled, and SIGTERM is what a
  // timeout, a job runner and a plain `kill <pid>` send.
  assert.equal(TERMINATION_SIGNALS.SIGINT, 130);
  assert.equal(TERMINATION_SIGNALS.SIGTERM, 143);
  assert.equal(TERMINATION_SIGNALS.SIGHUP, 129);
  assert.equal('SIGBREAK' in TERMINATION_SIGNALS, WINDOWS,
    WINDOWS
      ? 'Ctrl+Break is the second interruption a Windows console produces and it is not covered'
      : 'SIGBREAK does not exist off Windows and registering it throws ERR_UNKNOWN_SIGNAL');
});

/* ------------------------------------------------------------------ whole runs, in a real process */

/**
 * A run of the shipped launcher, in its own process, against a browser that is not one.
 *
 * @param {string} mode `normal`, `hold` or `self-interrupt`
 */
function launcherRun(mode) {
  return spawn(process.execPath, ['--input-type=module', '-e', `
import http from 'node:http';
import net from 'node:net';
import { launchWithWebMCP } from ${JSON.stringify(LAUNCH_URL)};

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const port = await freePort();
// After the launcher's 900 ms check for somebody else on this port, and before its real wait.
setTimeout(() => {
  const fake = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.startsWith('/json/version') ? JSON.stringify({ Browser: 'FakeBrowser/1.0' }) : '[]');
  });
  fake.listen(port, '127.0.0.1', () => fake.unref());
}, 1200);

const launched = await launchWithWebMCP({
  url: 'http://127.0.0.1:1/nothing', port, chrome: process.execPath, timeoutMs: 20000,
});
process.stdout.write('PROFILE ' + launched.profile + '\\n');

// The shipped runner's own last line. Nothing calls close(): the exit hook is the thing on trial.
if (${JSON.stringify(mode)} === 'normal') process.exit(0);

// Anything else stays up to be interrupted, with a watchdog so a missing handler fails loudly
// rather than hanging the suite.
setInterval(() => {}, 1 << 30);
setTimeout(() => { process.stdout.write('WATCHDOG\\n'); process.exit(70); }, 8000);
if (${JSON.stringify(mode)} === 'self-interrupt') setTimeout(() => process.emit('SIGINT'), 300);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Resolve with the profile path the child printed, once it has printed it. */
function profileOf(child) {
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(/^PROFILE (.+)$/m);
      if (found) resolve(found[1].trim());
    });
    child.on('exit', () => reject(new Error(`the run ended before it made a profile. Saw: ${out}`)));
  });
}

test('a run that ends normally takes its profile with it', async (t) => {
  const child = launcherRun('normal');
  t.after(() => { try { child.kill(); } catch { /* already gone */ } });

  const profile = await profileOf(child);
  assert.ok(path.basename(profile).startsWith('ninthtool-'), `unexpected profile path ${profile}`);
  const code = await new Promise((resolve) => child.on('exit', resolve));

  assert.equal(code, 0);
  assert.equal(fs.existsSync(profile), false,
    `${profile} is still on disk after an ordinary run, which is the 79-directories-in-TEMP defect`);
});

test('a run that is interrupted takes its profile with it', async (t) => {
  const child = launcherRun(WINDOWS ? 'self-interrupt' : 'hold');
  t.after(() => { try { child.kill(); } catch { /* already gone */ } });

  const profile = await profileOf(child);
  assert.equal(fs.existsSync(profile), true, 'the profile was never made, so nothing is under test');

  if (WINDOWS) {
    console.log('  [windows] the child raised SIGINT on itself, because Windows cannot deliver one');
  } else {
    console.log('  [posix] a real SIGINT was sent to the child process');
    child.kill('SIGINT');
  }
  const code = await new Promise((resolve) => child.on('exit', resolve));

  assert.equal(code, 130, code === 70
    ? 'the watchdog fired, so no handler ran and the run would have leaked its profile'
    : 'an interrupted run should exit 130');
  assert.equal(fs.existsSync(profile), false, `${profile} survived an interrupted run`);
});
