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
 * ON "CONFORMANCE". The house rule bans two words outright, named here so the paragraph says what
 * it is about: "compliant" and "conformity" [style-gate:rule-literal]. Those words claim a
 * regulatory posture nobody here has audited. "Conformance", meaning agreement with a published web
 * standard, is the actual subject of this repository and is allowed. The banned list below is
 * therefore exact rather than a stem match, and this paragraph is why.
 *
 * THIS FILE IS SCANNED BY ITSELF, WHICH IT DID NOT USED TO BE. It sat in the whole file `EXEMPT`
 * set, so the file deciding what the rules are was one of the only two the rules never read. The
 * exemption is now per line: the lines that must carry a banned literal say so with a marker, and
 * every other line here is read like any other file's. See `RULE_LITERAL_MARKER` in style_config.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SCANNED_DIRS, SCANNED_EXTENSIONS, EXEMPT, OTHER_COMPETITIONS, SIBLING_MAY_BE_NAMED_IN,
  RULE_LITERAL_MARKER, RULE_LITERAL_FILES } from './style_config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

/**
 * Words that make prose read as machine written. Exact, case insensitive, word bounded.
 *
 * EXPORTED SO A TEST CAN SWEEP IT RATHER THAN COPY IT. A test holding its own list of sixteen words
 * proves those sixteen and says nothing about the seventeenth somebody adds here next week. Both
 * the selftest below and tests/unit/style_gate.test.js iterate this array, so a new entry is
 * covered the moment it is added and an entry that stops being enforced fails immediately.
 */
export const BANNED_WORDS = [
  'leverage', 'leverages', 'leveraging', // style-gate:rule-literal
  'robust', 'seamless', 'seamlessly', // style-gate:rule-literal
  'comprehensive', 'comprehensively', // style-gate:rule-literal
  'cutting-edge', 'state-of-the-art', 'game-changing', // style-gate:rule-literal
  'delve', 'delves', 'delving', // style-gate:rule-literal
  'compliant', 'conformity', // style-gate:rule-literal
];

/** Phrases that are always a finding. Exported for the same reason as the words above. */
export const BANNED_PHRASES = ['in today\'s world', 'in the world of', 'it is important to note that']; // style-gate:rule-literal

/*
 * Files where naming the sibling entry is required rather than forbidden.
 *
 * IMPORTED, NOT RESTATED. This was a second hardcoded copy of a list that already lives in
 * style_config.mjs, and the two had already drifted: this one carried docs/reuse.md and not the
 * Devpost description, so a file REQUIRED to disclose the sibling was flagged for disclosing it.
 * One list, one place.
 */
const MAY_NAME_SIBLINGS = new Set(SIBLING_MAY_BE_NAMED_IN);

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
 * @param {string} relative the file, used for the location, the sibling exemption and the marker
 * @param {string} line
 * @param {number} index zero based
 * @returns {string[]} one string per finding, empty when the line is clean
 */
export function findingsForLine(relative, line, index) {
  const out = [];
  const where = `${relative}:${index + 1}`;

  /*
   * A line that DEFINES a rule has to contain the thing the rule bans, and that is true of a
   * handful of lines rather than of a whole file. So the skip is per line AND per file: in any file
   * not named in RULE_LITERAL_FILES the marker is ordinary text and the line is read exactly as it
   * would be without it. That asymmetry is the whole point, and it is tested in both directions.
   */
  if (RULE_LITERAL_FILES.includes(relative) && line.includes(RULE_LITERAL_MARKER)) return out;

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

/**
 * Prove the gate can fail, on every rule it owns, by calling the rule.
 *
 * This used to re-implement the regexes inline, so it proved a COPY of the scanner and never the
 * scanner. Mutating findingsForLine so it could return nothing left this printing PASS. A gate that
 * checks a duplicate of itself is the defect this repository keeps finding.
 *
 * IT SWEEPS THE LISTS RATHER THAN SAMPLING THEM. Six hand picked samples against a sixteen word
 * list proved six words. Deleting any of the other ten left this printing PASS, which is the same
 * shape of hole one level down. Every entry in every list now gets its own deliberate sample, and
 * each sample names the rule it is meant to trip, so a sample caught by the WRONG rule is not
 * counted as proof.
 *
 * @returns {number} how many checks could not be made to behave, zero when the gate is sound
 */
export function runSelfTest() {
  const cases = [
    ['em dash', `a sentence with an ${EM_DASH} in it`, /em dash/],
    ['en dash', `a range 1 ${EN_DASH} 2`, /en dash/],
  ];
  for (const word of BANNED_WORDS) {
    cases.push([`banned word "${word}"`, `we ${word} the platform`, /banned word/]);
  }
  for (const phrase of BANNED_PHRASES) {
    cases.push([`banned phrase "${phrase}"`, `${phrase}, agents matter`, /banned phrase/]);
  }
  for (const name of OTHER_COMPETITIONS) {
    cases.push([`other competition "${name}"`, `as we did for the ${name} entry`, /names another project/]);
  }

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

  /*
   * The negative half. Without these, every case above could pass for a reason that is not the
   * rule, because a scanner that flagged every line would satisfy all of them.
   */
  const negatives = [
    ['a clean line', 'selftest.md', 'an ordinary sentence about agents and pages'],
    // The banned list is exact rather than a stem match, and this is the word that proves it.
    ['the word this repository is about', 'selftest.md', 'conformance with the published standard'],
  ];
  for (const [label, file, sample] of negatives) {
    const hits = findingsForLine(file, sample, 0);
    if (hits.length) {
      console.error(`selftest: ${label} was flagged, so the rules fire on anything: ${hits.join('; ')}`);
      broken++;
    }
  }

  /*
   * The marker is an exemption, so the thing worth proving is that it does NOT work where it is not
   * meant to. A marker pasted into a judge facing file must leave that line scanned.
   */
  const marked = `we ${BANNED_WORDS[0]} the platform ${RULE_LITERAL_MARKER}`;
  if (findingsForLine(RULE_LITERAL_FILES[0], marked, 0).length !== 0) {
    console.error('selftest: the rule literal marker did not exempt a line in the file that owns it.');
    broken++;
  }
  if (findingsForLine('README.md', marked, 0).length === 0) {
    console.error('selftest: the rule literal marker silenced a line in README.md, so it is a '
      + 'general purpose escape hatch rather than a narrow exemption.');
    broken++;
  }

  if (broken) {
    console.error(`style selftest: FAIL, ${broken} checks could not be made to behave.`);
    return broken;
  }
  console.log(`style selftest: PASS, all ${cases.length} rules were handed a deliberate sample and `
    + `the real scanner flagged each one, while ${negatives.length} clean lines produced nothing `
    + 'and the rule literal marker was refused outside the files that own it.');
  return 0;
}

/**
 * Read the tree and report.
 *
 * WHY THIS IS A FUNCTION BEHIND A GUARD. It used to be top level, so `import { BANNED_WORDS }` ran
 * the whole scan, printed to stdout and could call process.exit(1) in the middle of somebody
 * else's test run. A file nothing can import without side effects is a file nothing can test,
 * which is part of how this one ended up with no external test at all.
 *
 * The guard compares `pathToFileURL(process.argv[1])` with `import.meta.url`. Comparing argv[1] to
 * import.meta.url directly is the obvious spelling and it never matches on either platform, which
 * would leave `node scripts/check_style.mjs` a silent no-op that exits 0. That is the exact failure
 * class this repository keeps finding, so tests/unit/style_gate.test.js spawns the script for real
 * and asserts it still scans and still reports.
 *
 * @param {string[]} argv
 * @returns {number} the process exit code
 */
export function main(argv = process.argv) {
  if (argv.includes('--selftest') && runSelfTest() !== 0) return 1;

  const files = walk();
  const findings = [];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      findings.push(...findingsForLine(relative, line, index));
    });
  }

  console.log(`style gate: scanned ${files.length} files across ${SCANNED_DIRS.length} declared directories.`);
  if (findings.length) {
    console.error(`style gate: FAIL, ${findings.length} findings.`);
    for (const finding of findings) console.error(`  - ${finding}`);
    return 1;
  }
  console.log('style gate: PASS.');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
