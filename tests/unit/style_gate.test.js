/**
 * The style gate, checked from outside itself.
 *
 * WHY THIS FILE EXISTS. `scripts/check_style.mjs` decides what every judge facing file in this
 * repository is allowed to say, and until now nothing outside it checked it. A per file review
 * found the pair of facts that matter only together: no test imported it, spawned it or exercised
 * one of its rules, and it was ALSO named in the whole file `EXEMPT` set in style_config.mjs. The
 * file writing the rules was the file the rules never read, and the only thing standing behind it
 * was its own `--selftest`. A gate that checks a duplicate of itself is the defect this repository
 * keeps finding, and a gate that checks only itself is the same defect one level out.
 *
 * IT SWEEPS THE EXPORTED LISTS AND COPIES NOTHING. A test carrying its own list of sixteen words
 * proves those sixteen and goes quiet about the seventeenth somebody adds next week. Every case
 * below is generated from the array the scanner actually reads, so a new rule is covered the moment
 * it is added, and a rule that stops being enforced fails here immediately.
 *
 * IT ALSO MEANS THIS FILE CONTAINS NO BANNED LITERAL. `tests/unit` is inside the gate's own scope,
 * so a test written the obvious way, with the banned words typed out as fixtures, would turn the
 * gate red on itself. Building the samples from the imports is what keeps this file scannable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  findingsForLine, runSelfTest, main, BANNED_WORDS, BANNED_PHRASES,
} from '../../scripts/check_style.mjs';
import {
  EXEMPT, OTHER_COMPETITIONS, SIBLING_ENTRY, SIBLING_MAY_BE_NAMED_IN,
  RULE_LITERAL_MARKER, RULE_LITERAL_FILES,
} from '../../scripts/style_config.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);

/** Built from code points, exactly as the scanner builds them, so no editor can normalise them. */
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

/** A file on no exemption list, so every rule applies to it. */
const ORDINARY = 'docs/some-page.md';

/** Every line of a real file, run through the real rules. */
function findingsForFile(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  return text.split(/\r?\n/).flatMap((line, index) => findingsForLine(relative, line, index));
}

/** Every line of a real file that carries the rule literal marker, with its one based number. */
function markedLinesOf(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  return text.split(/\r?\n/)
    .map((line, index) => ({ relative, line, number: index + 1 }))
    .filter((row) => row.line.includes(RULE_LITERAL_MARKER));
}

// ---------------------------------------------------------------------------------------------
// Every rule the gate owns, swept from the list the scanner reads.
// ---------------------------------------------------------------------------------------------

test('no rule list has quietly shrunk', () => {
  /*
   * THE ONE HOLE A SWEEP HAS. Every test below iterates the real lists, which is what makes them
   * drift proof when a rule is ADDED. It also means deleting a rule deletes the test for it in the
   * same edit, silently, and the suite stays green over a gate that now bans less than it did.
   * Deleting a rule is a real decision somebody may want to make; it is not one that should happen
   * without a line changing in a test. So the sizes are pinned and the sweeps do the rest.
   */
  assert.deepEqual(
    {
      words: BANNED_WORDS.length,
      phrases: BANNED_PHRASES.length,
      names: OTHER_COMPETITIONS.length,
    },
    { words: 16, phrases: 3, names: 12 },
    'a rule list changed size. Adding to one is welcome and only needs this number moved. Removing '
    + 'from one means the gate bans less than it did, so say why in the commit',
  );
});

test('every banned word is enforced, not just the ones somebody sampled', () => {
  assert.ok(BANNED_WORDS.length > 0, 'the banned word list is empty, so this test proves nothing');
  for (const word of BANNED_WORDS) {
    const hits = findingsForLine(ORDINARY, `we ${word} the platform`, 0);
    assert.ok(
      hits.some((hit) => hit.includes(`banned word "${word}"`)),
      `"${word}" is in the list the scanner reads and the scanner does not flag it: ${hits.join('; ') || 'nothing'}`,
    );
  }
});

test('every banned phrase is enforced', () => {
  assert.ok(BANNED_PHRASES.length > 0, 'the banned phrase list is empty, so this test proves nothing');
  for (const phrase of BANNED_PHRASES) {
    const hits = findingsForLine(ORDINARY, `${phrase}, agents matter`, 0);
    assert.ok(
      hits.some((hit) => hit.includes(`banned phrase "${phrase}"`)),
      `"${phrase}" is in the list the scanner reads and the scanner does not flag it`,
    );
  }
});

test('a banned phrase is caught whatever its casing', () => {
  const [phrase] = BANNED_PHRASES;
  const hits = findingsForLine(ORDINARY, phrase.toUpperCase(), 0);
  assert.ok(hits.some((hit) => hit.includes('banned phrase')), 'the phrase rule is case sensitive');
});

test('every other project or competition name is enforced', () => {
  assert.ok(OTHER_COMPETITIONS.length > 0, 'the name list is empty, so this test proves nothing');
  for (const name of OTHER_COMPETITIONS) {
    const hits = findingsForLine(ORDINARY, `as we did for the ${name} entry`, 0);
    assert.ok(
      hits.some((hit) => hit.includes(`names another project or competition: "${name}"`)),
      `"${name}" is in the list the scanner reads and the scanner does not flag it`,
    );
  }
});

test('both dash characters are enforced', () => {
  const em = findingsForLine(ORDINARY, `a sentence with an ${EM_DASH} in it`, 0);
  assert.ok(em.some((hit) => hit.includes('em dash')), 'the em dash rule does not fire');
  const en = findingsForLine(ORDINARY, `a range 1 ${EN_DASH} 2`, 0);
  assert.ok(en.some((hit) => hit.includes('en dash')), 'the en dash rule does not fire');
  // The two are separate findings, so a scanner conflating them would be visible here.
  assert.ok(!em.some((hit) => hit.includes('en dash')), 'an em dash was reported as an en dash');
  assert.ok(!en.some((hit) => hit.includes('em dash')), 'an en dash was reported as an em dash');
});

test('the word rules are case insensitive', () => {
  const [word] = BANNED_WORDS;
  const hits = findingsForLine(ORDINARY, `We ${word.toUpperCase()} The Platform`, 0);
  assert.ok(hits.some((hit) => hit.includes('banned word')), 'the word rule is case sensitive');
});

// ---------------------------------------------------------------------------------------------
// The negative half. Without it, a scanner that flagged every line would pass everything above.
// ---------------------------------------------------------------------------------------------

test('a clean line produces nothing at all', () => {
  assert.deepEqual(findingsForLine(ORDINARY, 'an ordinary sentence about agents and pages', 0), []);
  assert.deepEqual(findingsForLine(ORDINARY, '', 0), [], 'an empty line produced a finding');
});

test('the banned list is exact rather than a stem match', () => {
  // The file header claims this outright: the word this repository is about must survive, while
  // the two words that claim a regulatory posture must not. Nothing checked the claim until now.
  assert.deepEqual(
    findingsForLine(ORDINARY, 'conformance with the published standard', 0), [],
    'the gate flags the word this repository is actually about, so the list is matching stems',
  );
  // A banned word with a letter glued to its end is a different word and is not a finding.
  const [word] = BANNED_WORDS;
  assert.deepEqual(
    findingsForLine(ORDINARY, `the platform was ${word}d last year`, 0), [],
    'the word rule is not word bounded, so it fires inside longer words',
  );
});

test('a finding names the file and the one based line number', () => {
  const [word] = BANNED_WORDS;
  const [hit] = findingsForLine('docs/evidence.md', `we ${word} it`, 41);
  assert.ok(hit.startsWith('docs/evidence.md:42'), `a finding must be locatable, got "${hit}"`);
});

// ---------------------------------------------------------------------------------------------
// The sibling exemption.
// ---------------------------------------------------------------------------------------------

test('the sibling entry may be named in the files that are required to disclose it', () => {
  assert.ok(SIBLING_MAY_BE_NAMED_IN.length > 0, 'the allow list is empty, so this test proves nothing');
  for (const relative of SIBLING_MAY_BE_NAMED_IN) {
    const hits = findingsForLine(relative, `it shares a probe with ${SIBLING_ENTRY}`, 0);
    assert.deepEqual(
      hits, [],
      `${relative} is required to disclose the sibling entry and the gate flags it for doing so`,
    );
  }
});

test('the sibling entry is still banned everywhere else', () => {
  const hits = findingsForLine(ORDINARY, `it shares a probe with ${SIBLING_ENTRY}`, 0);
  assert.ok(
    hits.some((hit) => hit.includes(`"${SIBLING_ENTRY}"`)),
    'the sibling name is allowed in a file that is not on the disclosure list, so the exemption is not narrow',
  );
});

test('the sibling entry is a name the gate would otherwise ban', () => {
  // If it were not on OTHER_COMPETITIONS the exemption above would be exempting nothing, and both
  // tests would pass while the disclosure rule did no work.
  assert.ok(
    OTHER_COMPETITIONS.includes(SIBLING_ENTRY),
    'the sibling entry is not on the banned name list, so its exemption is a no op',
  );
});

// ---------------------------------------------------------------------------------------------
// The rule literal marker, which replaced two whole file exemptions.
// ---------------------------------------------------------------------------------------------

test('the marker exempts a line only inside the files that own the rules', () => {
  const [word] = BANNED_WORDS;
  const marked = `we ${word} the platform ${RULE_LITERAL_MARKER}`;

  for (const relative of RULE_LITERAL_FILES) {
    assert.deepEqual(
      findingsForLine(relative, marked, 0), [],
      `${relative} defines the rules and must be able to hold the literal on a marked line`,
    );
  }

  // The other direction is the one that matters. A marker pasted into any other file, judge facing
  // or not, must change nothing whatsoever, or the narrow exemption is a general escape hatch.
  for (const relative of [ORDINARY, 'README.md', 'index.html', ...SIBLING_MAY_BE_NAMED_IN]) {
    const hits = findingsForLine(relative, marked, 0);
    assert.ok(
      hits.some((hit) => hit.includes('banned word')),
      `the marker silenced a banned word in ${relative}, so it works outside the two files that own it`,
    );
  }
});

test('an unmarked line inside the rule owning files is scanned like any other', () => {
  const [word] = BANNED_WORDS;
  for (const relative of RULE_LITERAL_FILES) {
    const hits = findingsForLine(relative, `we ${word} the platform`, 0);
    assert.ok(
      hits.some((hit) => hit.includes('banned word')),
      `${relative} is not being scanned on its unmarked lines, so the exemption is still whole file`,
    );
  }
});

test('neither rule owning file is exempt for its whole length any more', () => {
  for (const relative of RULE_LITERAL_FILES) {
    assert.ok(
      !EXEMPT.has(path.basename(relative)),
      `${relative} is back in the whole file EXEMPT set, so nothing reads the file that writes the rules`,
    );
  }
});

test('both rule owning files pass their own rules on every unmarked line', () => {
  for (const relative of RULE_LITERAL_FILES) {
    assert.deepEqual(
      findingsForFile(relative), [],
      `${relative} is scanned now, and it does not pass. Fix the prose rather than the exemption`,
    );
  }
});

test('the marker is pinned to an exact number of lines in each file', () => {
  // A floor would let markers accumulate one at a time until the narrow exemption is the old wide
  // one wearing a different name. Adding a marker has to be a deliberate edit to this number.
  const counted = Object.fromEntries(
    RULE_LITERAL_FILES.map((relative) => [relative, markedLinesOf(relative).length]),
  );
  assert.deepEqual(
    counted,
    { 'scripts/check_style.mjs': 8, 'scripts/style_config.mjs': 4 },
    'the number of exempted lines changed. If the new marker is genuinely a rule literal, say so '
    + 'here; if it is silencing ordinary prose, take it out',
  );
});

test('no marker is decorative', () => {
  // Strip the marker from each marked line and the line must then produce a finding. A marker that
  // changes nothing is either dead or, worse, parked ready to silence something later.
  const decorative = [];
  for (const relative of RULE_LITERAL_FILES) {
    for (const row of markedLinesOf(relative)) {
      const stripped = row.line.split(RULE_LITERAL_MARKER).join('');
      if (findingsForLine(relative, stripped, row.number - 1).length === 0) decorative.push(row);
    }
  }
  for (const row of decorative) {
    assert.match(
      row.line, /RULE_LITERAL_MARKER\s*=/,
      `${row.relative}:${row.number} carries the marker but nothing would be flagged without it, `
      + 'so the marker is doing no work on that line',
    );
  }
  assert.ok(
    decorative.length <= 1,
    'more than one marked line would flag nothing without its marker, and only the line that '
    + 'declares the marker constant has that excuse',
  );
});

// ---------------------------------------------------------------------------------------------
// The script still behaves as a script.
// ---------------------------------------------------------------------------------------------

test('the selftest passes when called directly', () => {
  assert.equal(runSelfTest(), 0, 'the gate cannot demonstrate that every rule of its own can fail');
});

test('the selftest itself goes red when the scanner it checks is broken', () => {
  /*
   * A selftest nobody has ever watched fail is a selftest nobody knows can fail. This hands it two
   * broken scanners rather than trusting that it would notice one. It is the mutation that was run
   * by hand against this file, kept as a test so it stays run.
   *
   * console.error is swapped out because a deliberately failing selftest prints one line per rule,
   * and thirty lines of expected noise in a passing suite trains people to ignore the output.
   */
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.ok(
      runSelfTest(() => []) > 0,
      'a scanner that never finds anything was handed to the selftest and the selftest passed',
    );
    assert.ok(
      runSelfTest((relative, line, index) => [`${relative}:${index + 1} everything`]) > 0,
      'a scanner that flags every line was handed to the selftest and the selftest passed, so the '
      + 'negative cases are not doing any work',
    );
  } finally {
    console.error = quiet;
  }
});

test('the gate fails on a real file in the tree, not only on a line handed to it', () => {
  /*
   * Every rule above is proved against a string. That leaves the part between a rule and a verdict
   * unproven: the walk, the read, the loop and the exit code. This breaks the input deliberately,
   * once, and then puts it back. A `.md` name is chosen so the file cannot disturb the module count
   * that tests/unit/modules_parse.test.js pins, and the removal is in a finally so a failing
   * assertion cannot leave it behind.
   */
  const probe = path.join(ROOT, 'tests/unit/zz_style_gate_probe.md');
  assert.equal(main([]), 0, 'the tree was not clean before the probe file was written');
  fs.writeFileSync(probe, `we ${BANNED_WORDS[0]} the platform\n`, 'utf8');
  try {
    assert.equal(
      main([]), 1,
      'a file holding a banned word was written into a scanned directory and the gate still '
      + 'returned 0, so the walk, the read or the verdict is not connected to the rules',
    );
  } finally {
    fs.rmSync(probe, { force: true });
  }
  assert.equal(main([]), 0, 'the gate did not go back to green once the probe file was removed');
});

test('running the gate with the selftest asked for still reaches the scan', () => {
  // main() takes the selftest branch only when it is asked for, and it must fall through to the
  // scan afterwards rather than reporting on the selftest alone.
  assert.equal(main(['node', 'check_style.mjs', '--selftest']), 0);
});

test('the whole file exemption still covers a file nobody here writes', () => {
  /*
   * `EXEMPT` is down to one entry, a lock file, kept so that one appearing does not arrive as a
   * wall of findings about somebody else's package metadata. This repository ships none, so that
   * branch is never taken by the tree as it stands and the reason for the entry would go unchecked
   * until the day it mattered. One is written, held wrong on purpose, and removed.
   */
  const lock = path.join(ROOT, 'tests/unit/package-lock.json');
  assert.ok(EXEMPT.has('package-lock.json'), 'the exemption this test is about is gone');
  fs.writeFileSync(lock, `{ "note": "we ${BANNED_WORDS[0]} the platform" }\n`, 'utf8');
  try {
    assert.equal(
      main([]), 0,
      'a lock file holding a banned word was scanned, so the whole file exemption is not applied',
    );
  } finally {
    fs.rmSync(lock, { force: true });
  }
});

test('running the script scans the tree and reports, so the main guard is not a no op', () => {
  // The guard is the one part of the file an import cannot reach. Spelled the obvious way it never
  // matches, which would leave `node scripts/check_style.mjs` exiting 0 having done nothing, and
  // every caller would read that as a pass. execFileSync throws on a non zero exit.
  const out = execFileSync(process.execPath, ['scripts/check_style.mjs'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  });
  const scanned = Number((out.match(/scanned (\d+) files/) || [])[1]);
  assert.ok(scanned > 0, `the script ran but scanned nothing, so the guard did not fire: ${out}`);
  assert.match(out, /style gate: PASS/, 'the script did not report a verdict');
});

test('the script still runs its selftest before scanning, which is what CI invokes', () => {
  const out = execFileSync(process.execPath, ['scripts/check_style.mjs', '--selftest'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  });
  // These three are the strings scripts/readiness.mjs row R3 matches on. Changing any of them
  // silently turns that row into a permanent failure, so they are asserted from outside.
  assert.match(out, /selftest: PASS/, 'readiness R3 reads this to decide the gate proved it can fail');
  assert.match(out, /scanned (\d+) files/, 'readiness R3 reads the scanned count out of this line');
  assert.match(out, /style gate: PASS/, 'readiness R3 reads this to decide the gate passed');
});
