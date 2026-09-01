/**
 * The judge, against the two transcripts that bound it: one where every promise is kept and one
 * that a real browser actually produced.
 *
 * The pair is the point. A judge shown only the failing transcript might be a function that always
 * fails; a judge shown only the conforming one might be a function that always passes. Both are
 * asserted here, id by id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { judge, judgeBehaviour } from '../../src/judge/verdict.js';
import { BEHAVIOURS, BEHAVIOUR_IDS, headlineCounts } from '../../src/judge/behaviours.js';
import { conforming, measuredChrome152, CHROME_152_FAILURES, CHROME_152_PASSES,
  CHROME_152_INCONCLUSIVE } from '../support/transcripts.mjs';

test('a conforming transcript passes every behaviour in the catalogue', () => {
  const result = judge(conforming());
  const notPassed = result.findings.filter((f) => f.verdict !== 'pass');
  assert.deepEqual(
    notPassed.map((f) => `${f.id}: ${f.verdict} (${f.reason || f.observed})`),
    [],
    'a transcript in which every promise is kept must produce no failures and no gaps',
  );
  assert.equal(result.counts.pass, BEHAVIOURS.length);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.counts.notApplicable, 0);
  assert.equal(result.complete, true);
});

test('the measured Chrome 152 transcript fails exactly the behaviours it failed', () => {
  const result = judge(measuredChrome152());
  const failed = result.findings.filter((f) => f.verdict === 'fail').map((f) => f.id);
  const passed = result.findings.filter((f) => f.verdict === 'pass').map((f) => f.id);

  assert.deepEqual(failed, [...CHROME_152_FAILURES],
    'the set of behaviours a real browser failed is a measurement and must not drift silently');
  assert.deepEqual(passed, [...CHROME_152_PASSES]);

  // Rows the run could not conclude about. They are not passes and not failures, and after the
  // oracle rewrite P5 is honestly one of them on this page: its tool answers a broken call
  // differently, which is consistent with a refusal and with echoing the arguments.
  const abstained = result.findings.filter((f) => f.verdict === 'not-applicable').map((f) => f.id);
  assert.deepEqual(abstained, [...CHROME_152_INCONCLUSIVE],
    'the set of rows a real browser could not settle is a measurement too');
  assert.equal(result.counts.notApplicable, CHROME_152_INCONCLUSIVE.length);
  assert.equal(result.complete, false,
    'a run with an unsettled row is not complete, and saying otherwise is the fail open this gate exists to stop');
});

test('every behaviour in the catalogue has a rule that judges it', () => {
  const transcript = conforming();
  for (const id of BEHAVIOUR_IDS) {
    const finding = judgeBehaviour(id, transcript);
    assert.notEqual(finding.verdict, 'not-applicable',
      `${id} is in the catalogue but the conforming transcript could not be judged against it`);
  }
});

test('a behaviour with no observation is not-applicable and never a pass', () => {
  const empty = { meta: {}, observations: {} };
  const result = judge(empty);
  assert.equal(result.counts.pass, 0);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.counts.notApplicable, BEHAVIOURS.length);
  assert.equal(result.complete, false, 'a transcript that observed nothing is not complete');
  for (const finding of result.findings) {
    assert.equal(finding.verdict, 'not-applicable');
    assert.match(finding.reason, /no observation/);
  }
});

test('a partial transcript reports the gap rather than shrinking the report', () => {
  const transcript = conforming();
  delete transcript.observations.B1;
  delete transcript.observations.C2;
  const result = judge(transcript);

  assert.equal(result.findings.length, BEHAVIOURS.length,
    'the catalogue drives the loop, so a probe that stopped covering a row cannot make it vanish');
  assert.equal(result.counts.notApplicable, 2);
  assert.equal(result.complete, false);
  assert.equal(result.findings.find((f) => f.id === 'B1').verdict, 'not-applicable');
  assert.equal(result.findings.find((f) => f.id === 'C2').verdict, 'not-applicable');
});

test('an observation missing a field the rule needs is not-applicable, with the field named', () => {
  const transcript = conforming();
  delete transcript.observations.A1.argCount;
  const finding = judgeBehaviour('A1', transcript);
  assert.equal(finding.verdict, 'not-applicable');
  assert.match(finding.reason, /argCount/);
});

test('every finding carries what was expected, what was seen and how to reproduce it', () => {
  for (const finding of judge(measuredChrome152()).findings) {
    assert.ok(finding.expected.length > 0, `${finding.id} has no expected value`);
    assert.ok(finding.reproduce.length > 0, `${finding.id} has no reproduction command`);
    if (finding.verdict === 'fail') {
      assert.ok(finding.observed.length > 0, `${finding.id} failed without saying what was seen`);
    }
  }
});

test('an unknown behaviour id is refused rather than quietly ignored', () => {
  assert.throws(() => judgeBehaviour('Z9', conforming()), /no behaviour "Z9"/);
});

test('the headline counts are computed from the catalogue, never written down', () => {
  const counts = headlineCounts();
  assert.equal(counts.total, BEHAVIOURS.length);
  assert.equal(
    counts.yourPage + counts.specDivergence + counts.standardGap + counts.silentTrap
      + counts.byDesign + counts.holds,
    counts.total,
    'every behaviour belongs to exactly one group',
  );
  assert.equal(counts.browserSubject + counts.pageSubject, counts.total);
});

test('the environment travels with the verdict', () => {
  const result = judge(measuredChrome152());
  assert.match(result.environment.userAgent, /Chrome\/152|HeadlessChrome\/152/);
  assert.equal(result.environment.api, 'document.modelContext');
  assert.equal(result.environment.catalogueMeasuredAgainst, 'Chrome 152.0.7977.65');
});
