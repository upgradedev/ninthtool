/**
 * The deployment manifest, and the blind spot in how it is built.
 *
 * Readiness row R5 compares the live origin against `runtime-manifest.json`. That only means
 * anything if the manifest describes this tree, so a forgotten regeneration has to fail here, in
 * CI, rather than at a deploy nobody is watching.
 *
 * THE REACHABILITY TEST IS THE MORE IMPORTANT ONE. The manifest is built by walking imports from
 * `index.html`, and a static walk cannot see a path assembled at runtime from a variable. So every
 * module under `src/` must be reachable from the page OR from the command line runner, which are
 * two different graphs: the browser never loads the CDP client or the launcher. A module in
 * neither is dead code or is loaded by a path the walk cannot follow, and both are findings. Row R5
 * used to check exactly one file while eight others were served unverified, which is the failure
 * this file exists to make impossible to repeat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildManifest, readManifest, manifestDrift, hashOf, MANIFEST_PATH } from '../../scripts/build_manifest.mjs';
import { runtimeGraph } from '../../scripts/runtime_graph.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);

test('the committed manifest describes this working tree', () => {
  const drift = manifestDrift(buildManifest(ROOT), readManifest(ROOT));
  assert.deepEqual(drift, [],
    'the manifest is out of date. Run: node scripts/build_manifest.mjs');
});

test('the manifest is committed and parses', () => {
  const p = path.join(ROOT, MANIFEST_PATH);
  assert.ok(fs.existsSync(p), `${MANIFEST_PATH} is missing, so the deployment has no identity`);
  const stored = readManifest(ROOT);
  assert.ok(stored && stored.files, `${MANIFEST_PATH} did not parse`);
  assert.ok(Object.keys(stored.files).length >= 8,
    `the manifest covers only ${Object.keys(stored.files).length} files, which is fewer than the page loads`);
});

test('the page loads nothing the tree does not contain', () => {
  const { unresolved } = runtimeGraph(ROOT);
  assert.deepEqual(unresolved, [],
    'the page references files that are not in the repository, so the deployment would 404');
});

test('every module under src is reachable from the page or from the runner', () => {
  /*
   * The blind spot, made visible, and the first version of this test was wrong about it.
   *
   * A static walk cannot follow a path built at runtime, so anything it misses would be silently
   * absent from the manifest. But `src/` holds two graphs, not one: the browser page loads the
   * catalogue, the judge, the probe and the UI, while `src/probe/cdp.mjs` and
   * `src/probe/launch.mjs` are Node side and are reached only from `bin/ninthtool.mjs`. Requiring
   * everything to be reachable from the PAGE therefore failed on two files that are exactly where
   * they should be.
   *
   * So both entry points are walked. A module in neither graph is dead code or is loaded by a path
   * that cannot be seen, and both are findings.
   */
  const fromPage = runtimeGraph(ROOT, 'index.html').files;
  const fromRunner = runtimeGraph(ROOT, 'bin/ninthtool.mjs').files;
  const reachable = new Set([...fromPage, ...fromRunner]);

  const shipped = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(entry.name)) shipped.push(rel);
    }
  };
  walk('src');

  const unreachable = shipped.filter((f) => !reachable.has(f));
  assert.deepEqual(unreachable, [],
    'these modules ship under src and neither the page nor the runner reaches them. Either they '
    + 'are dead code, or they are loaded by a path the graph walk cannot see, and the manifest is '
    + 'therefore short. Neither is acceptable in a repository whose deployment gate reads it.');
});

test('the page graph and the runner graph are different, and the manifest is the page one', () => {
  // Stated as an assertion because it is the thing the first version of the test above got wrong.
  // The manifest describes what a BROWSER loads. The runner's Node side modules are not deployed
  // and must not be in it.
  const fromPage = new Set(runtimeGraph(ROOT, 'index.html').files);
  const manifest = readManifest(ROOT);
  for (const nodeOnly of ['src/probe/cdp.mjs', 'src/probe/launch.mjs']) {
    assert.ok(!fromPage.has(nodeOnly), `${nodeOnly} is Node side and the page must not load it`);
    assert.ok(!(nodeOnly in manifest.files),
      `${nodeOnly} is Node side and does not belong in a manifest of what the browser fetches`);
  }
});

test('the hash normalises line endings and nothing else', () => {
  // The one normalisation, and why. This tree holds CRLF and GitHub Pages serves LF; one file
  // measured 421 line endings and 421 bytes of difference, identical after normalisation.
  assert.equal(hashOf('a\r\nb'), hashOf('a\nb'), 'CRLF and LF must hash the same');
  assert.notEqual(hashOf('a b'), hashOf('a  b'), 'a changed space inside a line must still differ');
  assert.notEqual(hashOf('a\nb'), hashOf('b\na'), 'a changed order must still differ');
  assert.notEqual(hashOf('const a = 1;'), hashOf('const a = 2;'), 'a changed character must still differ');
});

test('drift is reported in both directions', () => {
  const fresh = { files: { 'a.js': 'h1', 'b.js': 'h2' } };
  assert.deepEqual(manifestDrift(fresh, { files: { 'a.js': 'h1', 'b.js': 'h2' } }), []);

  assert.match(manifestDrift(fresh, { files: { 'a.js': 'h1' } })[0], /b\.js is in the graph/);
  assert.match(manifestDrift(fresh, { files: { 'a.js': 'CHANGED', 'b.js': 'h2' } })[0], /a\.js has changed/);
  assert.match(
    manifestDrift(fresh, { files: { 'a.js': 'h1', 'b.js': 'h2', 'gone.js': 'h3' } })[0],
    /gone\.js is in the manifest and no longer in the graph/,
  );
  assert.match(manifestDrift(fresh, null)[0], /no committed manifest/);
});

test('the graph finds every file the page actually references', () => {
  const { files } = runtimeGraph(ROOT);
  for (const expected of ['index.html', 'assets/styles.css', 'fixtures/subject.html', 'src/ui/app.js']) {
    assert.ok(files.includes(expected), `the graph missed ${expected}, which index.html references directly`);
  }
  // Reached only through two levels of import, which is the property that makes the walk worth having.
  for (const expected of ['src/probe/steps.js', 'src/probe/fixture_identity.js']) {
    assert.ok(files.includes(expected), `the graph missed ${expected}, reached through observe.js`);
  }
});
