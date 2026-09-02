/**
 * Every JavaScript file in this repository parses as an ES module.
 *
 * WHY THIS IS A TEST AND NOT A HABIT. `node --check file.js` parses the file as CommonJS, so it
 * accepts a module with a syntax error and reports nothing. A stray apostrophe inside a single
 * quoted string passed that check, shipped, and left the page with nought registered tools and one
 * console error. Every verification run in that session had used the check that cannot fail on this.
 *
 * `node --input-type=module --check` is the one that works, and this runs it over every file.
 *
 * WHY THE SELECTION IS A WALK AND NOT A LIST. This test used to choose its files from eight
 * directory names typed out by hand. That is the failure class `scripts/style_config.mjs` and
 * `scripts/runtime_graph.mjs` were both written to remove, and it had already happened here: the
 * list named `tests/support` and `tests/integration` and not `tests/unit`, and it had never been
 * given `video/`. Thirty eight files, including every test in this suite and the whole video
 * pipeline with its own CI gate, were outside a gate that reported green over eighteen. Nobody had
 * to make a mistake for that to happen. Somebody added a directory, and a list that has to be
 * remembered was not.
 *
 * So the walk starts at the repository root and takes every `.js` and `.mjs` it finds, skipping
 * only the directories `IGNORED_DIRS` already declares as not ours to write. A new module joins
 * this gate by existing.
 *
 * AND THE COUNT IS PINNED, NOT FLOORED. The old assertion was `files.length >= 12` against
 * eighteen files, so six could have left the tree with the gate still green, and the thirty eight
 * that were never in scope could not have registered at all. A floor cannot detect a file leaving
 * coverage, which is the only thing this number is for. Adding or removing a module is now a
 * deliberate one line edit here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { IGNORED_DIRS } from '../../scripts/style_config.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);

/**
 * How many JavaScript modules this repository holds.
 *
 * PINNED ON PURPOSE. If you added a module, add one here and say so in the commit. If this number
 * fell and you did not delete anything, a directory has left the walk and that is the bug this
 * exists to catch. Untracked scratch files in the working tree count too, because they are in the
 * tree; CI checks out clean, so the number there is the number of tracked modules.
 */
// 63 since tests/unit/ui_reading.test.js was added for the reading surface: the index, the fold and
// the command in the blocker. The count is exact rather than a floor, so adding a module without
// noticing fails here.
const EXPECTED_MODULES = 63;

/** Every `.js` and `.mjs` under the root, chosen by path, never by searching file contents. */
function everyModule(dir = '', found = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      everyModule(path.join(dir, entry.name), found);
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      found.push(path.join(dir, entry.name).split(path.sep).join('/'));
    }
  }
  return found;
}

test('the parse gate scans every module in the tree, and the count is exact', () => {
  const files = everyModule().sort();

  // Printed so a run says what it covered rather than only whether it liked it. A drop is then
  // attributable to a directory rather than being a number nobody can place.
  const byDirectory = {};
  for (const file of files) {
    const dir = path.posix.dirname(file);
    byDirectory[dir] = (byDirectory[dir] || 0) + 1;
  }
  console.log(`parse gate: scanned ${files.length} modules by walking the tree from the root.`);
  for (const dir of Object.keys(byDirectory).sort()) {
    console.log(`  ${byDirectory[dir]}  ${dir === '.' ? '<root>' : dir}`);
  }

  assert.equal(
    files.length, EXPECTED_MODULES,
    'the number of JavaScript modules in the tree changed. If you added or removed one, update '
    + 'EXPECTED_MODULES in this file. If you did not, a directory has silently left this gate',
  );

  // The two directories this gate used to miss entirely. Named so that a walk which quietly
  // stopped descending would fail here with the reason rather than only with a wrong total.
  for (const dir of ['tests/unit', 'video']) {
    assert.ok(
      files.some((file) => file.startsWith(`${dir}/`)),
      `${dir} holds modules and the walk found none there, which is how this gate lost thirty `
      + 'eight files the first time',
    );
  }
});

test('every module in the tree parses as an ES module', () => {
  const files = everyModule().sort();
  const broken = [];
  for (const relative of files) {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(path.join(ROOT, relative), 'utf8'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const first = String(error.stderr || error.message).split('\n').find((l) => /Error/.test(l));
      broken.push(`${relative}: ${first || 'failed'}`);
    }
  }
  assert.deepEqual(broken, [], 'these files do not parse as ES modules');
});
