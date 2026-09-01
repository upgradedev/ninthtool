/**
 * Every rule in the judge, broken once, on purpose.
 *
 * A GATE NOBODY HAS WATCHED FAIL IS NOT A GATE. This repository exists to tell people their pages
 * lie to agents, so the one thing it cannot afford is a check that reports a pass whatever it is
 * handed. Each mutation below starts from the conforming transcript, which passes everything,
 * changes one field, and requires that behaviour to turn red.
 *
 * THE STRUCTURAL ASSERTION AT THE BOTTOM IS THE IMPORTANT PART. Adding a row to the catalogue
 * without adding a mutation for it fails this file. That is deliberate: the failure mode this
 * repository is most likely to have is a new check that has never been seen to fail, and a lesson
 * written as prose in a long document does not stop its own repeat. So it is a failing test
 * instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { judgeBehaviour } from '../../src/judge/verdict.js';
import { BEHAVIOUR_IDS } from '../../src/judge/behaviours.js';
import { conforming } from '../support/transcripts.mjs';

/**
 * One mutation per behaviour. `break` receives the conforming observation for that behaviour and
 * mutates it into something that must not pass. `expect` is a fragment the observed text has to
 * carry, so a rule cannot pass this file by failing for an unrelated reason.
 */
const MUTATIONS = {
  A1: { what: 'the handler is handed only one argument',
    break: (o) => { o.argCount = 1; o.optionsTypeof = 'undefined'; o.hasSignal = false; },
    expect: /arguments\.length=1/ },

  A2: { what: 'the schema reads back as a string',
    break: (o) => { o.inputSchemaTypeof = 'string'; },
    expect: /"string"/ },

  A3: { what: 'consequentialHint does not survive registration',
    break: (o) => { o.returnedAnnotationKeys = ['readOnlyHint', 'untrustedContentHint']; },
    expect: /readOnlyHint/ },

  B1: { what: 'every refusal route either resolves or loses the reason',
    break: (o) => {
      o.routes = [
        { route: 'return { isError: true }', settled: 'resolved', errName: null, pageMessageSurvived: false },
        { route: 'throw Error', settled: 'rejected', errName: 'UnknownError', pageMessageSurvived: false },
      ];
    },
    expect: /resolved/ },

  B2: { what: 'an isError envelope resolves',
    break: (o) => { o.settled = 'resolved'; },
    expect: /reads success/ },

  B3: { what: 'annotations are dropped without an error',
    break: (o) => { o.sentAnnotationKeys = ['readOnlyHint', 'destructiveHint']; },
    expect: /destructiveHint/ },

  B4: { what: 'a declarative tool carries no annotations',
    break: (o) => { o.annotationsTypeof = 'undefined'; },
    expect: /undefined/ },

  B5: { what: 'text and data are indistinguishable to the caller',
    break: (o) => { o.objectReturn = { typeofValue: 'string', parsesAsJson: true }; },
    expect: /string/ },

  C1: { what: 'a missing required property resolves and leaks a stale value',
    break: (o) => { o.settled = 'resolved'; o.handlerSawStaleValue = true; o.staleValue = 'M. Okafor'; },
    expect: /M\. Okafor/ },

  C2: { what: 'a signal on the descriptor never withdraws the tool',
    break: (o) => { o.onDescriptor = { presentBefore: true, presentAfter: true }; },
    expect: /does NOT withdraw/ },

  C3: { what: 'a constraint is enforced on one half only',
    break: (o) => { o.constraints[0].script = 'ignored'; },
    expect: /enforced on one half only/ },

  // The fail open an audit found: agreement between two absences used to read as conformance.
  C3b: { id: 'C3', what: 'a constraint is enforced by neither half',
    break: (o) => { o.constraints.forEach((c) => { c.script = 'ignored'; c.form = 'ignored'; }); },
    expect: /enforced by neither/ },

  C3c: { id: 'C3', what: 'the schema declares none of the constraints compared',
    break: (o) => { o.constraints.forEach((c) => { c.declared = false; }); },
    expectNotApplicable: /declares none of the constraints/ },

  C4: { what: 'the tool never settles',
    break: (o) => { o.settled = 'timeout'; o.waitedMs = 2502; },
    expect: /2502 ms/ },

  D1: { what: 'no event fires on withdrawal',
    break: (o) => { o.onWithdraw = 0; },
    expect: /0 on withdraw/ },

  D2: { what: 'the browser synthesises nothing beyond bare properties',
    break: (o) => { o.schema = '{"type":"object","properties":{"a":{"type":"string"}}}'; },
    expect: /nothing beyond bare properties/ },
  P1: { what: 'a tool carries no annotations at all',
    break: (o) => { o.withoutAnnotations = ['your_form_tool']; },
    expect: /your_form_tool/ },

  P2: { what: 'a schema does not parse',
    break: (o) => { o.unusableSchemas = ['your_tool: schema did not parse, Unexpected token']; },
    expect: /did not parse/ },

  P3: { what: 'a parameter has no description',
    break: (o) => { o.undescribedParams = ['your_tool.customer_id']; },
    expect: /customer_id/ },

  P4: { what: 'a frame put a tool on your surface',
    break: (o) => { o.fromOtherDocuments = ['widget_tool (origin https://you.example)']; },
    expect: /widget_tool/ },

  P5: { what: 'a tool ignores its own required list',
    break: (o) => { o.ignored = ['your_tool: omitting customer_id changed nothing in the answer']; },
    expect: /changed nothing/ },

  P6: { what: 'a read only tool moved state another one can see',
    break: (o) => { o.moved = ['read_state changed what read_notes answers']; },
    expect: /changed what read_notes answers/ },

  // P5 has a second mutation, because the defect an audit found was not a wrong verdict but a
  // verdict reached with nothing demonstrated. Refusing nothing and ignoring nothing must not pass.
  P5b: { id: 'P5', what: 'nothing is demonstrated either way',
    break: (o) => { o.refused = []; o.ignored = []; o.inconclusive = ['your_tool: answered differently']; },
    expectNotApplicable: /nothing was demonstrated/ },

  P6b: { id: 'P6', what: 'the oracles do not answer the same way twice',
    break: (o) => { o.stable = false; o.unstable = ['read_state']; },
    expectNotApplicable: /same way twice/ },
};

for (const key of Object.keys(MUTATIONS)) {
  const mutation = MUTATIONS[key];
  const id = mutation.id || key;

  test(`${key} passes the conforming transcript`, () => {
    const finding = judgeBehaviour(id, conforming());
    assert.equal(finding.verdict, 'pass',
      `${id} cannot be shown to fail until it has first been shown to pass. Got: ${finding.reason || finding.observed}`);
  });

  test(`${key} does not pass when ${mutation.what}`, () => {
    const transcript = conforming();
    mutation.break(transcript.observations[id]);
    const finding = judgeBehaviour(id, transcript);

    if (mutation.expectNotApplicable) {
      // Some defects are not "the promise was broken" but "nothing was established". Those must
      // abstain with the reason, and abstaining is never a pass either.
      assert.equal(finding.verdict, 'not-applicable',
        `${key} should have abstained rather than scoring. Got ${finding.verdict}.`);
      assert.match(finding.reason, mutation.expectNotApplicable);
      return;
    }
    assert.equal(finding.verdict, 'fail',
      `${key} was handed a broken observation and did not fail. A rule that cannot fail is not a rule.`);
    assert.match(finding.observed, mutation.expect,
      `${key} failed, but not for the reason the mutation introduced`);
  });
}

test('every behaviour in the catalogue has a mutation proving it can fail', () => {
  const covered = Object.keys(MUTATIONS).map((k) => MUTATIONS[k].id || k);
  const missing = BEHAVIOUR_IDS.filter((id) => !covered.includes(id));
  assert.deepEqual(missing, [],
    'a behaviour was added to the catalogue with no proof that its rule can fail. '
    + 'Add a mutation to tests/unit/verdict_mutations.test.js before shipping it.');

  const orphans = covered.filter((id) => !BEHAVIOUR_IDS.includes(id));
  assert.deepEqual(orphans, [],
    'a mutation names a behaviour that is no longer in the catalogue');
});
