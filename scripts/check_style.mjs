/**
 * The style gate. It reads the files a judge reads and fails the build on the things that make
 * writing look machine made or make a claim we cannot stand behind.
 *
 * IT SELECTS BY PATH, NEVER BY CONTENT, AND PRINTS THE COUNT. A gate that picks its files by
 * searching their text stops covering a file the moment somebody renames a heading inside it, and
 * it goes on reporting green. So the walk below is over directories, the extensions are listed, and
 * the number of files scanned is printed on every run. If that number drops, something left the
 * gate's scope and the drop is visible.
 *
 * IT USES LITERAL CHARACTERS. In Git Bash, grep -c for an em dash written as a shell escape returns
 * 0 on a file that genuinely holds one, and grep -P fails outside a UTF-8 locale. A style gate
 * written the obvious way on this machine is a gate that cannot fail. This one is JavaScript and
 * compares code points, so the shell has no opinion.
 *
 * ON "CONFORMANCE". The house rule bans "compliant" and "conformity", because those words claim a
 * regulatory posture nobody here has audited. "Conformance", meaning agreement with a published web
 * standard, is the actual subject of this repository and is allowed. The banned list below is
 * therefore exact rather than a stem match, and this paragraph is why.
 */
import fs from 'node:fs';
import path from 'node:path';

import { SCANNED_DIRS, SCANNED_EXTENSIONS, EXEMPT, OTHER_COMPETITIONS } from './style_config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

/** Words that make prose read as machine written. Exact, case insensitive, word bounded. */
const BANNED_WORDS = [
  'leverage', 'leverages', 'leveraging',
  'robust', 'seamless', 'seamlessly',
  'comprehensive', 'comprehensively',
  'cutting-edge', 'state-of-the-art', 'game-changing',
  'delve', 'delves', 'delving',
  'compliant', 'conformity',
];

/** Phrases that are always a finding. */
const BANNED_PHRASES = ['in today\'s world', 'in the world of', 'it is important to note that'];

/** Files where naming the sibling entry is required rather than forbidden. */
const MAY_NAME_SIBLINGS = new Set(['README.md', 'docs/prior-art.md', 'docs/reuse.md']);

function walk() {
  const files = [];
  for (const dir of SCANNED_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (EXEMPT.has(entry.name)) continue;
      if (!SCANNED_EXTENSIONS.includes(path.extname(entry.name))) continue;
      files.push(path.join(dir, entry.name).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

/**
 * Every rule this gate owns, for one line, as a pure function.
 *
 * EXTRACTED SO THE SELF TEST CAN CALL IT. This lived inline in the loop below, which meant
 * `--selftest` had nothing to call and re-implemented the same regexes beside it. A copy of a rule
 * cannot prove the rule: mutating the real scanner so it could never flag anything left the self
 * test printing PASS. That is the defect readiness `--selftest` had, in the second gate.
 *
 * @param {string} relative the file, used for the location and the sibling exemption
 * @param {string} line
 * @param {number} index zero based
 * @returns {string[]} one string per finding, empty when the line is clean
 */
export function findingsForLine(relative, line, index) {
  const out = [];
  const where = `${relative}:${index + 1}`;

  if (line.includes(EM_DASH)) out.push(`${where} em dash`);
  if (line.includes(EN_DASH)) out.push(`${where} en dash`);

  const lower = line.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`, 'i').test(line)) {
      out.push(`${where} banned word "${word}"`);
    }
  }
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) out.push(`${where} banned phrase "${phrase}"`);
  }
  if (!MAY_NAME_SIBLINGS.has(relative)) {
    for (const name of OTHER_COMPETITIONS) {
      if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`, 'i').test(line)) {
        out.push(`${where} names another project or competition: "${name}"`);
      }
    }
  }
  return out;
}

const findings = [];
const files = walk();

for (const relative of files) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    findings.push(...findingsForLine(relative, line, index));
  });
}

const selfTest = process.argv.includes('--selftest');
if (selfTest) {
  /*
   * PROVE THE GATE CAN FAIL, on every rule it owns, by calling the rule.
   *
   * This used to re-implement the regexes inline, so it proved a COPY of the scanner and never the
   * scanner. Mutating findingsForLine so it could return nothing left this printing PASS. A gate
   * that checks a duplicate of itself is the defect this repository keeps finding, and this was the
   * second instance of it.
   *
   * Each sample names the rule it is meant to trip, and the finding has to mention it, so a sample
   * caught by the WRONG rule is not counted as proof.
   */
  const cases = [
    ['em dash', `a sentence with an ${EM_DASH} in it`, /em dash/],
    ['en dash', `a range 1 ${EN_DASH} 2`, /en dash/],
    ['banned word', 'we leverage the platform', /banned word/],
    ['banned word compliant', 'the system is compliant', /banned word/],
    ['banned phrase', 'in today\'s world, agents matter', /banned phrase/],
    ['other competition', 'as we did for the Nebius entry', /names another project/],
  ];
  let broken = 0;
  for (const [label, sample, expect] of cases) {
    const hits = findingsForLine('selftest.md', sample, 0);
    if (!hits.length) {
      console.error(`selftest: "${label}" was NOT caught. The gate cannot fail on it.`);
      broken++;
    } else if (!hits.some((h) => expect.test(h))) {
      console.error(`selftest: "${label}" was caught by the wrong rule: ${hits.join('; ')}`);
      broken++;
    }
  }
  // A clean line must produce nothing, or every case above passes for a reason that is not the rule.
  const clean = findingsForLine('selftest.md', 'an ordinary sentence about agents and pages', 0);
  if (clean.length) {
    console.error(`selftest: a clean line was flagged, so the rules fire on anything: ${clean.join('; ')}`);
    broken++;
  }
  if (broken) { console.error(`style selftest: FAIL, ${broken} rules could not be made to fail.`); process.exit(1); }
  console.log(`style selftest: PASS, all ${cases.length} rules were handed a deliberate sample and `
    + 'the real scanner flagged each one, while a clean line produced nothing.');
}

console.log(`style gate: scanned ${files.length} files across ${SCANNED_DIRS.length} declared directories.`);
if (findings.length) {
  console.error(`style gate: FAIL, ${findings.length} findings.`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log('style gate: PASS.');
