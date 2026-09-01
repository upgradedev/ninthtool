/**
 * The package manifest, checked against the tree it describes.
 *
 * WHY THIS IS A TEST. `npx github:upgradedev/ninthtool` installs only what `files` lists. A runtime
 * module left out of that list produces a command that resolves, starts, and then dies on an import
 * of something that was never packed. The failure lands on whoever ran the one command the README
 * tells a reader to run, which is the worst possible place for it.
 *
 * So the list is checked against the real module graph rather than eyeballed, and the CI end to end
 * job then actually runs the command on a clean machine. Neither alone is enough: this catches the
 * omission at authoring time, and CI catches whatever this did not think of.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runtimeGraph } from '../../scripts/runtime_graph.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Would `files` pack this path? */
function packed(relative) {
  return (pkg.files || []).some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

test('the bin entry points at a file that exists and can be executed', () => {
  assert.ok(pkg.bin && pkg.bin.ninthtool, 'no bin entry, so npx has nothing to run');
  const target = pkg.bin.ninthtool;
  assert.ok(fs.existsSync(path.join(ROOT, target)), `${target} does not exist`);

  // Trimmed: this tree is checked out with CRLF while git stores and npm packs LF, so the
  // carriage return is a working copy artifact that never reaches an installed package.
  const first = fs.readFileSync(path.join(ROOT, target), 'utf8').split('\n')[0].trim();
  assert.equal(first, '#!/usr/bin/env node',
    'without a shebang the file is not executable on a machine that installed it');
});

test('everything the runner and the page load is packed', () => {
  // Both graphs, because npx installs the CLI and the CLI serves the page.
  const fromRunner = runtimeGraph(ROOT, 'bin/ninthtool.mjs').files;
  const fromPage = runtimeGraph(ROOT, 'index.html').files;
  const needed = [...new Set([...fromRunner, ...fromPage, 'runtime-manifest.json'])];

  const missing = needed.filter((f) => !packed(f));
  assert.deepEqual(missing, [],
    'these are loaded at runtime and would not be installed, so the command would die on an import');
});

test('the manifest is packed, because the server refuses to start without it', () => {
  // src/probe/serve.mjs builds its allowlist from runtime-manifest.json. Without it, a run with no
  // URL cannot serve the subject page at all.
  assert.ok(packed('runtime-manifest.json'));
});

test('nothing is packed that has no business being installed', () => {
  for (const unwanted of ['tests', '.github', 'docs', 'scripts/readiness.mjs', 'scripts/check_style.mjs']) {
    assert.ok(!packed(unwanted), `${unwanted} would be installed on a user's machine for no reason`);
  }
});

test('it declares no dependencies and never will', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(!fs.existsSync(path.join(ROOT, 'package-lock.json')),
    'a lock file means something was installed, and nothing here installs anything');
});

test('it stays unpublishable, and the repository is named so npx can find it', () => {
  // private:true is deliberate. The install path is `npx github:owner/repo`, which needs the
  // repository field and does not need a registry entry.
  assert.equal(pkg.private, true, 'this must not be publishable to a registry by accident');
  assert.match(pkg.repository.url, /github\.com\/upgradedev\/ninthtool/);
  assert.equal(pkg.homepage, 'https://upgradedev.github.io/ninthtool/');
});

test('it declares the Node it needs', () => {
  assert.ok(pkg.engines && pkg.engines.node, 'no engines.node, so an old Node fails obscurely');
  assert.match(pkg.engines.node, />=\s*20/);
});

test('the README tells a reader the command that actually works', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  // The form CI proves, not the tidier one that does not work on npm 10.8.2. The e2e job
  // tries the shorthand first every run, so if npm fixes it this assertion is what changes.
  assert.match(readme, /npx --yes https:\/\/github\.com\/upgradedev\/ninthtool\/tarball\/main/,
    'the README must carry the one line a reader with no checkout can actually run');
});
