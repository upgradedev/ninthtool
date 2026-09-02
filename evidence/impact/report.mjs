/**
 * Turn the raw run files into results.md. Nothing in the report is typed by hand.
 *
 * WHY THIS IS A SCRIPT AND NOT A DOCUMENT. Every number this project has been caught by was typed
 * once and then outlived the thing it described: a duration pinned as a constant, a count that fell
 * when an oracle got stricter, a verdict whose reasoning had been retired. A generated file cannot
 * drift from its inputs, and CI compares the committed output with a fresh run byte for byte.
 *
 *   node evidence/impact/report.mjs           writes results.md
 *   node evidence/impact/report.mjs --check   fails if the committed file is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { BEHAVIOURS } from '../../src/judge/behaviours.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, 'runs');
const OUT = path.join(HERE, 'results.md');

/*
 * THE PRIMARY METRIC, FIXED BY THE PROTOCOL BEFORE ANY PAGE RAN.
 *
 * `decidableFrom` partitions the catalogue into rows readable from the tool list and rows that need
 * a call or a registration. That field was written long before this study and is not adjusted for
 * it. The metric counts rows that REACHED A VERDICT and sit in the execution half.
 */
const EXECUTION = new Set(BEHAVIOURS.filter((b) => b.decidableFrom === 'execution').map((b) => b.id));
const SETTLED = new Set(['pass', 'fail', 'by-design']);

function loadRuns() {
  if (!fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')) }));
}

function measure(run) {
  const findings = (run.result && run.result.findings) || [];
  const settled = findings.filter((f) => SETTLED.has(f.verdict));
  const executionSettled = settled.filter((f) => EXECUTION.has(f.id));
  const abstained = findings.filter((f) => f.verdict === 'not-applicable');
  const withReproduce = findings.filter((f) => typeof f.reproduce === 'string' && f.reproduce);
  return {
    ran: Boolean(run.result),
    /*
     * What the PAGE exposed, before this tool registered anything of its own.
     *
     * THE FIELD IS `pageTools`. Read as `transcript.tools` it is undefined on every run, and the
     * generated report stated "13 of 13 pages exposed zero tools of their own" as a measured fact.
     * Seven of them had published between 2 and 14. A misspelt field does not throw, it reports
     * zero, and zero is a number a reader will believe.
     */
    pageTools: ((run.transcript && run.transcript.pageTools) || []).length,
    // The exact set of execution rows and their verdicts. If this string is the same on every page,
    // the metric is not reading the pages.
    executionSignature: executionSettled.map((f) => `${f.id}:${f.verdict}`).sort().join(','),
    settled: settled.length,
    executionSettled: executionSettled.length,
    metadataSettled: settled.length - executionSettled.length,
    abstained: abstained.length,
    broken: settled.filter((f) => f.verdict === 'fail').length,
    withReproduce: withReproduce.length,
    total: findings.length,
    elapsedMs: run.elapsedMs,
  };
}

const median = (numbers) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const runs = loadRuns();
const rows = runs.map((r) => ({ ...r, m: measure(r.data) }));
const ran = rows.filter((r) => r.m.ran);
const medianExecution = median(ran.map((r) => r.m.executionSettled));
const THRESHOLD = 3;

/*
 * VALIDITY IS CHECKED BEFORE THE THRESHOLD, AND IT OVERRIDES IT.
 *
 * The first generated version of this file said "the hypothesis holds" on a median of 8 against a
 * threshold of 3. It was wrong, and nothing in the metric could have said so: all twelve pages had
 * produced the SAME eight execution verdicts, because none of them exposed a single tool. The rows
 * settled against this tool's own registrations, so the number measured one browser twelve times.
 *
 * A metric that cannot vary across the population cannot support a claim about the population. That
 * is a property of the data, so it is computed here rather than remembered, and it decides the
 * headline. The primary metric itself is UNCHANGED and still reported: the protocol forbids swapping
 * it once results exist, and this is not a swap, it is the precondition it always had.
 */
const distinctPatterns = new Set(ran.map((r) => r.m.executionSignature)).size;
const pagesExposingTools = rows.filter((r) => r.m.pageTools > 0).length;

/*
 * WHICH ROWS ACTUALLY TELL TWO PAGES APART.
 *
 * A row that returns the same verdict on every page in the population is not reading the pages. It
 * may still be reading something real, and here it is: the execution rows are reading the browser's
 * WebMCP implementation through tools this instrument registers itself, and one browser gives one
 * answer. That is what those rows are FOR. It is not what the primary metric assumed they were.
 */
const verdictsById = new Map();
for (const r of ran) {
  for (const f of (r.data.result.findings || [])) {
    if (!verdictsById.has(f.id)) verdictsById.set(f.id, new Set());
    verdictsById.get(f.id).add(f.verdict);
  }
}
const varying = [...verdictsById.entries()].filter(([, v]) => v.size > 1).map(([id]) => id).sort();
const varyingExecution = varying.filter((id) => EXECUTION.has(id));
const discriminates = varyingExecution.length > 0;
const valid = discriminates;
const holds = valid && ran.length > 0 && medianExecution >= THRESHOLD;

const lines = [];
lines.push('# Results: what Ninth Tool reported on independently authored WebMCP pages');
lines.push('');
lines.push('**Generated by `evidence/impact/report.mjs`. Do not edit by hand; CI compares this file');
lines.push('with a fresh run byte for byte.**');
lines.push('');

if (!runs.length) {
  lines.push('## No runs exist yet');
  lines.push('');
  lines.push('`evidence/impact/runs/` is empty, so there is nothing to report. This file exists so');
  lines.push('that its absence cannot be mistaken for a result, and so the generator is checked in');
  lines.push('CI before any page has been run.');
} else {
  if (!valid) {
    lines.push('## The hypothesis is not supported, and the reason is worth more than the result');
    lines.push('');
    lines.push(`Across ${ran.length} pages that produced a judged result, **not one \`execution\` row `
      + 'returned a different verdict on a different page.** There is exactly '
      + `**${distinctPatterns} distinct pattern** of execution verdicts in the whole population.`);
    lines.push('');
    lines.push(`**${varying.length} of ${verdictsById.size} rows vary between pages: `
      + `${varying.map((id) => `\`${id}\``).join(', ')}. Every one of them is a \`metadata\` row**, `
      + 'which is precisely the half a declaration-only reading can already reach.');
    lines.push('');
    lines.push('So the preregistered claim fails on its own terms. The rows that need a tool to be');
    lines.push('called are not telling these pages apart, and the rows that tell these pages apart did');
    lines.push('not need a tool to be called.');
    lines.push('');
    lines.push('The execution rows were not measuring nothing. They were measuring the **browser**,');
    lines.push('through tools this instrument registers itself, and one browser returns one answer.');
    lines.push('That is a real reading and it is reported below as a post-hoc secondary result. It is');
    lines.push('not the reading the primary metric was written to support, and the metric is not');
    lines.push('changed to fit it.');
    lines.push('');
  }
  lines.push('## The preregistered answer, first');
  lines.push('');
  lines.push(`The protocol fixed the primary metric as **catalogue rows that reached a verdict and`);
  lines.push(`could not have been reached from the tool list alone**, with a success threshold of`);
  lines.push(`**${THRESHOLD} on the median page**, both chosen before any page ran.`);
  lines.push('');
  lines.push(`Pages attempted: **${rows.length}**. Pages that produced a judged result: **${ran.length}**.`);
  lines.push(`Median execution rows settled: **${medianExecution}**.`);
  lines.push('');
  lines.push(holds
    ? `**The hypothesis holds on this population.**`
    : valid
      ? `**The hypothesis FAILS on this population, and that is the result.** The median page yielded`
        + ` ${medianExecution} execution rows against a preregistered threshold of ${THRESHOLD}.`
      : `**That number clears the threshold and still means nothing**, for the reason given above.`
        + ` It is recorded, not claimed.`);
  lines.push('');
  lines.push('## Every page, including the ones that produced nothing');
  lines.push('');
  lines.push('| page | tools the page exposed | ran | settled | of those, execution | abstained | broken | ms |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const m = r.m;
    lines.push(`| \`${r.data.corpusId}\` | ${m.pageTools} | ${m.ran ? 'yes' : 'NO'} | ${m.settled} | `
      + `${m.executionSettled} | ${m.abstained} | ${m.broken} | ${m.elapsedMs} |`);
  }
  lines.push('');
  lines.push('## The comparator, which is an ablation of this tool and is named as one');
  lines.push('');
  lines.push('A declaration-only reading can reach the `metadata` half of the catalogue and no more.');
  lines.push(`That half is ${BEHAVIOURS.filter((b) => b.decidableFrom === 'metadata').length} rows of `
    + `${BEHAVIOURS.length}, fixed by \`decidableFrom\` in the catalogue before this study existed.`);
  lines.push('');
  lines.push('| page | a declaration-only reading could settle | Ninth Tool settled | difference |');
  lines.push('|---|---|---|---|');
  for (const r of ran) {
    lines.push(`| \`${r.data.corpusId}\` | ${r.m.metadataSettled} | ${r.m.settled} | `
      + `+${r.m.executionSettled} |`);
  }
  lines.push('');
  lines.push('## Reproduction');
  lines.push('');
  const noRepro = ran.filter((r) => r.m.withReproduce !== r.m.total);
  lines.push(noRepro.length
    ? `**${noRepro.length} page(s) produced findings without a reproduce command**, which contradicts `
      + 'the claim that every row carries one. Named: '
      + noRepro.map((r) => `\`${r.data.corpusId}\``).join(', ')
    : 'Every finding on every page carried a one-command reproduction.');
  lines.push('');
  lines.push('## Post hoc, and labelled as such');
  lines.push('');
  lines.push('**This was not preregistered. It is reported because the data shows it, and it is');
  lines.push('marked so that no reader mistakes it for the tested hypothesis.**');
  lines.push('');
  const constantFails = [...verdictsById.entries()]
    .filter(([id, v]) => v.size === 1 && [...v][0] === 'fail' && EXECUTION.has(id))
    .map(([id]) => id).sort();
  lines.push(`${constantFails.length} execution rows returned \`fail\` on **every one of the `
    + `${ran.length} pages**: ${constantFails.map((id) => `\`${id}\``).join(', ')}.`);
  lines.push('');
  lines.push('Identical results across twelve independently authored pages is what reproducibility');
  lines.push('looks like when the subject is the runtime rather than the page. These are findings');
  lines.push('about one browser build, named in the provenance table below, and they should be read');
  lines.push('as one finding reproduced twelve times, never as twelve findings.');
  lines.push('');
  lines.push('## What a reader should not take from this');
  lines.push('');
  lines.push('- Not that these pages are defective. No page here is named as broken.');
  lines.push('- Not that the tool finds page-specific defects that a declaration-only reading misses,');
  lines.push('  because on this population it did not.');
  lines.push('- Not that the browser is defective. A conformance row failing is a difference from a');
  lines.push('  draft specification, measured on one build, and the draft is still moving.');
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push('| page | source commit | instrument commit | browser |');
  lines.push('|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| \`${r.data.corpusId}\` | \`${String(r.data.sourceCommit).slice(0, 12)}\` | `
      + `\`${String(r.data.toolCommit).slice(0, 12)}\` | ${r.data.browser || 'not recorded'} |`);
  }
}

lines.push('');
lines.push('## Artifact hashes');
lines.push('');
lines.push('| file | sha256 |');
lines.push('|---|---|');
for (const r of runs) {
  const bytes = fs.readFileSync(path.join(RUNS, r.file));
  lines.push(`| \`runs/${r.file}\` | \`${crypto.createHash('sha256').update(bytes).digest('hex')}\` |`);
}
lines.push('');

const text = `${lines.join('\n')}`;

if (process.argv.includes('--check')) {
  const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (committed.split('\r\n').join('\n') !== text) {
    console.error('results.md is not what the runs produce. Regenerate it:');
    console.error('  node evidence/impact/report.mjs');
    process.exit(1);
  }
  console.log(`results.md matches ${runs.length} run file(s).`);
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log(`wrote results.md from ${runs.length} run file(s).`);
