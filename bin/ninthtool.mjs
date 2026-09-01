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
import { serveRuntime } from '../src/probe/serve.mjs';

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

const HELP = `ninthtool, a behavioural conformance suite for WebMCP

  node bin/ninthtool.mjs [url] [options]

  url                 the page to audit. Defaults to this repository's own subject page,
                      served from a temporary local server.

  --behaviour, -b ID  run ONE behaviour, for example B1 or C2. Only that row's step and its
                      declared dependencies execute. Nothing else is registered, no tool of the
                      page under test is called, and no form is submitted
  --fail-on WHAT      exit non zero when something fails. "page" fails on a defect in the page
                      under test, "any" fails on anything, "none" is the default and exits zero
                      whenever the run completed
  --json              print the verdict as JSON instead of a report
  --port N            the remote debugging port to use, default 9411
  --chrome PATH       the Chrome or Edge binary. Found automatically if not given
  --keep-open         leave the browser running afterwards

AUTHORISATION. By default this reads the tool surface and exercises tools it registers itself, and
it touches nothing belonging to the page under test.

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
  console.log('ninthtool, a behavioural conformance suite for WebMCP');
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
    const mark = { pass: 'HOLDS ', fail: 'BROKEN', 'not-applicable': 'NOT RUN' }[finding.verdict];
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
  if (result.scope.fixture) {
    console.log(`fixture : ${result.scope.fixture.trusted ? 'identity holds' : 'REFUSED'}`
      + ` - ${result.scope.fixture.reason}`);
  }
  console.log(BAR);
  console.log(`${result.counts.fail} broken, ${result.counts.pass} kept`
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

  const expectedOrigin = new URL(url).origin;
  const raw = await session.evaluate(probeExpression({
    only: selected, allow, expectedOrigin,
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
  if (served) served.server.close();
  if (!args.keepOpen) launched.close();
}

process.exit(exitCode);
