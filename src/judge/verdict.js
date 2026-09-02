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

/*
 * The bundled fixture's form tool name. DECLARED HERE rather than imported from the probe, because
 * this module must stay reachable without a browser and must not depend on the gathering half. A
 * test asserts the two spellings agree, so the duplication cannot drift silently.
 */
const D2_FIXTURE_TOOL = 'nt_form_answers';

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
    // `subject` is REQUIRED. It used to judge everything that was sent, which included
    // consequentialHint, and that is A3's whole finding. One measured fact became two broken
    // promises. An omitted subject would silently restore that, so it fails closed.
    need(o, ['sentAnnotationKeys', 'returnedAnnotationKeys', 'subject']);
    const back = asArray(o.returnedAnnotationKeys);
    const subject = asArray(o.subject);
    const elsewhere = o.measuredElsewhere && typeof o.measuredElsewhere === 'object'
      ? Object.entries(o.measuredElsewhere).map(([k, row]) => `${k} is row ${row}`)
      : [];
    const dropped = subject.filter((k) => !back.includes(k));
    return {
      held: dropped.length === 0,
      expected: `the ${subject.length} backend MCP annotation names survive registration`,
      observed: (dropped.length
        ? `${dropped.length} of ${subject.length} dropped with no error and no console warning: `
          + `${dropped.join(', ')}`
        : `none of the ${subject.length} dropped`)
        + (elsewhere.length ? `. Counted by another row and not here: ${elsewhere.join(', ')}` : ''),
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
    // handlerTelemetry is REQUIRED, not optional. Left optional, a transcript that simply omitted it
    // read as "nothing leaked" and passed, which is the same fail-open in a new field.
    need(o, ['settled', 'handlerTelemetry']);
    const leaked = o.handlerSawStaleValue === true;

    /*
     * REJECTING IS NOT ENOUGH IF THE HANDLER ALREADY READ IT.
     *
     * This held on `settled === 'rejected'` alone, and the leak only ever reached it through the
     * ECHOED ANSWER. A rejected call has no answer, so a handler that was handed the stale value
     * and then rejected arrived here as `handlerSawStaleValue: false` and scored a pass. That is
     * the worst shape of this defect and it was the one shape the row could not see: the data
     * reached the handler, which is where it could be logged, forwarded or acted on, and the
     * refusal afterwards does not take it back.
     *
     * The fixture now reports what it was handed before anything resolves, so a read is visible
     * whichever way the promise goes.
     */
    if (o.handlerTelemetry !== 'read') {
      throw new Error('this page does not report what its submit handler was handed, so whether the '
        + 'stale value reached it could not be observed. A rejection alone does not settle it, '
        + 'because a handler can read a value and refuse afterwards');
    }

    return {
      held: o.settled === 'rejected' && !leaked,
      expected: 'a call omitting a required property is refused, and the handler never sees a value '
        + 'left by an earlier call',
      observed: `the call ${o.settled}`
        + (leaked
          ? `, and the handler was handed "${String(o.staleValue)}" left by an earlier call`
            + (o.settled === 'rejected' ? '. Refusing afterwards does not unread it' : '')
          : ', and the handler was handed nothing left by an earlier call'),
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
    /*
     * A REFUSAL FROM A HALF THAT REFUSES EVERYTHING IS NOT ENFORCEMENT.
     *
     * This read one bit per call, `settled === 'rejected'`, and called it `enforced`. Reproduced
     * against a host that rejects every call with SERVICE_UNAVAILABLE: verdict pass, "3 of 3
     * enforced on both", on a run where no schema was ever looked at, and indistinguishable from a
     * host that really enforces.
     *
     * The probe now sends each half a schema valid call first. A half that will not answer that has
     * refused for a reason of its own, and none of its other refusals can be attributed to a
     * constraint, so the row abstains rather than scoring. `controls` is REQUIRED: an omitted field
     * would silently restore the old reading, which is the same fail open in a new key.
     */
    need(o, ['constraints', 'controls']);
    const constraints = Array.isArray(o.constraints) ? o.constraints : [];
    const declared = constraints.filter((c) => c && c.declared);
    if (!declared.length) {
      throw new Error('the captured schema declares none of the constraints this row compares');
    }

    const controls = o.controls || {};
    const dead = ['script', 'form'].filter((half) => !(controls[half] && controls[half].answered));
    if (dead.length) {
      const how = dead
        .map((half) => `the ${half} half ${(controls[half] && controls[half].settled) || 'was never measured'}`
          + `${controls[half] && controls[half].errName ? ` with ${controls[half].errName}` : ''}`)
        .join(', and ');
      throw new Error(`${how} on a schema valid call. A half that will not accept a call breaking `
        + 'nothing has refused for a reason of its own, so no refusal here could be attributed to a '
        + 'constraint');
    }

    const bothEnforce = declared.filter((c) => c.script === 'enforced' && c.form === 'enforced');
    const oneSided = declared.filter((c) => c.script !== c.form);
    const neither = declared.filter((c) => c.script !== 'enforced' && c.form !== 'enforced'
      && c.script !== 'unattributable' && c.form !== 'unattributable');
    const unattributable = declared.filter((c) => c.script === 'unattributable' || c.form === 'unattributable');

    return {
      held: bothEnforce.length === declared.length,
      expected: `every constraint the schema declares is enforced on both halves, measured against `
        + 'a call that breaks nothing',
      observed: bothEnforce.length === declared.length
        ? `${declared.length} of ${declared.length} enforced on both, and both halves answered the `
          + 'schema valid control'
        : `${bothEnforce.length} of ${declared.length} enforced on both`
          + (oneSided.length
            ? `; ${oneSided.length} enforced on one half only: `
              + oneSided.map((c) => `${c.name}: script ${c.script}, form ${c.form}`).join(', ')
            : '')
          + (neither.length
            ? `; ${neither.length} enforced by neither: ${neither.map((c) => c.name).join(', ')}`
            : '')
          + (unattributable.length
            ? `; ${unattributable.length} could not be attributed`
            : ''),
    };
  },

  /** Held only if the tool answered. A timeout is a failure, not an inconclusive result. */
  C4(o) {
    /*
     * THIS ROW MEASURED THE WRONG THING, AND ITS OWN CATALOGUE ENTRY SAID SO.
     *
     * It held on "did the promise settle", and the entry reads: "That pause is the design, not a
     * defect" and "this row does not call it a defect". So the rule scored the platform down for
     * exactly the behaviour the row says is intended, and the pending call landed in the broken
     * promise count.
     *
     * What the row actually claims is the sentence after that one: the two kinds of declarative
     * tool are INDISTINGUISHABLE before you call them. Same shape, same schema, no annotation, no
     * flag. An agent finds out which it called by waiting, with no deadline to wait against.
     *
     * So the pause is reported as by-design, and the gap around it is what is judged.
     */
    need(o, ['settled']);
    const pending = o.settled === 'timeout';
    const waited = Number(o.waitedMs) || 0;

    if (pending) {
      return {
        held: false,
        byDesign: true,
        expected: 'a form without toolautosubmit waits for a person, and the surface says which '
          + 'tools do that',
        observed: `still pending after ${waited} ms, which is the human hold working. Nothing on `
          + 'the tool surface distinguishes it from a tool that answers: same shape, same schema, '
          + 'no annotation, no flag, and no deadline to wait against',
      };
    }
    // It answered. Whatever else is true of the surface, the agent that called this one got a
    // result rather than waiting on a pause with no deadline, so for this tool the promise holds.
    return {
      held: true,
      expected: 'a form without toolautosubmit waits for a person, and the surface says which '
        + 'tools do that',
      observed: `the promise ${o.settled}, so the caller was not left waiting on a human hold`,
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

    /*
     * ONLY THE MARKUP WE WROTE CAN BE JUDGED AGAINST WHAT IT SHOULD PRODUCE.
     *
     * The probe prefers the bundled fixture's form tool and falls back to whatever declarative tool
     * the page publishes, so this row can be handed a stranger's form. Demanding four features there
     * would blame the BROWSER for markup the page never wrote: a form with no number input cannot
     * produce numeric bounds, and that is not a defect in anything.
     *
     * So the row abstains off the fixture. That is narrower than the old rule and it is the only
     * scope in which the promise is falsifiable.
     */
    if (o.toolName !== D2_FIXTURE_TOOL) {
      throw new Error(`this row compares a synthesised schema against markup known in advance, and `
        + `the only markup known in advance is the bundled fixture's. The tool read here was `
        + `${o.toolName ? `"${o.toolName}"` : 'not named in the transcript'}, so what its page`
        + ` declared is unknown and nothing can be concluded about the browser from it`);
    }

    const props = schema.properties || {};
    const names = Object.keys(props);
    if (!names.length) throw new Error('the synthesised schema declares no properties at all');

    /*
     * ALL FOUR, AND EACH ONE WHERE THE MARKUP PUTS IT.
     *
     * This read `unique.length >= 3`, one below its own promise, so the row carried a spare life and
     * every single-feature loss passed. Measured against the fixture's schema: dropping all bounds,
     * the enum, all descriptions, or the required array each still returned PASS.
     *
     * Raising it to four was not enough on its own, because the old counting was OR-folded across
     * properties: any one property carrying a bound, an enum and a description scored three of
     * three. So `{"only":{"minimum":1,"enum":["x"],"description":"d"}}` scored four of four while
     * every control the markup declares had failed. Each feature is now tied to the shape the
     * markup actually produces:
     *
     *   bounds       min AND max on the SAME property, because the fixture declares min="18" max="120"
     *   enum         a non-empty enum, because the fixture declares a select with options
     *   descriptions on EVERY property, because every control carries toolparamdescription
     *   required     naming a property that exists, because "required" on a ghost name is not a list
     */
    const missing = [];
    const bounded = names.filter((k) => (props[k] || {}).minimum !== undefined && (props[k] || {}).maximum !== undefined);
    const enumerated = names.filter((k) => Array.isArray((props[k] || {}).enum) && (props[k] || {}).enum.length);
    if (!bounded.length) missing.push('numeric bounds on one property (min and max together)');
    if (!enumerated.length) missing.push('an enum');
    // AND THEY COME FROM DIFFERENT CONTROLS. The four features are produced by four different
    // markup constructs, so one property carrying a bound, an enum and a description is not three
    // features, it is one property. Without this, `{"only":{"minimum":1,"maximum":2,"enum":["x"],
    // "description":"d"}}` scored four of four while every control the markup declares had failed.
    if (bounded.length && enumerated.length
      && bounded.every((k) => enumerated.includes(k)) && enumerated.every((k) => bounded.includes(k))) {
      missing.push(`bounds and an enum on different controls (both sit on ${bounded.join(', ')})`);
    }
    const undescribed = names.filter((k) => {
      const d = (props[k] || {}).description;
      return !(typeof d === 'string' && d.trim());
    });
    if (undescribed.length) missing.push(`a description on every control (${undescribed.join(', ')} carry none)`);
    const required = Array.isArray(schema.required) ? schema.required : [];
    const named = required.filter((k) => names.includes(k));
    if (!named.length) {
      missing.push(required.length
        ? `a required list naming a real control (it names ${required.join(', ')}, none of which is a property)`
        : 'a required list');
    }

    return {
      held: missing.length === 0,
      expected: 'markup produces numeric bounds, an enum, a description on every control, and a '
        + 'required list naming one of them',
      observed: missing.length
        ? `missing: ${missing.join('; ')}`
        : `all four synthesised: bounds, an enum, descriptions on all ${names.length} controls, and `
          + `required naming ${named.join(', ')}`,
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
      /*
       * SAYS WHICH HALF THE AUTHOR CAN ACTUALLY FIX.
       *
       * A tool carrying no annotations at all is either a form derived tool, which the standard
       * gives no way to annotate (row B4), or a script registered tool whose author left them off.
       * Those are the same observation: the ONLY discriminator this surface offers is the absent
       * annotations object, so the probe genuinely cannot tell them apart, and the report must not
       * pretend it can.
       *
       * The row still fails, because an agent reading this page really cannot tell which tools
       * write. What it no longer does is imply the whole of it is the author's to fix.
       */
      observed: silent.length || hintless.length
        ? [
          silent.length ? `${silent.length} carry no annotations at all: ${silent.join(', ')}`
            + '. If any of those came from an HTML form, the standard offers no way to annotate it '
            + 'and that part is row B4 rather than anything this page can change' : '',
          hintless.length ? `${hintless.length} carry annotations without readOnlyHint, which is `
            + `this page's to fix: ${hintless.join(', ')}` : '',
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
      // NAMES THE PROVENANCE IT USED. The row reads `tool.window` to decide this, so saying
      // nothing reveals where a tool came from would contradict the very field it read.
      observed: elsewhere.length
        ? `${elsewhere.length} of ${o.toolCount} came from another document, which their own `
          + `tool.window reveals and nothing on the surface points out: ${elsewhere.join(', ')}`
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
    need(o, ['oracleCount', 'oracles', 'moved', 'stable', 'controlAnswered']);
    const moved = asArray(o.moved);
    const selfChanged = asArray(o.selfChanged);
    const unstable = asArray(o.unstable);
    const answered = asArray(o.controlAnswered);
    const unanswered = asArray(o.controlUnanswered);

    /*
     * A CONTROL THAT NOTHING ANSWERED IS NOT A CONTROL.
     *
     * This row used to require only that two reads AGREE. But the probe normalises every
     * non-resolved outcome to a constant, so two tools that reject every call produce two identical
     * reads, an empty `moved`, and a confident pass. Reproduced against a fake host: all-reject and
     * all-timeout both gave verdict=pass with "none changed what another answers", on a run where
     * nothing was ever read. Stability of an error string is not evidence that nothing moved, it is
     * evidence that nothing was read.
     *
     * TWO, not one. The observable set is the pairs (caller, oracle) with caller != oracle where
     * BOTH answered. With one answered oracle that set is empty, so `moved` could not be non-empty
     * whatever the page did, and the row would pass by construction. That is the row's own arity
     * precondition, so it is applied to the answered set rather than to the published count.
     */
    if (answered.length < 2) {
      throw new Error('a differential needs at least two read only tools that actually answered a '
        + `schema valid call in both control reads, and ${answered.length} did`
        + `${unanswered.length ? `. The rest: ${unanswered.join('; ')}` : ''}`);
    }
    if (o.stable !== true) {
      throw new Error('these read only tools do not answer the same way twice with nothing called '
        + `in between, so no change can be attributed to any of them: ${unstable.join(', ')}`);
    }

    /*
     * AND THE CLAIM IS QUANTIFIED OVER WHAT WAS MEASURED. It used to read "calling any of the N read
     * only tools", where N was every tool the page PUBLISHED, including ones that never answered.
     * A resolution is also not a state read: WebMCP's refusal channel resolves, and this page's own
     * refuse() resolves, so "answered" means "returned something", not "reported state".
     */
    return {
      held: moved.length === 0,
      expected: `calling any read only tool that answers leaves what the other answering ones `
        + 'report unchanged',
      observed: moved.length
        ? `${moved.length} changed another tool's answer: ${moved.join('; ')}`
        : `${answered.length} of ${o.oracleCount} read only tools answered a schema valid call in `
          + `both control reads, and calling any of them did not change what the others answered`
          + (unanswered.length ? `. Not counted: ${unanswered.join('; ')}` : '')
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

  /*
   * A FOURTH OUTCOME, AND THE PAGE ALREADY ASSUMED IT EXISTED.
   *
   * The `by-design` group's own copy reads: "Counting these as broken promises would inflate the
   * number with somebody else's design decision." The code counted them anyway, because there were
   * only two outcomes and anything not held was a failure. So the page said one thing and the
   * headline said another.
   *
   * A rule opts in by returning `byDesign: true`. It is NOT the same as not-applicable: that means
   * the row could not be observed, this means it was observed and the result is a deliberate
   * behaviour of the platform rather than a promise anybody broke.
   */
  const unheld = outcome.byDesign === true ? 'by-design' : 'fail';
  return {
    ...base,
    verdict: outcome.held ? 'pass' : unheld,
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
    // Observed, deliberate, and NOT a broken promise. Reported separately so the headline counts
    // what somebody got wrong rather than what somebody decided.
    byDesign: counted.filter((f) => f.verdict === 'by-design').length,
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
