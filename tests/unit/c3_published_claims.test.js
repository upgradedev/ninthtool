/**
 * C3's PUBLISHED CLAIM, PINNED TO WHERE IT CAN BE MEASURED.
 *
 * THE FAILURE THIS EXISTS TO STOP HAS ALREADY HAPPENED. The catalogue entry and the README both
 * read "script registered: 0 of 4 refused, form derived: 4 of 4 refused". The second number had
 * stopped being true: run against the shipping browser today, the form half enforces the declared
 * type and the declared enum and does NOT enforce `required`, so NO declared constraint is enforced
 * on both paths. The README went further and told a story from that number, that an untouched form
 * refuses a call missing a required property. It does not.
 *
 * Nothing failed. A count typed into static prose cannot track a browser that moves, and neither
 * can a story derived from it.
 *
 * So the rule is: the per constraint split is measured on every run and printed in the row's own
 * observation. Judge facing prose describes the SHAPE of the finding and carries no count. This
 * test fails if a count comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BEHAVIOURS } from '../../src/judge/behaviours.js';
import { judge } from '../../src/judge/verdict.js';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);

/** "0 of 4", "4 of 4", "2 of 3": an enforcement tally, wherever it is written. */
const A_TALLY = /\b\d+\s+of\s+\d+\b/;

const c3 = BEHAVIOURS.find((b) => b.id === 'C3');

test('the C3 catalogue entry carries no enforcement count', () => {
  for (const field of ['measured', 'contract', 'why', 'title']) {
    const text = String(c3[field] || '');
    assert.equal(A_TALLY.test(text), false,
      `C3.${field} carries a tally: "${(text.match(A_TALLY) || [])[0]}". `
      + 'The split is measured per run and belongs in the observation, not in static prose.');
  }
});

test('the README C3 row carries no enforcement count', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const row = readme.split('\n').find((line) => line.startsWith('| C3 |'));
  assert.ok(row, 'the README no longer has a C3 row, so this test is not reading what it thinks');
  assert.equal(A_TALLY.test(row), false,
    `the README C3 row carries a tally: "${(row.match(A_TALLY) || [])[0]}"`);
});

test('the evidence table C3 row states the split it was measured with', () => {
  const evidence = fs.readFileSync(path.join(ROOT, 'docs', 'evidence.md'), 'utf8');
  const row = evidence.split('\n').find((line) => line.startsWith('| C3 |'));
  assert.ok(row, 'the evidence table no longer has a C3 row');
  // This file IS a dated snapshot of one run, so a count is allowed here and nowhere else. What is
  // not allowed is the claim the snapshot used to make.
  assert.equal(/form derived tools do\b/.test(row), false,
    'the evidence table still says the form half enforces, which the measurement contradicts');
  assert.match(row, /not `required`/,
    'the evidence table must name the constraint neither half enforces');
});

test('the judged observation is where the count lives, and it counts what was declared', () => {
  // A transcript in the shape the probe produces, with a split that differs from anything written
  // down anywhere, so a hard coded number could not pass this.
  const transcript = {
    meta: { url: 'https://x.test/', userAgent: 'node', api: 'document.modelContext' },
    observations: {
      C3: {
        constraints: [
          { name: 'required', declared: true, script: 'ignored', form: 'ignored', detail: 'd' },
          { name: 'type', declared: true, script: 'ignored', form: 'enforced', detail: 'd' },
          { name: 'enumerated', declared: true, script: 'enforced', form: 'enforced', detail: 'd' },
          { name: 'unknownProperty', declared: false, script: 'not-declared', form: 'not-declared', detail: 'd' },
        ],
        controls: {
          script: { answered: true, settled: 'resolved', errName: null, waitedMs: 1 },
          form: { answered: true, settled: 'resolved', errName: null, waitedMs: 1 },
        },
        formSchema: '{}',
        scriptPathEnforces: false,
        formPathEnforces: false,
      },
    },
    errors: [],
    scope: {},
    skipped: {},
    pageTools: [],
  };
  const finding = judge(transcript, { only: ['C3'] }).findings.find((f) => f.id === 'C3');
  assert.equal(finding.verdict, 'fail');
  // One of the three declared constraints is enforced on both halves in this fixture, and the row
  // must say so from the data rather than from anything a person typed.
  assert.match(String(finding.observed), /1 of 3 enforced on both/);
});
