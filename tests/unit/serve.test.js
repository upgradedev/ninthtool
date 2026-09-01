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

import { allowlistFor, resolveRequest } from '../../src/probe/serve.mjs';

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
