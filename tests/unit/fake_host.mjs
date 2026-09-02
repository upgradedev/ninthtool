/**
 * A WebMCP host you can configure to misbehave, so the PROBE can be measured instead of described.
 *
 * WHY A FAKE HOST AND NOT A TRANSCRIPT. Everything under tests/unit that judges a run reads a
 * hand written transcript from tests/support/transcripts.mjs. That is the right shape for testing
 * src/judge/verdict.js, which is a pure function over a transcript. It is the wrong shape for
 * testing src/probe/observe.js, because a hand written transcript is written from the same
 * assumption the probe is being checked for. If the probe reads a host's callback arity wrongly,
 * a fixture that already says `argCount: 1` agrees with it.
 *
 * So this file is a host, not a transcript. `observeAll` runs against it for real: it registers
 * tools, calls them, aborts controllers, listens for events, and the transcript that comes out is
 * the thing under test. tests/unit/p5_causality.test.js and tests/unit/fixture_ownership.test.js
 * already do this for two rows; this generalises their fake to the whole surface.
 *
 * TWO PROFILES, BOTH TAKEN FROM MEASUREMENT. `conformingHost()` behaves the way the catalogue says
 * a host should. `chrome152Host()` reproduces what Chrome 152.0.7977.65 was measured doing on
 * 2026-09-01, as transcribed in tests/support/transcripts.mjs. A probe that reads the surface
 * honestly reports two different transcripts from the same code. A probe that guesses reports one.
 *
 * NOTHING HERE TOUCHES A NETWORK, A BROWSER OR A DISK. Every object is built in memory and thrown
 * away with the test.
 */

/**
 * The tool object a host hands back from `getTools()`.
 *
 * `annotations` is deliberately ABSENT rather than undefined-valued when a page tool declares none,
 * because `observe.js` discriminates a form derived tool with `typeof tool.annotations ===
 * 'undefined'` and an own property holding undefined would answer that test the same way for the
 * wrong reason. Building it by deletion keeps the two cases distinguishable if that ever changes.
 */
function toolView(descriptor, options) {
  const view = { name: String(descriptor.name) };

  // A page is free to publish a tool with no description and no origin at all. The probe coerces
  // both to the empty string, and a test that never sees an absent one never exercises that.
  if (descriptor.description !== undefined) view.description = descriptor.description;
  if (!descriptor.noOrigin) {
    view.origin = descriptor.origin === undefined ? options.origin : descriptor.origin;
  }
  if (descriptor.title !== undefined) view.title = descriptor.title;

  // The read back type of inputSchema is behaviour A2's whole question, so the host decides it.
  if (descriptor.inputSchema !== undefined) {
    view.inputSchema = options.schemaReadBack === 'string' && typeof descriptor.inputSchema !== 'string'
      ? JSON.stringify(descriptor.inputSchema)
      : descriptor.inputSchema;
  }

  // Which annotation names survive registration is behaviours A3 and B3. A host that drops the
  // object itself rather than thinning it is a third answer, and the probe has to survive it.
  if (descriptor.annotations !== undefined && !options.dropAnnotations) {
    const kept = {};
    for (const key of Object.keys(descriptor.annotations)) {
      if (options.keepAnnotations === null || options.keepAnnotations.includes(key)) {
        kept[key] = descriptor.annotations[key];
      }
    }
    view.annotations = kept;
  }

  // The document that registered the tool. `observe.js` compares it against its own `window`,
  // which does not exist in node, so `null` is what "this document" looks like here.
  Object.defineProperty(view, 'window', {
    get() {
      if (descriptor.windowThrows) throw new Error('cross origin window access denied');
      return descriptor.window === undefined ? null : descriptor.window;
    },
    enumerable: false,
  });
  return view;
}

/** The text inside a `{ content: [{ type: 'text', text }] }` envelope, or null when there is none. */
function envelopeText(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.content)) return null;
  const first = value.content.find((part) => part && part.type === 'text');
  return first ? String(first.text) : '';
}

/**
 * Build a host.
 *
 * @param {object} [config]
 * @param {number} [config.handlerArgs] how many arguments the host hands a page's `execute`
 * @param {'object'|'string'} [config.schemaReadBack] the type `getTools()` reports for inputSchema
 * @param {string[]|null} [config.keepAnnotations] annotation names that survive, null keeps all
 * @param {'faithful'|'flattening'} [config.refusals] whether a refusal reaches the caller intact
 * @param {boolean} [config.serialiseResults] whether a non-string answer comes back JSON encoded
 * @param {boolean} [config.honourDescriptorSignal] whether an AbortSignal ON THE DESCRIPTOR works
 * @param {'both'|'register'|'none'} [config.toolchange] when the lifecycle event fires
 * @param {object[]} [config.pageTools] descriptors the page publishes before the probe arrives
 * @param {string} [config.origin] the origin every tool reports unless it names its own
 * @param {boolean} [config.getToolsThrows] a surface that cannot be read at all
 */
export function makeHost(config = {}) {
  const options = {
    handlerArgs: config.handlerArgs === undefined ? 2 : config.handlerArgs,
    schemaReadBack: config.schemaReadBack || 'object',
    keepAnnotations: config.keepAnnotations === undefined ? null : config.keepAnnotations,
    refusals: config.refusals || 'faithful',
    serialiseResults: config.serialiseResults === true,
    honourDescriptorSignal: config.honourDescriptorSignal !== false,
    toolchange: config.toolchange || 'both',
    origin: config.origin || 'https://host.test',
    dropAnnotations: config.dropAnnotations === true,
    enforceSchema: config.enforceSchema === true,
  };

  /** Every live tool, as { descriptor, view }. The view is what `getTools()` hands out. */
  const entries = [];
  for (const descriptor of config.pageTools || []) {
    entries.push({ descriptor, view: toolView(descriptor, options) });
  }

  /** What the probe did to this host, for tests that assert on side effects rather than answers. */
  const counts = { registered: 0, withdrawn: 0, calls: 0, byName: {} };

  const listeners = new Set();
  const fire = () => { for (const listener of [...listeners]) listener({ type: 'toolchange' }); };

  const withdraw = (entry) => {
    const at = entries.indexOf(entry);
    if (at === -1) return;
    entries.splice(at, 1);
    counts.withdrawn += 1;
    if (options.toolchange === 'both') fire();
  };

  const ctx = {
    async getTools() {
      if (config.getToolsThrows) throw new Error('this surface refuses to be read');
      return entries.map((entry) => entry.view);
    },

    async registerTool(descriptor, bag) {
      const entry = { descriptor, view: toolView(descriptor, options) };
      entries.push(entry);
      counts.registered += 1;

      // THE DOCUMENTED CHANNEL. A signal in the options bag withdraws the tool.
      if (bag && bag.signal) {
        if (bag.signal.aborted) withdraw(entry);
        else bag.signal.addEventListener('abort', () => withdraw(entry), { once: true });
      }
      // THE ONE A DEVELOPER WRITES BY MISTAKE. A signal on the descriptor itself. Behaviour C2 is
      // exactly whether this works, so whether it works is a setting rather than an assumption.
      if (options.honourDescriptorSignal && descriptor.signal) {
        if (descriptor.signal.aborted) withdraw(entry);
        else descriptor.signal.addEventListener('abort', () => withdraw(entry), { once: true });
      }

      if (options.toolchange !== 'none') fire();
      return { name: descriptor.name };
    },

    async executeTool(view, argsJson) {
      const entry = entries.find((candidate) => candidate.view === view);
      if (!entry) throw new Error(`no such tool on this surface: ${view && view.name}`);
      counts.calls += 1;
      counts.byName[entry.view.name] = (counts.byName[entry.view.name] || 0) + 1;

      // An oracle that leaves the surface part way through a differential. P6 has to say "gone
      // from the surface" rather than treat the absence as an answer.
      const vanish = config.vanishAfter;
      if (vanish && vanish.name === entry.view.name && counts.byName[vanish.name] >= vanish.calls) {
        withdraw(entry);
      }

      // A HALF THAT REFUSES EVERYTHING, for a reason having nothing to do with any schema. It is
      // the shape behaviour C3 used to score as full enforcement, because rejected meant enforced.
      if (config.refuseEveryCall) {
        throw translateRefusal(new Error(String(config.refuseEveryCall)), options.refusals);
      }

      let input = {};
      try { input = JSON.parse(argsJson || '{}'); } catch { input = {}; }

      // A host that checks the declared schema before the page's handler ever sees the call. This
      // is what behaviour C3 asks about, and neither answer to it can be assumed.
      if (options.enforceSchema) {
        const complaint = violatesSchema(entry.descriptor.inputSchema, input);
        if (complaint) throw translateRefusal(new Error(complaint), options.refusals);
      }

      // A host that answers without ever reaching the page's handler. The probe must not report an
      // arity it did not observe, so behaviour A1 has to fail loudly rather than guess.
      if (config.neverRunsHandlers) return 'ok';

      const handler = entry.descriptor.execute || entry.descriptor.run;
      if (typeof handler !== 'function') return 'ok';

      let answer;
      try {
        // A1's whole question. The host decides how many arguments a handler is handed, and the
        // probe has to report what it was rather than what the standard says it should be.
        answer = options.handlerArgs >= 2
          ? await handler(input, { signal: new AbortController().signal })
          : await handler(input);
      } catch (error) {
        throw translateRefusal(error, options.refusals);
      }

      // A refusal envelope. Whether the host turns it into a rejection is behaviour B1 route one.
      if (answer && typeof answer === 'object' && answer.isError === true) {
        const text = envelopeText(answer) || '';
        if (options.refusals === 'faithful') {
          const out = new Error(text);
          out.name = 'ToolRefused';
          throw out;
        }
        // The measured behaviour: the envelope resolves, and nothing downstream can tell that the
        // page meant to refuse.
        return text;
      }

      const text = envelopeText(answer);
      if (text !== null) return text;
      if (typeof answer === 'string') return answer;
      return options.serialiseResults ? JSON.stringify(answer) : answer;
    },

    addEventListener(type, listener) { if (type === 'toolchange') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'toolchange') listeners.delete(listener); },
  };

  return {
    ctx,
    counts,
    options,
    /** The live view objects, so a test can assert on what the surface holds right now. */
    names: () => entries.map((entry) => entry.view.name),
    /** Publish a tool after construction, for surfaces that change while the probe watches. */
    publish(descriptor) { entries.push({ descriptor, view: toolView(descriptor, options) }); },
    /** Take a page tool away, for the oracle that leaves mid differential. */
    remove(name) {
      const entry = entries.find((candidate) => candidate.view.name === name);
      if (entry) withdraw(entry);
    },
  };
}

/**
 * The first way a call breaks its own declared schema, or null when it keeps to it.
 *
 * Only the four constraints behaviour C3 sends bad calls for, because a host that enforced more
 * than the row asks about would make the row's matrix unreadable rather than stricter.
 *
 * @param {object|string} schema the tool's declared inputSchema
 * @param {object} input the parsed arguments
 * @returns {string|null}
 */
function violatesSchema(schema, input) {
  const declared = typeof schema === 'string' ? JSON.parse(schema) : schema;
  if (!declared || typeof declared !== 'object') return null;
  const properties = declared.properties || {};
  for (const key of (Array.isArray(declared.required) ? declared.required : [])) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return `${key} is required`;
  }
  for (const key of Object.keys(input)) {
    const property = properties[key];
    if (!property) {
      if (declared.additionalProperties === false) return `${key} is not a declared property`;
      continue;
    }
    if (Array.isArray(property.enum) && !property.enum.includes(input[key])) {
      return `${key} is not one of ${property.enum.join(', ')}`;
    }
    if (property.type === 'number' && typeof input[key] !== 'number') {
      return `${key} must be a number`;
    }
  }
  return null;
}

/**
 * What the caller sees when a handler rejected.
 *
 * `faithful` keeps the page's own name and words. `flattening` replaces both, which is what Chrome
 * 152 was measured doing and is the finding behind behaviour B1: the reason a page gives for
 * refusing does not reach whoever asked.
 */
function translateRefusal(error, mode) {
  if (mode === 'faithful') {
    const out = new Error(String((error && error.message) || error));
    out.name = String((error && error.name) || 'Error');
    return out;
  }
  const out = new Error('An unknown error occurred while executing the tool.');
  out.name = 'UnknownError';
  return out;
}

/** A host that keeps the promises in the catalogue. */
export function conformingHost(extra = {}) {
  return makeHost({
    handlerArgs: 2,
    schemaReadBack: 'object',
    keepAnnotations: null,
    refusals: 'faithful',
    serialiseResults: false,
    honourDescriptorSignal: true,
    toolchange: 'both',
    ...extra,
  });
}

/**
 * A host behaving the way Chrome 152.0.7977.65 was measured behaving on 2026-09-01.
 *
 * Every setting below is one transcribed row of tests/support/transcripts.mjs, and each is the
 * finding of a behaviour in the catalogue rather than an invention of this file.
 */
export function chrome152Host(extra = {}) {
  return makeHost({
    handlerArgs: 1,
    schemaReadBack: 'string',
    keepAnnotations: ['readOnlyHint', 'untrustedContentHint'],
    refusals: 'flattening',
    serialiseResults: true,
    honourDescriptorSignal: false,
    toolchange: 'both',
    ...extra,
  });
}

/** A read only page tool, described well enough that P1, P2 and P3 have nothing to report. */
export function readOnlyTool(name, over = {}) {
  return {
    name,
    description: `Reads ${name} and returns what it reads.`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Which one to read.' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true },
    async run() { return `${name}: steady`; },
    ...over,
  };
}

/**
 * A form derived tool.
 *
 * It carries NO `annotations` key at all, which is the only thing on the surface that separates a
 * tool the browser synthesised from markup from one a script registered. `observe.js` reads that
 * with `typeof tool.annotations === 'undefined'`, so the key has to be absent rather than present
 * and undefined.
 */
export function declarativeTool(name, over = {}) {
  return {
    name,
    description: `Submits the ${name} form.`,
    inputSchema: {
      type: 'object',
      properties: { witness_name: { type: 'string', description: 'Full name.' } },
      required: ['witness_name'],
    },
    async run() { return 'submitted'; },
    ...over,
  };
}
