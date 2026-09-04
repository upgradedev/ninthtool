#!/usr/bin/env node
/**
 * The command line runner. Point it at any origin you control and it drives that page through a
 * real browser's WebMCP, judges what happened and prints a report.
 *
 * WHY THIS EXISTS ALONGSIDE THE PAGE. A page cannot reach another origin's tool surface: the
 * `tools` Permissions Policy defaults to `self`, and a cross origin frame was measured contributing
 * zero tools. So the browser page audits its own subject page, and this audits anything, because
 * here the browser itself is the thing being driven.
 *
 * IT IS THE SAME PROBE AND THE SAME JUDGE. src/probe/observe.js is read off disk and injected into
 * the target page, and src/judge/verdict.js decides. Two transports, one instrument, so a verdict
 * from the page and a verdict from here are comparable. A second copy of either would be two things
 * to keep right.
 *
 *   node bin/ninthtool.mjs https://your-page.example
 *   node bin/ninthtool.mjs --behaviour B1
 *   node bin/ninthtool.mjs https://your-page.example --json --fail-on page
 *
 * NO DEPENDENCIES. Node 20 has no WebSocket client, so src/probe/cdp.mjs speaks the frames itself.
 * Nothing is installed and there is no lock file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSession } from '../src/probe/cdp.mjs';
import { launchWithWebMCP, waitForPageTarget, targetFor, waitForDocument } from '../src/probe/launch.mjs';
import { judge } from '../src/judge/verdict.js';
import { BEHAVIOURS, behaviourById, MEASURED_AGAINST } from '../src/judge/behaviours.js';
import { stepsFor, permittedSteps, refusedModes, modesFor } from '../src/probe/steps.js';
import { serveRuntime, keepAlive } from '../src/probe/serve.mjs';
import { FIXTURE_PATH } from '../src/probe/fixture_identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * What a run with no arguments audits.
 *
 * The page itself, not the subject fixture. Same origin frames contribute their tools to the top
 * document, so from here the surface carries this page's three script registered tools AND the
 * subject frame's two form derived ones. That is the only place both halves of the standard are on
 * one surface at once, which is what the your-page rows need in order to say anything.
 */
const DEFAULT_SUBJECT = 'index.html';

/* ------------------------------------------------------------------ arguments */

/**
 * Parse arguments strictly, and refuse anything unrecognised.
 *
 * IT USED TO IGNORE WHAT IT DID NOT UNDERSTAND. A misspelled flag was silently dropped, so
 * `--allow-fixture-form` without the s would have read as "no authorisation" and a typo in
 * `--fail-on` read as "never fail". A tool that quietly does something other than what it was asked
 * is the failure mode this whole repository is about.
 *
 * @returns {{args: object, errors: string[]}}
 */
function parseArgs(argv) {
  const args = {
    url: null, behaviour: null, json: false, failOn: 'none', port: 9411,
    keepOpen: false, chrome: null, help: false,
    allowToolCalls: false, allowFixtureForms: false,
  };
  const errors = [];
  const needsValue = new Set(['--behaviour', '-b', '--fail-on', '--port', '--chrome']);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (needsValue.has(a) && (i + 1 >= argv.length || String(argv[i + 1]).startsWith('--'))) {
      errors.push(`${a} needs a value`);
      continue;
    }
    if (a === '--behaviour' || a === '-b') args.behaviour = String(argv[++i]).toUpperCase();
    else if (a === '--json') args.json = true;
    else if (a === '--fail-on') args.failOn = String(argv[++i]);
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--chrome') args.chrome = String(argv[++i]);
    else if (a === '--keep-open') args.keepOpen = true;
    else if (a === '--allow-tool-calls') args.allowToolCalls = true;
    else if (a === '--allow-fixture-forms') args.allowFixtureForms = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('-')) errors.push(`unknown option ${a}`);
    else if (args.url === null) args.url = a;
    else errors.push(`more than one URL given: ${args.url} and ${a}`);
  }

  if (!['none', 'page', 'any'].includes(args.failOn)) {
    errors.push(`--fail-on must be none, page or any. Got ${JSON.stringify(args.failOn)}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    errors.push(`--port must be an integer between 1024 and 65535. Got ${JSON.stringify(args.port)}`);
  }
  if (args.behaviour && !behaviourById(args.behaviour)) {
    errors.push(`no behaviour "${args.behaviour}". Known: ${BEHAVIOURS.map((b) => b.id).join(', ')}`);
  }
  if (args.url !== null) {
    try {
      const parsed = new URL(args.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`the target must be http or https. Got ${parsed.protocol}`);
      }
    } catch { errors.push(`${args.url} is not a URL`); }
  }
  return { args, errors };
}

const HELP = `ninthtool, a reproducible behaviour probe for WebMCP

  node bin/ninthtool.mjs [url] [options]

  url                 the page to audit. Defaults to this repository's own subject page,
                      served from a temporary local server.

  --behaviour, -b ID  run ONE behaviour, for example B1 or C2. Only that row's step and its
                      declared dependencies execute. AGAINST A URL, nothing else is registered,
                      no tool of that page is called and no form is submitted. WITH NO URL the
                      subject is the fixture this command serves itself, and both authorisations
                      are on for it, so a row that needs them will call and submit against that
                      fixture. Run P6 alone with no flags and it settles, which it cannot do
                      without calling tools
  --fail-on WHAT      exit non zero when something fails. "page" fails on a defect in the page
                      under test, "any" fails on anything, "none" is the default and exits zero
                      whenever the run completed
  --json              print the verdict as JSON instead of a report
  --port N            the remote debugging port to use, default 9411
  --chrome PATH       the Chrome or Edge binary. Found automatically if not given
  --keep-open         leave the browser, its profile and the local server running after the
                      report, and do not exit. Stop this process to close the browser and remove
                      the profile. It exits 130 then, so with --keep-open the exit code tells you
                      how the run was stopped rather than what the run found

AUTHORISATION. By default this reads the tool surface and exercises tools it REGISTERS ITSELF. It
does not call your tools and does not submit your forms.

  It is not invisible, and the earlier wording here said it was. Registering a tool is a document
  level event, so a page with a toolchange listener sees every probe tool arrive and leave.
  Measured against a page that counts them: 26 events on a default run with nothing authorised.
  If your listener writes, fetches or re-renders, it will do that. There is no way to register a
  tool in a document without the document being able to notice, so this is stated rather than
  fixed.

  --allow-tool-calls      let it CALL tools the page marked readOnlyHint. Rows P5 and P6 need this.
                          Read what that means first: readOnlyHint is an annotation this suite
                          exists to doubt, and a handler behind one can do anything
  --allow-fixture-forms   let it SUBMIT a form, which is a write. Rows C1, C3 and C4 need this, and
                          it additionally runs only against a page that passes four identity checks
                          against the bundled fixture. Declaring the fixture's tool name is not
                          enough

The browser needs WebMCP enabled. This launches it with --enable-features=WebMCP in a throwaway
profile, which is what ${MEASURED_AGAINST} was measured with. The documented alternative for a
browser you drive yourself is chrome://flags/#enable-webmcp-testing.
`;

/* ------------------------------------------------------------------ the browser */

/**
 * The probe, turned from an ES module into an expression the page can evaluate.
 *
 * Reading the one file off disk is deliberate: a second, inlined copy of the probe would drift from
 * the one the page uses, and then a verdict from here would stop being comparable with a verdict
 * from there. The transform is only the removal of the `export` keyword, which leaves valid script.
 */
function probeExpression(options) {
  const source = fs.readFileSync(path.join(ROOT, 'src/probe/observe.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  const steps = fs.readFileSync(path.join(ROOT, 'src/probe/steps.js'), 'utf8')
    .replace(/^export\s+/gm, '')
    .replace(/^import[^;]+;$/gm, '');
  const identity = fs.readFileSync(path.join(ROOT, 'src/probe/fixture_identity.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  const body = source.replace(/^import[^;]+;$/gm, '').replace(/^import\s[\s\S]*?from\s+'[^']+';$/gm, '');
  return `(async () => {
    ${steps}
    ${identity}
    ${body}
    const found = findModelContext(document, navigator);
    if (!found.ctx) {
      return JSON.stringify({ meta: { url: document.URL, userAgent: navigator.userAgent, api: null },
        observations: {}, errors: [found.reason], scope: null, skipped: {} });
    }
    const transcript = await observeAll(found.ctx, ${JSON.stringify(options)});
    transcript.meta.api = found.where;
    return JSON.stringify(transcript);
  })()`;
}

/* ------------------------------------------------------------------ report */

const BAR = '-'.repeat(78);

function printReport(result, transcript, only) {
  const chosen = only ? result.findings.filter((f) => f.id === only) : result.findings;
  console.log(BAR);
  console.log('ninthtool, a reproducible behaviour probe for WebMCP');
  console.log(BAR);
  console.log(`subject : ${result.environment.url || 'unknown'}`);
  console.log(`browser : ${result.environment.userAgent || 'unknown'}`);
  console.log(`host    : ${result.environment.api || 'NONE, this browser exposes no WebMCP'}`);
  console.log('');

  let group = null;
  for (const finding of chosen) {
    if (finding.verdict === 'out-of-scope') continue;
    if (finding.group !== group) {
      group = finding.group;
      console.log(`  ${group.toUpperCase()}`);
    }
    const mark = { pass: 'HOLDS ', fail: 'BROKEN', 'not-applicable': 'NOT RUN',
      'by-design': 'BY DSGN' }[finding.verdict];
    console.log(`  [${mark}] ${finding.id}  ${finding.title}`);
    console.log(`           subject   ${finding.subject === 'browser' ? 'the browser' : 'the page under test'}`);
    console.log(`           expected  ${finding.expected}`);
    if (finding.verdict === 'not-applicable') console.log(`           not run   ${finding.reason}`);
    else console.log(`           observed  ${finding.observed}`);
    console.log(`           reproduce ${finding.reproduce}`);
    console.log('');
  }

  if (result.scope.requested) {
    console.log(`scope   : ${result.scope.requested.join(', ')}`
      + ` (${result.counts.outOfScope} of the catalogue not selected and not counted)`);
  }
  if (result.scope.refusedSteps && result.scope.refusedSteps.length) {
    console.log(`refused : ${result.scope.refusedSteps.join(', ')}, not authorised`);
  }
  // ONE LINE PER TOOL. Identity is decided per tool now, because a decision about one tool used to
  // authorise another one in a different document, and that document was written to.
  for (const [name, decision] of Object.entries(result.scope.fixture || {})) {
    console.log(`fixture : ${name} ${decision.trusted ? 'identity holds' : 'REFUSED'}`
      + ` - ${decision.reason}`);
  }
  console.log(BAR);
  // by-design is printed separately and NOT folded into "broken". It is observed and deliberate,
  // and adding it to the headline would count somebody else's design decision as a defect.
  console.log(`${result.counts.fail} broken, ${result.counts.pass} kept`
    + (result.counts.byDesign ? `, ${result.counts.byDesign} by design` : '')
    + (result.counts.notApplicable ? `, ${result.counts.notApplicable} could not be run` : '')
    + `, ${result.counts.total} tested.`);
  if (!result.complete) {
    console.log('This run is INCOMPLETE. A behaviour that was never observed is not a behaviour that passed.');
  }
  if (transcript.errors && transcript.errors.length) {
    console.log('');
    console.log('Could not be observed:');
    for (const error of transcript.errors) console.log(`  - ${error}`);
  }
  console.log(BAR);
}

/* ------------------------------------------------------------------ main */

const parsed = parseArgs(process.argv.slice(2));
const args = parsed.args;

if (args.help) { console.log(HELP); process.exit(0); }

if (parsed.errors.length) {
  for (const line of parsed.errors) console.error(`ninthtool: ${line}`);
  console.error('Nothing was launched. Run with --help for the options.');
  process.exit(2);
}

/*
 * EVERY SAFETY DECISION IS MADE HERE, BEFORE A BROWSER EXISTS.
 *
 * The steps that would run are computed from the selection, their modes are compared against what
 * was authorised, and anything unauthorised is reported now rather than discovered halfway through
 * a run against somebody else's page.
 */
const selected = args.behaviour ? [args.behaviour] : null;
const requestedSteps = stepsFor(selected);

/*
 * THE DEFAULT DEPENDS ON WHOSE PAGE IT IS, AND THAT IS THE WHOLE POINT.
 *
 * With no URL the target is the subject page this repository ships and serves from a loopback
 * server it just started, so calling its tools and submitting its forms is calling and submitting
 * our own. Everything is authorised, and the four identity checks still run, so even here a page
 * that is not the bundled fixture is not written to.
 *
 * With a URL the target is somebody else's until proved otherwise, and nothing is authorised unless
 * it was asked for by name. An audit found the previous behaviour calling a stranger's read only
 * handler twice and submitting a stranger's form twice, purely because the page used a tool name we
 * also use.
 */
const auditingOurOwnBundledPage = args.url === null;
const allow = {
  toolCalls: args.allowToolCalls || auditingOurOwnBundledPage,
  fixtureForms: args.allowFixtureForms || auditingOurOwnBundledPage,
};
const runnableSteps = permittedSteps(requestedSteps, allow);
const refused = refusedModes(requestedSteps, allow);

if (!runnableSteps.length) {
  console.error('ninthtool: everything this selection needs was refused, so there is nothing to run.');
  console.error(`  needed: ${modesFor(requestedSteps).join(', ')}`);
  console.error('  see --help for --allow-tool-calls and --allow-fixture-forms.');
  process.exit(2);
}

let served = null;
let url = args.url;
if (!url) {
  served = await serveRuntime(ROOT);
  url = `${served.origin}/${DEFAULT_SUBJECT}`;
  /*
   * SAID OUT LOUD, ON STDERR, BEFORE THE BROWSER OPENS.
   *
   * The port is chosen by the operating system, so until now the only place it appeared was the
   * `subject` line of the report, which is printed at the end and not printed at all under --json.
   * With --keep-open that origin outlives the run, and a reader cannot open a URL nobody told
   * them. It goes to stderr so that --json still writes nothing but JSON to stdout.
   */
  console.error(`ninthtool: serving this repository's own page at ${url}`);
}

let launched;
try {
  launched = await launchWithWebMCP({ url, port: args.port, chrome: args.chrome });
} catch (error) {
  console.error(`ninthtool: ${String((error && error.message) || error)}`);
  if (served) served.server.close();
  process.exit(2);
}

let socket = null;
let exitCode = 0;
try {
  // The browser opens about:blank first and navigates afterwards. Attaching to whichever page
  // target exists first raced that navigation and once audited a blank document.
  const target = await waitForPageTarget(args.port, url);
  if (!target.ok) {
    throw new Error(`the browser never opened ${url}. Page targets seen: ${target.seen.join(', ') || 'none'}`);
  }
  const connection = await openSession(args.port, targetFor(url));
  socket = connection.socket;
  const { session } = connection;
  await session.send('Runtime.enable');

  // The target list reports the new URL before the page's context has committed to it, so the
  // document is asked directly whether it is the right one and finished loading.
  const document_ = await waitForDocument(session, url);
  if (!document_.ok) {
    throw new Error(`${url} never finished loading. The attached document is "${document_.url}"`
      + ` in state "${document_.readyState}" after ${document_.waitedMs} ms.`);
  }

  // THE PATH WE ASKED FOR, NOT THE ONE WE LANDED ON.
  //
  // The fixture identity check compares the registering document against an EXPECTED path, and that
  // expectation has to come from the run's own intent. Deriving it from the loaded document would
  // make it compare a value with itself, so `/attacker/fixtures/subject.html` would satisfy it by
  // construction. Taking it from the requested URL means a redirect or a navigation that lands
  // somewhere else is refused instead of silently audited.
  const requested = new URL(url);
  const expectedOrigin = requested.origin;
  /*
   * WHERE THE FIXTURE IS EXPECTED TO BE, DERIVED FROM WHAT WE ASKED FOR.
   *
   * The fixture is not always the document we navigate to. Pointed at the subject page it is that
   * document; pointed at a page that EMBEDS it, including this runner's own bundled index.html, it
   * is a frame at `<that directory>/fixtures/subject.html`.
   *
   * Deriving it from the LOADED document instead would compare a value with itself and trust
   * anything; taking it from the requested URL means a redirect, or a page that puts our fixture
   * path somewhere else, is refused.
   */
  const expectedPath = requested.pathname.endsWith(FIXTURE_PATH)
    ? requested.pathname
    : requested.pathname.replace(/[^/]*$/, '') + FIXTURE_PATH.replace(/^\//, '');
  /*
   * ONLY A FIXTURE WE SERVED OURSELVES MAY BE WRITTEN TO.
   *
   * Pointed at somebody's URL there is no signal WebMCP exposes that a document must answer BEFORE
   * it is invoked, so no ordering of checks can prove an arbitrary page is ours without first
   * writing to it. When this runner served the bundle itself, the bytes under test are the bytes
   * it shipped, and that is established before a single call.
   */
  const raw = await session.evaluate(probeExpression({
    only: selected, allow, expectedOrigin, expectedPath,
    fixtureOwnership: auditingOurOwnBundledPage ? 'served-by-runner' : 'unproven',
  }), 120000);
  const transcript = JSON.parse(raw);
  const result = judge(transcript, { only: selected });

  if (args.json) console.log(JSON.stringify({ transcript, result }, null, 1));
  else printReport(result, transcript, args.behaviour);

  // EXIT CODE SEMANTICS, STATED RATHER THAN GUESSED. A broken promise is the expected FINDING of
  // this instrument, not an error in running it, so the default exit is zero whenever the run
  // completed. --fail-on turns findings into a build failure for anyone who wants that.
  const pageFailures = result.findings.filter((f) => f.verdict === 'fail' && f.subject === 'page');
  if (!result.complete) exitCode = 3;
  else if (args.failOn === 'any' && result.counts.fail > 0) exitCode = 1;
  else if (args.failOn === 'page' && pageFailures.length > 0) exitCode = 1;
} catch (error) {
  console.error(`ninthtool: the run did not complete. ${String((error && error.message) || error)}`);
  exitCode = 2;
} finally {
  if (socket) socket.destroy();

  /*
   * --keep-open USED TO CLOSE EVERYTHING IT PROMISED TO LEAVE OPEN.
   *
   * Three lines did it. The loopback server was closed unconditionally, so the page the kept open
   * browser was reading stopped being served. And process.exit() below ran unconditionally, which
   * emits `exit`, which runs the launcher's own cleanup: the browser was killed and its profile
   * deleted a moment after the report said they had been left alone. Reproduced by calling the
   * real launcher, not calling close(), and calling process.exit(0): the profile directory was
   * gone afterwards.
   *
   * So --keep-open now tears down nothing and does not exit. The launcher's cleanup stays
   * registered and does the right thing when the reader finally stops this process, which is the
   * explicit termination the flag is asking to wait for.
   */
  if (args.keepOpen) {
    console.error('');
    console.error(`ninthtool: --keep-open, so the browser is still on port ${args.port}`);
    console.error(`ninthtool: --keep-open, its throwaway profile is ${launched.profile}`);
    if (served) console.error(`ninthtool: --keep-open, the page is still served from ${served.origin}`);
    console.error('ninthtool: --keep-open, stop this process to close the browser and remove the profile.');
    keepAlive();
  } else {
    if (served) served.server.close();
    launched.close();
  }
}

// NOT REACHED UNDER --keep-open, AND THAT IS THE FIX. process.exit() emits `exit`, and the
// launcher's cleanup is registered there, so exiting here is the same thing as closing the
// browser. The run's exit code is given up in exchange, which is why --help says so.
if (!args.keepOpen) process.exit(exitCode);
