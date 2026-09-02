/**
 * Two transcripts the tests judge, and the difference between them is the whole point.
 *
 * `conforming()` is what a browser that kept every promise in the catalogue would produce. Nothing
 * has ever produced it. It exists so the judge can be shown passing, because a judge that has only
 * ever been shown failing might simply always fail.
 *
 * `measuredChrome152()` is what Chrome 152.0.7977.65 actually produced on 2026-09-01, transcribed
 * from the seven probe runs recorded in docs/evidence.md. Every value here was observed. Where a
 * number appears, it was read off the run, not estimated.
 *
 * Both are plain data with no behaviour, so a test can take one, change a single field, and require
 * the verdict to move. That is how tests/unit/verdict_mutations.test.js proves each rule can fail.
 */

/** A transcript in which every promise in the catalogue is kept. */
export function conforming() {
  return {
    meta: {
      url: 'https://example.invalid/conforming',
      userAgent: 'a browser that keeps its promises',
      api: 'document.modelContext',
    },
    observations: {
      A1: { argCount: 2, optionsTypeof: 'object', hasSignal: true },
      A2: { inputSchemaTypeof: 'object' },
      A3: { returnedAnnotationKeys: ['readOnlyHint', 'untrustedContentHint', 'consequentialHint'] },
      B1: {
        routes: [
          { route: 'return { isError: true }', settled: 'rejected', errName: 'ToolRefused', pageMessageSurvived: true },
          { route: 'throw Error', settled: 'rejected', errName: 'ToolRefused', pageMessageSurvived: true },
          { route: 'reject DOMException', settled: 'rejected', errName: 'InvalidStateError', pageMessageSurvived: true },
        ],
      },
      B2: { settled: 'rejected' },
      B3: {
        sentAnnotationKeys: ['readOnlyHint', 'untrustedContentHint'],
        returnedAnnotationKeys: ['readOnlyHint', 'untrustedContentHint'],
      },
      B4: { annotationsTypeof: 'object' },
      B5: {
        stringReturn: { typeofValue: 'string', parsesAsJson: false },
        objectReturn: { typeofValue: 'object', parsesAsJson: true },
      },
      // handlerTelemetry is how we know. Without it the row abstains rather than assuming clean.
      C1: { settled: 'rejected', handlerSawStaleValue: false, staleValue: null, handlerTelemetry: 'read', handlerCallsObserved: 1 },
      C2: {
        optionsBag: { presentBefore: true, presentAfter: false },
        onDescriptor: { presentBefore: true, presentAfter: false },
      },
      C3: {
        constraints: [
          { name: 'required', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
          { name: 'type', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
          { name: 'enumerated', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
          { name: 'unknownProperty', declared: true, script: 'enforced', form: 'enforced', detail: 'both refused it' },
        ],
        scriptPathEnforces: true,
        formPathEnforces: true,
      },
      C4: { settled: 'resolved', waitedMs: 17 },
      D1: { onRegister: 1, onWithdraw: 1 },
      D2: {
        schema: '{"type":"object","properties":{"witness_name":{"type":"string","description":"Full name."},'
          + '"age":{"type":"number","minimum":18,"maximum":120,"multipleOf":1,"description":"Age in years."},'
          + '"severity":{"type":"string","enum":["dent","write_off"],"description":"How bad."}},'
          + '"required":["witness_name"]}',
        // D2 is scoped to the bundled fixture, because only that markup is known in advance.
        toolName: 'nt_form_answers',
      },
      P1: { toolCount: 3, withoutAnnotations: [], withoutReadOnlyHint: [], readOnlyCount: 2 },
      P2: { toolCount: 3, unusableSchemas: [] },
      P3: { toolCount: 3, undescribedTools: [], undescribedParams: [] },
      P4: { toolCount: 3, fromOtherDocuments: [] },
      P5: {
        attempted: ['read_state', 'read_notes'],
        refused: ['read_state: rejected the call', 'read_notes: rejected the call'],
        ignored: [],
        inconclusive: [],
        skipped: [],
      },
      P6: {
        oracleCount: 2,
        oracles: ['read_state', 'read_notes'],
        stable: true,
        unstable: [],
        moved: [],
        selfChanged: [],
        // Both oracles answered a schema valid call in BOTH control reads. Without this the row
        // could pass on a page whose read only tools reject everything, because two identical
        // rejections read as a stable control.
        controlAnswered: ['read_state', 'read_notes'],
        controlUnanswered: [],
      },
    },
  };
}

/**
 * What Chrome 152.0.7977.65 did on 2026-09-01. Transcribed from the probe runs, not summarised.
 */
export function measuredChrome152() {
  return {
    meta: {
      url: 'http://127.0.0.1:4199/target2.html',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'HeadlessChrome/152.0.0.0 Safari/537.36',
      api: 'document.modelContext',
    },
    observations: {
      A1: { argCount: 1, optionsTypeof: 'undefined', hasSignal: false },
      A2: { inputSchemaTypeof: 'string' },
      A3: { returnedAnnotationKeys: ['readOnlyHint', 'untrustedContentHint'] },
      B1: {
        routes: [
          {
            route: 'return { isError: true }',
            settled: 'resolved',
            errName: null,
            pageMessageSurvived: false,
          },
          {
            route: 'throw Error',
            settled: 'rejected',
            errName: 'UnknownError',
            pageMessageSurvived: false,
          },
          {
            route: 'reject DOMException("InvalidStateError")',
            settled: 'rejected',
            errName: 'UnknownError',
            pageMessageSurvived: false,
          },
        ],
      },
      B2: { settled: 'resolved' },
      B3: {
        sentAnnotationKeys: ['readOnlyHint', 'untrustedContentHint', 'consequentialHint',
          'destructiveHint', 'idempotentHint', 'openWorldHint'],
        returnedAnnotationKeys: ['readOnlyHint', 'untrustedContentHint'],
      },
      B4: { annotationsTypeof: 'undefined' },
      B5: {
        stringReturn: { typeofValue: 'string', parsesAsJson: false },
        objectReturn: { typeofValue: 'string', parsesAsJson: true },
      },
      C1: { settled: 'resolved', handlerSawStaleValue: true, staleValue: 'M. Okafor', handlerTelemetry: 'read', handlerCallsObserved: 1 },
      C2: {
        optionsBag: { presentBefore: true, presentAfter: false },
        onDescriptor: { presentBefore: true, presentAfter: true },
      },
      // Measured 2026-09-01 against this suite's own subject page. The form column reads 'enforced'
      // for `required` because this row sends its bad calls to an UNTOUCHED form, where the control
      // is empty. C1 sends a complete call first and the same omission is then accepted from the
      // stale control value. Both are true, and together they say the form path enforces `required`
      // against the control rather than against the call.
      C3: {
        constraints: [
          { name: 'required', declared: true, script: 'ignored', form: 'enforced', detail: 'the script handler received {"age":18,"severity":"dent"}' },
          { name: 'type', declared: true, script: 'ignored', form: 'enforced', detail: 'the script handler received a string where a number was declared' },
          { name: 'enumerated', declared: true, script: 'ignored', form: 'enforced', detail: 'the script handler received a value outside the enum' },
          // MEASURED declared=false. The form derived schema Chrome synthesises carries no
          // `additionalProperties: false`, so this constraint was never expressed and the row used
          // to compare a rule neither side had. It counted as a fourth constraint anyway.
          { name: 'unknownProperty', declared: false, script: 'not-declared', form: 'not-declared', detail: 'the schema does not express this constraint' },
        ],
        scriptPathEnforces: false,
        formPathEnforces: true,
      },
      C4: { settled: 'timeout', waitedMs: 2502 },
      D1: { onRegister: 1, onWithdraw: 1 },
      D2: {
        schema: '{"type":"object","properties":{"witness_name":{"type":"string","description":"Full name of the witness."},'
          + '"age":{"type":"number","minimum":18,"maximum":120,"multipleOf":1,"description":"Age in years."},'
          + '"severity":{"type":"string","anyOf":[{"type":"string","const":"dent","title":"dent"},'
          + '{"type":"string","const":"write_off","title":"write_off"}],"enum":["dent","write_off"],'
          + '"description":"How bad."}},"required":["witness_name"]}',
        toolName: 'nt_form_answers',
      },
      // The your-page rows, measured against this suite's own page on 2026-09-01. Two fail, and
      // both are owned rather than hidden: P1 because the standard has no way to annotate a form
      // derived tool, which is behaviour B4, and P4 because this page deliberately embeds a subject
      // frame whose tools join its surface, which is the finding rather than an accident.
      P1: {
        toolCount: 5,
        withoutAnnotations: ['nt_form_answers', 'nt_form_silent'],
        withoutReadOnlyHint: [],
        readOnlyCount: 2,
      },
      P2: { toolCount: 5, unusableSchemas: [] },
      P3: { toolCount: 5, undescribedTools: [], undescribedParams: [] },
      P4: {
        toolCount: 5,
        fromOtherDocuments: ['nt_form_answers (origin http://127.0.0.1:57361)',
          'nt_form_silent (origin http://127.0.0.1:57361)'],
      },
      // P5 and P6 are re-measured below from a live run after the oracle rewrite. P5 no longer
      // passes on "answered differently", and this page's tool does exactly that, so the row is now
      // honestly inconclusive rather than a pass it had not earned.
      P5: {
        attempted: ['nt_explain_behaviour'],
        refused: [],
        ignored: [],
        inconclusive: ['nt_explain_behaviour: answered differently, which is consistent with a '
          + 'refusal and also with the tool simply echoing what it was sent'],
        skipped: ['nt_form_answers: carries no annotations', 'nt_form_silent: carries no annotations',
          'nt_run_audit: not marked readOnlyHint',
          'nt_list_behaviours: declares no required properties, so there is nothing to break'],
      },
      P6: {
        oracleCount: 2,
        oracles: ['nt_explain_behaviour', 'nt_list_behaviours'],
        stable: true,
        unstable: [],
        moved: [],
        selfChanged: [],
        controlAnswered: ['nt_explain_behaviour', 'nt_list_behaviours'],
        controlUnanswered: [],
      },
    },
  };
}

/**
 * The ids Chrome 152 failed, written out rather than computed, so that a change in the judge that
 * quietly moves one of them breaks a test instead of rewriting the headline.
 */
export const CHROME_152_FAILURES = Object.freeze(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5',
  'C1', 'C2', 'C3', 'C4', 'P1', 'P4']);

/** Rows nothing could be concluded about. Not passes, and the report never counts them as any. */
export const CHROME_152_INCONCLUSIVE = Object.freeze(['P5']);

/** The ids Chrome 152 kept. Same reasoning. */
export const CHROME_152_PASSES = Object.freeze(['D1', 'D2', 'P2', 'P3', 'P6']);
