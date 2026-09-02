/**
 * What the loopback server will and will not hand out.
 *
 * IT USED TO SERVE THE WHOLE CHECKOUT. Anything under the repository root that existed was fair
 * game: `.git/config`, every script, every test, and any untracked file left in the tree. It binds
 * a loopback port so the exposure was to this machine, which is a mitigation and not a defence.
 *
 * The allowlist is `runtime-manifest.json`, which is derived by walking the module graph rather
 * than maintained by hand, so it cannot drift from what the page loads. These tests assert both
 * halves: everything the page needs is served, and the things that used to leak are refused by
 * name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { allowlistFor, resolveRequest, serveRuntime, keepAlive } from '../../src/probe/serve.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const allowed = allowlistFor(ROOT);

test('the allowlist is the manifest, plus the manifest itself', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime-manifest.json'), 'utf8'));
  for (const file of Object.keys(manifest.files)) {
    assert.ok(allowed.has(file), `${file} is in the manifest and would not be served`);
  }
  assert.ok(allowed.has('runtime-manifest.json'),
    'the manifest itself must be served, or readiness row R5 cannot read the deployed identity');
  assert.equal(allowed.size, Object.keys(manifest.files).length + 1,
    'the allowlist holds something the manifest does not, which means a second list exists');
});

test('the page and everything it loads is served', () => {
  for (const wanted of ['/', '/index.html', '/assets/styles.css', '/src/ui/app.js',
    '/fixtures/subject.html', '/runtime-manifest.json']) {
    const decision = resolveRequest(ROOT, allowed, wanted);
    assert.equal(decision.status, 200, `${wanted} is needed by the page and was refused: ${decision.said}`);
  }
});

test('the things that used to leak are refused by name', () => {
  // Each of these existed and was served before the allowlist. None of them is a file a browser
  // driving this page has any reason to fetch.
  const refused = [
    '/.git/config',
    '/.git/HEAD',
    '/package.json',
    '/README.md',
    '/scripts/readiness.mjs',
    '/scripts/readiness_config.mjs',
    '/tests/unit/verdict.test.js',
    '/src/probe/cdp.mjs',
    '/src/probe/launch.mjs',
    '/docs/evidence.md',
    '/LICENSE',
  ];
  for (const wanted of refused) {
    const decision = resolveRequest(ROOT, allowed, wanted);
    assert.equal(decision.status, 404, `${wanted} is still being served`);
    assert.match(decision.said, /only the files runtime-manifest\.json lists/);
  }
});

test('traversal out of the root is refused before anything is read', () => {
  for (const wanted of ['/../../../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/./../../secrets']) {
    const decision = resolveRequest(ROOT, allowed, wanted);
    assert.notEqual(decision.status, 200, `${wanted} was served`);
  }
});

test('containment is segment aware, not a string prefix', () => {
  // The reason path.relative replaced startsWith: a sibling directory named `ninthtool-evil`
  // starts with `ninthtool`, so a prefix test would have called it inside the root.
  const sibling = `${ROOT}-evil`;
  const inside = path.relative(ROOT, path.resolve(sibling, 'index.html'));
  assert.ok(inside.startsWith('..'),
    'path.relative must place a sibling directory outside the root');
  assert.ok(path.resolve(sibling, 'index.html').startsWith(ROOT),
    'and a string prefix test would have called it inside, which is why it was replaced');
});

test('a directory is not a file', () => {
  // Even if a directory name somehow entered the allowlist, it is refused.
  const withDir = new Set([...allowed, 'src']);
  assert.equal(resolveRequest(ROOT, withDir, '/src').status, 404);
});

test('a malformed percent escape is a bad request, not a crash', () => {
  const decision = resolveRequest(ROOT, allowed, '/%E0%A4%A');
  assert.equal(decision.status, 400);
});

test('a query string and a fragment do not defeat the allowlist', () => {
  assert.equal(resolveRequest(ROOT, allowed, '/index.html?v=2').status, 200);
  assert.equal(resolveRequest(ROOT, allowed, '/index.html#top').status, 200);
  assert.equal(resolveRequest(ROOT, allowed, '/.git/config?x=1').status, 404);
});

test('leading slashes are collapsed rather than creating a second name', () => {
  assert.equal(resolveRequest(ROOT, allowed, '//index.html').status, 200);
  assert.equal(resolveRequest(ROOT, allowed, '///.git/config').status, 404);
});

test('a name in the allowlist that resolves outside the root is refused by containment', () => {
  /*
   * The second gate, reached by defeating the first. The allowlist is derived, so today nothing in
   * it points out of the tree, and the containment check is therefore never the thing that says no.
   * That is exactly why it has to be tested directly: a check nothing reaches is a check nobody
   * would notice breaking. `resolveRequest` takes the allowlist as an argument, so handing it a
   * poisoned one is the honest way in.
   */
  const poisoned = new Set([...allowed, '../secrets.txt']);
  const decision = resolveRequest(ROOT, poisoned, '/../secrets.txt');
  assert.equal(decision.status, 403);
  assert.equal(decision.said, 'outside the served root');
  assert.equal(decision.file, null, 'a refused request must not name a path to read');
});

/* ------------------------------------------------------- the server itself, on a real port */

/** Start the server, run one body against it, and close it however that body ends. */
async function served(body) {
  const running = await serveRuntime(ROOT);
  try {
    return await body(running);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }
}

test('the running server hands out the page with the right type, and nothing else', async () => {
  // Everything above decides a request without a socket. This is the same decision reached through
  // an actual request, which is the only version of it a browser ever performs. The two used to be
  // impossible to tell apart, because the second half was never run.
  await served(async ({ origin, allowed: live }) => {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'the server must bind loopback and nothing else');
    assert.deepEqual([...live].sort(), [...allowed].sort(),
      'the running server is serving a different list from the one asserted above');

    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await page.text(), fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
      'the body served is not the file on disk');

    const styles = await fetch(`${origin}/assets/styles.css`);
    assert.equal(styles.status, 200);
    assert.equal(styles.headers.get('content-type'), 'text/css; charset=utf-8');

    const script = await fetch(`${origin}/src/ui/app.js`);
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8',
      'a module served as anything else is a module the browser refuses to execute');

    // THE REFUSALS, OVER THE NETWORK. This is the half that was never exercised: the decision was
    // tested, and whether the server acts on it was not.
    const leak = await fetch(`${origin}/.git/config`);
    assert.equal(leak.status, 404);
    assert.match(await leak.text(), /only the files runtime-manifest\.json lists/);

    const malformed = await fetch(`${origin}/%E0%A4%A`);
    assert.equal(malformed.status, 400);
    assert.equal(await malformed.text(), 'bad request');
  });
});

test('the hold open handle keeps the loop open and lets go when it is released', () => {
  /*
   * WHAT THIS PINS, AND WHY IT IS THE TIMER RATHER THAN THE PROCESS. `--keep-open` promises to
   * leave the browser and the loopback origin running, and the runner used to call process.exit and
   * close the very things it promised to leave up. Not exiting is most of the fix; the rest is that
   * a run given its own URL starts no server, so with nothing listening the event loop drains and
   * the process ends anyway a second later, for an unrelated reason.
   *
   * That means an unref'd timer would satisfy every observable outcome a test could reach for while
   * still failing to hold anything open. So the timer itself is the assertion. It is captured by
   * standing in for setInterval for the length of one synchronous call, with nothing awaited in
   * between, so nothing else in this process can create a timer while the stand in is installed.
   */
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const created = [];
  const cleared = [];
  let handle;
  try {
    globalThis.setInterval = (fn, ms) => {
      const timer = { fn, ms, unrefCalls: 0, unref() { this.unrefCalls += 1; return this; } };
      created.push(timer);
      return timer;
    };
    globalThis.clearInterval = (timer) => { cleared.push(timer); };
    handle = keepAlive();
    handle.release();
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }

  assert.equal(created.length, 1, 'nothing was scheduled, so nothing is holding the loop open');
  assert.equal(created[0].unrefCalls, 0,
    'the timer was unref\'d, which lets the loop drain and closes the surfaces --keep-open promised');
  assert.ok(created[0].ms > 60000,
    `a hold open timer that fires every ${created[0].ms} ms is a busy loop, not a hold`);
  assert.deepEqual(cleared, [created[0]],
    'release did not clear the timer it created, so the process can never end');
});

test('the hold open handle really does hold this process, with the real timer', async () => {
  // The same thing again without the stand in, so the test above cannot pass against a keepAlive
  // that only behaves when it is being watched. A ref'd timer counts as an active handle; an
  // unref'd one does not, and neither does a cleared one.
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const handle = keepAlive();
  const during = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  handle.release();
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

  assert.equal(during, before + 1, 'keepAlive added no timer this process would wait for');
  assert.equal(after, before, 'release left the timer behind and the process can never end');
});
