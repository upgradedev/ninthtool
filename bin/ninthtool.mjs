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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Where the subject page lives when no URL is given. */
const DEFAULT_SUBJECT = 'fixtures/subject.html';

/* ------------------------------------------------------------------ arguments */

function parseArgs(argv) {
  const args = { url: null, behaviour: null, json: false, failOn: 'none', port: 9411, keepOpen: false, chrome: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--behaviour' || a === '-b') args.behaviour = String(argv[++i] || '').toUpperCase();
    else if (a === '--json') args.json = true;
    else if (a === '--fail-on') args.failOn = String(argv[++i] || 'none');
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--chrome') args.chrome = String(argv[++i] || '');
    else if (a === '--keep-open') args.keepOpen = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.url = a;
  }
  return args;
}

const HELP = `ninthtool, a behavioural conformance suite for WebMCP

  node bin/ninthtool.mjs [url] [options]

  url                 the page to audit. Defaults to this repository's own subject page,
                      served from a temporary local server.

  --behaviour, -b ID  report one behaviour only, for example B1 or C2
  --fail-on WHAT      exit non zero when something fails. "page" fails on a defect in the page
                      under test, "any" fails on anything, "none" is the default and exits zero
                      whenever the run completed
  --json              print the verdict as JSON instead of a report
  --port N            the remote debugging port to use, default 9411
  --chrome PATH       the Chrome or Edge binary. Found automatically if not given
  --keep-open         leave the browser running afterwards

The browser needs WebMCP enabled. This launches it with --enable-features=WebMCP in a throwaway
profile, which is what ${MEASURED_AGAINST} was measured with. The documented alternative for a
browser you drive yourself is chrome://flags/#enable-webmcp-testing.
`;

/* ------------------------------------------------------------------ the browser */

/**
 * A static server for the bundled subject page, so the default run needs no arguments and no
 * separate terminal. It binds to the loopback address only and is closed when the run ends.
 */
async function serveRepo() {
  const http = await import('node:http');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer((req, res) => {
    const wanted = decodeURIComponent(String(req.url).split('?')[0]);
    const target = path.join(ROOT, wanted === '/' ? 'index.html' : wanted);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
    res.end(fs.readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/**
 * The probe, turned from an ES module into an expression the page can evaluate.
 *
 * Reading the one file off disk is deliberate: a second, inlined copy of the probe would drift from
 * the one the page uses, and then a verdict from here would stop being comparable with a verdict
 * from there. The transform is only the removal of the `export` keyword, which leaves valid script.
 */
function probeExpression() {
  const source = fs.readFileSync(path.join(ROOT, 'src/probe/observe.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  return `(async () => {
    ${source}
    const found = findModelContext(document, navigator);
    if (!found.ctx) {
      return JSON.stringify({ meta: { url: document.URL, userAgent: navigator.userAgent, api: null },
        observations: {}, errors: [found.reason] });
    }
    const transcript = await observeAll(found.ctx, { url: document.URL, userAgent: navigator.userAgent });
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

const args = parseArgs(process.argv.slice(2));

if (args.help) { console.log(HELP); process.exit(0); }

if (args.behaviour && !behaviourById(args.behaviour)) {
  console.error(`No behaviour "${args.behaviour}". Known: ${BEHAVIOURS.map((b) => b.id).join(', ')}`);
  process.exit(2);
}

let served = null;
let url = args.url;
if (!url) {
  served = await serveRepo();
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

  const raw = await session.evaluate(probeExpression(), 90000);
  const transcript = JSON.parse(raw);
  const result = judge(transcript);

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
