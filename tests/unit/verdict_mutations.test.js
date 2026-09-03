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

  // Breaks what B3 READS. It used to shorten sentAnnotationKeys, which the row no longer consults
  // now that it judges its own three names rather than everything that went out.
  B3: { what: 'annotations are dropped without an error',
    break: (o) => { o.returnedAnnotationKeys = ['readOnlyHint', 'untrustedContentHint']; },
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

  // C4 leaves `pass` as BY DESIGN, not as a failure. The pause is intended and its own catalogue
  // entry says so; what the row reports is that nothing on the surface distinguishes a tool which
  // waits for a person from one that answers.
  C4: { what: 'the tool never settles',
    break: (o) => { o.settled = 'timeout'; o.waitedMs = 2502; },
    expectByDesign: true,
    expect: /2502 ms/ },

  D1: { what: 'no event fires on withdrawal',
    break: (o) => { o.onWithdraw = 0; },
    expect: /0 on withdraw/ },

  D2: { what: 'the browser synthesises nothing beyond bare properties',
    break: (o) => { o.schema = '{"type":"object","properties":{"a":{"type":"string"}}}'; },
    expect: /missing: the controls the markup declares/ },
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
    if (mutation.expectByDesign) {
      /*
       * A THIRD WAY TO LEAVE `pass`. Some outcomes are observed, deliberate, and nobody's broken
       * promise: the row still has to STOP passing when the platform does the thing, which is what
       * this proves, but calling it a failure would count somebody else's design decision as a
       * defect. It is never a pass, so a rule cannot hide behind this.
       */
      assert.equal(finding.verdict, 'by-design',
        `${key} should have reported by-design rather than ${finding.verdict}.`);
      assert.match(finding.observed, mutation.expect,
        `${key} left pass, but not for the reason the mutation introduced`);
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

/* ------------------------------------------------------------ D2, one mutation per tightening */

/*
 * WHY EACH OF THESE EXISTS SEPARATELY.
 *
 * D2 read `unique.length >= 3` against a promise of four, so the row carried a spare life: measured
 * against the fixture's own schema, dropping ALL the bounds, the enum, ALL the descriptions, or the
 * required array each still returned PASS. Nine deliberately broken schemas, nine passes.
 *
 * Raising the threshold to four was not enough, because the counting was OR-folded across
 * properties. So each feature is now tied to the markup construct that produces it, and each of
 * those tightenings gets its own mutation. Without them, reverting one `&&` to `||`, or "every
 * property" to "any property", leaves the whole suite green and the tightening is a gate nobody has
 * watched fail.
 */
const D2_FIXTURE_SCHEMA = () => ({
  type: 'object',
  properties: {
    witness_name: { type: 'string', description: 'Full name.' },
    age: { type: 'number', minimum: 18, maximum: 120, multipleOf: 1, description: 'Age in years.' },
    severity: { type: 'string', enum: ['dent', 'write_off'], description: 'How bad.' },
  },
  required: ['witness_name'],
});

const d2 = (mutate, toolName = 'nt_form_answers') => {
  const schema = D2_FIXTURE_SCHEMA();
  if (mutate) mutate(schema);
  return judgeBehaviour('D2', { observations: { D2: { schema, toolName } } });
};

test('D2 passes the fixture schema as the browser actually synthesises it', () => {
  const finding = d2(null);
  assert.equal(finding.verdict, 'pass', finding.observed);
  assert.match(finding.observed, /all four synthesised/);
});

test('D2 fails when only one half of a numeric bound is lost', () => {
  // The `||` that was there before: minimum OR maximum counted as "numeric bounds", so a browser
  // that dropped the max attribute scored the feature as present.
  const finding = d2((s) => { delete s.properties.age.maximum; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /min 18 and max 120 on age/,
    'the report must name the control and the values the markup declares, not just "bounds"');
});

test('D2 fails when descriptions survive on some controls but not all', () => {
  // Every control in the fixture carries toolparamdescription. "Any property has one" was the old
  // test, so a browser honouring the attribute on one control in three scored a pass.
  const finding = d2((s) => {
    delete s.properties.age.description;
    delete s.properties.severity.description;
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /age, severity carry none/);
});

test('D2 fails when every feature is piled onto one property', () => {
  // Four features come from four markup constructs. One property carrying a bound, an enum and a
  // description is one control, not three, and it used to score four of four.
  const finding = d2((s) => {
    s.properties = { only: { type: 'string', minimum: 1, maximum: 2, enum: ['x'], description: 'd' } };
    s.required = ['only'];
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  // The exact contract subsumes the old different-controls rule: piling everything onto one
  // property means the markup's own controls are absent.
  assert.match(finding.observed, /the controls the markup declares/);
});

test('D2 fails when required names something that is not a control', () => {
  const finding = d2((s) => { s.required = ['not_a_control']; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /witness_name in the required list/,
    'the report must name the control whose input carries the required attribute');
});

test('D2 abstains on a form this repository did not write', () => {
  /*
   * THE FALSE ACCUSATION THIS AVOIDS. The probe falls back to whatever declarative tool a page
   * publishes, and D2's subject is the BROWSER. On a stranger's form with no number input, demanding
   * numeric bounds would report a browser defect for markup the page never wrote. The row can only
   * be decided where the markup is known in advance, which is the bundled fixture.
   */
  const finding = d2(null, 'somebody_elses_form');
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /known in advance/);
});

test('the fixture tool name the judge scopes D2 to is the one the probe looks for', async () => {
  // The judge declares this constant itself so it never imports the probe. That duplication is only
  // safe while something asserts the two spellings agree.
  const { FIXTURE_FORM_ANSWERS } = await import('../../src/probe/observe.js');
  const finding = d2(null, FIXTURE_FORM_ANSWERS);
  assert.equal(finding.verdict, 'pass',
    `the judge scopes D2 to a different tool name than the probe reads: ${finding.observed}`);
});

/* ---------------------------------------------------- P6, a control that nothing answered */

/*
 * P6 USED TO PASS ON A RUN IN WHICH NOTHING WAS EVER READ.
 *
 * Its only precondition was that two control reads AGREE. But the probe normalises every
 * non-resolved outcome to a constant, so two tools that reject every call produce two identical
 * reads, an empty `moved`, and a confident pass. Reproduced end to end against a fake host: both
 * all-reject and all-timeout gave verdict=pass, complete=true, observed "2 read only tools, stable
 * across a control read, and none changed what another answers".
 *
 * Stability of an error string is not evidence that nothing moved. It is evidence that nothing was
 * read. The row now needs at least two oracles that actually answered in BOTH control reads.
 *
 * TWO, not one, and that is the row's own arity precondition rather than a taste. The observable
 * set is the pairs (caller, oracle) where caller is not oracle and both answered; with one answered
 * oracle that set is empty, so `moved` could not be non-empty whatever the page did.
 */
const p6 = (over) => judgeBehaviour('P6', {
  observations: {
    P6: {
      oracleCount: 2,
      oracles: ['read_state', 'read_notes'],
      stable: true,
      unstable: [],
      moved: [],
      selfChanged: [],
      controlAnswered: ['read_state', 'read_notes'],
      controlUnanswered: [],
      ...over,
    },
  },
});

test('P6 passes when two oracles answered and neither moved the other', () => {
  const finding = p6({});
  assert.equal(finding.verdict, 'pass', finding.observed);
  assert.match(finding.observed, /2 of 2 read only tools returned something/);
});

test('P6 abstains when every oracle rejected the control call', () => {
  const finding = p6({
    controlAnswered: [],
    controlUnanswered: ['read_state: rejected then rejected', 'read_notes: rejected then rejected'],
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /rejected then rejected/,
    'the abstention must name what actually happened, not just that it abstained');
});

test('P6 abstains when every oracle timed out, and says so distinctly', () => {
  const finding = p6({
    controlAnswered: [],
    controlUnanswered: ['read_state: timeout then timeout', 'read_notes: timeout then timeout'],
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /timeout then timeout/,
    'all-timeout and all-reject must stay distinguishable in the report');
});

test('P6 abstains when only one oracle answered, because a differential needs two', () => {
  // The pair set is empty with one answered oracle, so the row would pass by construction.
  const finding = p6({
    controlAnswered: ['read_state'],
    controlUnanswered: ['read_notes: rejected then rejected'],
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /at least two/);
});

test('P6 counts what answered, not what the page published', () => {
  // A page publishing ten read only tools of which two answer is a two-tool differential, and the
  // sentence has to say two. It used to quantify over every published tool.
  const finding = p6({
    oracleCount: 10,
    controlAnswered: ['read_state', 'read_notes'],
    controlUnanswered: ['eight_others: rejected then rejected'],
  });
  assert.equal(finding.verdict, 'pass', finding.observed);
  assert.match(finding.observed, /2 of 10 read only tools returned something/);
  assert.match(finding.observed, /Not counted: eight_others/);
});

test('P6 still fails when an answering tool moved what another answers', () => {
  const finding = p6({ moved: ['read_state changed what read_notes answers'] });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /changed what read_notes answers/);
});

/* -------------------------------------------------- C3, only constraints the schema declares */

/*
 * C3 COUNTED A CONSTRAINT NOBODY DECLARED.
 *
 * The probe derived `required`, `type` and `enumerated` from the captured schema and then wrote
 * `unknownProperty: true` as a LITERAL. A JSON Schema forbids extra properties only when it says
 * `additionalProperties: false`, and the form derived schema Chrome synthesises does not say it. So
 * the row sent an undeclared property to both halves, watched what happened, and reported the
 * result as a fourth constraint. Measured live after the fix: three declared, not four.
 *
 * These pin the derivation, because a literal is exactly the kind of thing that reads as a fact.
 */
const c3 = (constraints, extra = {}) => judgeBehaviour('C3', {
  observations: {
    C3: {
      constraints,
      // Both halves answered a schema valid call. Without this the row abstains, correctly, because
      // a half that refuses everything cannot have its refusals attributed to a constraint.
      controls: {
        script: { answered: true, settled: 'resolved', errName: null, waitedMs: 2 },
        form: { answered: true, settled: 'resolved', errName: null, waitedMs: 4 },
      },
      scriptPathEnforces: false,
      formPathEnforces: true,
      ...extra,
    },
  },
});

const declared = (name, script, form) => ({ name, declared: true, script, form, detail: `${name}: ${script}/${form}` });
const notDeclared = (name) => ({
  name, declared: false, script: 'not-declared', form: 'not-declared',
  detail: 'the schema does not express this constraint',
});

test('C3 counts only the constraints the captured schema actually expresses', () => {
  const finding = c3([
    declared('required', 'ignored', 'enforced'),
    declared('type', 'ignored', 'enforced'),
    declared('enumerated', 'ignored', 'enforced'),
    notDeclared('unknownProperty'),
  ]);
  assert.match(finding.observed, /of 3\b/,
    `the row is still counting a constraint nobody declared: ${finding.observed}`);
  assert.ok(!/of 4\b/.test(finding.observed), finding.observed);
});

test('C3 counts four when a schema really does forbid extra properties', () => {
  // The derivation has to work in both directions, or it is just a different hardcoded answer.
  const finding = c3([
    declared('required', 'ignored', 'enforced'),
    declared('type', 'ignored', 'enforced'),
    declared('enumerated', 'ignored', 'enforced'),
    declared('unknownProperty', 'ignored', 'enforced'),
  ]);
  assert.match(finding.observed, /of 4\b/, finding.observed);
});

test('C3 still fails when one half enforces and the other does not', () => {
  const finding = c3([
    declared('required', 'ignored', 'enforced'),
    declared('type', 'ignored', 'enforced'),
    declared('enumerated', 'ignored', 'enforced'),
    notDeclared('unknownProperty'),
  ]);
  assert.equal(finding.verdict, 'fail', finding.observed);
});

test('the probe derives the fourth constraint rather than asserting it', async () => {
  // THE SOURCE-LEVEL GUARD. The defect was one word: `unknownProperty: true`. A transcript fixture
  // cannot catch that, because a fixture is written by hand and would simply repeat the literal.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const raw = fs.readFileSync(path.join(here, '../../src/probe/observe.js'), 'utf8');
  // COMMENTS STRIPPED FIRST. The comment explaining this very fix quotes the old literal, so a
  // plain substring search matched the explanation and went red against correct code. A gate that
  // reads prose is a gate that reports on prose.
  const code = raw.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.match(code, /unknownProperty:\s*formSchema\.additionalProperties === false/,
    'unknownProperty must be read off the schema, not asserted');
  assert.ok(!/unknownProperty:\s*true\b/.test(code),
    'a literal true is back, so the row counts a constraint nobody declared');
});

/* ------------------------------------------- C1, the read the answer could not show us */

/*
 * REJECT-AFTER-READ WAS A PASS.
 *
 * C1 held on `settled === 'rejected'` alone, and the leak only ever reached the judge through the
 * ECHOED ANSWER. A rejected call has no answer, so a handler that was handed the stale value and
 * then rejected arrived as `handlerSawStaleValue: false` and scored a clean pass.
 *
 * That is the worst shape of this defect and it was the one shape the row could not see. The data
 * reached the handler, which is where it can be logged, forwarded or acted on, and refusing
 * afterwards does not take it back.
 *
 * The fixture now records what it was handed the moment it was handed it, before anything resolves.
 */
const c1 = (over) => judgeBehaviour('C1', {
  observations: {
    C1: {
      settled: 'rejected',
      handlerSawStaleValue: false,
      staleValue: null,
      handlerTelemetry: 'read',
      handlerCallsObserved: 1,
      ...over,
    },
  },
});

test('C1 passes only when the call was refused AND the handler saw nothing stale', () => {
  const finding = c1({});
  assert.equal(finding.verdict, 'pass', finding.observed);
});

test('C1 fails when the handler read the stale value and rejected afterwards', () => {
  // THE FALSE PASS. Under the old rule this was indistinguishable from a clean refusal.
  const finding = c1({ handlerSawStaleValue: true, staleValue: 'M. Okafor' });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /Refusing afterwards does not unread it/,
    'the report must say why a rejection did not save it');
});

test('C1 fails when the call succeeded and carried the stale value back', () => {
  const finding = c1({ settled: 'resolved', handlerSawStaleValue: true, staleValue: 'M. Okafor' });
  assert.equal(finding.verdict, 'fail', finding.observed);
});

test('C1 abstains when the page cannot report what its handler was handed', () => {
  // FAIL CLOSED. A rejection alone does not settle it, because a handler can read and refuse.
  const finding = c1({ handlerTelemetry: 'unavailable' });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /read a value and refuse afterwards/);
});

test('C1 abstains when the telemetry field is missing entirely', () => {
  // The same fail-open in a new field: an omitted key must not read as "nothing leaked".
  const finding = judgeBehaviour('C1', {
    observations: { C1: { settled: 'rejected', handlerSawStaleValue: false, staleValue: null } },
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
});

/* ---------------------------------------- C3, a refusal from a half that refuses everything */

/*
 * C3 SCORED A DEAD SERVICE AS FULL ENFORCEMENT.
 *
 * It read one bit per call, `settled === 'rejected'`, and called it `enforced`. Reproduced against
 * a host that rejects every call with SERVICE_UNAVAILABLE:
 *
 *   VERDICT : pass, "3 of 3 enforced on both"
 *
 * on a run where no schema was ever looked at, and indistinguishable from a host that really
 * enforces. Message matching cannot rescue it: row B1 measured that this browser rejects as
 * UnknownError with the page's reason erased, so there is no text to read a constraint out of.
 *
 * The probe now sends each half a schema valid call FIRST. A half that will not answer that has
 * refused for a reason of its own.
 */
const c3control = (over) => {
  const enforced = (name) => ({ name, declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' });
  return judgeBehaviour('C3', {
    observations: {
      C3: {
        constraints: [enforced('required'), enforced('type'), enforced('enumerated')],
        controls: {
          script: { answered: true, settled: 'resolved', errName: null, waitedMs: 2 },
          form: { answered: true, settled: 'resolved', errName: null, waitedMs: 4 },
        },
        scriptPathEnforces: true,
        formPathEnforces: true,
        ...over,
      },
    },
  });
};

test('C3 passes when every declared constraint is enforced and both controls answered', () => {
  const finding = c3control({});
  assert.equal(finding.verdict, 'pass', finding.observed);
  assert.match(finding.observed, /both halves answered the schema valid control/);
});

test('C3 abstains when the valid control is refused too, on both halves', () => {
  // THE REPRODUCTION. Every call rejected, including the one that breaks nothing.
  const finding = c3control({
    controls: {
      script: { answered: false, settled: 'rejected', errName: 'SERVICE_UNAVAILABLE', waitedMs: 1 },
      form: { answered: false, settled: 'rejected', errName: 'SERVICE_UNAVAILABLE', waitedMs: 1 },
    },
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /SERVICE_UNAVAILABLE/);
  assert.match(finding.reason, /breaking nothing/);
});

test('C3 abstains when only one half refuses its control', () => {
  // Half a control is not a control. The other half's refusals are still unattributable.
  const finding = c3control({
    controls: {
      script: { answered: true, settled: 'resolved', errName: null, waitedMs: 2 },
      form: { answered: false, settled: 'rejected', errName: 'UnknownError', waitedMs: 1 },
    },
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /form half/);
});

test('C3 abstains when a control times out rather than answering', () => {
  const finding = c3control({
    controls: {
      script: { answered: false, settled: 'timeout', errName: null, waitedMs: 2500 },
      form: { answered: true, settled: 'resolved', errName: null, waitedMs: 4 },
    },
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
  assert.match(finding.reason, /timeout/);
});

test('C3 fails when only one of the declared constraints is genuinely enforced', () => {
  const finding = c3control({
    constraints: [
      { name: 'required', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
      { name: 'type', declared: true, script: 'ignored', form: 'ignored', detail: 'both accepted it' },
      { name: 'enumerated', declared: true, script: 'ignored', form: 'ignored', detail: 'both accepted it' },
    ],
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /1 of 3 enforced on both/);
  assert.match(finding.observed, /enforced by neither: type, enumerated/);
});

test('C3 abstains rather than scoring a constraint it could not attribute', () => {
  // `unattributable` is what the probe records for a half whose control failed. It must never read
  // as enforcement, and it must not be silently counted as a plain failure either.
  const finding = c3control({
    constraints: [
      { name: 'required', declared: true, script: 'unattributable', form: 'unattributable', detail: 'the control failed' },
      { name: 'type', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
      { name: 'enumerated', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
    ],
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /could not be attributed/);
});

test('C3 requires the controls field, so an omitted one cannot read as clean', () => {
  const finding = judgeBehaviour('C3', {
    observations: {
      C3: {
        constraints: [{ name: 'required', declared: true, script: 'enforced', form: 'enforced', detail: 'x' }],
        scriptPathEnforces: true,
        formPathEnforces: true,
      },
    },
  });
  assert.equal(finding.verdict, 'not-applicable', finding.observed);
});

/* ------------------------------------- D2, the right shapes on the RIGHT controls */

/*
 * A WHOLLY UNRELATED SCHEMA USED TO PASS.
 *
 * D2 knew which shapes it wanted and never checked they were on the right controls, so this scored
 * "all four synthesised":
 *
 *   { totally_wrong: { minimum: -999, maximum: -1, description: 'nonsense' },
 *     also_wrong:    { enum: ['banana'], description: 'nonsense' } }, required: ['totally_wrong']
 *
 * A bounded property, an enum on a different one, a description on each, a required list naming a
 * real property: the whole of the old test, and nothing to do with the fixture's markup.
 *
 * The row is about what the browser builds from markup KNOWN IN ADVANCE, so it is compared against
 * that markup. One mutation per field below, plus the unrelated schema.
 */
const D2_REAL = () => ({
  type: 'object',
  properties: {
    witness_name: { type: 'string', description: 'Full name of the witness to the incident.' },
    age: { type: 'number', minimum: 18, maximum: 120, multipleOf: 1, description: 'Age in years.' },
    severity: { type: 'string', enum: ['dent', 'write_off'], description: 'How bad the damage is.' },
  },
  required: ['witness_name'],
});
const d2real = (mutate) => {
  const schema = D2_REAL();
  if (mutate) mutate(schema);
  return judgeBehaviour('D2', { observations: { D2: { schema, toolName: 'nt_form_answers' } } });
};

test('D2 passes the schema the fixture markup actually produces', () => {
  const finding = d2real(null);
  assert.equal(finding.verdict, 'pass', finding.observed);
  assert.match(finding.observed, /each on the control its markup declares/);
});

test('D2 fails a wholly unrelated schema that happens to carry the right shapes', () => {
  const finding = judgeBehaviour('D2', {
    observations: {
      D2: {
        toolName: 'nt_form_answers',
        schema: {
          type: 'object',
          properties: {
            totally_wrong: { type: 'number', minimum: -999, maximum: -1, description: 'nonsense' },
            also_wrong: { type: 'string', enum: ['banana'], description: 'nonsense' },
          },
          required: ['totally_wrong'],
        },
      },
    },
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /witness_name, age, severity absent/);
  assert.match(finding.observed, /totally_wrong, also_wrong appeared/);
});

test('D2 fails when a control is renamed', () => {
  const finding = d2real((s) => {
    s.properties.witness = s.properties.witness_name;
    delete s.properties.witness_name;
    s.required = ['witness'];
  });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /witness_name absent/);
});

test('D2 fails on the wrong minimum, and names both the control and the value', () => {
  const finding = d2real((s) => { s.properties.age.minimum = 0; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /min 18 and max 120 on age \(read 0 and 120\)/);
});

test('D2 fails on the wrong option values', () => {
  const finding = d2real((s) => { s.properties.severity.enum = ['banana']; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /dent and write_off \(read banana\)/);
});

test('D2 fails when required names a control the markup did not mark required', () => {
  const finding = d2real((s) => { s.required = ['age']; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /witness_name in the required list/);
});

test('D2 fails when a property the markup never declared appears', () => {
  // A browser inventing a control is as much a defect as one dropping a constraint.
  const finding = d2real((s) => { s.properties.sneaky = { type: 'string', description: 'd' }; });
  assert.equal(finding.verdict, 'fail', finding.observed);
  assert.match(finding.observed, /sneaky appeared/);
});

test('the contract the judge compares against is the markup the fixture really ships', async () => {
  /*
   * THE DRIFT GUARD. The expected values live in the judge so it stays reachable without a browser,
   * which is only safe while something asserts the fixture still declares them. Edit the form and
   * this fails at authoring time rather than turning D2 into a test of a page that no longer exists.
   */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const markup = fs.readFileSync(path.join(here, '../../fixtures/subject.html'), 'utf8');
  const form = markup.slice(markup.indexOf('id="answers"'), markup.indexOf('id="silent"'));

  assert.match(form, /name="witness_name"[^>]*\srequired/, 'witness_name must carry required');
  assert.match(form, /name="age"[^>]*type="number"[^>]*min="18"[^>]*max="120"/, 'age bounds moved');
  assert.match(form, /<option value="dent">/, 'the dent option moved');
  assert.match(form, /<option value="write_off">/, 'the write_off option moved');
  for (const control of ['witness_name', 'age', 'severity']) {
    assert.ok(form.includes(`name="${control}"`), `${control} is no longer a control on the form`);
  }
});
