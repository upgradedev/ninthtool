/**
 * The judge. A transcript goes in, a verdict comes out, and nothing else in this repository decides
 * anything.
 *
 * PURE MODULE. No DOM, no network, no timers, no browser globals, no clock. Given the same
 * transcript it returns the same verdict for ever, which is what makes it testable and what makes a
 * stored result checkable by a reader who does not trust us.
 *
 * WHY THE JUDGEMENT IS NOT IN THE PROBE. The first version of the probe this was grown from printed
 * what it saw and exited zero whatever that was. Pointed at a browser with no WebMCP it printed
 * "api: null" and reported success, so a run that proved nothing looked exactly like a run that
 * proved everything. Gathering and judging are now two modules, the judging one has no way to reach
 * a browser, and tests/unit/verdict_mutations.test.js breaks every rule below in turn and requires
 * a failure each time. A rule nobody has watched fail is not a rule.
 *
 * MISSING IS NOT PASSING. A behaviour the transcript does not cover is `not-applicable` with the
 * reason printed, never a pass. The counts at the bottom keep the three states apart, so "12 of 14"
 * can never be read as "2 failed" when it means "2 were never run".
 *
 * THE OBSERVED VALUE TRAVELS WITH THE VERDICT. Every finding carries what was expected, what was
 * seen and the command that reproduces it. A finding a reader cannot reproduce is an opinion.
 */

import { BEHAVIOURS, behaviourById, MEASURED_AGAINST, MEASURED_ON } from './behaviours.js';

/** A transcript that carries no observation for a behaviour gets this, and it is never a pass. */
const NOT_OBSERVED = 'the transcript carries no observation for this behaviour';

/**
 * One rule per behaviour.
 *
 * Each takes that behaviour's observation and returns `{ held, expected, observed }`.
 * `held: true` means the page or the browser did the conforming thing. A rule that cannot decide
 * throws, and decide() turns that into `not-applicable` with the message, because a rule that
 * guesses is worse than a rule that abstains.
 *
 * Read `held` as "the promise in the catalogue was kept". For the standard-gap rows that is
 * routinely false everywhere, which is the finding, not a defect in the page under test. The
 * `subject` field on the behaviour is what tells a reader whose problem it is.
 */
const RULES = {
  /** The handler is handed (input, options). Held only when a second argument arrives with a signal. */
  A1(o) {
    need(o, ['argCount', 'optionsTypeof']);
    return {
      held: o.argCount >= 2 && o.optionsTypeof === 'object' && o.hasSignal === true,
      expected: 'execute(input, options) with options.signal an AbortSignal',
      observed: `arguments.length=${o.argCount}, typeof options=${o.optionsTypeof}`
        + `, options.signal present=${o.hasSignal === true}`,
    };
  },

  /** The draft says inputSchema reads back as an object. Held only when it does. */
  A2(o) {
    need(o, ['inputSchemaTypeof']);
    return {
      held: o.inputSchemaTypeof === 'object',
      expected: 'typeof tool.inputSchema === "object", per the W3C draft',
      observed: `typeof tool.inputSchema === "${o.inputSchemaTypeof}"`,
    };
  },

  /** consequentialHint is in Chromium IDL. Held only when the browser gives it back. */
  A3(o) {
    need(o, ['returnedAnnotationKeys']);
    const keys = asArray(o.returnedAnnotationKeys);
    return {
      held: keys.includes('consequentialHint'),
      expected: 'consequentialHint survives registration, per Chromium model_context_tool.idl',
      observed: keys.length ? `annotations read back: ${keys.join(', ')}` : 'no annotations read back',
    };
  },

  /**
   * The flagship. Held only if SOME route lets a refusal reach the caller as a failure whose own
   * message survives. Both halves are required: a resolved promise is not a failure however good
   * its text, and a rejection that erases the reason tells the agent nothing it can act on.
   */
  B1(o) {
    need(o, ['routes']);
    // Deliberately NOT asArray: that helper stringifies, which is right for a list of annotation
    // names and wrong here, where each entry is a record. Stringifying turned every route into
    // "[object Object]" and the rule reported a failure with no readable reason. The tests caught
    // it, which is the only reason this comment exists rather than a silent bug.
    const routes = Array.isArray(o.routes) ? o.routes.filter((r) => r && typeof r === 'object') : [];
    if (!routes.length) throw new Error('no refusal routes were attempted');
    const usable = routes.filter((r) => r.settled === 'rejected' && r.pageMessageSurvived === true);
    const described = routes
      .map((r) => `${r.route}: ${r.settled}`
        + (r.settled === 'rejected' ? `, name=${r.errName}, reason survived=${r.pageMessageSurvived === true}` : ''))
      .join(' | ');
    return {
      held: usable.length > 0,
      expected: 'at least one route where the promise signals failure AND carries the page’s reason',
      observed: described,
    };
  },

  /** isError is held only if the browser treats it as a failure signal. It does not. */
  B2(o) {
    need(o, ['settled']);
    return {
      held: o.settled === 'rejected',
      expected: 'returning { isError: true } is surfaced to the caller as a failure',
      observed: `the promise ${o.settled}`
        + (o.settled === 'resolved' ? ', so the caller reads success' : ''),
    };
  },

  /** Held only if every annotation the page sent came back. */
  B3(o) {
    need(o, ['sentAnnotationKeys', 'returnedAnnotationKeys']);
    const sent = asArray(o.sentAnnotationKeys);
    const back = asArray(o.returnedAnnotationKeys);
    const dropped = sent.filter((k) => !back.includes(k));
    return {
      held: dropped.length === 0,
      expected: `all ${sent.length} annotations survive registration`,
      observed: dropped.length
        ? `${dropped.length} dropped with no error: ${dropped.join(', ')}`
        : 'none dropped',
    };
  },

  /** A declarative tool is held to carry annotations at all. */
  B4(o) {
    need(o, ['annotationsTypeof']);
    return {
      held: o.annotationsTypeof === 'object',
      expected: 'a form derived tool carries annotations, at least readOnlyHint',
      observed: `typeof tool.annotations === "${o.annotationsTypeof}"`,
    };
  },

  /** Held only if a caller can tell text from data without guessing. */
  B5(o) {
    need(o, ['stringReturn', 'objectReturn']);
    const s = o.stringReturn;
    const d = o.objectReturn;
    return {
      held: s.typeofValue !== d.typeofValue,
      expected: 'the caller can distinguish a text result from a data result',
      observed: `a string handler gave typeof "${s.typeofValue}" (${s.parsesAsJson ? 'parses' : 'does not parse'} as JSON)`
        + `, an object handler gave typeof "${d.typeofValue}" (${d.parsesAsJson ? 'parses' : 'does not parse'} as JSON)`,
    };
  },

  /**
   * The alarming one. Held only if omitting a required property is refused. It is a failure both
   * when the call succeeds and, worse, when the handler is handed a value from an earlier call.
   */
  C1(o) {
    need(o, ['settled']);
    const leaked = o.handlerSawStaleValue === true;
    return {
      held: o.settled === 'rejected',
      expected: 'a call omitting a required property is refused',
      observed: `the call ${o.settled}`
        + (leaked ? `, and the handler was handed "${String(o.staleValue)}" left by an earlier call` : ''),
    };
  },

  /** The ninth tool. Held only when the tool is gone after abort, by whichever route was tried. */
  C2(o) {
    need(o, ['optionsBag', 'onDescriptor']);
    const bagWorks = o.optionsBag.presentBefore === true && o.optionsBag.presentAfter === false;
    const descWorks = o.onDescriptor.presentBefore === true && o.onDescriptor.presentAfter === false;
    return {
      held: bagWorks && descWorks,
      expected: 'aborting the signal withdraws the tool, wherever the signal was passed',
      observed: `signal in the options bag: ${bagWorks ? 'withdraws' : 'does not withdraw'}`
        + `; signal on the descriptor: ${descWorks ? 'withdraws' : 'does NOT withdraw, and nothing is thrown'}`,
    };
  },

  /** Held only if both halves enforce the schema the same way. */
  /**
   * Held only when every constraint the schema declares is enforced on BOTH halves.
   *
   * It used to hold whenever two booleans matched, which meant it held when NEITHER half enforced
   * anything: agreement between two absences read as conformance. It also tested different
   * constraints on each side, so the two booleans were never comparable in the first place, and it
   * contradicted C1, which had already measured the form path ignoring `required`.
   *
   * The same four bad calls now go to both halves against schemas that declare the same
   * constraints, and a constraint nobody enforces is a failure rather than an agreement.
   */
  C3(o) {
    need(o, ['constraints']);
    const constraints = Array.isArray(o.constraints) ? o.constraints : [];
    const declared = constraints.filter((c) => c && c.declared);
    if (!declared.length) {
      throw new Error('the schema under test declares none of the constraints this row compares, '
        + 'so there was nothing to enforce on either half');
    }

    const say = (c) => `${c.name}: script ${c.script}, form ${c.form}`;
    const bothEnforce = declared.filter((c) => c.script === 'enforced' && c.form === 'enforced');
    const neitherEnforces = declared.filter((c) => c.script !== 'enforced' && c.form !== 'enforced');
    const disagree = declared.filter((c) => (c.script === 'enforced') !== (c.form === 'enforced'));

    return {
      held: bothEnforce.length === declared.length,
      expected: `all ${declared.length} declared constraints are enforced on both halves`,
      observed: `${bothEnforce.length} of ${declared.length} enforced on both`
        + (disagree.length ? `; ${disagree.length} enforced on one half only: ${disagree.map(say).join(', ')}` : '')
        + (neitherEnforces.length ? `; ${neitherEnforces.length} enforced by neither: ${neitherEnforces.map(say).join(', ')}` : ''),
    };
  },

  /** Held only if the tool answered. A timeout is a failure, not an inconclusive result. */
  C4(o) {
    need(o, ['settled']);
    return {
      held: o.settled === 'resolved' || o.settled === 'rejected',
      expected: 'a published tool settles, either answering or refusing',
      observed: o.settled === 'timeout'
        ? `never settled, still pending after ${Number(o.waitedMs) || 0} ms`
        : `the promise ${o.settled}`,
    };
  },

  /** Held when the event fires for both directions. */
  D1(o) {
    need(o, ['onRegister', 'onWithdraw']);
    return {
      held: Number(o.onRegister) > 0 && Number(o.onWithdraw) > 0,
      expected: 'toolchange fires on registration and on withdrawal',
      observed: `${Number(o.onRegister) || 0} on register, ${Number(o.onWithdraw) || 0} on withdraw`,
    };
  },

  /** Held when the browser built the constraints the markup declared. */
  D2(o) {
    need(o, ['schema']);
    const schema = typeof o.schema === 'string' ? safeParse(o.schema) : o.schema;
    if (!schema || typeof schema !== 'object') throw new Error('the synthesised schema was unreadable');
    const props = schema.properties || {};
    const found = [];
    for (const key of Object.keys(props)) {
      const p = props[key] || {};
      if (p.minimum !== undefined || p.maximum !== undefined) found.push('numeric bounds');
      if (Array.isArray(p.enum)) found.push('enum');
      if (typeof p.description === 'string' && p.description) found.push('descriptions');
    }
    const hasRequired = Array.isArray(schema.required) && schema.required.length > 0;
    if (hasRequired) found.push('required');
    const unique = [...new Set(found)];
    return {
      held: unique.length >= 3,
      expected: 'markup produces bounds, an enum, descriptions and a required list',
      observed: unique.length ? `synthesised: ${unique.join(', ')}` : 'nothing beyond bare properties',
    };
  },
  /* ---------------------------------------------------------------- your page
   * These read the tools the page published before the probe registered anything of its own, so a
   * failure here is a defect a page author can fix today. Everything above is the host.
   */

  /** Held when every published tool says whether it writes. */
  P1(o) {
    need(o, ['toolCount', 'withoutAnnotations', 'withoutReadOnlyHint']);
    if (Number(o.toolCount) === 0) throw new Error('this page publishes no tools');
    const silent = asArray(o.withoutAnnotations);
    const hintless = asArray(o.withoutReadOnlyHint);
    return {
      held: silent.length === 0 && hintless.length === 0,
      expected: `all ${o.toolCount} tools carry a readOnlyHint`,
      observed: silent.length || hintless.length
        ? [
          silent.length ? `${silent.length} carry no annotations at all: ${silent.join(', ')}` : '',
          hintless.length ? `${hintless.length} carry annotations without readOnlyHint: ${hintless.join(', ')}` : '',
        ].filter(Boolean).join('; ')
        : `all ${o.toolCount} tools say whether they write, ${o.readOnlyCount} are read only`,
    };
  },

  /** Held when every published tool declares a schema a consumer can actually read. */
  P2(o) {
    need(o, ['toolCount', 'unusableSchemas']);
    if (Number(o.toolCount) === 0) throw new Error('this page publishes no tools');
    const bad = asArray(o.unusableSchemas);
    return {
      held: bad.length === 0,
      expected: `all ${o.toolCount} tools declare a readable object schema`,
      observed: bad.length ? `${bad.length} unusable: ${bad.join('; ')}` : `all ${o.toolCount} schemas parsed`,
    };
  },

  /** Held when every tool and every parameter carries a description a model can use. */
  P3(o) {
    need(o, ['toolCount', 'undescribedTools', 'undescribedParams']);
    if (Number(o.toolCount) === 0) throw new Error('this page publishes no tools');
    const tools = asArray(o.undescribedTools);
    const params = asArray(o.undescribedParams);
    return {
      held: tools.length === 0 && params.length === 0,
      expected: 'every tool and every parameter is described',
      observed: tools.length || params.length
        ? [
          tools.length ? `${tools.length} tools with no usable description: ${tools.join(', ')}` : '',
          params.length ? `${params.length} undescribed parameters: ${params.join(', ')}` : '',
        ].filter(Boolean).join('; ')
        : `all ${o.toolCount} tools and every parameter described`,
    };
  },

  /** Held when nothing on the surface was registered by another document. */
  P4(o) {
    need(o, ['toolCount', 'fromOtherDocuments']);
    if (Number(o.toolCount) === 0) throw new Error('this page publishes no tools');
    const elsewhere = asArray(o.fromOtherDocuments);
    return {
      held: elsewhere.length === 0,
      expected: 'every tool on the surface was registered by this document',
      observed: elsewhere.length
        ? `${elsewhere.length} came from another document: ${elsewhere.join(', ')}`
        : `all ${o.toolCount} tools were registered by this document`,
    };
  },

  /**
   * Held when every read only tool noticed a call that omitted one of its own required properties.
   *
   * NOT the extra property rule an earlier draft used. JSON Schema allows additional properties
   * unless a schema says otherwise, so accepting one was never a defect. Breaking the tool's own
   * required list is, because the browser enforces nothing on the script path and that array is a
   * promise only the page can keep.
   *
   * Two kinds of page cannot be measured here and both say so rather than passing: one with no
   * tools marked read only, because calling a tool the page has not marked safe is the thing this
   * probe will not do, and one whose read only tools declare no required array, because there is
   * then nothing to break.
   */
  /**
   * Held only when a refusal was actually DEMONSTRATED, never merely not disproved.
   *
   * An earlier version passed on "answered differently", which is consistent with a refusal and
   * equally consistent with the tool echoing what it was sent. It could therefore pass with nothing
   * noticed at all, which an audit was right to call structural. Three outcomes now, and only one
   * of them is a pass:
   *
   *   rejected      the only failure signal WebMCP has. Unambiguous. Counts.
   *   identical     the tool answered a broken call exactly as it answered a good one. It did not
   *                 look at its input. This is the only outcome that PROVES a defect.
   *   different     inconclusive, and reported as inconclusive rather than scored either way.
   */
  P5(o) {
    need(o, ['attempted', 'refused', 'ignored', 'inconclusive', 'skipped']);
    const attempted = asArray(o.attempted);
    const refused = asArray(o.refused);
    const ignored = asArray(o.ignored);
    const inconclusive = asArray(o.inconclusive);
    const skipped = asArray(o.skipped);

    if (attempted.length === 0) {
      throw new Error('no tool on this page is both marked readOnlyHint and declares a required '
        + `property that is in its own schema, and this probe calls nothing else. `
        + `Skipped: ${skipped.join('; ') || 'nothing'}`);
    }
    if (ignored.length === 0 && refused.length === 0) {
      throw new Error(`nothing was demonstrated either way. ${inconclusive.length} of `
        + `${attempted.length} answered differently, which is consistent with a refusal and also `
        + `with echoing the arguments: ${inconclusive.join('; ')}`);
    }

    return {
      held: ignored.length === 0 && refused.length === attempted.length,
      expected: `all ${attempted.length} read only tools demonstrably refuse a call that omits a `
        + 'required property',
      observed: ignored.length
        ? `${ignored.length} of ${attempted.length} ignored it: ${ignored.join('; ')}`
        : (refused.length === attempted.length
          ? `all ${attempted.length} rejected it: ${refused.join('; ')}`
          : `${refused.length} of ${attempted.length} demonstrably refused; `
            + `${inconclusive.length} were inconclusive: ${inconclusive.join('; ')}`),
    };
  },

  /**
   * A differential observation, and it is careful not to claim more than one.
   *
   * It cannot prove readOnlyHint is honest: a tool can change state no tool on this page reports.
   * What it reports is whether calling one read only tool changed what another one answers, using
   * arguments each tool's own schema says are valid.
   *
   * IT ABSTAINS WHEN THE SURFACE IS NOT STABLE. Reading the oracles is itself calling tools, so the
   * baseline is built by the thing being measured. The probe reads them twice with nothing in
   * between first; if those disagree, no attribution is possible and this returns not-applicable
   * rather than blaming whichever tool was called next.
   */
  P6(o) {
    need(o, ['oracleCount', 'oracles', 'moved', 'stable']);
    const moved = asArray(o.moved);
    const selfChanged = asArray(o.selfChanged);
    const unstable = asArray(o.unstable);
    if (Number(o.oracleCount) < 2) {
      throw new Error('a differential needs at least two read only tools, one to call and one to '
        + 'read the state with');
    }
    if (o.stable !== true) {
      throw new Error('these read only tools do not answer the same way twice with nothing called '
        + `in between, so no change can be attributed to any of them: ${unstable.join(', ')}`);
    }
    return {
      held: moved.length === 0,
      expected: `calling any of the ${o.oracleCount} read only tools leaves what the others answer `
        + 'unchanged',
      observed: moved.length
        ? `${moved.length} changed another tool's answer: ${moved.join('; ')}`
        : `${o.oracleCount} read only tools, stable across a control read, and none changed what `
          + `another answers`
          + (selfChanged.length ? `. ${selfChanged.length} changed their own answer: ${selfChanged.join('; ')}` : ''),
    };
  },
};

/** Throw rather than guess when the transcript is missing a field the rule needs. */
function need(observation, fields) {
  if (!observation || typeof observation !== 'object') throw new Error(NOT_OBSERVED);
  for (const field of fields) {
    if (observation[field] === undefined) throw new Error(`the observation has no "${field}"`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Judge one behaviour against one transcript.
 *
 * @param {string} id a behaviour id from the catalogue
 * @param {object} transcript
 * @returns {{id: string, group: string, subject: string, title: string, verdict: string,
 *            expected: string, observed: string, reproduce: string, reason: (string|null)}}
 */
export function judgeBehaviour(id, transcript) {
  const behaviour = behaviourById(id);
  if (!behaviour) throw new Error(`no behaviour "${id}" in the catalogue`);
  const rule = RULES[id];
  if (!rule) throw new Error(`behaviour "${id}" is in the catalogue with no rule to judge it`);

  const observations = (transcript && transcript.observations) || {};
  const observation = observations[id];
  const skipped = (transcript && transcript.skipped) || {};

  const base = {
    id: behaviour.id,
    group: behaviour.group,
    subject: behaviour.subject,
    title: behaviour.title,
    reproduce: behaviour.reproduce,
  };

  if (observation === undefined) {
    // A row the probe REFUSED carries its reason, which is a different thing from a row that was
    // simply never covered, and a reader has to be able to tell them apart. Neither is a pass.
    const reason = skipped[id] || NOT_OBSERVED;
    return { ...base, verdict: 'not-applicable', expected: behaviour.promise, observed: '', reason };
  }

  let outcome;
  try {
    outcome = rule(observation);
  } catch (error) {
    return {
      ...base,
      verdict: 'not-applicable',
      expected: behaviour.promise,
      observed: '',
      reason: String((error && error.message) || error),
    };
  }

  return {
    ...base,
    verdict: outcome.held ? 'pass' : 'fail',
    expected: outcome.expected,
    observed: outcome.observed,
    reason: null,
  };
}

/**
 * Judge a whole transcript against the whole catalogue.
 *
 * EVERY BEHAVIOUR IS ALWAYS JUDGED. The catalogue drives the loop, not the transcript, so a probe
 * that quietly stopped covering a behaviour shows up as `not-applicable` rather than disappearing
 * from the report. A gate that selects its own scope from the thing it is checking cannot fail.
 *
 * @param {object} transcript
 * @returns {{findings: object[], counts: object, environment: object, complete: boolean}}
 */
export function judge(transcript, options = {}) {
  /*
   * WHAT IS IN SCOPE.
   *
   * A run may deliberately observe one behaviour. Judging the whole catalogue against it then
   * reports nineteen unobserved rows and calls the run incomplete, which is true of the catalogue
   * and useless about the run. So the scope is the behaviours the transcript says were selected,
   * and when the transcript says nothing the scope is everything.
   *
   * Rows outside the scope are still returned, marked out-of-scope, so nothing disappears from the
   * report. They are simply not counted, and they cannot make a scoped run look incomplete.
   */
  const scope = (transcript && transcript.scope) || {};
  const requested = options.only && options.only.length
    ? options.only
    : (Array.isArray(scope.requestedBehaviours) && scope.requestedBehaviours.length
      ? scope.requestedBehaviours
      : null);

  const inScope = (id) => {
    if (!requested) return true;
    if (requested.includes(id)) return true;
    // A refused row that was asked for stays in scope, so the refusal is counted and visible.
    return Boolean((transcript && transcript.skipped && transcript.skipped[id]));
  };

  const findings = BEHAVIOURS.map((behaviour) => {
    const finding = judgeBehaviour(behaviour.id, transcript);
    return inScope(behaviour.id) ? finding : { ...finding, verdict: 'out-of-scope', reason: 'not selected for this run' };
  });

  const counted = findings.filter((f) => f.verdict !== 'out-of-scope');
  const counts = {
    total: counted.length,
    pass: counted.filter((f) => f.verdict === 'pass').length,
    fail: counted.filter((f) => f.verdict === 'fail').length,
    notApplicable: counted.filter((f) => f.verdict === 'not-applicable').length,
    outOfScope: findings.length - counted.length,
    catalogue: findings.length,
  };

  const meta = (transcript && transcript.meta) || {};

  /*
   * COMPLETENESS FAILS CLOSED.
   *
   * It used to mean only "no row was unobserved". That let a run be complete with a null host
   * object and with fatal errors in the transcript, which is exactly the shape of a run that proved
   * nothing while reporting cleanly. All four conditions are now required, and each is reported
   * separately so a reader can see which one failed.
   */
  const fatalErrors = Array.isArray(transcript && transcript.errors) ? transcript.errors : [];
  const environmentIdentified = Boolean(meta.api) && Boolean(meta.url);
  const completeness = {
    everySelectedObserved: counts.notApplicable === 0,
    environmentIdentified,
    noFatalErrors: fatalErrors.length === 0,
    anythingMeasured: counted.length > 0,
  };
  const complete = completeness.everySelectedObserved
    && completeness.environmentIdentified
    && completeness.noFatalErrors
    && completeness.anythingMeasured;

  return {
    findings,
    counts,
    scope: {
      requested: requested ? [...requested] : null,
      steps: Array.isArray(scope.steps) ? scope.steps : null,
      refusedSteps: Array.isArray(scope.refusedSteps) ? scope.refusedSteps : [],
      allow: scope.allow || null,
      fixture: scope.fixture || null,
    },
    completeness,
    errors: fatalErrors,
    // The page's own surface as it was before the probe touched it. Every your-page finding is
    // checkable against this without rerunning anything.
    pageTools: Array.isArray(transcript && transcript.pageTools) ? transcript.pageTools : [],
    environment: {
      url: meta.url === undefined ? null : String(meta.url),
      userAgent: meta.userAgent === undefined ? null : String(meta.userAgent),
      api: meta.api === undefined ? null : meta.api,
      catalogueMeasuredAgainst: MEASURED_AGAINST,
      catalogueMeasuredOn: MEASURED_ON,
    },
    complete,
  };
}
