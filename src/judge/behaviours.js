/**
 * The catalogue. Every behaviour this suite tests, in one place, as data.
 *
 * PURE MODULE. No DOM, no network, no timers, no browser globals. It is imported by the judge, by
 * the page, by the command line runner and by the tests, so that a row
 * cannot say one thing on the page and another in the documentation. Change a row here and every
 * surface changes with it. The README is hand written rather than generated, and
 * tests/unit/flagship.test.js fails when it and this file disagree about which rows exist.
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
 *   your-page        a defect in the page under test, and the only group a build should fail on
 *   spec-divergence  the browser does something its own IDL and the W3C draft say it should not
 *   standard-gap     the standard provides no way to do this, and the draft sometimes says so
 *   silent-trap      it works, but the obvious way to write it fails and nothing is thrown
 *   by-design        the behaviour is deliberate; what is reported is a gap around it, not a defect
 *   holds            it works as documented, and the suite says so rather than staying quiet
 *
 * `by-design` was added after an audit pointed out that C4 was counting somebody's deliberate
 * human-in-the-loop design decision as a broken promise, which inflated the headline. A taxonomy
 * that calls every observation the same kind of thing is a taxonomy that cannot be trusted on any
 * single row.
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
export const GROUPS = ['your-page', 'spec-divergence', 'standard-gap', 'silent-trap', 'by-design', 'holds'];

/**
 * How a row could be decided by a checker that only READS the tool surface: the names, the
 * descriptions, the schemas, the annotations and the origins the page publishes.
 *
 *   metadata   readable from getTools() alone, calling nothing and registering nothing
 *   execution  needs a tool to be called, or a tool of the checker's own to be registered
 *
 * THIS IS THE ENTRY'S ONE COMPARATIVE NUMBER, and it is a property of this catalogue rather than a
 * survey of anybody's product.
 *
 * THE PREMISE WAS CORRECTED ON 2026-09-02 AND THE NUMBER SURVIVED IT. This used to read "every
 * existing WebMCP checker reads declared metadata", which a prior art re-check falsified: at least
 * three of the products in docs/prior-art.md execute tools rather than only reading declarations.
 * The number is unaffected because it never depended on that claim. It counts how much of THIS
 * catalogue a metadata-only reading can reach, which is a fact about these twenty rows and about
 * where these defects live, whoever else is or is not calling anything. Recount it yourself:
 *
 *   node -e "import('./src/judge/behaviours.js').then(m=>console.log(m.decidability()))"
 *
 * The limitation, stated: a checker with a different catalogue would score differently, and this
 * says nothing about how well any named product implements the metadata half.
 */
export const DECIDABLE_FROM = ['metadata', 'execution'];

/** What a check can conclude. `not-applicable` is a real answer and is never counted as a pass. */
export const VERDICTS = ['pass', 'fail', 'not-applicable', 'out-of-scope'];

/**
 * `out-of-scope` exists because a run may deliberately observe one behaviour. Judging the whole
 * catalogue against such a run reported nineteen unobserved rows and called it incomplete, which
 * was true of the catalogue and useless about the run. Out of scope rows are still printed, so
 * nothing vanishes, and are not counted.
 */

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
    decidableFrom: 'execution',
    group: 'spec-divergence',
    subject: 'browser',
    title: 'The execute callback receives one argument, not two',
    promise: 'A tool handler is handed a cancellation signal it can pass to fetch.',
    contract: 'The W3C draft declares callback ToolExecuteCallback = Promise<any> '
      + '(object inputObject, ToolExecuteCallbackOptions options), and Chromium the same with the '
      + 'first parameter named input, both with '
      + 'dictionary ToolExecuteCallbackOptions { required AbortSignal signal; }.',
    measured: 'The callback receives one argument. arguments.length is 1 and options is undefined, '
      + 'so execute(args, { signal }) reads a property of undefined and throws.',
    why: 'A handler written to the documented signature throws on its first line, and by B1 the '
      + 'agent is told only that something went wrong.',
    reproduce: 'node bin/ninthtool.mjs --behaviour A1',
  },
  {
    id: 'A2',
    decidableFrom: 'metadata',
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
    decidableFrom: 'execution',
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
    decidableFrom: 'execution',
    group: 'standard-gap',
    subject: 'browser',
    title: 'No route makes a refusal both a failure and readable',
    promise: 'A page that refuses a write signals a failure AND says what was wrong.',
    contract: 'None. WebMCP assigns no native failure semantics to the MCP error envelope. The W3C '
      + 'draft notes its own gap: "Support more granular errors than “UnknownError”, based on each '
      + 'failure case."',
    measured: 'Three routes, none of which does both. Returning { isError: true } RESOLVES: the '
      + 'refusal text and the flag ARE in the resolved value, so a caller that reads the payload '
      + 'can see them, but the promise carries no failure signal. Throwing an Error REJECTS as '
      + 'UnknownError with "Tool was executed but the invocation failed. For example, the script '
      + 'function threw an error", and the page\'s own words are gone. A named DOMException gives '
      + 'byte-identical text.',
    why: 'An earlier version of this row said a tool cannot tell the agent why it refused, and that '
      + 'its own transcript disproves: the reason is present in the resolved value. What is missing '
      + 'is native failure SEMANTICS. A caller that branches on the promise settling sees success, '
      + 'and a caller that branches on the rejection has lost the reason. Whether a given model then '
      + 'reports success is a question about that model, and no experiment here has asked it.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B1',
  },
  {
    id: 'B2',
    decidableFrom: 'execution',
    group: 'standard-gap',
    subject: 'browser',
    title: 'isError is payload, not a signal',
    promise: 'A result can be marked as a failure in band, the way backend MCP does it.',
    contract: 'None in WebMCP. isError and structuredContent appear nowhere in the draft. They are '
      + 'backend MCP fields, where a result carries "isError": true beside its content.',
    measured: 'A handler returning { content: [...], isError: true } resolves. The flag rides along '
      + 'inside the serialized string and the browser attaches no meaning to it.',
    why: 'A developer arriving from an MCP server writes the shape they know. The promise '
      + 'resolves, so the refusal reaches the caller through the channel a success uses, '
      + 'and nothing in the platform marks it as a failure. What a particular agent then '
      + 'does with it was not measured here, and is not claimed.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B2',
  },
  {
    id: 'B3',
    decidableFrom: 'execution',
    group: 'standard-gap',
    // Measured by registering a tool of our own and reading it back, so this is a fact about the
    // host and not a defect in the page under test. Six rows were labelled `page` for one commit,
    // which would have told a reader their page was at fault for something no page can change.
    // Whether YOUR page fell into any of these traps is the your-page group below.
    subject: 'browser',
    title: 'The MCP annotation names do not exist in WebMCP',
    promise: 'A tool that changes something is marked destructive so an agent can be careful.',
    contract: 'None. WebMCP’s ToolAnnotations has readOnlyHint and untrustedContentHint. '
      + 'destructiveHint, idempotentHint and openWorldHint belong to backend MCP and are not part '
      + 'of this standard.',
    measured: 'Sent all six. Read back two. Of the four dropped, three are this row: '
      + 'destructiveHint, idempotentHint and openWorldHint, gone with no error and no '
      + 'console warning. The fourth, consequentialHint, is row A3, because Chromium '
      + 'declares it in its own IDL and this build drops it anyway. Counting it in both '
      + 'rows turned one measured fact into two broken promises.',
    why: 'The page believes it warned the agent. The tool list carries no warning.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B3',
  },
  {
    id: 'B4',
    decidableFrom: 'metadata',
    group: 'standard-gap',
    subject: 'browser',
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
    decidableFrom: 'execution',
    group: 'standard-gap',
    subject: 'browser',
    title: 'The caller cannot tell whether to parse the result',
    promise: 'A consumer knows whether it was handed text or data.',
    contract: 'None. executeTool resolves with a DOMString either way.',
    measured: 'The probe registers two tools of its own. One returns the string '
      + '"Added to-do: Buy milk" and gets it back raw, 21 characters, not parsing as JSON. One '
      + 'returns { title, count } and gets back JSON text, which does parse. Both arrive as a '
      + 'DOMString and nothing distinguishes them.',
    why: 'A tool whose text happens to look like JSON is indistinguishable from one returning data, '
      + 'so every consumer guesses.',
    reproduce: 'node bin/ninthtool.mjs --behaviour B5',
  },

  // ---------------------------------------------------------------- silent trap
  {
    id: 'C1',
    decidableFrom: 'execution',
    group: 'silent-trap',
    subject: 'browser',
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
    decidableFrom: 'execution',
    group: 'silent-trap',
    subject: 'browser',
    title: 'A tool withdraws only when the signal is in the options bag',
    promise: 'A conditional tool disappears when the state that justified it goes away.',
    contract: 'registerTool(tool, { signal }) then controller.abort(). '
      + 'ModelContextRegisterToolOptions declares the signal, and the descriptor does not.',
    measured: 'signal in the options bag: present before abort, absent after. '
      + 'signal on the descriptor: present before abort, PRESENT AFTER. Nothing is thrown and '
      + 'nothing is logged.',
    why: 'This is the row the suite is named for. A tool the page believes it withdrew stays on the surface, and an '
      + 'agent can call an action the page no longer offers.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C2',
  },
  {
    id: 'C3',
    decidableFrom: 'execution',
    group: 'silent-trap',
    subject: 'browser',
    title: 'The two halves of the standard enforce different parts of one schema',
    promise: 'Every constraint the declared schema expresses is enforced.',
    contract: 'One schema format, one executeTool, two ways to register. Nothing in the standard '
      + 'says the two should behave differently.',
    /*
     * NO COUNTS IN THIS STRING, DELIBERATELY. It used to read "0 of 4" and "4 of 4", and the second
     * number had stopped being true: the form half enforces the declared type and the enum and does
     * NOT enforce `required`, so nothing is enforced on both paths. A count typed into a static
     * catalogue entry cannot track a browser that moves. The per constraint matrix is measured on
     * every run and printed in the row's own observation, which is where a reader should take it
     * from. `tests/unit/c3_published_claims.test.js` fails if a count reappears here.
     */
    measured: 'The same bad calls, against schemas declaring the same constraints: a missing '
      + 'required property, a wrong type, and a value outside an enum. Script registered enforces '
      + 'none of them, and the handler receives every bad call unchanged. The form half enforces '
      + 'the declared type and the declared enum, and does not enforce `required`, so no declared '
      + 'constraint is enforced on both paths. Read the `required` line with C1 beside it: the form '
      + 'path decides that constraint from the CONTROL rather than from the call, which is why what '
      + 'a previous call left in the DOM changes the answer. Same rule, different outcome, decided '
      + 'by state the caller cannot see. The exact per constraint split is in the observation for '
      + 'this row on every run rather than in this sentence.',
    why: 'A developer’s mental model is wrong on one of the two paths whichever way they guess: '
      + 'write the descriptor yourself and nothing you declared is checked. An earlier version of '
      + 'this row compared a different constraint on each half and passed whenever the two answers '
      + 'matched, so it passed when neither half enforced anything. It now reports a constraint by '
      + 'constraint matrix, and a constraint nobody enforces is a failure rather than an agreement.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C3',
  },
  {
    id: 'C4',
    decidableFrom: 'execution',
    // MOVED OUT OF silent-trap. An audit was right that this is the declarative API working as
    // designed: without toolautosubmit the call fills the controls and waits for a person, which is
    // the human-in-the-loop path the explainer describes. Counting it as a broken promise inflated
    // the headline with somebody's deliberate design decision. What remains, and is real, is that
    // nothing on the tool surface distinguishes a tool that will answer from one that is waiting
    // for a human, so an agent finds out by waiting.
    group: 'by-design',
    subject: 'browser',
    title: 'Nothing says which declarative tools wait for a human',
    promise: 'An agent can tell, before calling, whether a tool will answer it.',
    contract: 'toolautosubmit makes an agent’s call fill the controls and submit. Without it the '
      + 'controls are filled and a person is expected to act, which is the human-in-the-loop path '
      + 'the declarative explainer describes. That pause is the design, not a defect.',
    measured: 'Called through the shipped probe, which waits 2500 ms: still pending when that '
      + 'deadline expired, at 2502 ms. Chrome imposed no deadline of its own. Reproduced across a '
      + 'same origin frame as well as in the same document. Pressing the button by hand settles it, '
      + 'which is the design working.',
    why: 'The pause is intentional and this row does not call it a defect. What it reports is that '
      + 'the two kinds of tool are indistinguishable on the surface: same shape, same schema, no '
      + 'annotation, no flag. An agent finds out which it called by waiting, with no deadline to '
      + 'wait against.',
    reproduce: 'node bin/ninthtool.mjs --behaviour C4',
  },

  // ---------------------------------------------------------------- holds
  {
    id: 'D1',
    decidableFrom: 'execution',
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
    decidableFrom: 'metadata',
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
  // ---------------------------------------------------------------- your page
  // Everything above measures the host: register a tool, call it, watch what the browser does, and
  // the answer is the same whatever page you point this at. The rows below are different. They read
  // the tools YOUR page publishes, snapshotted before this probe registers anything of its own, and
  // they are the rows a build should go red on.
  //
  // THE PROBE CALLS ONLY WHAT THE PAGE MARKS READ ONLY. A tool carrying no annotations is never
  // called, and that refusal is itself reported, because a page that gives an auditor no way to
  // know a tool is safe gives an agent no way either.
  {
    id: 'P1',
    decidableFrom: 'metadata',
    group: 'your-page',
    subject: 'page',
    title: 'Every tool you publish says whether it writes',
    promise: 'An agent can tell a tool that reads from a tool that changes something.',
    contract: 'ToolAnnotations carries readOnlyHint, default false. The declarative half has no '
      + 'attribute for it at all.',
    measured: 'Script registered tools return an annotations object. Form derived tools return '
      + 'undefined, so half the standard cannot say this.',
    why: 'A tool with no readOnlyHint is a tool an agent has to guess about, and the safe guess '
      + 'stops it using your page at all.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P1',
  },
  {
    id: 'P2',
    decidableFrom: 'metadata',
    group: 'your-page',
    subject: 'page',
    title: 'Every tool you publish declares a schema an agent can read',
    promise: 'A model knows what arguments a tool takes before it calls it.',
    contract: 'RegisteredTool.inputSchema, a JSON Schema object at registration and a string when '
      + 'read back in Chrome.',
    measured: 'Chrome returns the schema as a JSON string, so a missing, empty or unparseable one '
      + 'is visible from outside the page.',
    why: 'A tool with no properties accepts anything, and the browser validates nothing at all on '
      + 'the script path, so the schema is the only contract there is.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P2',
  },
  {
    id: 'P3',
    decidableFrom: 'metadata',
    group: 'your-page',
    subject: 'page',
    title: 'Every tool you publish describes itself, and every parameter is described',
    promise: 'A model can choose the right tool and fill it in without guessing.',
    contract: 'description on the tool, and description on each schema property. The declarative '
      + 'half takes them from tooldescription and toolparamdescription.',
    measured: 'Both survive registration on both halves of the standard, so an absent one is the '
      + 'page not writing it.',
    why: 'This is the one thing existing WebMCP checkers look at, and it is still worth checking, '
      + 'because an undescribed parameter is a parameter a model fills with something plausible.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P3',
  },
  {
    id: 'P4',
    decidableFrom: 'metadata',
    group: 'your-page',
    subject: 'page',
    title: 'Your tool surface carries nothing registered by a frame you may not control',
    promise: 'The tools on your page are the tools you registered.',
    contract: 'Tools registered in a same origin frame join the top document tool list. A cross '
      + 'origin frame contributes nothing unless it is given allow="tools".',
    measured: 'On this suite\'s own page a same origin frame contributes its two form tools to the '
      + 'top document list, each carrying tool.window pointing at the other document. A frame on a '
      + 'different origin of the same server contributed zero.',
    why: 'Anything you embed same origin can put a tool in front of an agent on your page, '
      + 'under your origin. The provenance IS available: every tool carries a window that '
      + 'points at the document which registered it, and this row reads exactly that field '
      + 'to decide. What the surface does not do is distinguish them for you. They arrive '
      + 'in one list, in the same shape, and nothing prompts a caller to look. An earlier '
      + 'version of this line claimed nothing on the surface says where a tool came from, '
      + 'which the measured column beside it already contradicted.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P4',
  },
  {
    id: 'P5',
    decidableFrom: 'execution',
    group: 'your-page',
    subject: 'page',
    title: 'Your read only tools demonstrably refuse a call that breaks their own required list',
    promise: 'A tool enforces the schema it published, because the browser does not.',
    contract: 'None on the script path, where the browser enforces nothing at all. A required array '
      + 'in your schema is a promise only your handler can keep.',
    measured: 'A script registered tool declaring required: ["a"] was called with an empty object '
      + 'and the handler received it unchanged, so nothing but the page can refuse it.',
    why: 'Unvalidated arguments from a model are unvalidated input from a stranger. This row has '
      + 'been wrong twice and both corrections are recorded here. It first sent a property that was '
      + 'in no schema, which JSON Schema permits, so accepting one was never a defect. It then '
      + 'passed on "answered differently", which is consistent with a refusal and equally '
      + 'consistent with the tool echoing its arguments, so it could pass with nothing '
      + 'demonstrated. It now reports three outcomes and passes on only one: a rejection, which is '
      + 'the single failure signal the standard has. An identical answer proves a defect. Anything '
      + 'else is reported as inconclusive rather than scored.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P5 --allow-tool-calls',
  },
  {
    id: 'P6',
    decidableFrom: 'execution',
    group: 'your-page',
    subject: 'page',
    title: 'Calling one read only tool does not change what another one answers',
    promise: 'A tool marked read only leaves the state your other read tools report alone.',
    contract: 'readOnlyHint, default false, says the tool does not modify its environment.',
    measured: 'A differential, with a control. The read only tools are read twice with nothing '
      + 'called in between; if those two reads disagree the surface is not stable and this row '
      + 'abstains. Otherwise each tool is called with arguments its own schema says are valid, and '
      + 'the others are read again.',
    why: 'This row deliberately claims less than it used to. It CANNOT prove readOnlyHint is honest: '
      + 'a tool can change state no tool on your page reports, and nothing observable from here '
      + 'would show it. What it can say is whether one read only tool moved what another one '
      + 'reports, which is a real defect when it happens and is stated as the narrow observation it '
      + 'is. It also reports a tool whose own answer drifts, which the earlier version structurally '
      + 'could not name because it skipped itself and blamed the next tool called.',
    reproduce: 'node bin/ninthtool.mjs https://your-page.example --behaviour P6 --allow-tool-calls',
  },
]);

/**
 * How much of this catalogue a metadata only checker could reach, computed rather than typed.
 *
 * @returns {{total: number, metadata: number, execution: number, yourPageMetadata: number,
 *            yourPageExecution: number}}
 */
export function decidability() {
  const metadata = BEHAVIOURS.filter((b) => b.decidableFrom === 'metadata');
  const yourPage = BEHAVIOURS.filter((b) => b.group === 'your-page');
  return {
    total: BEHAVIOURS.length,
    metadata: metadata.length,
    execution: BEHAVIOURS.length - metadata.length,
    yourPageMetadata: yourPage.filter((b) => b.decidableFrom === 'metadata').length,
    yourPageExecution: yourPage.filter((b) => b.decidableFrom === 'execution').length,
  };
}

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
 * NO RUNNABLE SURFACE TYPES THE NUMBER BY HAND. The page calls this rather than stating a count,
 * so its sentence cannot drift from the catalogue. The README is markdown and cannot call anything,
 * so it types its counts and the test named "the README group counts agree with the catalogue" in
 * tests/unit/flagship.test.js fails when they disagree with this file.
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
    byDesign: behavioursInGroup('by-design').length,
    yourPage: behavioursInGroup('your-page').length,
    browserSubject: BEHAVIOURS.filter((b) => b.subject === 'browser').length,
    pageSubject: BEHAVIOURS.filter((b) => b.subject === 'page').length,
  };
}
