/**
 * What the style gate covers, in one place, so a test can check the coverage rather than trusting
 * it.
 *
 * WHY THIS IS ITS OWN FILE. The gate used to hold this list inline. Three tracked directories were
 * missing from it for one commit, so `assets/`, `bin/` and the workflow files sat outside the gate
 * while it printed PASS. Nothing was wrong with the gate's rules; its scope was silently short. A
 * list nobody can import is a list nobody can test, so it moved here and
 * tests/unit/style_coverage.test.js now walks the tree and fails when a directory holding a
 * scannable file is not named below.
 */

/** Directories the gate walks, by path. Not by searching file contents, ever. */
export const SCANNED_DIRS = ['', '.github/workflows', 'assets', 'bin', 'docs', 'fixtures', 'scripts',
  'src', 'src/judge', 'src/probe', 'src/ui', 'tests', 'tests/support', 'tests/unit'];

/** Extensions the gate reads. A new kind of judge facing file means adding it here. */
export const SCANNED_EXTENSIONS = ['.md', '.js', '.mjs', '.html', '.css', '.json', '.yml'];

/** Directories never walked, because nothing in them is written by us. */
export const IGNORED_DIRS = ['.git', 'node_modules', 'tmp'];

/**
 * Files exempt from the word rules, by exact name, each for a stated reason.
 *
 * `check_style.mjs` is exempt because it CONTAINS the banned list, and scanning the definition of a
 * rule against itself finds the rule. This file is exempt for the same reason it exists: it is
 * configuration, not prose. Both are exact filenames rather than patterns, and the gate's selftest
 * still exercises every rule on deliberate samples, so neither exemption removes coverage of
 * anything a judge will read.
 */
export const EXEMPT = new Set(['package-lock.json', 'check_style.mjs', 'style_config.mjs']);
