/**
 * The three things `launchWithWebMCP` refuses to do, each driven for real and none of them a browser.
 *
 * WHY THIS IS NOT IN launch.test.js. That file states, in its own opening docblock, that no browser
 * is started and `launchWithWebMCP` is never called, and that is the right rule for the matchers and
 * pollers it covers. The refusals below are the other shape: each one is a decision the launcher
 * makes BEFORE or AFTER a browser exists, and each is reachable without one.
 *
 *   no browser on this machine   findChrome returns null, and nothing is created at all
 *   the port is already taken    something answers the version endpoint, and nothing is created
 *   the browser never came up    a process is started, it is not a browser, and it is cleaned up
 *
 * WHY THEY MATTER MORE THAN THEY LOOK. The middle one is the difference between a run that measures
 * the page it was asked about and a run that silently adopts somebody else's debugging session and
 * reports on whatever page happened to be open in it. The third is the path that removes the
 * throwaway profile when the launch fails, and profile directories leaking is a measured defect in
 * this module's history: 79 of them in TEMP after one afternoon.
 *
 * THE THIRD ONE STARTS A PROCESS, AND IT IS THIS NODE. `chrome` is an explicit path here, so the
 * launcher spawns the node binary with Chrome's flags. Node rejects them and exits at once, which is
 * exactly the condition the code is for: something was started, it never opened a debugging port,
 * and the launcher has to give up and tidy up rather than wait for ever. tests/unit/profile_cleanup
 * .test.js uses the same substitution from a child process, for the paths that need a real exit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { launchWithWebMCP } from '../../src/probe/launch.mjs';

const URL_UNDER_TEST = 'http://127.0.0.1:1/nothing.html';

/** A loopback port that was bound and released, so nothing is listening on it right now. */
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

/**
 * Run one body with the temporary directory pointed at a private one, and report what is left in it.
 *
 * WHY THE TEMPORARY DIRECTORY IS MOVED RATHER THAN COUNTED. The launcher makes its throwaway profile
 * with `fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-'))`, and the first version of this file
 * counted the `ninthtool-` directories in the shared temporary directory before and after. That
 * passed alone and failed in the suite, because tests/unit/profile_cleanup.test.js is making and
 * removing profiles of its own in the same place at the same time, in another process. A test whose
 * result depends on what a sibling process is doing this second is worse than no test.
 *
 * `os.tmpdir()` reads the environment on every call, so pointing it at a directory this test owns
 * makes the count exact: whatever is in there afterwards was put there by the launch under test, and
 * the assertion becomes "none", not "no more than before".
 *
 * @param {function(): Promise<void>} body
 * @returns {Promise<string[]>} what the launch left behind in its own temporary directory
 */
async function withPrivateTemp(body) {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-launchtest-'));
  const restore = ['TMPDIR', 'TMP', 'TEMP'].map((name) => [name, process.env[name]]);
  try {
    for (const [name] of restore) process.env[name] = own;
    assert.equal(os.tmpdir(), own, 'the temporary directory was not redirected, so the count is shared');
    await body();
    return fs.readdirSync(own);
  } finally {
    for (const [name, value] of restore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(own, { recursive: true, force: true });
  }
}

test('no browser on this machine is a sentence, not a stack trace', async () => {
  const missing = path.join(os.tmpdir(), 'ninthtool-no-such-browser.exe');
  assert.equal(fs.existsSync(missing), false, 'the fixture path exists, so this proves nothing');

  await assert.rejects(
    () => launchWithWebMCP({ url: URL_UNDER_TEST, chrome: missing }),
    (error) => {
      assert.match(error.message, /^no Chrome or Edge on this machine\./);
      // The two halves a reader needs: why no other browser will do, and what to do about it.
      assert.match(error.message, /Firefox and Safari have no implementation/);
      assert.match(error.message, /--chrome PATH/);
      return true;
    },
  );
});

test('a debugging port somebody else is already on is refused, not adopted', async (t) => {
  /*
   * THE REFUSAL THAT KEEPS A RUN HONEST. `waitForDebugger` asks the port whether a browser is
   * answering, and ANY browser answers. A stale run, or somebody's own debugging session, would be
   * adopted and driven, and the probe would report confidently on a page nobody asked about. This
   * fake answers the version endpoint exactly as a browser would, and nothing else, because that is
   * all the launcher looks at.
   */
  const port = await freeLoopbackPort();
  const occupant = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'Chrome/99.0.0.0', 'Protocol-Version': '1.3' }));
  });
  await new Promise((resolve) => occupant.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupant.close(resolve)));

  const left = await withPrivateTemp(async () => {
    await assert.rejects(
      () => launchWithWebMCP({ url: URL_UNDER_TEST, port, chrome: process.execPath }),
      (error) => {
        assert.match(error.message, new RegExp(`^something is already listening on the debugging port ${port}: `));
        assert.match(error.message, /Chrome\/99\.0\.0\.0/,
          'the refusal has to name what is there, or there is nothing to act on');
        assert.match(error.message, /pass --port with a free one/);
        return true;
      },
    );
  });

  // The refusal happens before anything is created. A launcher that made the profile first and
  // then refused would leak one on every occupied port.
  assert.deepEqual(left, [], 'a refused launch left a throwaway profile behind');
});

test('a browser that never opens a debugging port is given up on, and its profile is removed', async () => {
  const port = await freeLoopbackPort();
  const exitListeners = process.listenerCount('exit');

  const left = await withPrivateTemp(async () => {
    await assert.rejects(
      // process.execPath is node, and node refuses Chrome's flags and exits at once. That is the
      // condition: something started, nothing ever answered on the port.
      () => launchWithWebMCP({
        url: URL_UNDER_TEST, port, chrome: process.execPath, timeoutMs: 700,
      }),
      (error) => {
        assert.match(error.message, /did not open a debugging port on \d+ within \d+ ms\./);
        assert.match(error.message, /another process may hold the port/);
        assert.ok(error.message.startsWith(process.execPath),
          `the refusal must name what was started: ${error.message}`);
        return true;
      },
    );
  });

  // THE PART THAT LEAKED. Each failed launch used to leave its profile directory in TEMP, and 79
  // of them were counted there after one afternoon before close() was called on this path.
  assert.deepEqual(left, [],
    'the failed launch left its throwaway profile in the temporary directory');

  // And the cleanup unregistered itself. A launcher that added an exit hook per failed attempt
  // would eventually trip the max listeners warning and keep every dead profile path alive.
  assert.equal(process.listenerCount('exit'), exitListeners,
    'the teardown hook outlived the launch it was cleaning up after');
});
