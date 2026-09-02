/**
 * The readiness self test has to prove the rows, not a copy of them.
 *
 * WHAT WENT WRONG, AND WHY A TEST NOW SITS ON IT. The self test used to hold a hand written
 * expression per case: `{ ok: 404 === 200 }` stood in for "row M5 saw a 404". Nothing tied those
 * expressions to the rows they were named after. Row M5's `if (response.status !== 200)` was changed
 * to `if (false)`, which makes the row incapable of failing on any input, and `--selftest` still
 * printed "PASS, all 19 automated rows were seen to fail on a deliberate input". The sentence was
 * false and nothing in the repository could tell.
 *
 * Two things had to change and both are asserted below. Every automated row is split into a
 * `gather` that does the input and output and a pure `decide` that holds the judgement, and the
 * self test looks each row up by id and calls its real `decide`. The last test here does the
 * mutation in memory: it replaces a row's judgement with one that always passes and requires the
 * self test to go red, which is the property the old design did not have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ROWS, decideM8, healthyDrive, selftestCases, greenBaselines, runSelftest } from '../../scripts/readiness.mjs';
import { STANDING_TOOLS, FINDINGS_TOOL, MAY_ABSTAIN, surfaceAtRest, surfaceDuringRun } from '../../scripts/readiness_config.mjs';
import { BEHAVIOURS } from '../../src/judge/behaviours.js';
import { measuredChrome152 } from '../support/transcripts.mjs';

const automated = ROWS.filter((row) => row.kind !== 'owner-gated');

test('every automated row separates what it gathers from what it decides', () => {
  assert.ok(automated.length >= 13, 'the gate has lost rows');
  for (const row of automated) {
    assert.equal(typeof row.gather, 'function', `${row.id} has no gather`);
    assert.equal(typeof row.decide, 'function',
      `${row.id} has no decide, so the self test has nothing of its own to call and would have to `
      + 'go back to imitating the row');
    assert.equal(typeof row.run, 'undefined',
      `${row.id} still carries a combined run, which is where judgement hides from the self test`);
  }
});

test('every automated row accepts a healthy input, or its failures prove nothing', async () => {
  const green = await greenBaselines();
  const covered = new Set(green.map(([rowId]) => rowId));
  for (const row of automated) assert.ok(covered.has(row.id), `${row.id} has no healthy input`);
  for (const [rowId, input] of green) {
    const row = ROWS.find((r) => r.id === rowId);
    const verdict = row.decide(input);
    assert.equal(verdict.ok, true, `${rowId} rejected its healthy input: ${verdict.evidence}`);
  }
});

test('the self test passes, and covers every automated row by id', async () => {
  const { problems, cases, rows } = await runSelftest();
  assert.deepEqual(problems, [], 'the readiness self test reports problems');
  assert.equal(rows, automated.length);
  assert.ok(cases >= automated.length, 'there are fewer cases than rows');

  const table = await selftestCases();
  const covered = new Set(table.map(([, rowId]) => rowId));
  for (const row of automated) {
    assert.ok(covered.has(row.id), `no case names row ${row.id}`);
  }
  for (const [label, rowId] of table) {
    assert.ok(ROWS.some((row) => row.id === rowId), `"${label}" names row ${rowId}, which does not exist`);
  }
});

test('mutating a row judgement so it cannot fail makes the self test fail', async () => {
  // The proof the old design could not give. Each row's judgement is replaced, in memory, with one
  // that returns a pass whatever it is handed, which is exactly what the `if (false)` mutation did
  // to the shipped file. The self test has to notice, by name, every time.
  for (const id of ['M5', 'M8', 'R2', 'R5']) {
    const row = ROWS.find((r) => r.id === id);
    const real = row.decide;
    row.decide = () => ({ ok: true, evidence: 'mutated so this row can never fail' });
    try {
      const { problems } = await runSelftest();
      assert.ok(problems.some((line) => line.includes(`Row ${id} cannot fail`)),
        `row ${id} was made unfailable and the self test still reported no problem with it`);
    } finally {
      row.decide = real;
    }
  }
  const { problems } = await runSelftest();
  assert.deepEqual(problems, [], 'the rows were not put back');
});

test('the healthy browser row baseline is green, or every mutation below proves nothing', () => {
  const baseline = decideM8(healthyDrive(measuredChrome152()));
  assert.equal(baseline.ok, true, baseline.evidence);
});

test('the browser row catches a verdict swap the totals cannot see', () => {
  // THE DEFECT THIS ROW USED TO HAVE. It compared three totals. Rendering A2 broken and B2 kept
  // while the observations say the opposite leaves all three totals untouched, so the page could
  // show a reader the wrong verdict for a named behaviour and the gate would agree with it.
  const healthy = healthyDrive(measuredChrome152());
  const cards = healthy.cardVerdicts.map((card) => ({ ...card }));
  const aFail = cards.find((c) => c.verdict === 'fail');
  const aPass = cards.find((c) => c.verdict === 'pass');
  const swappedIds = [aFail.id, aPass.id];
  aFail.verdict = 'pass';
  aPass.verdict = 'fail';

  const totalsOf = (list) => ({
    fail: list.filter((c) => c.verdict === 'fail').length,
    pass: list.filter((c) => c.verdict === 'pass').length,
    notApplicable: list.filter((c) => c.verdict === 'not-applicable').length,
  });
  assert.deepEqual(totalsOf(cards), totalsOf(healthy.cardVerdicts),
    'the swap has to leave the totals identical or it proves nothing about totals');

  const verdict = decideM8({ ...healthy, cardVerdicts: cards });
  assert.equal(verdict.ok, false, 'a per behaviour verdict swap was not caught');
  for (const id of swappedIds) {
    assert.ok(verdict.evidence.includes(id), `the evidence does not name ${id}, so nobody could fix it`);
  }
});

test('abstention is allowed only for the ids on the declared list, with no numeric slack', () => {
  // THE FLOOR THIS REPLACES. The row accepted any run where at least `BEHAVIOURS.length - 2` rows
  // reached a verdict, so ANY two rows could go quiet for any reason and it stayed green. The live
  // run legitimately leaves one row unsettled, so the allowance had to exist; it is a list of ids
  // and not a count, and this is the test that says so.
  const live = measuredChrome152();
  const asLive = decideM8(healthyDrive(live));
  assert.equal(asLive.ok, true, `the declared abstention is not accepted: ${asLive.evidence}`);

  const abstainers = judgeAbstainers(healthyDrive(live));
  assert.deepEqual(abstainers, Object.keys(MAY_ABSTAIN).sort(),
    'the live transcript abstains on something other than the declared list');

  const alsoQuiet = JSON.parse(JSON.stringify(live));
  delete alsoQuiet.observations.A1;
  const second = decideM8(healthyDrive(alsoQuiet));
  assert.equal(second.ok, false,
    'a SECOND unsettled row was accepted, which is the numeric floor coming back');
  assert.ok(second.evidence.includes('A1'), 'the row that went quiet is not named');
});

test('the browser row refuses a result it cannot bind to the run the page rendered', () => {
  const healthy = healthyDrive(measuredChrome152());
  assert.equal(decideM8({ ...healthy, observeCalls: 2 }).ok, false,
    'a second observation after the render was accepted as the same run');
  assert.equal(decideM8({ ...healthy, runIdOnPage: null }).ok, false,
    'a page that does not say which run it is showing was accepted');
  const stale = {
    ...healthy,
    findings: {
      ...healthy.findings,
      text: JSON.stringify({ run: { id: 'run-9-9' }, findings: JSON.parse(healthy.findings.text).findings }),
    },
  };
  assert.equal(decideM8(stale).ok, false, 'a tool answer from a different run was accepted');
  assert.equal(decideM8({ ...healthy, findings: { called: true, error: null, text: 'not json' } }).ok, false,
    'a malformed tool answer was accepted');

  // THE SHAPE THE BROWSER ACTUALLY HANDS BACK. The handler returns a content envelope and Chrome
  // resolves executeTool with that envelope serialised, so the payload is one parse further in.
  // Reading it at the wrong depth made a working tool look like it answered nothing at all.
  const enveloped = {
    ...healthy,
    findings: {
      called: true,
      error: null,
      text: JSON.stringify({ content: [{ type: 'text', text: healthy.findings.text }] }),
    },
  };
  assert.equal(decideM8(enveloped).ok, true, decideM8(enveloped).evidence);
  const emptyEnvelope = {
    ...healthy,
    findings: {
      called: true,
      error: null,
      text: JSON.stringify({ content: [{ type: 'text', text: '{ not json' }] }),
    },
  };
  assert.equal(decideM8(emptyEnvelope).ok, false,
    'unwrapping the envelope must not swallow a payload that is not readable');
  assert.equal(decideM8({ ...healthy, findings: { called: false, error: null, text: null } }).ok, false,
    'a tool that was never executed was accepted as a proved capability');
});

test('the browser row compares the tool surface as an exact multiset at all three moments', () => {
  const healthy = healthyDrive(measuredChrome152());
  assert.equal(decideM8({
    ...healthy, toolsBefore: surfaceAtRest().filter((n) => n !== STANDING_TOOLS[0]),
  }).ok, false, 'a standing tool missing before the run was accepted');
  assert.equal(decideM8({ ...healthy, toolsBefore: [...STANDING_TOOLS] }).ok, false,
    'the subject frame tools vanishing from the surface was accepted');
  assert.equal(decideM8({
    ...healthy, toolsDuring: [...surfaceDuringRun(), 'nt_probe_leftover'],
  }).ok, false, 'a stray tool on the surface during the run was accepted');
  assert.equal(decideM8({ ...healthy, toolsAfter: surfaceDuringRun() }).ok, false,
    'the conditional tool never being withdrawn was accepted');
  const rightCountWrongNames = surfaceAtRest().map(() => STANDING_TOOLS[0]);
  assert.equal(decideM8({ ...healthy, toolsBefore: rightCountWrongNames }).ok, false,
    'a surface with the right COUNT and the wrong names was accepted');
  assert.deepEqual(surfaceDuringRun(), [...surfaceAtRest(), FINDINGS_TOOL],
    'the only difference the run may make to the surface is the conditional tool');
});

test('the browser row fails on a console error before the visitor touches anything', () => {
  const healthy = healthyDrive(measuredChrome152());
  assert.equal(decideM8({ ...healthy, loadConsoleErrors: ['console.error: boom'] }).ok, false);
  // STATED LIMITATION, ASSERTED SO IT CANNOT BE FORGOTTEN. Errors raised while the audit runs are
  // the browser logging the refusals the audit provokes on purpose, so they are printed and not
  // gated. If that ever becomes gateable, this assertion is the thing that has to change.
  const duringRun = decideM8({ ...healthy, runConsoleErrors: ['log error: WebMCP tool execution failed'] });
  assert.equal(duringRun.ok, true, 'the audit provoking a refusal is not a defect in the page');
  assert.ok(duringRun.evidence.includes('while the audit ran'),
    'an ungated error must still be printed, or it is being hidden rather than scoped');
  assert.equal(decideM8({
    ...healthy, narrow: { viewport: 375, scrollWidth: 411, sideScroll: true },
  }).ok, false, 'sideways scroll at 375 px was accepted');
  assert.equal(decideM8({
    ...healthy, wide: { viewport: 1280, scrollWidth: 1460, sideScroll: true },
  }).ok, false, 'sideways scroll at 1280 px was accepted, and it was never even measured before');
});

test('the browser row requires the whole catalogue, in the render and in the judgement', () => {
  const healthy = healthyDrive(measuredChrome152());
  assert.equal(decideM8({ ...healthy, cards: BEHAVIOURS.length - 1 }).ok, false);
  assert.equal(decideM8({ ...healthy, cardVerdicts: healthy.cardVerdicts.slice(1) }).ok, false);
});

/** The ids the judge left unsettled for a drive input, read back the way the row reads them. */
function judgeAbstainers(drive) {
  return drive.cardVerdicts
    .filter((card) => card.verdict === 'not-applicable')
    .map((card) => card.id)
    .sort();
}
