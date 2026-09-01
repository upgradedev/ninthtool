/**
 * What each behaviour needs in order to be observed, declared as data rather than buried in one
 * long function.
 *
 * WHY THIS FILE EXISTS. `--behaviour A1` used to run all twenty probes and filter the printed
 * report. An audit pointed the runner at a page whose read only handler had an observable network
 * side effect and watched it get called twice, and pointed it at a page that merely declared the
 * bundled fixture's tool name and watched two forms get submitted. Both were possible because
 * nothing in the probe distinguished "read a tool's metadata" from "call somebody else's tool" from
 * "submit somebody else's form", and because selecting one behaviour selected nothing at all.
 *
 * So every step now declares its MODE, and the runner refuses a mode it was not authorised for
 * before Chrome is launched.
 *
 *   metadata       reads the tool surface snapshot. No calls of any kind. Always allowed.
 *   register       registers tools OF OUR OWN, calls only those, and withdraws them. It adds
 *                  nothing to the page's own state, but it does briefly put tools on the page's
 *                  surface, which is disclosed rather than hidden.
 *   readonly-call  calls tools THE TARGET PAGE marked readOnlyHint. Needs --allow-tool-calls,
 *                  because a readOnlyHint an auditor trusts is exactly the annotation this suite
 *                  exists to doubt.
 *   fixture-form   submits a form, which is a write. Needs --allow-fixture-forms AND a fixture
 *                  that passes the identity check in fixture_identity.js. Declaring the right tool
 *                  name is not enough and never was.
 *
 * `needs` is an explicit dependency, not an ordering hint: selecting B2 runs B1's step because B2's
 * observation is produced by it, and selecting B2 runs nothing else.
 */

/** The modes, in increasing order of what they are allowed to touch. */
export const MODES = ['metadata', 'register', 'readonly-call', 'fixture-form'];

/**
 * One entry per behaviour in the catalogue. `produces` lists every observation id the step writes,
 * so the runner can select by behaviour and know which steps to run.
 */
export const STEPS = Object.freeze({
  arity: { mode: 'register', produces: ['A1'] },
  schemaRoundTrip: { mode: 'register', produces: ['A2'] },
  annotations: { mode: 'register', produces: ['A3', 'B3'] },
  refusalRoutes: { mode: 'register', produces: ['B1', 'B2'] },
  resultShape: { mode: 'register', produces: ['B5'] },
  withdrawal: { mode: 'register', produces: ['C2'] },
  lifecycleEvent: { mode: 'register', produces: ['D1'] },
  scriptValidation: { mode: 'register', produces: [] },
  declarativeMetadata: { mode: 'metadata', produces: ['B4', 'D2'] },
  formValidation: { mode: 'fixture-form', produces: ['C3'], needs: ['scriptValidation'] },
  staleRequired: { mode: 'fixture-form', produces: ['C1'] },
  humanHold: { mode: 'fixture-form', produces: ['C4'] },
  pageAnnotations: { mode: 'metadata', produces: ['P1'] },
  pageSchemas: { mode: 'metadata', produces: ['P2'] },
  pageDescriptions: { mode: 'metadata', produces: ['P3'] },
  pageProvenance: { mode: 'metadata', produces: ['P4'] },
  pageRequired: { mode: 'readonly-call', produces: ['P5'] },
  pageReadOnlyDifferential: { mode: 'readonly-call', produces: ['P6'] },
});

/** Every step name, in the order the runner executes them. */
export const STEP_ORDER = Object.freeze(Object.keys(STEPS));

/**
 * The steps needed to observe a set of behaviour ids, with their declared dependencies, in run
 * order.
 *
 * @param {string[]|null} behaviourIds null or empty means everything
 * @returns {string[]} step names
 */
export function stepsFor(behaviourIds) {
  if (!behaviourIds || !behaviourIds.length) return [...STEP_ORDER];
  const wanted = new Set();
  const add = (stepName) => {
    if (wanted.has(stepName)) return;
    wanted.add(stepName);
    for (const dependency of STEPS[stepName].needs || []) add(dependency);
  };
  for (const id of behaviourIds) {
    for (const stepName of STEP_ORDER) {
      if ((STEPS[stepName].produces || []).includes(id)) add(stepName);
    }
  }
  return STEP_ORDER.filter((name) => wanted.has(name));
}

/**
 * The behaviour ids a set of steps can produce. Used to scope the report so that rows nobody asked
 * for are not reported as unobserved gaps.
 *
 * @param {string[]} stepNames
 * @returns {string[]}
 */
export function behavioursFrom(stepNames) {
  const out = [];
  for (const name of stepNames) for (const id of STEPS[name].produces || []) out.push(id);
  return out;
}

/**
 * The modes a set of steps needs. The runner compares this against what was authorised and refuses
 * before launching a browser.
 *
 * @param {string[]} stepNames
 * @returns {string[]}
 */
export function modesFor(stepNames) {
  return [...new Set(stepNames.map((name) => STEPS[name].mode))];
}

/**
 * Which of the requested modes are not permitted by the given authorisation.
 *
 * @param {string[]} stepNames
 * @param {{toolCalls?: boolean, fixtureForms?: boolean}} allowed
 * @returns {string[]} the modes that are refused
 */
export function refusedModes(stepNames, allowed = {}) {
  const refused = [];
  for (const mode of modesFor(stepNames)) {
    if (mode === 'readonly-call' && allowed.toolCalls !== true) refused.push(mode);
    if (mode === 'fixture-form' && allowed.fixtureForms !== true) refused.push(mode);
  }
  return refused;
}

/** Steps that are allowed to run under the given authorisation. */
export function permittedSteps(stepNames, allowed = {}) {
  return stepNames.filter((name) => {
    const mode = STEPS[name].mode;
    if (mode === 'readonly-call') return allowed.toolCalls === true;
    if (mode === 'fixture-form') return allowed.fixtureForms === true;
    return true;
  });
}

/** Why a step was not run, in words a report can print. */
export function refusalReason(stepName) {
  const mode = STEPS[stepName].mode;
  if (mode === 'readonly-call') {
    return 'calling a tool on the page under test was not authorised. Pass --allow-tool-calls to '
      + 'let this run, and read what it does first: it calls tools the page marked readOnlyHint, '
      + 'which is an annotation this suite exists to doubt';
  }
  if (mode === 'fixture-form') {
    return 'submitting a form was not authorised. Pass --allow-fixture-forms, which additionally '
      + 'runs only against a page that passes the bundled fixture identity check';
  }
  return `mode ${mode} was not permitted`;
}
