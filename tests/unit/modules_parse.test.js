/**
 * Every shipped module parses as an ES module.
 *
 * WHY THIS IS A TEST AND NOT A HABIT. `node --check file.js` parses the file as CommonJS, so it
 * accepts a module with a syntax error and reports nothing. A stray apostrophe inside a single
 * quoted string passed that check, shipped, and left the page with nought registered tools and one
 * console error. Every verification run in that session had used the check that cannot fail on this.
 *
 * `node --input-type=module --check` is the one that works, and this runs it over every file the
 * browser or the runner loads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);

/** Every .js and .mjs file under the directories the page and the runner load from. */
function shippedModules() {
  const dirs = ['src', 'src/judge', 'src/probe', 'src/ui', 'scripts', 'bin', 'tests/support', 'tests/integration'];
  const found = [];
  for (const dir of dirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
        found.push(path.join(dir, entry.name).split(path.sep).join('/'));
      }
    }
  }
  return found;
}

test('every shipped module parses as an ES module', () => {
  const files = shippedModules();
  assert.ok(files.length >= 12, `only ${files.length} modules found, which is fewer than this repository has`);
  const broken = [];
  for (const rel of files) {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(path.join(ROOT, rel), 'utf8'), stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      broken.push(`${rel}: ${String(error.stderr || error.message).split('\n').find((l) => /Error/.test(l)) || 'failed'}`);
    }
  }
  assert.deepEqual(broken, [], 'these files do not parse as ES modules');
});
