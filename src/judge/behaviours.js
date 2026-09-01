/**
 * The catalogue. Every behaviour this suite tests, in one place, as data.
 *
 * PURE MODULE. No DOM, no network, no timers, no browser globals. It is imported by the judge, by
 * the page, by the command line runner, by the README generator and by the tests, so that a row
 * cannot say one thing on the page and another in the documentation. Change a row here and every
 * surface changes with it.
 *
 * WHY A CATALOGUE AND NOT A PILE OF ASSERTIONS. Each row carries the thing a page is trying to
 * promise, how that promise is tested, what a conforming answer looks like, and the command a
 * reader runs to see it for themselves. A finding without a reproduction is an opinion.
 *
 * THE THREE GROUPS ARE CLAIMED SEPARATELY, ON PURPOSE. An earlier draft of this work reported one
 * number, "the browser ignores six of these". That was an overstatement: three of the six were
 * never the browser failing to implement anything, they were fields that do not exist in WebMCP at
 * all. A reader who checks one row, finds it is not a browser defect and discounts the rest would
 * have been right to. So:
 *
 *   spec-divergence  the browser does something its own IDL and the W3C draft say it should not
 *   standard-gap     the standard provides no way to do this, and the draft sometimes says so
 *   silent-trap      it works, but the obvious way to write it fails and nothing is thrown
 *   holds            it works as documented, and the suite says so rather than staying quiet
 *
 * SUBJECT MATTERS AS MUCH AS GROUP. `browser` rows are facts about the host and are the same
 * whatever page you point this at. `page` rows are defects in the page under test. Reporting a
 * browser fact as if it were your page's fault is the fastest way to make a conformance tool
 * useless, so the two are never mixed in the output.
 *
 * EVERY `measured` FIELD IS [PRIMARY], taken on 2026-09-01 against Chrome 152.0.7977.65 launched
 * with --enable-features=WebMCP. Nothing here is copied from documentation. Where the documentation
 * disagrees with the measurement, `contract` says what the documentation promised and the row is a
 * spec-divergence.
 */

/** The browser the `measured` fields were taken against. Printed beside every stored result. */
export const MEASURED_AGAINST = 'Chrome 152.0.7977.65';

/** The date those measurements were taken. One place, so no surface can claim a fresher one. */
export const MEASURED_ON = '2026-09-01';

/** The groups, in the order the page and the README present them. */
export const GROUPS = ['spec-divergence', 'standard-gap', 'silent-trap', 'holds'];

/** What a check can conclude. `not-applicable` is a real answer and is never counted as a pass. */
export const VERDICTS = ['pass', 'fail', 'not-applicable'];

/**
 * The catalogue.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   group: string,
 *   subject: 'browser'|'page',
 *   title: string,
 *   promise: string,
 *   contract: (string|null),
 *   measured: string,
 *   why: string,
 *   reproduce: string
 * }>}
 */
export const BEHAVIOURS = Object.freeze([
  // ---------------------------------------------------------------- spec divergence
  {
    id: 'A1',
    group: 'spec-divergence',
    subject: 'browser',
    title: 'The execute callback receives one argument, not two',
    promise: 'A tool handler is handed a cancellation signal it can pass to fetch.',
    contract: 'Both the W3C draft and Chromium IDL declare '
      + 'ToolExecuteCallback = Promise<any>(object input, ToolExecuteCallbackOptions options), '
      + 'with dictionary ToolExecuteCallbackOptions { required AbortSignal signal; }.',
    measured: 'The callback receives one argument. arguments.length is 1 and options is undefined, '
      + 'so execute(args, { signal }) reads a property of undefined and throws.',
    why: 'A handler written to the documented signature throws on its first line, and by B1 the '
      + 'agent is told only that something went wrong.',
    reproduce: 'node bin/ninthtool.mjs --behaviour A1',
  },
  {
    id: 'A2',
    group: 'spec-divergence',
    subject: 'browser',
    title: 'inputSchema is written as an object and read back as a string',
    promise: 'The schema you registered is the schema you can inspect.',
    contract: 'The W3C draft declares RegisteredTool.inputSchema as object. '
      + 'Chromium declares it as DOMString. Registration takes an object in both.',
    measured: 'typeof tool.inputSchema === "string". It holds JSON text, so code written against '
      + 'the draft reads tool.inputSchema.type and gets undefined.',
    why: 'A consumer written to the draft reports a correct page as having no schema at all.',
    reproduce: 'node bin/ninthtool.mjs --behaviour A2',
  },
  {
    id: 'A3',
    group: 'spec-divergence',
    subject: 'browser',
    title: 'consequentialHint is in the IDL and not in this build',
    promise: 'A tool can be marked as having a consequence.',
    contract: 'Chromium model_context_tool.idl declares '
      + 'dictionary ToolAnnotations { boolean readOnlyHint; boolean untrustedContentHint; '
      + 'boolean consequentialHint; }.',
    measured: 'Sent consequentialHint: true. The tool read back carries only readOnlyHint and '
      + 'untrustedContentHint. consequentialHint is absent from this build.',
    why: 'The one annotation that would warn an agent about a side effect is newer than the '
      + 'shipping browser, so nothing may claim it works today.',
    reproduce: 'node bin/ninthtool.mjs --behaviour A3',
  },

  // ---------------------------------------------------------------- standard gap
  {
    id: 'B1',
    group: 'standard-gap',
    subject: 'browser',
    title: 'A tool cannot tell the agent why it refused',
    promise: 'A page that refuses a write says what was wrong and what to send next.',
    contract: 'None. The W3C draft notes its own gap: "Support more granular errors than '
      + '“UnknownError”, based on each failure case."',
    measured: 'Three routes, one message. Returning { isError: true } RESOLVES, so the agent reads '
      + 'success. Throwing an Error REJECTS as UnknownError with '
      + '"Tool was executed but the invocation failed. For example, the script function threw an '
      + 'error". Rejecting with a named DOMException gives byte-identical text. The page’s own '
      + 'words never reach the caller.',
    why: 'This is the flagship. A refusal a page took care to write cannot reach the model that '
      + 'needs it. The page either looks like it succeeded, or it fails anonymously.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B1',
  },
  {
    id: 'B2',
    group: 'standard-gap',
    subject: 'browser',
    title: 'isError is payload, not a signal',
    promise: 'A result can be marked as a failure in band, the way backend MCP does it.',
    contract: 'None in WebMCP. isError and structuredContent appear nowhere in the draft. They are '
      + 'backend MCP fields, where a result carries "isError": true beside its content.',
    measured: 'A handler returning { content: [...], isError: true } resolves. The flag rides along '
      + 'inside the serialized string and the browser attaches no meaning to it.',
    why: 'A developer arriving from an MCP server writes the shape they know, and every refusal '
      + 'their page makes is reported to the agent as a success.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B2',
  },
  {
    id: 'B3',
    group: 'standard-gap',
    subject: 'page',
    title: 'The MCP annotation names do not exist in WebMCP',
    promise: 'A tool that changes something is marked destructive so an agent can be careful.',
    contract: 'None. WebMCP’s ToolAnnotations has readOnlyHint and untrustedContentHint. '
      + 'destructiveHint, idempotentHint and openWorldHint belong to backend MCP and are not part '
      + 'of this standard.',
    measured: 'Sent all six. Read back two. The four unknown members are dropped with no error and '
      + 'no console warning.',
    why: 'The page believes it warned the agent. The tool list carries no warning.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B3',
  },
  {
    id: 'B4',
    group: 'standard-gap',
    subject: 'page',
    title: 'A declarative tool carries no annotations at all',
    promise: 'A form promoted to a tool says whether it only reads.',
    contract: 'None. There is no attribute for an annotation on the declarative half.',
    measured: 'typeof tool.annotations === "undefined" on every form derived tool measured, where a '
      + 'script registered tool returns an object. Not even readOnlyHint is available.',
    why: 'Half the standard has no way to say a tool writes, so an agent cannot be careful with it.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B4',
  },
  {
    id: 'B5',
    group: 'standard-gap',
    subject: 'browser',
    title: 'The caller cannot tell whether to parse the result',
    promise: 'A consumer knows whether it was handed text or data.',
    contract: 'None. executeTool resolves with a DOMString either way.',
    measured: 'A handler returning the string "Added to-do: Buy milk" gives that back raw, 21 '
      + 'characters, and it does not parse as JSON. A handler returning { title, count } gives '
      + '{"title":"t2","count":3}, which does. Nothing distinguishes them.',
    why: 'A tool whose text happens to look like JSON is indistinguishable from one returning data, '
      + 'so every consumer guesses.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B5',
  },

  // ---------------------------------------------------------------- silent trap
  {
    id: 'C1',
    group: 'silent-trap',
    subject: 'page',
    title: 'A missing required property is filled from the control’s stale value',
    promise: 'A call that omits a required property is refused.',
    contract: 'The schema the browser itself synthesised from the markup says required: '
      + '["witness_name"].',
    measured: 'Call one sent a full set and resolved. Call two omitted the required property and '
      + 'also RESOLVED, and the handler was handed the value left in the DOM by call one. The agent '
      + 'was told a witness had been recorded under a name it never supplied.',
    why: 'The worst thing measured. It is a wrong write and a cross call data leak at once, on the '
      + 'half of the standard that validates everything else strictly.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C1',
  },
  {
    id: 'C2',
    group: 'silent-trap',
    subject: 'page',
    title: 'A tool withdraws only when the signal is in the options bag',
    promise: 'A conditional tool disappears when the state that justified it goes away.',
    contract: 'registerTool(tool, { signal }) then controller.abort(). '
      + 'ModelContextRegisterToolOptions declares the signal, and the descriptor does not.',
    measured: 'signal in the options bag: present before abort, absent after. '
      + 'signal on the descriptor: present before abort, PRESENT AFTER. Nothing is thrown and '
      + 'nothing is logged.',
    why: 'This is the ninth tool. A tool the page believes it withdrew stays on the surface, and an '
      + 'agent can call an action the page no longer offers.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C2',
  },
  {
    id: 'C3',
    group: 'silent-trap',
    subject: 'page',
    title: 'The two halves of the standard validate oppositely',
    promise: 'The declared schema is enforced.',
    contract: 'One schema format, one executeTool, two ways to register.',
    measured: 'Script registered: nothing is enforced. required is ignored and a declared string '
      + 'accepts 123. Form derived: strict, with quotable refusals such as '
      + '"Invalid value “NOT_AN_OPTION” for parameter severity" and '
      + '"Input contains a parameter “injected” but there is no such parameter for the tool".',
    why: 'A developer’s mental model is wrong on one of the two paths whichever way they guess, '
      + 'and a page that trusts its own schema is handing unvalidated model input to its handler.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C3',
  },
  {
    id: 'C4',
    group: 'silent-trap',
    subject: 'page',
    title: 'A declarative form without toolautosubmit never answers',
    promise: 'A published tool answers the agent that calls it.',
    contract: 'toolautosubmit makes an agent’s call fill the controls and submit. Without it the '
      + 'controls are filled and a person is expected to act.',
    measured: 'Measured three times, including across a same origin iframe, and timed at 8016 ms '
      + 'with no settlement. The promise never resolves and never rejects. There is no browser side '
      + 'timeout.',
    why: 'Nothing on the tool surface distinguishes a tool that will answer from one that waits for '
      + 'a person. Same shape, same schema, no annotation, no flag. An agent finds out by waiting.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C4',
  },

  // ---------------------------------------------------------------- holds
  {
    id: 'D1',
    group: 'holds',
    subject: 'browser',
    title: 'toolchange fires on both registration and withdrawal',
    promise: 'The tool surface can be observed without polling.',
    contract: 'ModelContext is an EventTarget and carries ontoolchange.',
    measured: 'One event on register, one on abort. Observed through addEventListener("toolchange").',
    why: 'Reported because a suite that only ever prints failures cannot be trusted to notice a '
      + 'pass. This is how a page watches its own surface honestly.',
    reproduce: 'node bin/ninthtool.mjs --behaviour D1',
  },
  {
    id: 'D2',
    group: 'holds',
    subject: 'browser',
    title: 'A form derived schema is built richly and correctly from markup',
    promise: 'Four HTML attributes produce a real JSON Schema.',
    contract: 'toolname, tooldescription, toolautosubmit on the form, toolparamdescription on a '
      + 'control. The browser synthesises the schema.',
    measured: 'A number input with min and max produced '
      + '{"type":"number","minimum":18,"maximum":120,"multipleOf":1}. A select produced both anyOf '
      + 'and enum. The required attribute joined the required array. Descriptions came from '
      + 'toolparamdescription.',
    why: 'The migration path for a page that already has a form is real, and this row says so.',
    reproduce: 'node bin/ninthtool.mjs --behaviour D2',
  },
]);

/** Every id, in catalogue order. Used by the runners so nothing is silently skipped. */
export const BEHAVIOUR_IDS = Object.freeze(BEHAVIOURS.map((b) => b.id));

/**
 * One behaviour by id.
 * @param {string} id
 * @returns {object|null}
 */
export function behaviourById(id) {
  return BEHAVIOURS.find((b) => b.id === id) || null;
}

/**
 * The behaviours in one group, in catalogue order.
 * @param {string} group
 * @returns {object[]}
 */
export function behavioursInGroup(group) {
  return BEHAVIOURS.filter((b) => b.group === group);
}

/**
 * The counts the headline sentence is built from, computed rather than written down.
 *
 * THE NUMBER IS NEVER TYPED BY HAND ANYWHERE. Every surface that states it calls this, so the
 * sentence in the README, the sentence on the page and the sentence in the description cannot drift
 * from the catalogue or from each other. tests/unit/headline.test.js asserts that.
 *
 * @returns {{total: number, specDivergence: number, standardGap: number, silentTrap: number,
 *            holds: number, browserSubject: number, pageSubject: number}}
 */
export function headlineCounts() {
  return {
    total: BEHAVIOURS.length,
    specDivergence: behavioursInGroup('spec-divergence').length,
    standardGap: behavioursInGroup('standard-gap').length,
    silentTrap: behavioursInGroup('silent-trap').length,
    holds: behavioursInGroup('holds').length,
    browserSubject: BEHAVIOURS.filter((b) => b.subject === 'browser').length,
    pageSubject: BEHAVIOURS.filter((b) => b.subject === 'page').length,
  };
}
