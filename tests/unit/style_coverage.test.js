/**
 * The style gate's SCOPE, checked rather than trusted.
 *
 * THE FAILURE THIS EXISTS TO STOP HAS ALREADY HAPPENED ONCE HERE. Three tracked directories were
 * missing from the gate's list for one commit, so `assets/`, `bin/` and the workflow files sat
 * outside it while it printed PASS over thirteen files. Nothing was wrong with the rules. The scope
 * was short, quietly, and a passing gate said so.
 *
 * A lesson written as prose in a long document does not stop its own repeat, so it is a failing
 * test instead: this walks the tree and refuses any directory that holds a file the gate would
 * scan and is not on the gate's list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SCANNED_DIRS, SCANNED_EXTENSIONS, IGNORED_DIRS } from '../../scripts/style_config.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);

/** Every directory under the root that holds at least one file the gate would read. */
function directoriesHoldingScannableFiles(dir = '', found = new Set()) {
  const full = path.join(ROOT, dir);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      directoriesHoldingScannableFiles(path.join(dir, entry.name), found);
    } else if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
      found.add(dir.split(path.sep).join('/'));
    }
  }
  return found;
}

test('the style gate walks every directory that holds a file it would scan', () => {
  const holding = [...directoriesHoldingScannableFiles()].sort();
  const missing = holding.filter((dir) => !SCANNED_DIRS.includes(dir));
  assert.deepEqual(
    missing,
    [],
    'these directories hold files the style gate would scan and are not on its list, '
    + 'so they are silently outside the gate. Add them to SCANNED_DIRS in scripts/style_config.mjs.',
  );
});

test('the style gate lists no directory that does not exist', () => {
  const stale = SCANNED_DIRS.filter((dir) => !fs.existsSync(path.join(ROOT, dir)));
  assert.deepEqual(stale, [],
    'the gate names a directory that is not in the tree, which reads as coverage it does not have');
});

test('the gate scans more than a token number of files', () => {
  // A floor, not a target. If this ever drops sharply, something left the gate's scope and the
  // printed count would have been the only sign.
  let count = 0;
  for (const dir of SCANNED_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && SCANNED_EXTENSIONS.includes(path.extname(entry.name))) count += 1;
    }
  }
  assert.ok(count >= 14, `the gate would scan only ${count} files, which is fewer than this repository has`);
});
