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
  'src', 'src/judge', 'src/probe', 'src/ui', 'tests', 'tests/integration', 'tests/support',
  'tests/unit'];

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

/**
 * Other competitions and other projects of ours. A judge who finds one of these is reading about
 * somebody else's contest.
 *
 * ONE COPY, TWO READERS. The style gate scans for these and the readiness gate has a mandatory row
 * asserting no judge facing file carries one. Keeping a second copy in the readiness script meant
 * the style gate found that copy and went red, which is the gate working, and it also meant two
 * lists that could drift. Deliberately NOT in the list: the host platform of this hackathon, since
 * linking the entry is expected.
 */
export const OTHER_COMPETITIONS = [
  'cockroach', 'backblaze', 'qwen', 'nebius', 'xprize', 'kaggle',
  'claimready', 'cinemory', 'claimscene', 'datahub', 'kerdon', 'archon',
];

/** Judge facing files the readiness gate holds to that list. */
export const JUDGE_FACING_FILES = ['README.md', 'index.html', 'docs/evidence.md', 'docs/prior-art.md'];

/**
 * Our own sibling entry, and the files the rules require it to be named in.
 *
 * THIS IS A NARROWING, NOT A WIDENING, AND THE DIFFERENCE MATTERS. The ban on naming other
 * competitions exists so a judge never opens a file and finds themselves reading about somebody
 * else's contest. Naming our OWN second entry in THIS contest, in the provenance section the rules
 * require in order to judge whether two submissions are substantially different, is the opposite of
 * that failure mode: leaving it out is what would be dishonest.
 *
 * So the name is permitted in exactly these files, and the readiness gate additionally REQUIRES it
 * in the README, because a missing disclosure is a finding too. Everywhere else it stays banned.
 */
export const SIBLING_ENTRY = 'claimready';
// The Devpost description MUST disclose the sibling entry, so it is both allowed to name it and
// required to. A file that has to carry the disclosure cannot be one the gate bans it from.
export const SIBLING_MAY_BE_NAMED_IN = ['README.md', 'docs/prior-art.md', 'docs/reuse.md', 'docs/description.md'];
export const SIBLING_MUST_BE_NAMED_IN = ['README.md', 'docs/description.md'];
