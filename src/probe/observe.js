/**
 * The probe. It runs inside a document, exercises that document's WebMCP surface, and returns a
 * transcript. It decides nothing.
 *
 * WHY GATHERING AND JUDGING ARE SEPARATE. The probe this grew from printed what it saw and exited
 * zero whatever that was, so pointed at a browser with no WebMCP it printed "api: null" and
 * reported success. A run that proved nothing looked exactly like a run that proved everything. So
 * this file has no idea what a pass is: it records what happened and hands it to
 * src/judge/verdict.js, which cannot reach a browser at all.
 *
 * IT CLEANS UP AFTER ITSELF. Every tool it registers goes on one AbortController, and `finally`
 * aborts it. A conformance instrument that leaves its own tools on the surface it just measured has
 * changed the thing it was measuring.
 *
 * IT NEVER CALLS A TOOL IT DID NOT REGISTER, EXCEPT THE TWO FORMS THE FIXTURE DECLARES. It writes
 * nothing anywhere, and it has no code path that could. That is a property of this file, not a
 * setting.
 *
 * TWO TRANSPORTS, ONE PROBE. The page loads a fixture in a same origin iframe and calls
 * `observeAll` inside it. The command line runner navigates a flagged Chrome to a URL and evaluates
 * the same source in the top document. Same observations either way, which is the only reason a
 * verdict from one is comparable with a verdict from the other.
 */

import { STEPS, STEP_ORDER, stepsFor, behavioursFrom, permittedSteps, refusalReason }
  from './steps.js';
import { checkFixtureIdentity, answerCarriesNonce, makeNonce, HANDLER_LOG_KEY } from './fixture_identity.js';

/** The two form tool names a fixture must publish for the declarative rows to be observable. */
export const FIXTURE_FORM_ANSWERS = 'nt_form_answers';
export const FIXTURE_FORM_SILENT = 'nt_form_silent';

/** How long to wait for a tool that may never settle, before calling it unsettled. */
const SETTLE_TIMEOUT_MS = 2500;

/** A tool name nothing else will collide with, unique per run. */
let counter = 0;
const probeName = (stem) => `nt_probe_${stem}_${Date.now().toString(36)}_${counter++}`;

/** Race a promise against a deadline without ever rejecting. */
function settle(promise, ms) {
  const started = Date.now();
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ settled: 'resolved', value, waitedMs: Date.now() - started }),
      (error) => ({
        settled: 'rejected',
        errName: String((error && error.name) || 'Error'),
        errMessage: String((error && error.message) || error),
        waitedMs: Date.now() - started,
      }),
    ),
    new Promise((resolve) => setTimeout(
      () => resolve({ settled: 'timeout', waitedMs: Date.now() - started }), ms,
    )),
  ]);
}

/** The tool object by name, from the live surface. */
async function toolNamed(ctx, name) {
  const tools = await ctx.getTools();
  return tools.find((t) => String(t.name) === name) || null;
}

/** Call a tool the way Chrome requires: the tool object, and the arguments as a JSON string. */
function call(ctx, tool, args) {
  return ctx.executeTool(tool, JSON.stringify(args === undefined ? {} : args));
}



/**
 * The tool list, once it has stopped changing.
 *
 * Polls until two consecutive reads agree, then once more after a quiet interval, up to the
 * deadline. It returns whatever it has when the deadline passes rather than throwing, because a
 * page whose surface never settles is itself a thing worth reporting, and the row that reads this
 * will say what it saw.
 *
 * @param {object} ctx
 * @param {number} [quietMs] how long the list must stay unchanged
 * @param {number} [timeoutMs]
 */
async function settledTools(ctx, quietMs = 600, timeoutMs = 6000) {
  const started = Date.now();
  let previous = null;
  let stableSince = null;
  let tools = await ctx.getTools();
  while (Date.now() - started < timeoutMs) {
    tools = await ctx.getTools();
    const signature = tools.map((t) => String(t.name)).sort().join('|');
    if (signature === previous) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) return tools;
    } else {
      previous = signature;
      stableSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return tools;
}

/**
 * Read the tools the page publishes, BEFORE this probe registers anything of its own.
 *
 * ORDER IS THE WHOLE POINT. Every browser row below works by registering a throwaway tool and
 * watching what the host does with it. If the page's own surface were read afterwards it would
 * contain the probe's tools, and every finding about "your tools" would be partly a finding about
 * ours. So this runs first, once, and everything in the your-page group is judged against this
 * snapshot rather than against the live list.
 *
 * `window` is compared rather than stored, because a Window cannot cross the boundary back to a
 * caller. What travels is whether it was this document or another one, and the origin.
 *
 * @param {object} ctx
 * @returns {Promise<object[]>} one plain record per tool the page published
 */
async function snapshotPageTools(ctx) {
  // WAIT FOR THE SURFACE TO SETTLE FIRST. A page registers its tools from a module that runs after
  // load, so reading the list the moment the document is complete catches a half built surface.
  // Measured on this suite's own page: the snapshot saw two tools when the page publishes five.
  // The list is therefore polled until it stops changing, and only then read.
  const tools = await settledTools(ctx);
  const here = typeof window === 'undefined' ? null : window;
  return tools.map((tool) => {
    let schema = null;
    let schemaError = null;
    try {
      schema = typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema;
    } catch (error) {
      schemaError = String((error && error.message) || error);
    }
    let fromThisDocument = null;
    try { fromThisDocument = tool.window === here; } catch { fromThisDocument = null; }
    return {
      name: String(tool.name),
      description: String(tool.description === undefined ? '' : tool.description),
      title: String(tool.title === undefined ? '' : tool.title),
      origin: String(tool.origin === undefined ? '' : tool.origin),
      annotationsTypeof: typeof tool.annotations,
      readOnlyHint: tool.annotations ? tool.annotations.readOnlyHint : undefined,
      untrustedContentHint: tool.annotations ? tool.annotations.untrustedContentHint : undefined,
      schema,
      schemaError,
      // A form derived tool carries no annotations at all, measured on every one of them. That is
      // the only discriminator the surface offers, so it is the one used, and it is named here
      // rather than buried at the call site.
      looksDeclarative: typeof tool.annotations === 'undefined',
      fromThisDocument,
    };
  });
}

/**
 * Build one well formed argument object from a tool's own schema.
 *
 * Only the shapes a synthesised value can be trusted for: a string, a number inside its bounds, a
 * boolean, and an enum's first option. Anything else is left out, which may make the call
 * incomplete, and that is why P5 compares two calls rather than judging one. A value invented for a
 * property this code does not understand would be worse than an absent one.
 *
 * @param {object} schema
 * @returns {object}
 */
function synthesiseArguments(schema) {
  const out = {};
  const properties = (schema && schema.properties) || {};
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  for (const key of Object.keys(properties)) {
    const property = properties[key] || {};
    if (Array.isArray(property.enum) && property.enum.length) { out[key] = property.enum[0]; continue; }
    if (property.type === 'string') { out[key] = 'ninthtool'; continue; }
    if (property.type === 'number' || property.type === 'integer') {
      const low = typeof property.minimum === 'number' ? property.minimum : 1;
      const high = typeof property.maximum === 'number' ? property.maximum : low + 1;
      out[key] = Math.min(high, Math.max(low, low));
      continue;
    }
    if (property.type === 'boolean') { out[key] = false; continue; }
    // Unknown shape. Include it only if the tool says it is required, so the call is at least
    // structurally complete, and use a string, which is what a model would most likely send.
    if (required.includes(key)) out[key] = 'ninthtool';
  }
  return out;
}


/*
 * WHEN THIS SUITE CANNOT DEFEND THE ARGUMENTS IT INVENTED.
 *
 * synthesiseArguments honours type, enum, minimum and maximum. A property that also declares
 * `format`, `pattern`, `minLength` and the rest gets a value that satisfies none of them, and a
 * required property whose type this code does not synthesise gets the string 'ninthtool' regardless
 * of what it asked for. Either way the call this suite calls WELL FORMED is not well formed, and a
 * comparison against it proves nothing about the page.
 *
 * THIS IS WHY THE ROW MISREAD TWO REAL PAGES. One declared a 64 hex character `pattern` and one a
 * `format` of date; both received 'ninthtool', both legs failed for the same reason, the answers
 * matched, and P5 reported the PAGE as ignoring its own required property. One of those pages had
 * rejected the omission on its first line.
 *
 * It is a guard on THIS suite's competence, not on the page's behaviour, so it names only what it
 * cannot honour. A property carrying nothing but `type` and a description is still fair game, which
 * is why the row keeps every defect it could previously prove: the tool that genuinely ignores a
 * plain string argument is untouched by this.
 */
const CONSTRAINTS_NOT_SYNTHESISED = ['format', 'pattern', 'minLength', 'maxLength',
  'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum'];
const TYPES_SYNTHESISED = ['string', 'number', 'integer', 'boolean'];

export function undefendableArguments(schema) {
  const properties = (schema && schema.properties) || {};
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  const reasons = [];
  for (const key of Object.keys(properties)) {
    const property = properties[key] || {};
    const unmet = CONSTRAINTS_NOT_SYNTHESISED.filter(
      (k) => Object.prototype.hasOwnProperty.call(property, k),
    );
    if (unmet.length) reasons.push(`"${key}" declares ${unmet.join(' and ')}`);
    const enumerated = Array.isArray(property.enum) && property.enum.length;
    if (!enumerated && required.includes(key) && !TYPES_SYNTHESISED.includes(property.type)) {
      reasons.push(`"${key}" is required and its type is ${property.type === undefined ? 'not declared' : property.type}`);
    }
  }
  return reasons;
}


/**
 * Exercise everything and return a transcript.
 *
 * @param {object} ctx a ModelContext, normally document.modelContext
 * @param {{url?: string, userAgent?: string}} [meta]
 * @returns {Promise<{meta: object, observations: object, errors: string[]}>}
 */
export async function observeAll(ctx, options = {}) {
  const meta = options.meta || {};
  const observations = {};
  const errors = [];
  const skipped = {};

  /*
   * WHAT WILL RUN IS DECIDED HERE, BEFORE ANYTHING RUNS.
   *
   * `only` is a list of behaviour ids. It selects the steps that produce them plus each step's
   * declared dependencies, and nothing else. Selecting A1 therefore registers one tool of our own
   * and calls it, and does not touch the page's tools, its forms, or any other row.
   *
   * `allow` is the authorisation. A step whose mode was not authorised is not run and the reason is
   * recorded, so the report says "not authorised" rather than pretending the row passed or that the
   * page was at fault.
   */
  const allow = options.allow || {};
  const requestedSteps = stepsFor(options.only && options.only.length ? options.only : null);
  const runnableSteps = permittedSteps(requestedSteps, allow);
  const selected = new Set(behavioursFrom(runnableSteps));

  for (const stepName of requestedSteps) {
    if (runnableSteps.includes(stepName)) continue;
    for (const id of STEPS[stepName].produces || []) skipped[id] = refusalReason(stepName);
  }

  // The per run nonce, and the fixture identity verdicts, established before any form is touched.
  // KEYED BY TOOL NAME, not a single run-wide boolean: one tool's identity is not another's, and
  // caching one decision for the whole run is what let an unrelated form be submitted.
  const nonce = makeNonce(options.random);
  const fixtureTrust = {};

  /*
   * WHETHER THIS RUN OWNS THE FIXTURE, decided before any row runs.
   *
   * Two ways to own it, and both are established without calling anything:
   *   'served-by-runner'  the command line served the bundled fixture from its own tree and
   *                       navigated to it, so the bytes under test are the bytes it shipped.
   *   'same-document'     the probe is executing INSIDE the document that publishes the forms,
   *                       which is how the page drives its own subject frame.
   *
   * Anything else is 'unproven', and unproven means no writes. The flag is passed IN by the caller
   * that actually knows, rather than inferred here from something a page could arrange.
   */
  const ownership = options.fixtureOwnership || 'unproven';
  const ownsFixture = ownership === 'served-by-runner'
    || (ownership === 'same-document' && options.expectedWindow
      && typeof window !== 'undefined' && options.expectedWindow === window);

  // BEFORE ANYTHING ELSE. Read the page's own surface while it is still only the page's own
  // surface. Everything in the your-page group is judged against this.
  let pageTools = [];
  try {
    pageTools = await snapshotPageTools(ctx);
  } catch (error) {
    errors.push(`could not read the page's own tools: ${String((error && error.message) || error)}`);
  }

  const controller = new AbortController();
  const opts = { signal: controller.signal };

  /** Register a throwaway tool that this run will withdraw. */
  const register = (descriptor) => ctx.registerTool(descriptor, opts);

  /**
   * Run one measurement, if it was selected and authorised, and record why not otherwise.
   *
   * A row that was not selected is absent from the transcript entirely, which is what lets a
   * scoped run report only what was asked for. A row that was selected and refused is recorded in
   * `skipped`, which the judge turns into not-applicable with the reason. Neither is ever a pass.
   */
  const step = async (id, fn) => {
    if (!selected.has(id)) return;
    try { observations[id] = await fn(); }
    catch (error) { errors.push(`${id}: ${String((error && error.message) || error)}`); }
  };

  /**
   * The bundled fixture, or null with the reason.
   *
   * Called only by steps whose mode is fixture-form. Four checks, all of which must hold, and the
   * fourth hands the document a nonce that its own handler has to echo. A page that merely declares
   * the tool name gets nothing submitted to it. Resolved once per run and cached, because the
   * checks write the nonce and repeating that is pointless.
   */
  /*
   * ONE DECISION PER TOOL, AND THE DECISION IS ABOUT THE TOOL WE ARE ABOUT TO WRITE TO.
   *
   * This used to prove whichever of the two fixture tools it found FIRST, cache that as a single
   * run-wide boolean, and then hand back whatever tool the caller asked for without checking it at
   * all. A trusted `nt_form_answers` in the bundled fixture therefore authorised an unrelated
   * `nt_form_silent` living in a different same-origin document, and that form was submitted.
   *
   * The identity now travels with the exact tool instance: it is resolved first, checked itself,
   * and cached under its own name only. Nothing is submitted to a tool that has not personally
   * passed origin, exact document path, build marker and the nonce channel.
   */
  const trustedFixture = async (toolName) => {
    /*
     * OWNERSHIP IS PROVED BEFORE ANYTHING IS WRITTEN, AND THE NONCE ECHO CANNOT DO THAT.
     *
     * The four checks ended by WRITING a nonce onto the document and returning trusted. The echo,
     * which is the only unforgeable half, was read from the answer to the FIRST CALL, and on a form
     * tool that call is the submission. So identity was confirmed one write too late.
     *
     * Reproduced against a page served at the expected path that copied the marker, which is a
     * public constant in this repository, and never read the nonce:
     *
     *   fixture identity : trusted true, "origin, document path, build marker and nonce channel all hold"
     *   form submissions : 1
     *
     * and the run's own error text admitted it: "One call was made and no further call was sent".
     *
     * WHY A CLEVERER CHECK WOULD BE A LIE. Everything a page exposes here is copyable: the tool
     * name, the pathname, the schema, and the marker. The nonce is not, but reading it back
     * requires calling the tool. There is no challenge WebMCP lets us issue that a document must
     * answer BEFORE it is invoked, so no amount of ordering makes an arbitrary page provable.
     *
     * So form writing is bound to a fixture this runner OWNS: one it served itself from its own
     * bundle, or the document the probe is running inside. Anything else is refused, and the rows
     * that need a write report not-applicable with the reason. That is narrower than before and it
     * is the only version of the promise that is true.
     */
    if (!ownsFixture) {
      throw new Error('this run cannot prove the page it was pointed at is the bundled fixture '
        + 'before writing to it. Every signal a page exposes here is copyable, the tool name, the '
        + 'pathname, the schema and the build marker, and the one that is not, the nonce echo, can '
        + 'only be read by calling the tool, which for a form IS the write. So nothing was '
        + 'submitted. Run this against the fixture this tool serves itself, with no URL, to '
        + 'measure the declarative rows');
    }

    if (Object.prototype.hasOwnProperty.call(fixtureTrust, toolName)) {
      const cached = fixtureTrust[toolName];
      if (!cached.decision.trusted) {
        throw new Error(`this page is not the bundled fixture, so nothing was submitted to it: `
          + `${cached.decision.reason}`);
      }
      return cached.tool;
    }

    // AMBIGUITY IS A REFUSAL. `toolNamed` took the first match and ignored the rest, so two
    // documents publishing the same name silently resolved to whichever the host listed first.
    // There is no safe way to pick, so we do not pick.
    const all = (await ctx.getTools()).filter((t) => String(t.name) === toolName);
    if (all.length > 1) {
      fixtureTrust[toolName] = {
        tool: null,
        decision: {
          trusted: false,
          reason: `${all.length} tools are published under the name ${toolName}, so which document `
            + `would be written to is ambiguous`,
        },
      };
      throw new Error(`this page is not the bundled fixture, so nothing was submitted to it: `
        + `${fixtureTrust[toolName].decision.reason}`);
    }

    const tool = all[0] || null;
    const decision = checkFixtureIdentity(tool, {
      expectedOrigin: options.expectedOrigin
        || (typeof location === 'undefined' ? '' : location.origin),
      expectedWindow: options.expectedWindow || null,
      expectedPath: options.expectedPath
        || (typeof location === 'undefined' ? '' : location.pathname),
      nonce,
    });
    fixtureTrust[toolName] = { tool, decision };

    if (!decision.trusted) {
      throw new Error(`this page is not the bundled fixture, so nothing was submitted to it: `
        + `${decision.reason}`);
    }
    return tool;
  };

  try {
    // ---------------------------------------------------------------- A1, the callback arity
    await step('A1', async () => {
      let seen = null;
      const name = probeName('arity');
      await register({
        name,
        description: 'Reports the shape of its own callback arguments.',
        inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
        annotations: { readOnlyHint: true },
        async execute(input, options) {
          seen = {
            argCount: arguments.length,
            optionsTypeof: typeof options,
            hasSignal: !!(options && options.signal),
          };
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      });
      await call(ctx, await toolNamed(ctx, name), { a: 'x' });
      if (!seen) throw new Error('the handler never ran');
      return seen;
    });

    // ---------------------------------------------------------------- A2, inputSchema round trip
    await step('A2', async () => {
      const name = probeName('schema');
      await register({
        name,
        description: 'Carries a schema, so the read back type can be seen.',
        inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        annotations: { readOnlyHint: true },
        async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
      });
      const tool = await toolNamed(ctx, name);
      return { inputSchemaTypeof: typeof tool.inputSchema };
    });

    // ------------------------------------------- A3 and B3, which annotations survive registration
    const annotationsSent = ['readOnlyHint', 'untrustedContentHint', 'consequentialHint',
      'destructiveHint', 'idempotentHint', 'openWorldHint'];
    let annotationsBack = [];
    await step('A3', async () => {
      const name = probeName('annotations');
      await register({
        name,
        description: 'Declares every annotation name in circulation.',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true,
          consequentialHint: true,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
        async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
      });
      const tool = await toolNamed(ctx, name);
      annotationsBack = Object.keys(tool.annotations || {});
      return { returnedAnnotationKeys: annotationsBack };
    });
    await step('B3', async () => ({
      sentAnnotationKeys: annotationsSent,
      returnedAnnotationKeys: annotationsBack,
      /*
       * WHOSE FINDING IS WHOSE.
       *
       * All six names go on one tool because registering six tools to ask one question would be
       * six times the side effect. But the two rows read different subsets of the same answer.
       *
       * A3 is about `consequentialHint`, which Chromium's own model_context_tool.idl declares and
       * this build drops: a divergence between the browser and its own IDL. B3 is about the three
       * names that belong to backend MCP and were never part of this standard. Counting
       * consequentialHint in both made one measured fact into two broken promises.
       */
      subject: ['destructiveHint', 'idempotentHint', 'openWorldHint'],
      measuredElsewhere: { consequentialHint: 'A3' },
    }));

    // -------------------------------------- B1 and B2, can a refusal reach the caller at all
    const REASON = 'REFUSED_STALE: the draft moved, quote revision 4.';
    await step('B1', async () => {
      const routes = [];

      const envelope = probeName('refuse_envelope');
      await register({
        name: envelope,
        description: 'Refuses by returning an isError envelope.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() { return { content: [{ type: 'text', text: REASON }], isError: true }; },
      });

      const thrown = probeName('refuse_throw');
      await register({
        name: thrown,
        description: 'Refuses by throwing an Error carrying the reason.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() { throw new Error(REASON); },
      });

      const domException = probeName('refuse_dom');
      await register({
        name: domException,
        description: 'Refuses by rejecting with a named DOMException.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() {
          return Promise.reject(new DOMException(REASON, 'InvalidStateError'));
        },
      });

      const probeRoute = async (label, name) => {
        const outcome = await settle(call(ctx, await toolNamed(ctx, name), {}), SETTLE_TIMEOUT_MS);
        const text = outcome.settled === 'rejected' ? outcome.errMessage : String(outcome.value ?? '');
        routes.push({
          route: label,
          settled: outcome.settled,
          errName: outcome.settled === 'rejected' ? outcome.errName : null,
          // Both halves matter. A resolved promise is not a failure however good its text, so a
          // route only counts when the caller sees a rejection AND the page's own words in it.
          pageMessageSurvived: outcome.settled === 'rejected' && text.includes('REFUSED_STALE'),
          callerSaw: text.slice(0, 200),
        });
      };
      await probeRoute('return { isError: true }', envelope);
      await probeRoute('throw Error', thrown);
      await probeRoute('reject DOMException("InvalidStateError")', domException);

      // B2 asks a narrower question of the first route: is isError a signal at all.
      const first = routes[0];
      observations.B2 = { settled: first.settled, callerSaw: first.callerSaw };

      return { routes };
    });

    // ---------------------------------------------------------------- B5, text or data
    await step('B5', async () => {
      const stringTool = probeName('returns_string');
      await register({
        name: stringTool,
        description: 'Returns a bare string.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() { return 'Added to-do: Buy milk'; },
      });
      const objectTool = probeName('returns_object');
      await register({
        name: objectTool,
        description: 'Returns a plain object.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() { return { title: 'a title', count: 3 }; },
      });
      const read = async (name) => {
        const out = await settle(call(ctx, await toolNamed(ctx, name), {}), SETTLE_TIMEOUT_MS);
        const value = out.value;
        let parses = false;
        try { JSON.parse(value); parses = true; } catch { parses = false; }
        return { typeofValue: typeof value, parsesAsJson: parses, sample: String(value).slice(0, 80) };
      };
      return { stringReturn: await read(stringTool), objectReturn: await read(objectTool) };
    });

    // ------------------------------------------------- C2, the conditional tool that must withdraw
    await step('C2', async () => {
      const listHas = async (name) => (await ctx.getTools()).some((t) => String(t.name) === name);
      const descriptorOf = (name) => ({
        name,
        description: 'A conditional tool that is supposed to withdraw.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async execute() { return { content: [{ type: 'text', text: 'still here' }] }; },
      });

      // The documented way: the signal goes in the options bag.
      const bagName = probeName('withdraw_bag');
      const bagController = new AbortController();
      await ctx.registerTool(descriptorOf(bagName), { signal: bagController.signal });
      const bagBefore = await listHas(bagName);
      bagController.abort();
      await new Promise((r) => setTimeout(r, 250));
      const bagAfter = await listHas(bagName);

      // The way a developer writes it when the descriptor already looks like an options object.
      const descName = probeName('withdraw_desc');
      const descController = new AbortController();
      await ctx.registerTool(
        { ...descriptorOf(descName), signal: descController.signal },
        opts,
      );
      const descBefore = await listHas(descName);
      descController.abort();
      await new Promise((r) => setTimeout(r, 250));
      const descAfter = await listHas(descName);

      return {
        optionsBag: { presentBefore: bagBefore, presentAfter: bagAfter },
        onDescriptor: { presentBefore: descBefore, presentAfter: descAfter },
      };
    });

    // ---------------------------------------------------------------- D1, the lifecycle event
    await step('D1', async () => {
      let onRegister = 0;
      let onWithdraw = 0;
      let withdrawing = false;
      const listener = () => { if (withdrawing) onWithdraw += 1; else onRegister += 1; };
      ctx.addEventListener('toolchange', listener);
      try {
        const name = probeName('lifecycle');
        const local = new AbortController();
        await ctx.registerTool({
          name,
          description: 'Registered and withdrawn, to see whether the event fires both ways.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true },
          async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
        }, { signal: local.signal });
        await new Promise((r) => setTimeout(r, 300));
        withdrawing = true;
        local.abort();
        await new Promise((r) => setTimeout(r, 400));
        return { onRegister, onWithdraw };
      } finally {
        ctx.removeEventListener('toolchange', listener);
      }
    });

    // ------------------------------- C3 script half: is a declared schema enforced at all
    let scriptEnforces = null;
    await step('C3', async () => {
      /*
       * THE SAME FOUR CONSTRAINTS ON BOTH HALVES, ONE PROBE EACH.
       *
       * This row used to test different things on each side: `required` and a wrong type on the
       * script path, an undeclared property on the form path. It then passed whenever the two
       * booleans matched, which meant it passed when NEITHER path enforced anything. An audit was
       * right to call that a fail open, and it also disagreed with C1, which had already measured
       * the form path ignoring `required`.
       *
       * So the script tool below declares a schema that mirrors the fixture form's synthesised one,
       * constraint for constraint, and both are sent the same four bad calls. What comes back is a
       * matrix, not a pair of booleans, and a constraint nobody enforces is a failure rather than
       * an agreement.
       */
      const form = await trustedFixture(FIXTURE_FORM_ANSWERS);
      const formSchema = typeof form.inputSchema === 'string'
        ? JSON.parse(form.inputSchema) : form.inputSchema;

      // Mirror it. The browser synthesised the form's schema from markup, so this is the closest a
      // script registered tool can come to declaring the same contract.
      const name = probeName('validation');
      let handlerSaw = null;
      await register({
        name,
        description: 'Declares the same constraints as the fixture form, and reports what it is handed.',
        inputSchema: formSchema,
        annotations: { readOnlyHint: true },
        async execute(input) { handlerSaw = input; return { content: [{ type: 'text', text: 'script ok' }] }; },
      });
      const scriptTool = await toolNamed(ctx, name);

      const properties = formSchema.properties || {};
      const required = Array.isArray(formSchema.required) ? formSchema.required : [];
      const numeric = Object.keys(properties).find((k) => properties[k].type === 'number');
      const enumerated = Object.keys(properties).find((k) => Array.isArray(properties[k].enum));
      const valid = synthesiseArguments(formSchema);

      // Does the mirrored schema actually express each constraint? A comparison of a constraint
      // neither side declares proves nothing, and is reported as not comparable rather than passed.
      const declares = {
        required: required.length > 0,
        type: Boolean(numeric),
        enumerated: Boolean(enumerated),
        /*
         * DERIVED, NOT ASSERTED. This read `unknownProperty: true`, a literal, so the row counted a
         * fourth constraint whether or not the schema expressed one. A JSON Schema forbids extra
         * properties only when it says `additionalProperties: false`; the form-derived schema this
         * browser synthesises does not, so nothing was ever declared here and "both refused it" was
         * a comparison of a rule neither side had.
         *
         * Every other entry in this object is read off the schema. This one now is too.
         */
        unknownProperty: formSchema.additionalProperties === false,
      };

      const badCalls = {
        required: declares.required ? (() => { const x = { ...valid }; delete x[required[0]]; return x; })() : null,
        type: declares.type ? { ...valid, [numeric]: 'not-a-number' } : null,
        enumerated: declares.enumerated ? { ...valid, [enumerated]: 'NINTHTOOL_NOT_AN_OPTION' } : null,
        unknownProperty: declares.unknownProperty
          ? { ...valid, ninthtool_undeclared_property: 'x' }
          : null,
      };

      /*
       * A CONTROL THAT SUCCEEDS, OR NOTHING BELOW MEANS ANYTHING.
       *
       * Every outcome was read from one bit: `settled === 'rejected'` became `enforced`, anything
       * else became `ignored`. So a host that refuses every call, for a reason having nothing to do
       * with any schema, scored as enforcing the whole of it. Reproduced against a fixture whose
       * host rejects every call with SERVICE_UNAVAILABLE:
       *
       *   VERDICT : pass, "3 of 3 enforced on both"
       *
       * on a run where no schema was ever looked at, and identical to a host that really enforces.
       *
       * Message matching cannot rescue it. Row B1 measured that this browser rejects as
       * UnknownError with the page's own reason erased, so there is no text to read a constraint
       * name out of. The only available discriminator is a controlled difference: does this half
       * ACCEPT a call that breaks nothing? A half that refuses the valid control has refused for a
       * reason of its own, and none of its other refusals can be attributed to a constraint.
       */
      const controlFor = async (tool) => {
        const outcome = await settle(call(ctx, tool, valid), SETTLE_TIMEOUT_MS);
        return {
          answered: outcome.settled === 'resolved',
          settled: outcome.settled,
          errName: outcome.errName || null,
          waitedMs: outcome.waitedMs,
        };
      };
      const controls = { script: await controlFor(scriptTool), form: await controlFor(form) };

      const constraints = [];
      for (const key of ['required', 'type', 'enumerated', 'unknownProperty']) {
        if (!declares[key] || badCalls[key] === null) {
          constraints.push({ name: key, declared: false, script: 'not-declared', form: 'not-declared', detail: 'the schema does not express this constraint' });
          continue;
        }
        handlerSaw = null;
        /*
         * FOUR OUTCOMES, NOT TWO. `enforced` only from a half that ANSWERED its control, because a
         * refusal from a half that refuses everything is not enforcement. `unattributable` when the
         * control failed, so an unavailable service and a browser error land there instead of being
         * scored as a pass. `inconclusive` on a timeout, which is neither a refusal nor an answer.
         */
        const verdictFrom = (outcome, control) => {
          if (!control.answered) return 'unattributable';
          if (outcome.settled === 'timeout') return 'inconclusive';
          return outcome.settled === 'rejected' ? 'enforced' : 'ignored';
        };

        const onScript = await settle(call(ctx, scriptTool, badCalls[key]), SETTLE_TIMEOUT_MS);
        const scriptVerdict = verdictFrom(onScript, controls.script);
        const sawOnScript = JSON.stringify(handlerSaw);

        const onForm = await settle(call(ctx, form, badCalls[key]), SETTLE_TIMEOUT_MS);
        const formVerdict = verdictFrom(onForm, controls.form);

        constraints.push({
          name: key,
          declared: true,
          script: scriptVerdict,
          form: formVerdict,
          detail: scriptVerdict === 'ignored'
            ? `the script handler received ${sawOnScript}`
            : 'the script path refused it',
        });
      }

      // scriptValidation's own summary, kept for anything that still reads it.
      scriptEnforces = constraints.filter((c) => c.declared).every((c) => c.script === 'enforced');

      return {
        constraints,
        // How we know the refusals mean anything. Without this the judge cannot tell a schema
        // refusal from a half that was never working.
        controls,
        formSchema: JSON.stringify(formSchema),
        scriptPathEnforces: scriptEnforces,
        formPathEnforces: constraints.filter((c) => c.declared).every((c) => c.form === 'enforced'),
      };
    });

    // B4 and D2 read a form derived tool. They prefer the fixture's, and fall back to whatever
    // declarative tool the page publishes, so they still measure something on a page of your own.
    const declarativeName = (pageTools.find((t) => t.name === FIXTURE_FORM_ANSWERS)
      || pageTools.find((t) => t.looksDeclarative) || {}).name || null;

    await step('B4', async () => {
      if (!declarativeName) throw new Error('this page publishes no form derived tool, so there is nothing to read');
      const form = await toolNamed(ctx, declarativeName);
      if (!form) throw new Error(`${declarativeName} left the surface before it could be read`);
      return { annotationsTypeof: typeof form.annotations, toolName: declarativeName };
    });

    await step('D2', async () => {
      if (!declarativeName) throw new Error('this page publishes no form derived tool, so there is no synthesised schema to read');
      const form = await toolNamed(ctx, declarativeName);
      if (!form) throw new Error(`${declarativeName} left the surface before it could be read`);
      return { schema: form.inputSchema, toolName: declarativeName };
    });

    await step('C1', async () => {
      // THIS ROW SUBMITS A FORM, WHICH IS A WRITE. It runs only against a page that passes all four
      // identity checks, and the first call's answer must carry this run's nonce or nothing further
      // is sent. Declaring the tool name is not enough and never was.
      const form = await trustedFixture(FIXTURE_FORM_ANSWERS);
      const seeded = 'M. Okafor';
      const first = await settle(call(ctx, form, { witness_name: seeded, age: 40, severity: 'dent' }), SETTLE_TIMEOUT_MS);
      const firstText = first.settled === 'resolved' ? String(first.value ?? '') : '';
      if (!answerCarriesNonce(firstText, nonce)) {
        throw new Error('the form answered without echoing this run\'s nonce, so it is not the '
          + 'bundled fixture handler. One call was made and no further call was sent');
      }
      /*
       * WHAT THE HANDLER SAW, READ FROM THE HANDLER RATHER THAN FROM ITS ANSWER.
       *
       * The leak used to be detectable only by finding the seeded value inside the RESOLVED answer.
       * A rejected call has no answer, so a handler that read the stale value and then rejected was
       * recorded as `handlerSawStaleValue: false` and the row passed. Reject-after-read was the one
       * shape this row could not see, and it is the worst one.
       *
       * The fixture now records what it was handed the moment it was handed it, before anything is
       * resolved. This reads that channel, and reads only the entries this call added.
       */
      /*
       * READ FROM THE FIXTURE'S WINDOW, NOT THE PROBE'S.
       *
       * The handler writes into the document that owns the form. On the command line's bundled run
       * that document is a FRAME and the probe is the top document, so reading `window[...]` here
       * found nothing and the row abstained on a page that reports perfectly well. The tool carries
       * a reference to the document that registered it, and that is the one to ask.
       */
      const readHandlerLog = () => {
        try {
          const log = form.window[HANDLER_LOG_KEY];
          return Array.isArray(log) ? log.slice() : null;
        } catch { return null; }
      };
      const before = readHandlerLog();

      // Only now, with the handler proved, the call that omits the required property.
      const second = await settle(call(ctx, form, { age: 41 }), SETTLE_TIMEOUT_MS);
      const text = second.settled === 'resolved' ? String(second.value ?? '') : '';

      const after = readHandlerLog();
      const telemetry = after === null ? 'unavailable' : 'read';
      const added = after === null ? [] : after.slice(before === null ? 0 : before.length);
      const sawStale = added.filter((entry) => entry && entry.saw
        && Object.values(entry.saw).some((v) => String(v) === seeded));

      return {
        settled: second.settled,
        // EITHER route counts as a leak: the handler telling us, or the answer carrying it back.
        handlerSawStaleValue: sawStale.length > 0 || text.includes(seeded),
        staleValue: (sawStale.length > 0 || text.includes(seeded)) ? seeded : null,
        // How we know, so a reader can tell a proven-clean run from one that could not look.
        handlerTelemetry: telemetry,
        handlerCallsObserved: added.length,
        callerSaw: text.slice(0, 200),
        nonceEchoed: true,
      };
    });

    await step('C4', async () => {
      // Same rule as C1. Calling a form tool that carries no annotations could submit it, so this
      // runs only against a page that passes the identity checks.
      const silent = await trustedFixture(FIXTURE_FORM_SILENT);
      const outcome = await settle(call(ctx, silent, { anything: 'x' }), SETTLE_TIMEOUT_MS);
      return { settled: outcome.settled, waitedMs: outcome.waitedMs };
    });

    /* ---------------------------------------------------------------- your page
     * Judged against `pageTools`, the snapshot taken before this probe registered anything.
     * Every row throws rather than guesses when the page published nothing, so a page with no
     * WebMCP at all reports `not applicable` with the reason instead of a clean sheet.
     */
    const requireTools = () => {
      if (!pageTools.length) {
        throw new Error('this page publishes no WebMCP tools, so there is nothing of yours to check');
      }
      return pageTools;
    };

    await step('P1', async () => {
      const tools = requireTools();
      const noAnnotations = tools.filter((t) => t.annotationsTypeof !== 'object').map((t) => t.name);
      const noHint = tools
        .filter((t) => t.annotationsTypeof === 'object' && typeof t.readOnlyHint !== 'boolean')
        .map((t) => t.name);
      return {
        toolCount: tools.length,
        withoutAnnotations: noAnnotations,
        withoutReadOnlyHint: noHint,
        readOnlyCount: tools.filter((t) => t.readOnlyHint === true).length,
      };
    });

    await step('P2', async () => {
      const tools = requireTools();
      const bad = [];
      for (const tool of tools) {
        if (tool.schemaError) { bad.push(`${tool.name}: schema did not parse, ${tool.schemaError}`); continue; }
        if (!tool.schema || typeof tool.schema !== 'object') { bad.push(`${tool.name}: no schema`); continue; }
        if (tool.schema.type !== 'object') { bad.push(`${tool.name}: schema type is ${JSON.stringify(tool.schema.type)}, not object`); continue; }
        /*
         * A SCHEMA CAN SAY object AND STILL CARRY NOTHING A CONSUMER CAN READ.
         *
         * `type` was the only thing checked, so `{type: 'object', properties: 'not-an-object'}`
         * counted as a readable object schema and P2 passed. Every consumer of this schema, this
         * probe included, then reads `.properties` and gets a string. Declaring the container and
         * filling it with the wrong thing is exactly the class of defect this row exists to find.
         */
        const properties = tool.schema.properties;
        if (properties !== undefined && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) {
          bad.push(`${tool.name}: properties is ${Array.isArray(properties) ? 'an array' : JSON.stringify(properties)}, not an object`);
        }
      }
      return { toolCount: tools.length, unusableSchemas: bad };
    });

    await step('P3', async () => {
      const tools = requireTools();
      const undescribedTools = tools.filter((t) => t.description.trim().length < 10).map((t) => t.name);
      const undescribedParams = [];
      for (const tool of tools) {
        const properties = (tool.schema && tool.schema.properties) || {};
        for (const key of Object.keys(properties)) {
          const property = properties[key] || {};
          if (typeof property.description !== 'string' || property.description.trim() === '') {
            undescribedParams.push(`${tool.name}.${key}`);
          }
        }
      }
      return { toolCount: tools.length, undescribedTools, undescribedParams };
    });

    await step('P4', async () => {
      const tools = requireTools();
      const elsewhere = tools
        .filter((t) => t.fromThisDocument === false)
        .map((t) => `${t.name} (origin ${t.origin})`);
      return { toolCount: tools.length, fromOtherDocuments: elsewhere };
    });

    await step('P5', async () => {
      const tools = requireTools();
      const readOnly = tools.filter((t) => t.readOnlyHint === true);
      const skipped = tools
        .filter((t) => t.readOnlyHint !== true)
        .map((t) => `${t.name}: ${t.annotationsTypeof === 'object' ? 'not marked readOnlyHint' : 'carries no annotations'}`);

      const testable = [];
      for (const record of readOnly) {
        const required = (record.schema && Array.isArray(record.schema.required)) ? record.schema.required : [];
        if (!required.length) {
          skipped.push(`${record.name}: declares no required properties, so there is nothing to break`);
          continue;
        }
        const properties = (record.schema && record.schema.properties) || {};
        if (!Object.prototype.hasOwnProperty.call(properties, required[0])) {
          skipped.push(`${record.name}: requires "${required[0]}" which is not in its own properties, `
            + 'so removing it would change nothing to send');
          continue;
        }
        const undefendable = undefendableArguments(record.schema);
        if (undefendable.length) {
          skipped.push(`${record.name}: this suite cannot build a call it can defend as well formed, `
            + `because ${undefendable.join(', ')}, and a comparison against a call that may itself `
            + 'be invalid cannot show what the page did with the missing property');
          continue;
        }
        testable.push(record);
      }

      const refused = [];
      const ignored = [];
      const inconclusive = [];
      for (const record of testable) {
        const tool = await toolNamed(ctx, record.name);
        if (!tool) continue;
        const wellFormed = synthesiseArguments(record.schema);
        const broken = { ...wellFormed };
        delete broken[record.schema.required[0]];

        /*
         * COUNTERBALANCED, BECAUSE FIXED ORDER CANNOT SEE CAUSE.
         *
         * This sent the well formed call and then the broken one, always in that order, and read a
         * rejection of the second as validation. A tool that rejects every SECOND call, for reasons
         * having nothing to do with its arguments, therefore scored exactly like a tool that checks
         * its input. Reproduced against a fake host: an alternator returned "all 1 rejected it",
         * verdict pass, indistinguishable from a real validator.
         *
         * The order is now good, bad, bad, good. Each kind is sent twice and neither kind owns a
         * position, so a refusal counts only when it tracks the INPUT: every broken call refused and
         * no well formed call refused. Anything else is reported as inconclusive rather than scored,
         * because a tool that refuses unpredictably has not demonstrated validation.
         *
         * Four calls rather than two. They go only to tools the page marked readOnlyHint, and only
         * with --allow-tool-calls, which is the same authorisation the two calls already needed.
         */
        const plan = [
          { kind: 'good', args: wellFormed },
          { kind: 'bad', args: broken },
          { kind: 'bad', args: broken },
          { kind: 'good', args: wellFormed },
        ];
        const results = [];
        for (const leg of plan) {
          results.push({ kind: leg.kind, ...(await settle(call(ctx, tool, leg.args), SETTLE_TIMEOUT_MS)) });
        }
        const goods = results.filter((r) => r.kind === 'good');
        const bads = results.filter((r) => r.kind === 'bad');
        const good = goods[0];
        const bad = bads[0];

        // THE CONTROL. If a well formed call did not succeed, the comparison is meaningless: two
        // failures that differ prove nothing about validation. Say so rather than scoring it.
        if (goods.some((r) => r.settled !== 'resolved')) {
          const how = goods.map((r) => r.settled).join(' then ');
          inconclusive.push(`${record.name}: a well formed call itself failed (${how}), so either `
            + 'there was nothing to compare against, or the failures do not track the arguments');
          continue;
        }

        const goodText = String(good.value ?? '');
        const badText = bad.settled === 'resolved' ? String(bad.value ?? '') : `[${bad.settled}]`;

        // A refusal that does not track the input is not a refusal, it is noise with a pattern.
        const rejectedBads = bads.filter((r) => r.settled === 'rejected').length;
        if (rejectedBads > 0 && rejectedBads < bads.length) {
          inconclusive.push(`${record.name}: rejected ${rejectedBads} of ${bads.length} identical `
            + 'broken calls, so the rejection does not track the arguments');
          continue;
        }

        if (rejectedBads === bads.length) {
          // The only failure signal WebMCP has. Behaviour B1 measured that it erases the reason,
          // which is a separate finding; as a signal that the tool refused, it is unambiguous.
          // Every broken call refused and every well formed one answered, in both orders.
          refused.push(`${record.name}: rejected every broken call and answered every well formed `
            + 'one, in both orders');
        } else if (badText === goodText) {
          // The tool answered a call missing a required property exactly as it answered a complete
          // one. It did not look at its input. This is the only outcome that PROVES a defect.
          ignored.push(`${record.name}: omitting ${record.schema.required[0]} changed nothing in the answer`);
        } else {
          // Different text is NOT proof of validation. It could be a refusal, or it could be the
          // tool echoing its arguments. An earlier version of this row counted it as a pass, which
          // an audit was right to reject. It is reported as what it is.
          inconclusive.push(`${record.name}: answered differently, which is consistent with a refusal `
            + 'and also with the tool simply echoing what it was sent');
        }
      }

      return { attempted: testable.map((t) => t.name), refused, ignored, inconclusive, skipped };
    });

    await step('P6', async () => {
      const tools = requireTools();
      const readOnly = tools.filter((t) => t.readOnlyHint === true);
      if (readOnly.length < 2) {
        throw new Error(`this page publishes ${readOnly.length} read only tool(s), and a differential `
          + 'needs at least two: one to call and one to read the state with');
      }

      /*
       * WHAT THIS ROW CAN AND CANNOT SAY.
       *
       * It cannot prove that readOnlyHint is honest. A tool can change state no tool on this page
       * reports, and nothing observable from here would show it. An earlier version of this row
       * claimed the broad thing and an audit was right to reject it. What it does is narrower and
       * stated as such: a DIFFERENTIAL OBSERVATION over the answers the page's own read only tools
       * give, using arguments each tool's own schema says are valid.
       *
       * THE STABILITY CONTROL COMES FIRST. Reading the oracles is itself calling tools, so the
       * baseline is built by the very thing being measured. Before attributing any change to any
       * tool, the oracles are read twice with no call in between. If those two reads already
       * disagree, this surface is not stable enough for a differential and the row abstains rather
       * than blaming whichever tool happened to be called next.
       */
      /*
       * EACH READ RECORDS TWO THINGS: THE ANSWER, AND WHETHER THE CALL RESOLVED AT ALL.
       *
       * The answer alone was a fail open. `[rejected]` is a constant, so a page whose read only
       * tools reject every invocation produced two identical control reads, an empty `moved`, and a
       * confident PASS on a run in which nothing was ever read. Reproduced against a fake host:
       * all-reject and all-timeout both gave verdict=pass, complete=true.
       *
       * Resolution is RECORDED here rather than sniffed back out of the text by the judge, because
       * a tool is free to resolve with the literal string "[rejected]" and nothing downstream could
       * then tell that answer from a rejection. The probe knows. The judge would have to guess.
       */
      /*
       * THE TARGET IS READ LAST, OR ITS OWN SELF READ ERASES WHAT IT DID.
       *
       * This walked `readOnly` in list order every time, so the re-read that is supposed to DETECT a
       * side effect began by calling the very tool that caused it. A tool whose next call restores
       * what its previous one moved therefore cleaned up before any independent oracle looked.
       *
       * Reproduced against a fake host where calling A moves state B reports and A's next call puts
       * it back: `moved: []`, verdict pass, "calling any of them did not change what the others
       * answered", on a run where A demonstrably moved it.
       *
       * `readLast` names the tool just called, so every other oracle is read while the effect is
       * still there and the target is read afterwards, which is where a self change belongs anyway.
       */
      const readOracles = async (readLast = null) => {
        const answers = {};
        const settledAs = {};
        const resolved = [];
        const order = readLast
          ? [...readOnly.filter((r) => r.name !== readLast), ...readOnly.filter((r) => r.name === readLast)]
          : readOnly;
        for (const record of order) {
          const tool = await toolNamed(ctx, record.name);
          if (!tool) {
            answers[record.name] = '[gone from the surface]';
            settledAs[record.name] = 'gone from the surface';
            continue;
          }
          // Schema valid arguments, not {}. A tool that requires an argument answers an empty
          // object with an error, and an error that varies is not a state change.
          const outcome = await settle(call(ctx, tool, synthesiseArguments(record.schema)), SETTLE_TIMEOUT_MS);
          answers[record.name] = outcome.settled === 'resolved' ? String(outcome.value ?? '') : `[${outcome.settled}]`;
          settledAs[record.name] = outcome.settled;
          if (outcome.settled === 'resolved') resolved.push(record.name);
        }
        return { answers, settledAs, resolved };
      };

      const controlA = await readOracles();
      const controlB = await readOracles();
      const unstable = Object.keys(controlA.answers).filter((k) => controlA.answers[k] !== controlB.answers[k]);

      // THE CONTROL MEASUREMENT, NAMED PER ORACLE. An oracle counts as having answered only if it
      // resolved in BOTH control reads. One resolution and one rejection is not a reading; that
      // case is instability, which the check below already reports.
      const names = readOnly.map((t) => t.name);
      const controlAnswered = names.filter(
        (name) => controlA.resolved.includes(name) && controlB.resolved.includes(name),
      );
      // The ones that did not answer, WITH how each read ended, so all-reject, all-timeout and a
      // mixture stay distinguishable instead of collapsing into one empty list.
      const controlUnanswered = names
        .filter((name) => !controlAnswered.includes(name))
        .map((name) => `${name}: ${controlA.settledAs[name]} then ${controlB.settledAs[name]}`);

      if (unstable.length) {
        return {
          oracleCount: readOnly.length,
          oracles: names,
          stable: false,
          unstable,
          moved: [],
          selfChanged: [],
          controlAnswered,
          controlUnanswered,
        };
      }

      // The baseline is controlB, established and confirmed before any attributed call.
      // COPIED rather than aliased: the loop below overwrites entries as it attributes them, and
      // controlB is still the record of what the control actually measured.
      const baseline = { ...controlB.answers };
      const moved = [];
      const selfChanged = [];
      for (const record of readOnly) {
        const tool = await toolNamed(ctx, record.name);
        if (!tool) continue;
        await settle(call(ctx, tool, synthesiseArguments(record.schema)), SETTLE_TIMEOUT_MS);
        // The others first, this tool last. See readOracles.
        const after = await readOracles(record.name);
        for (const oracle of Object.keys(baseline)) {
          if (after.answers[oracle] === baseline[oracle]) continue;
          // Self observation is REPORTED, not excluded. A tool whose own answer drifts is the one
          // thing the previous version structurally could not name, because it skipped itself and
          // then blamed the next tool called.
          if (oracle === record.name) selfChanged.push(`${record.name}: its own answer changed between reads`);
          else moved.push(`${record.name} changed what ${oracle} answers`);
          baseline[oracle] = after.answers[oracle];
        }
      }

      return {
        oracleCount: readOnly.length,
        oracles: names,
        stable: true,
        unstable: [],
        moved,
        selfChanged,
        controlAnswered,
        controlUnanswered,
      };
    });

  } finally {
    // Whatever happened, take the probe's own tools back off the surface.
    controller.abort();
  }

  return {
    meta: {
      url: meta.url || (typeof document !== 'undefined' ? document.URL : null),
      userAgent: meta.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
      api: 'document.modelContext',
    },
    observations,
    errors,
    // What was asked for, what was allowed to run, and what was refused. A reader can tell a row
    // that was never selected from a row that was selected and refused, and neither reads as a pass.
    scope: {
      requestedBehaviours: options.only && options.only.length ? [...options.only] : null,
      steps: runnableSteps,
      refusedSteps: requestedSteps.filter((name) => !runnableSteps.includes(name)),
      selectedBehaviours: [...selected],
      allow: { toolCalls: allow.toolCalls === true, fixtureForms: allow.fixtureForms === true },
      nonceIssued: Boolean(nonce),
      // One row per tool that was actually asked for, so a reader can tell WHICH document was
      // trusted rather than reading a single boolean that covered whatever was found first.
      fixture: Object.keys(fixtureTrust).length
        ? Object.fromEntries(Object.entries(fixtureTrust).map(([name, entry]) => [
          name, { trusted: entry.decision.trusted, reason: entry.decision.reason },
        ]))
        : null,
    },
    skipped,
    // The page's own surface, as it was before this probe touched it. A reader can check every
    // your-page finding against this without rerunning anything.
    pageTools: pageTools.map((tool) => ({
      name: tool.name,
      origin: tool.origin,
      readOnlyHint: tool.readOnlyHint,
      annotations: tool.annotationsTypeof,
      declarative: tool.looksDeclarative,
      fromThisDocument: tool.fromThisDocument,
    })),
  };
}

/**
 * Find the host object, and say plainly when there is not one.
 *
 * `navigator.modelContext` was measured absent in Chrome 152, where only `document.modelContext`
 * exists. The fallback is kept because the W3C draft attaches it to Document only and a future host
 * may differ, and because reading it costs nothing. What is not kept is the old behaviour of
 * carrying on with a null context and reporting success.
 *
 * @returns {{ctx: object|null, where: string|null, reason: string|null}}
 */
export function findModelContext(doc, nav) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (d && d.modelContext) return { ctx: d.modelContext, where: 'document.modelContext', reason: null };
  if (n && n.modelContext) return { ctx: n.modelContext, where: 'navigator.modelContext', reason: null };
  return {
    ctx: null,
    where: null,
    reason: 'This browser exposes no WebMCP host object. Chrome and Edge need the feature enabled '
      + 'at chrome://flags/#enable-webmcp-testing, and the page must be a secure context and origin '
      + 'isolated.',
  };
}
