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
 * Exercise everything and return a transcript.
 *
 * @param {object} ctx a ModelContext, normally document.modelContext
 * @param {{url?: string, userAgent?: string}} [meta]
 * @returns {Promise<{meta: object, observations: object, errors: string[]}>}
 */
export async function observeAll(ctx, meta = {}) {
  const observations = {};
  const errors = [];
  const controller = new AbortController();
  const opts = { signal: controller.signal };

  /** Register a throwaway tool that this run will withdraw. */
  const register = (descriptor) => ctx.registerTool(descriptor, opts);

  /** Run one measurement, and record why it could not be taken rather than losing the run. */
  const step = async (id, fn) => {
    try { observations[id] = await fn(); }
    catch (error) { errors.push(`${id}: ${String((error && error.message) || error)}`); }
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

    // ---------------------------------------------------------------- C2, the ninth tool
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
      const name = probeName('validation');
      let handlerSaw = null;
      await register({
        name,
        description: 'Declares a required string, and reports whatever it is handed.',
        inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        annotations: { readOnlyHint: true },
        async execute(input) { handlerSaw = input; return { content: [{ type: 'text', text: 'ok' }] }; },
      });
      const tool = await toolNamed(ctx, name);
      const missing = await settle(call(ctx, tool, {}), SETTLE_TIMEOUT_MS);
      const wrongType = await settle(call(ctx, tool, { a: 123 }), SETTLE_TIMEOUT_MS);
      scriptEnforces = missing.settled === 'rejected' && wrongType.settled === 'rejected';

      // The form half is measured against the fixture's own form, if the fixture published one.
      const form = await toolNamed(ctx, FIXTURE_FORM_ANSWERS);
      let formEnforces = null;
      if (form) {
        const bad = await settle(call(ctx, form, { not_a_real_parameter: 'x' }), SETTLE_TIMEOUT_MS);
        formEnforces = bad.settled === 'rejected';
      }
      if (formEnforces === null) {
        throw new Error(`no fixture form named ${FIXTURE_FORM_ANSWERS} on this page, so the form half could not be measured`);
      }
      return {
        scriptPathEnforces: scriptEnforces,
        formPathEnforces: formEnforces,
        handlerSawWhenRequiredMissing: JSON.stringify(handlerSaw),
      };
    });

    // ------------------------------- B4, C1, C4, D2: the declarative half, from the fixture
    await step('B4', async () => {
      const form = await toolNamed(ctx, FIXTURE_FORM_ANSWERS);
      if (!form) throw new Error(`no fixture form named ${FIXTURE_FORM_ANSWERS} on this page`);
      return { annotationsTypeof: typeof form.annotations };
    });

    await step('D2', async () => {
      const form = await toolNamed(ctx, FIXTURE_FORM_ANSWERS);
      if (!form) throw new Error(`no fixture form named ${FIXTURE_FORM_ANSWERS} on this page`);
      return { schema: form.inputSchema };
    });

    await step('C1', async () => {
      const form = await toolNamed(ctx, FIXTURE_FORM_ANSWERS);
      if (!form) throw new Error(`no fixture form named ${FIXTURE_FORM_ANSWERS} on this page`);
      // First a complete call, which leaves values in the controls.
      const seeded = 'M. Okafor';
      await settle(call(ctx, form, { witness_name: seeded, age: 40, severity: 'dent' }), SETTLE_TIMEOUT_MS);
      // Then a call that omits the property the synthesised schema marks required.
      const second = await settle(call(ctx, form, { age: 41 }), SETTLE_TIMEOUT_MS);
      const text = second.settled === 'resolved' ? String(second.value ?? '') : '';
      return {
        settled: second.settled,
        handlerSawStaleValue: text.includes(seeded),
        staleValue: text.includes(seeded) ? seeded : null,
        callerSaw: text.slice(0, 200),
      };
    });

    await step('C4', async () => {
      const silent = await toolNamed(ctx, FIXTURE_FORM_SILENT);
      if (!silent) throw new Error(`no fixture form named ${FIXTURE_FORM_SILENT} on this page`);
      const outcome = await settle(call(ctx, silent, { anything: 'x' }), SETTLE_TIMEOUT_MS);
      return { settled: outcome.settled, waitedMs: outcome.waitedMs };
    });
  } finally {
    // Whatever happened, take the probe's own tools back off the surface.
    controller.abort();
  }

  return {
    meta: {
      url: meta.url || (typeof location !== 'undefined' ? location.href : null),
      userAgent: meta.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
      api: 'document.modelContext',
    },
    observations,
    errors,
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
