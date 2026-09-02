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
import { execFileSync, spawnSync } from 'node:child_process';
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

/**
 * One entry, run once.
 *
 * `--json` is used so the transcript and the judged result both come back, which is what makes a
 * finding checkable later without rerunning a browser against somebody's page.
 */
function runEntry(entry) {
  const startedAt = new Date().toISOString();
  const args = [path.join(ROOT, 'bin/ninthtool.mjs'), entry.entryPoint, '--json'];

  // AUTHORISATION IS RECORDED, NOT ASSUMED. Calling a page's own tools happens only where the entry
  // declares them readOnlyHint, and fixture forms are never authorised off our own fixture.
  const authorisation = entry.allowToolCalls === true ? 'read-only tool calls' : 'no tool calls';
  if (entry.allowToolCalls === true) args.push('--allow-tool-calls');

  const started = Date.now();
  const out = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 300000,
    // No credentials reach the child. A study that runs somebody's page with a token in the
    // environment is a study that cannot claim it was read only.
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
  });

  let parsed = null;
  let parseError = null;
  try { parsed = out.stdout ? JSON.parse(out.stdout) : null; } catch (error) {
    parseError = String((error && error.message) || error);
  }

  return {
    corpusId: entry.id,
    repo: entry.repo,
    sourceCommit: entry.commit,
    entryPoint: entry.entryPoint,
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
  const record = runEntry(entry);
  fs.writeFileSync(path.join(RUNS, `${entry.id}.json`), `${JSON.stringify(record, null, 1)}\n`);
  const counts = record.result && record.result.counts;
  console.log(counts
    ? `exit ${record.exitCode}, ${counts.fail} broken, ${counts.pass} kept, ${counts.notApplicable} unsettled`
    : `exit ${record.exitCode}, no judged result (${record.parseError || 'see stderr'})`);
}
console.log(`\nwrote ${wanted.length} run file(s) to evidence/impact/runs/`);
