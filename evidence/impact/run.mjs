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

/** The browser the runner will actually launch, asked rather than assumed. */
function browserVersion() {
  for (const exe of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
  ]) {
    if (!fs.existsSync(exe)) continue;
    const out = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    if (out.stdout) return out.stdout.trim();
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
async function runEntry(entry) {
  const startedAt = new Date().toISOString();

  const checkout = fetchCommit(entry);
  if (!checkout.ok) {
    fs.rmSync(checkout.dir, { recursive: true, force: true });
    // A fetch that failed is a RUN THAT FAILED, recorded with the same fields as any other. The
    // protocol forbids dropping losing cases, and an entry that could not be fetched is a case.
    return {
      corpusId: entry.id, repo: entry.repo, sourceCommit: entry.commit,
      entryPoint: entry.entryPoint, toolCommit: toolCommit(), browser: browserVersion(),
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

  // AUTHORISATION IS RECORDED, NOT ASSUMED. Calling a page's own tools happens only where the entry
  // declares them readOnlyHint, and fixture forms are never authorised off our own fixture.
  const authorisation = entry.allowToolCalls === true ? 'read-only tool calls' : 'no tool calls';
  if (entry.allowToolCalls === true) args.push('--allow-tool-calls');

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
    toolCommit: toolCommit(),
    browser: browserVersion(),
    flags: ['--enable-features=WebMCP'],
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
