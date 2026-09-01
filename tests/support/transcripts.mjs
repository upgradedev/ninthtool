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
    },
  };
}

/**
 * The ids Chrome 152 failed, written out rather than computed, so that a change in the judge that
 * quietly moves one of them breaks a test instead of rewriting the headline.
 */
export const CHROME_152_FAILURES = Object.freeze(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4']);

/** The ids Chrome 152 kept. Same reasoning. */
export const CHROME_152_PASSES = Object.freeze(['D1', 'D2']);
