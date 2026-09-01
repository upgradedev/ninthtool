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
      C1: { settled: 'rejected', handlerSawStaleValue: false, staleValue: null },
      C2: {
        optionsBag: { presentBefore: true, presentAfter: false },
        onDescriptor: { presentBefore: true, presentAfter: false },
      },
      C3: { scriptPathEnforces: true, formPathEnforces: true },
      C4: { settled: 'resolved', waitedMs: 17 },
      D1: { onRegister: 1, onWithdraw: 1 },
      D2: {
        schema: '{"type":"object","properties":{"witness_name":{"type":"string","description":"Full name."},'
          + '"age":{"type":"number","minimum":18,"maximum":120,"multipleOf":1,"description":"Age in years."},'
          + '"severity":{"type":"string","enum":["dent","write_off"],"description":"How bad."}},'
          + '"required":["witness_name"]}',
      },
      P1: { toolCount: 3, withoutAnnotations: [], withoutReadOnlyHint: [], readOnlyCount: 2 },
      P2: { toolCount: 3, unusableSchemas: [] },
      P3: { toolCount: 3, undescribedTools: [], undescribedParams: [] },
      P4: { toolCount: 3, fromOtherDocuments: [] },
      P5: {
        attempted: ['read_state', 'read_notes'],
        ignored: [],
        noticed: ['read_state: refused', 'read_notes: refused'],
        skipped: [],
      },
      P6: { oracleCount: 2, oracles: ['read_state', 'read_notes'], moved: [] },
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
      C1: { settled: 'resolved', handlerSawStaleValue: true, staleValue: 'M. Okafor' },
      C2: {
        optionsBag: { presentBefore: true, presentAfter: false },
        onDescriptor: { presentBefore: true, presentAfter: true },
      },
      C3: { scriptPathEnforces: false, formPathEnforces: true },
      C4: { settled: 'timeout', waitedMs: 8016 },
      D1: { onRegister: 1, onWithdraw: 1 },
      D2: {
        schema: '{"type":"object","properties":{"witness_name":{"type":"string","description":"Full name of the witness."},'
          + '"age":{"type":"number","minimum":18,"maximum":120,"multipleOf":1,"description":"Age in years."},'
          + '"severity":{"type":"string","anyOf":[{"type":"string","const":"dent","title":"dent"},'
          + '{"type":"string","const":"write_off","title":"write_off"}],"enum":["dent","write_off"],'
          + '"description":"How bad."}},"required":["witness_name"]}',
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
      P5: {
        attempted: ['nt_explain_behaviour'],
        ignored: [],
        noticed: ['nt_explain_behaviour: answered differently'],
        skipped: ['nt_form_answers: carries no annotations', 'nt_form_silent: carries no annotations',
          'nt_run_audit: not marked readOnlyHint',
          'nt_list_behaviours: declares no required properties, so there is nothing to break'],
      },
      P6: { oracleCount: 2, oracles: ['nt_explain_behaviour', 'nt_list_behaviours'], moved: [] },
    },
  };
}

/**
 * The ids Chrome 152 failed, written out rather than computed, so that a change in the judge that
 * quietly moves one of them breaks a test instead of rewriting the headline.
 */
export const CHROME_152_FAILURES = Object.freeze(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5',
  'C1', 'C2', 'C3', 'C4', 'P1', 'P4']);

/** The ids Chrome 152 kept. Same reasoning. */
export const CHROME_152_PASSES = Object.freeze(['D1', 'D2', 'P2', 'P3', 'P5', 'P6']);
