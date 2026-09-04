/**
 * Run the frozen Ninth Tool against one corpus entry and keep everything it produced.
 *
 * ONE FILE PER RUN, WRITTEN WHATEVER HAPPENS. A run that errors, refuses, or finds nothing is
 * recorded with the same fields as one that succeeds. The protocol forbids removing losing cases,
 * and the cheapest way to honour that is to make dropping one require deleting a file somebody can
 * see is missing.
 *
 * NOTHING HERE DECIDES ANYTHING. It records what the runner printed and what the judge returned.
 * The metric is computed later, by report.mjs, from these files.
 *
 *   node evidence/impact/run.mjs --id <corpus id>
 *   node evidence/impact/run.mjs --all
 *
 * Safety, from protocol section 10 and enforced here rather than remembered:
 *   - read only unless the entry says its tools are readOnlyHint, and that is recorded per run
 *   - --allow-fixture-forms is NEVER passed to an external page
 *   - a public URL is read anonymously, with no credential in the environment
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RUNS = path.join(HERE, 'runs');

/** The commit of the instrument, so a reader can check the tool did not move mid study. */
function toolCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  } catch { return null; }
}

/*
 * WAS THE TREE CLEAN WHEN THIS RAN? BECAUSE THE COMMIT ALONE CAN LIE.
 *
 * `toolCommit` reads HEAD, which describes the REPOSITORY, not the code that executed. The second
 * wave was first run with the P5 guard sitting uncommitted in the working tree, so every one of the
 * eight records was stamped with a commit that does not contain the guard. A reader who checked that
 * commit out and re-ran would have got the OLD behaviour back, including the two findings those very
 * records exist to retract.
 *
 * Nothing failed. The number was simply wrong, and it was wrong in the field a reader trusts most.
 * So the record now carries whether `git status --porcelain` was empty, and a `false` here means the
 * commit beside it is a hint rather than a provenance.
 */
const INSTRUMENT_PATHS = ['src', 'bin', 'evidence/impact/run.mjs'];

function toolTreeClean() {
  try {
    /*
     * SCOPED TO THE CODE THAT EXECUTES, because the first version asked about the WHOLE tree and
     * this runner writes into that tree as it goes. The opening run reported clean and the other
     * seven reported dirty, all in one wave, on the strength of the run files the runner had just
     * written. A provenance check defeated by its own output is worse than none: it looks like a
     * finding about the instrument.
     *
     * What matters for reproducing a result is whether bin, src and this file were committed.
     */
    const out = execFileSync('git', ['status', '--porcelain', '--', ...INSTRUMENT_PATHS],
      { cwd: ROOT }).toString().trim();
    return out === '';
  } catch { return null; }
}

/**
 * The browser the runner will actually launch, asked rather than assumed.
 *
 * ASKING CAN ANSWER WITH SOMETHING THAT IS NOT A VERSION. On Windows, `chrome.exe --version` with a
 * Chrome already open is forwarded to the running instance, which prints "Opening in existing
 * browser session." and exits zero. Every wave one run recorded that sentence as its browser, and
 * the study that rests on one browser version named its browser nowhere. Trusting stdout because
 * the exit code was zero is the whole defect.
 *
 * So the shape is checked, not the exit code. Anything that does not look like a version is
 * refused, and null travels to the report, which then prefers the user agent the probe read from
 * the browser it actually drove.
 */
const LOOKS_LIKE_A_VERSION = /\d+\.\d+\.\d+/;

function browserVersion() {
  for (const exe of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
  ]) {
    if (!fs.existsSync(exe)) continue;
    const out = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    const said = String(out.stdout || '').trim();
    if (said && LOOKS_LIKE_A_VERSION.test(said)) return said;
  }
  return null;
}

/*
 * FETCH THE EXACT COMMIT, SERVE IT LOCALLY, DELETE IT.
 *
 * The protocol says local checkouts run from an exact commit in a throwaway directory with no
 * credentials present, and with no network reachable from the page. Fetching one commit rather
 * than cloning a history is both faster and the only thing that makes the recorded SHA mean
 * anything: a shallow clone of a branch would move under the study.
 *
 * The C drive on this machine runs near full, so each checkout is removed as soon as its run is
 * written rather than at the end.
 */
function fetchCommit(entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ntstudy-${entry.id}-`));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 240000 });
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  git('remote', 'add', 'origin', entry.repoUrl);
  const fetched = git('fetch', '--depth', '1', '-q', 'origin', entry.commit);
  if (fetched.status !== 0) {
    return { dir, ok: false, why: `could not fetch ${entry.commit}: ${String(fetched.stderr).slice(0, 300)}` };
  }
  const out = git('checkout', '-q', 'FETCH_HEAD');
  if (out.status !== 0) {
    return { dir, ok: false, why: `could not check out: ${String(out.stderr).slice(0, 300)}` };
  }
  return { dir, ok: true, why: null };
}

/** A loopback server over one throwaway checkout. Confined to that directory, nothing else. */
function serve(root) {
  const server = http.createServer((req, res) => {
    const wanted = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
    const full = path.resolve(root, `.${wanted}`);
    // Containment is segment aware, the same rule src/probe/serve.mjs uses, so a traversal cannot
    // read this machine rather than the checkout.
    if (path.relative(root, full).startsWith('..')) { res.writeHead(403); res.end('outside'); return; }
    let file = full;
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* below */ }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('no'); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)]
      || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(fs.readFileSync(file));
  });
  return server;
}

/**
 * One entry, run once.
 *
 * `--json` is used so the transcript and the judged result both come back, which is what makes a
 * finding checkable later without rerunning a browser against somebody's page.
 */
async function runEntry(entry, options = {}) {
  const startedAt = new Date().toISOString();
  const behaviour = options.behaviour || null;

  const checkout = fetchCommit(entry);
  if (!checkout.ok) {
    fs.rmSync(checkout.dir, { recursive: true, force: true });
    // A fetch that failed is a RUN THAT FAILED, recorded with the same fields as any other. The
    // protocol forbids dropping losing cases, and an entry that could not be fetched is a case.
    return {
      corpusId: entry.id, repo: entry.repo, sourceCommit: entry.commit,
      entryPoint: entry.entryPoint, toolCommit: toolCommit(), toolTreeClean: toolTreeClean(),
      browser: browserVersion(),
      flags: ['--enable-features=WebMCP'], authorisation: 'not reached', startedAt,
      endedAt: new Date().toISOString(), elapsedMs: 0, exitCode: null, signal: null,
      stderr: checkout.why, stdoutBytes: 0, parseError: null, transcript: null, result: null,
    };
  }

  const server = serve(checkout.dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // The corpus records entry points with forward slashes, so they are URL paths already.
  const url = origin + '/' + String(entry.entryPoint);

  const args = [path.join(ROOT, 'bin/ninthtool.mjs'), url, '--json'];

  /*
   * ONE ROW PER RUN IN WAVE 2, AND THE REASON IS ARITHMETIC RATHER THAN TIDINESS.
   *
   * P6 makes N squared plus 3N calls to the page's own tools and each call may take
   * SETTLE_TIMEOUT_MS, which is 2500. At N=5 that is 40 calls, and adding P5's 4 per testable tool
   * puts the worst case at 150 seconds against the 120 second budget the CLI gives the whole
   * evaluation. Splitting the rows gives each its own budget and, more usefully, it shrinks what a
   * single run can touch.
   */
  if (behaviour) args.push('--behaviour', behaviour);

  // AUTHORISATION IS RECORDED, NOT ASSUMED. Calling a page's own tools happens only where the entry
  // declares them readOnlyHint, and fixture forms are never authorised off our own fixture.
  const allowCalls = options.allowToolCalls === true || entry.allowToolCalls === true;
  const authorisation = allowCalls ? 'read-only tool calls' : 'no tool calls';
  if (allowCalls) args.push('--allow-tool-calls');

  /*
   * ASYNC, BECAUSE spawnSync BLOCKS THE EVENT LOOP AND THIS PROCESS IS THE WEB SERVER.
   *
   * The first version used spawnSync. The server never answered a single request, because nothing
   * in this process could run while it waited, and every page reported the same thing:
   *
   *   never finished loading. The attached document is "about:blank" after 30098 ms
   *
   * which reads like thirteen broken pages and was one blocked loop.
   */
  const started = Date.now();
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      // No credentials reach the child. A study that runs somebody's page with a token in the
      // environment is a study that cannot claim it was read only.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const killer = setTimeout(() => child.kill(), 300000);
    child.on('close', (status, signal) => {
      clearTimeout(killer);
      resolve({ status, signal, stdout, stderr });
    });
  });

  let parsed = null;
  let parseError = null;
  try { parsed = out.stdout ? JSON.parse(out.stdout) : null; } catch (error) {
    parseError = String((error && error.message) || error);
  }

  server.close();
  fs.rmSync(checkout.dir, { recursive: true, force: true });

  return {
    corpusId: entry.id,
    repo: entry.repo,
    sourceCommit: entry.commit,
    entryPoint: entry.entryPoint,
    servedAt: url,
    behaviour,
    toolCommit: toolCommit(),
    toolTreeClean: toolTreeClean(),
    browser: browserVersion(),
    /*
     * NAMED FOR WHAT IT IS. This used to read `flags: ['--enable-features=WebMCP']`, which reads as
     * the browser's full command line and is not: launchWithWebMCP builds seven. Recording an
     * incomplete list under a complete-sounding name is the shape of defect this study already
     * published twice, so the field now says what it holds and where the rest lives.
     */
    browserFlags: {
      recordedHere: ['--enable-features=WebMCP'],
      complete: false,
      builtIn: 'src/probe/launch.mjs',
    },
    authorisedTools: options.authorisedTools || null,
    authorisation,
    startedAt,
    endedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    exitCode: out.status,
    signal: out.signal || null,
    stderr: String(out.stderr || '').slice(0, 8000),
    stdoutBytes: String(out.stdout || '').length,
    parseError,
    transcript: parsed ? parsed.transcript : null,
    result: parsed ? parsed.result : null,
  };
}

const args = process.argv.slice(2);
const corpusPath = path.join(HERE, 'corpus.json');
if (!fs.existsSync(corpusPath)) {
  console.error('evidence/impact/corpus.json does not exist yet, so there is nothing to run.');
  process.exit(2);
}
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const entries = (corpus.entries || []).filter((e) => e.included === true);

/*
 * WAVE 2. THE FOUR PAGES ARE NOT A LIST SOMEBODY TYPED.
 *
 * They are every page in wave 1 that published at least one tool it annotated readOnlyHint, read
 * out of the wave-1 run files by the rule below. Protocol section 10 authorises --allow-tool-calls
 * on exactly those and nowhere else, so the selection rule IS the authorisation rule, and a reader
 * can re-derive the set instead of trusting it.
 *
 * The instrument does not verify readOnlyHint and says so: `steps.js` calls it "an annotation this
 * suite exists to doubt". So the guarantee here is not that these tools are harmless, it is that
 * nothing outside the page's own declared read-only set is ever called, enforced at
 * src/probe/observe.js:903 and :1010 by a strict === true, not by this file.
 */
if (args.includes('--wave2')) {
  const WAVE1 = path.join(HERE, 'runs');
  const RUNS2 = path.join(HERE, 'runs-wave2');
  if (!fs.existsSync(WAVE1)) {
    console.error('wave 2 is derived from the wave 1 runs, and evidence/impact/runs/ does not exist.');
    process.exit(2);
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const selected = [];
  for (const file of fs.readdirSync(WAVE1).filter((f) => f.endsWith('.json')).sort()) {
    const record = JSON.parse(fs.readFileSync(path.join(WAVE1, file), 'utf8'));
    const tools = (record.transcript && record.transcript.pageTools) || [];
    const readOnly = tools.filter((t) => t.readOnlyHint === true).map((t) => t.name).sort();
    if (!readOnly.length) continue;
    const entry = byId.get(record.corpusId);
    if (!entry) continue;
    selected.push({ entry, readOnly });
  }
  if (!selected.length) {
    console.error('no wave 1 page published a readOnlyHint tool, so wave 2 has nothing to authorise.');
    process.exit(2);
  }
  fs.mkdirSync(RUNS2, { recursive: true });
  console.log(`wave 2: ${selected.length} page(s) published a readOnlyHint tool.
`);
  for (const { entry, readOnly } of selected) {
    for (const row of ['P5', 'P6']) {
      process.stdout.write(`running ${entry.id} ${row} (${readOnly.length} read only tool(s)) ... `);
      const record = await runEntry(entry, {
        behaviour: row, allowToolCalls: true, authorisedTools: readOnly,
      });
      fs.writeFileSync(path.join(RUNS2, `${entry.id}-${row}.json`), `${JSON.stringify(record, null, 1)}
`);
      const finding = record.result && (record.result.findings || []).find((f) => f.id === row);
      console.log(finding ? `${finding.verdict}` : `no verdict (exit ${record.exitCode})`);
    }
  }
  console.log(`
wrote ${selected.length * 2} run file(s) to evidence/impact/runs-wave2/`);
  process.exit(0);
}

const wanted = args.includes('--all')
  ? entries
  : entries.filter((e) => e.id === args[args.indexOf('--id') + 1]);

if (!wanted.length) {
  console.error('no included corpus entry matched. Use --all or --id <id>.');
  process.exit(2);
}

fs.mkdirSync(RUNS, { recursive: true });
for (const entry of wanted) {
  process.stdout.write(`running ${entry.id} ... `);
  const record = await runEntry(entry);
  fs.writeFileSync(path.join(RUNS, `${entry.id}.json`), `${JSON.stringify(record, null, 1)}\n`);
  const counts = record.result && record.result.counts;
  console.log(counts
    ? `exit ${record.exitCode}, ${counts.fail} broken, ${counts.pass} kept, ${counts.notApplicable} unsettled`
    : `exit ${record.exitCode}, no judged result (${record.parseError || 'see stderr'})`);
}
console.log(`\nwrote ${wanted.length} run file(s) to evidence/impact/runs/`);
