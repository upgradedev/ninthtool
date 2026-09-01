/**
 * The readiness thresholds and the surfaces the gate checks, in one importable place.
 *
 * WHY THE NUMBERS LIVE HERE AND ALSO IN A FIXTURE. A threshold written once can be edited to make a
 * red build green, and the edit looks like any other diff. So each number below is pinned again in
 * `THRESHOLD_FIXTURE` at the bottom of this file, the validator asserts the two agree before it
 * runs a single check, and tests/unit/readiness_thresholds.test.js asserts it a third time from
 * outside. Moving a threshold now means changing three things that are visibly about the same
 * number, which is the point: widening a gate should be hard to do by accident and impossible to do
 * quietly.
 *
 * THE RULE THIS ENCODES: never widen a gate, move a threshold or flip a check fail open. Fix
 * reality or state the limitation.
 */

/** The live judge URL. Every mandatory network row is measured against this and nothing else. */
export const LIVE_URL = 'https://upgradedev.github.io/ninthtool/';

/** The repository, for the licence and visibility rows. */
export const REPO = 'upgradedev/ninthtool';

/**
 * Paths on the live origin that must each answer 200. If the page needs it to work, it is here.
 * A page that returns 200 while its module 404s is a page that shows a judge an empty screen.
 */
export const LIVE_PATHS = [
  '',
  'assets/styles.css',
  'index.html',
  'fixtures/subject.html',
  'src/ui/app.js',
  'src/judge/behaviours.js',
  'src/judge/verdict.js',
  'src/probe/observe.js',
];

/**
 * Tool names the page must actually register, checked against the DEPLOYED bytes rather than the
 * source. Grepping the source proves what we wrote; grepping what is served proves what a judge
 * gets. Those have differed before.
 */
export const CLAIMED_TOOLS = ['nt_list_behaviours', 'nt_explain_behaviour', 'nt_run_audit', 'nt_get_findings'];

/** The sentence that must appear, word for word, on the live page and in the README. */
export const FLAGSHIP = "Ninth Tool executes your page's WebMCP tools in the browser and shows which "
  + 'promises the standard silently drops, with the command that reproduces each one.';

/** Every mandatory row must pass. There is no partial credit on a mandatory row. */
export const MANDATORY_PASS_RATE = 1.0;

/** Across every automated row, this fraction must pass or the gate exits non zero. */
export const OVERALL_PASS_RATE = 0.95;

/** The cap the video must come in under, in seconds, from the rules. */
export const VIDEO_MAX_SECONDS = 180;

/**
 * The second pinning of every number above.
 *
 * The validator compares this to the exported constants before running anything and refuses to run
 * when they disagree. Change one and the gate stops, which is the behaviour we want from a
 * threshold that somebody is quietly moving.
 */
export const THRESHOLD_FIXTURE = Object.freeze({
  MANDATORY_PASS_RATE: 1.0,
  OVERALL_PASS_RATE: 0.95,
  VIDEO_MAX_SECONDS: 180,
  LIVE_URL: 'https://upgradedev.github.io/ninthtool/',
  REPO: 'upgradedev/ninthtool',
  CLAIMED_TOOL_COUNT: 4,
  LIVE_PATH_COUNT: 8,
});

/**
 * Refuse to run when the two copies disagree.
 * @returns {string[]} the disagreements, empty when they agree
 */
export function thresholdDrift() {
  const drift = [];
  const check = (name, live, pinned) => {
    if (live !== pinned) drift.push(`${name}: config says ${live}, the fixture says ${pinned}`);
  };
  check('MANDATORY_PASS_RATE', MANDATORY_PASS_RATE, THRESHOLD_FIXTURE.MANDATORY_PASS_RATE);
  check('OVERALL_PASS_RATE', OVERALL_PASS_RATE, THRESHOLD_FIXTURE.OVERALL_PASS_RATE);
  check('VIDEO_MAX_SECONDS', VIDEO_MAX_SECONDS, THRESHOLD_FIXTURE.VIDEO_MAX_SECONDS);
  check('LIVE_URL', LIVE_URL, THRESHOLD_FIXTURE.LIVE_URL);
  check('REPO', REPO, THRESHOLD_FIXTURE.REPO);
  check('CLAIMED_TOOL_COUNT', CLAIMED_TOOLS.length, THRESHOLD_FIXTURE.CLAIMED_TOOL_COUNT);
  check('LIVE_PATH_COUNT', LIVE_PATHS.length, THRESHOLD_FIXTURE.LIVE_PATH_COUNT);
  return drift;
}
