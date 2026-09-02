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
  'tests/unit', 'video'];

/** Extensions the gate reads. A new kind of judge facing file means adding it here. */
export const SCANNED_EXTENSIONS = ['.md', '.js', '.mjs', '.html', '.css', '.json', '.yml'];

/** Directories never walked, because nothing in them is written by us. */
export const IGNORED_DIRS = ['.git', 'node_modules', 'tmp'];

/**
 * Files exempt from the word rules for their whole length, by exact name, each for a stated reason.
 *
 * THIS SET USED TO HOLD THE GATE ITSELF. `check_style.mjs` and this file were both named here, so
 * the two files that decide what the rules are were the only two files the rules never read. Each
 * exemption was defensible alone. Together they meant nobody could tell whether the gate's own
 * prose obeyed the gate, and the answer turned out to be that a dozen lines need to carry a banned
 * literal and every other line in the two files does not. Count them for yourself by grepping both
 * files for the marker declared below, against `wc -l` on the same two files.
 * tests/unit/style_gate.test.js pins the first number, so it cannot drift unnoticed.
 *
 * Note that this paragraph deliberately does not spell the marker out. Writing it here would make
 * this very line exempt, which is how the first draft of this comment quietly bought itself an
 * exemption it had no use for. The `no marker is decorative` test caught it.
 *
 * Both files are now scanned like everything else. Only the individual lines that carry a rule
 * literal are skipped, by the marker below.
 *
 * What is left here is a lock file, which is machine generated and is not ours to write. This
 * repository ships none today and says so in `package.json`. The entry stays so that one arriving
 * does not arrive as a wall of findings about somebody else's package metadata.
 */
export const EXEMPT = new Set(['package-lock.json']);

/**
 * The line level replacement for the two whole file exemptions this set used to carry.
 *
 * A file that DEFINES a banned word has to contain that word. That is a property of a handful of
 * lines, so the exemption is now a property of a handful of lines rather than of a whole file. A
 * line is skipped only when it carries the marker AND the file is named below, which is the reason
 * the marker copied into README.md does nothing whatsoever.
 *
 * Keyed by relative path, deliberately. `EXEMPT` above is keyed by BASENAME, so any file anywhere
 * called `check_style.mjs` used to inherit the old exemption. Nothing new should carry that shape,
 * and `SIBLING_MAY_BE_NAMED_IN` below already set the precedent of keying on the path.
 *
 * `tests/unit/style_gate.test.js` pins the exact set of lines the marker skips in each file, so a
 * new marker is a deliberate edit to a test rather than a quiet widening of the gate.
 */
export const RULE_LITERAL_MARKER = 'style-gate:rule-literal';
export const RULE_LITERAL_FILES = ['scripts/check_style.mjs', 'scripts/style_config.mjs'];

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
  'cockroach', 'backblaze', 'qwen', 'nebius', 'xprize', 'kaggle', // style-gate:rule-literal
  'claimready', 'cinemory', 'claimscene', 'datahub', 'kerdon', 'archon', // style-gate:rule-literal
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
export const SIBLING_ENTRY = 'claimready'; // style-gate:rule-literal
// The Devpost description MUST disclose the sibling entry, so it is both allowed to name it and
// required to. A file that has to carry the disclosure cannot be one the gate bans it from.
export const SIBLING_MAY_BE_NAMED_IN = ['README.md', 'docs/prior-art.md', 'docs/reuse.md', 'docs/description.md'];
export const SIBLING_MUST_BE_NAMED_IN = ['README.md', 'docs/description.md'];
