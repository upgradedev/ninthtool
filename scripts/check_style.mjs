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

import { SCANNED_DIRS, SCANNED_EXTENSIONS, EXEMPT } from './style_config.mjs';

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

/** Other competitions. A judge who finds one of these is reading about somebody else's contest. */
const OTHER_COMPETITIONS = [
  'cockroach', 'backblaze', 'qwen', 'nebius', 'xprize', 'kaggle',
  'claimready', 'cinemory', 'claimscene', 'datahub', 'kerdon', 'archon',
];
// Deliberately NOT in that list: the host platform of THIS hackathon. Linking the entry is
// expected, and banning the word would make the submission checklist unwritable.

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

const findings = [];
const files = walk();

for (const relative of files) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const where = `${relative}:${index + 1}`;

    if (line.includes(EM_DASH)) findings.push(`${where} em dash`);
    if (line.includes(EN_DASH)) findings.push(`${where} en dash`);

    const lower = line.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`, 'i').test(line)) {
        findings.push(`${where} banned word "${word}"`);
      }
    }
    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) findings.push(`${where} banned phrase "${phrase}"`);
    }
    if (!MAY_NAME_SIBLINGS.has(relative)) {
      for (const name of OTHER_COMPETITIONS) {
        if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`, 'i').test(line)) {
          findings.push(`${where} names another project or competition: "${name}"`);
        }
      }
    }
  });
}

const selfTest = process.argv.includes('--selftest');
if (selfTest) {
  // PROVE THE GATE CAN FAIL, on every rule it owns, without touching a tracked file.
  const cases = [
    ['em dash', `a sentence with an ${EM_DASH} in it`],
    ['en dash', `a range 1 ${EN_DASH} 2`],
    ['banned word', 'we leverage the platform'],
    ['banned word compliant', 'the system is compliant'],
    ['banned phrase', 'in today\'s world, agents matter'],
    ['other competition', 'as we did for the Nebius entry'],
  ];
  let broken = 0;
  for (const [label, sample] of cases) {
    const hit = sample.includes(EM_DASH) || sample.includes(EN_DASH)
      || BANNED_WORDS.some((w) => new RegExp(`(^|[^a-z-])${w}([^a-z-]|$)`, 'i').test(sample))
      || BANNED_PHRASES.some((p) => sample.toLowerCase().includes(p))
      || OTHER_COMPETITIONS.some((n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`, 'i').test(sample));
    if (!hit) { console.error(`selftest: "${label}" was NOT caught. The gate cannot fail on it.`); broken++; }
  }
  if (broken) { console.error(`style selftest: FAIL, ${broken} rules could not be made to fail.`); process.exit(1); }
  console.log(`style selftest: PASS, all ${cases.length} rules were seen to fail on a deliberate sample.`);
}

console.log(`style gate: scanned ${files.length} files across ${SCANNED_DIRS.length} declared directories.`);
if (findings.length) {
  console.error(`style gate: FAIL, ${findings.length} findings.`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log('style gate: PASS.');
