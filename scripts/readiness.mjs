#!/usr/bin/env node
/**
 * The readiness gate. It answers one question: could a stranger with no account reach every
 * mandatory artifact of this submission right now?
 *
 * IT FETCHES THE LIVE URL AND FAILS ON ANYTHING BUT 200. That is the row that makes this a gate
 * rather than a checklist. A file existence check and a regular expression over the source prove
 * that we wrote something, not that anything is deployed. A nine thousand line gate elsewhere once
 * stayed green through a two day total outage because every one of its checks read the repository.
 * So the network rows here read the origin a judge would open, and the strongest row drives that
 * origin through a real browser and presses the button a visitor presses.
 *
 * IT GREPS THE DEPLOYED BYTES, NOT THE SOURCE. Row M4 asks whether the tools the README claims are
 * in the JavaScript actually being served. Those have differed before.
 *
 * USER GATED IS A THIRD STATUS AND NEVER A PASS. Rows only the owner can close are counted
 * separately, printed with the exact manual step, and never fold into the percentage as credit. The
 * same is true of a row that could not be run: `not run` is not `passed`, and the summary keeps them
 * apart.
 *
 * EVERY ROW IS TWO HALVES, AND THE SELF TEST CALLS THE SECOND ONE.
 *
 * `gather` does the input and output: fetch, read a file, spawn a process, drive a browser. `decide`
 * is pure, holds all of the judgement, and is the only thing that can return a verdict. `run` is
 * `decide(await gather())` and nothing else.
 *
 * The split exists because the self test that came before it was hollow. Its cases were hand
 * written expressions that resembled the rows, for example `{ ok: 404 === 200 }` standing in for
 * "the live URL answered 404". Nothing connected them to the rows they were named after. Proof:
 * row M5's `if (response.status !== 200)` was changed to `if (false)`, so the row could never fail
 * for any input, and `--selftest` still printed PASS for all nineteen cases. A gate that cannot
 * notice a row being disabled is not proving anything about that row.
 *
 * So the self test now names a row id and a deliberately broken input, looks the row up in `ROWS`,
 * and calls the row's real `decide`. Mutate any `decide` to return `{ ok: true }` and every case
 * for that row goes green, which is what makes `--selftest` fail. There is nowhere left to put a
 * hardcoded expression, because the case table holds no expressions.
 *
 *   node scripts/readiness.mjs                 everything, including the browser row
 *   node scripts/readiness.mjs --offline       skip the network and browser rows, report them not run
 *   node scripts/readiness.mjs --no-browser    network rows only
 *   node scripts/readiness.mjs --selftest      prove every row can fail, then exit
 *   node scripts/readiness.mjs --json          machine readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LIVE_URL, LIVE_PATHS, CLAIMED_TOOLS, FLAGSHIP, MANIFEST_PATH,
  MANDATORY_PASS_RATE, OVERALL_PASS_RATE, VIDEO_MAX_SECONDS, thresholdDrift,
  STANDING_TOOLS, SUBJECT_FRAME_TOOLS, FINDINGS_TOOL, EXPECTED_CATALOGUE_ROWS, MAY_ABSTAIN,
  sortedAbstainIds, surfaceAtRest, surfaceDuringRun,
} from './readiness_config.mjs';
import { buildManifest, readManifest, manifestDrift, hashOf } from './build_manifest.mjs';
import { OTHER_COMPETITIONS, JUDGE_FACING_FILES, SIBLING_ENTRY, SIBLING_MAY_BE_NAMED_IN,
  SIBLING_MUST_BE_NAMED_IN } from './style_config.mjs';
import { BEHAVIOURS } from '../src/judge/behaviours.js';
import { judge } from '../src/judge/verdict.js';
import { launchWithWebMCP, waitForPageTarget, targetFor, waitForDocument } from '../src/probe/launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const flat = (s) => s.replace(/\s+/g, ' ').trim();

const args = {
  offline: process.argv.includes('--offline'),
  noBrowser: process.argv.includes('--no-browser') || process.argv.includes('--offline'),
  selftest: process.argv.includes('--selftest'),
  json: process.argv.includes('--json'),
};

/* ------------------------------------------------------------------ helpers */

/** Fetch, and never throw: a network failure is a finding, not a crash. */
async function get(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    const body = await response.text();
    return { status: response.status, body, error: null };
  } catch (error) {
    return { status: 0, body: '', error: String((error && error.message) || error) };
  }
}

/** Parse, or say plainly that it did not parse. Never throw on somebody else's bytes. */
function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * The findings payload, out of whatever envelope the host wrapped it in.
 *
 * MEASURED, AND THE FIRST TWO READINGS WERE BOTH WRONG. The handler returns
 * `{ content: [{ type: 'text', text: '<the json>' }] }`. Reading `content[0].text` off the value
 * `executeTool` resolves to gave nothing, because Chrome hands the caller a STRING. Reading that
 * string as the payload gave an object with no run and no findings, because the string is the whole
 * envelope serialised rather than the text inside it. So this parses once, and when what comes back
 * is an envelope it parses the text within. Neither step invents anything: an answer that is not
 * JSON, or JSON with no findings in it, still fails the row.
 */
function readFindingsPayload(text) {
  const once = safeParse(text);
  if (!once || typeof once !== 'object') return null;
  const first = (Array.isArray(once.content) ? once.content[0] : null) || null;
  if (first && typeof first.text === 'string') {
    const inner = safeParse(first.text);
    if (inner && typeof inner === 'object') return inner;
  }
  return once;
}

/** Two lists of names hold the same names the same number of times. Order is not a finding. */
function sameMultiset(seen, wanted) {
  const a = [...(Array.isArray(seen) ? seen : [])].map(String).sort();
  const b = [...wanted].map(String).sort();
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** What a multiset comparison found, in words a reader can act on. */
function multisetDrift(seen, wanted) {
  const a = [...(Array.isArray(seen) ? seen : [])].map(String).sort();
  const b = [...wanted].map(String).sort();
  const extra = a.filter((name) => !b.includes(name));
  const absent = b.filter((name) => !a.includes(name));
  const parts = [];
  if (absent.length) parts.push(`absent: ${absent.join(', ')}`);
  if (extra.length) parts.push(`unexpected: ${extra.join(', ')}`);
  if (!parts.length && a.length !== b.length) parts.push(`${a.length} names where ${b.length} were expected`);
  return parts.join('; ');
}

/* ------------------------------------------------------------------ the rows */

/**
 * Every row. `kind` is mandatory, recommended or owner-gated.
 *
 * `gather` does the input and output and returns plain data. `decide` takes that data, returns
 * `{ ok, evidence }` or throws, and a throw is a failure with the message as the evidence. All of
 * the judgement lives in `decide`, which is what `--selftest` calls. `network` and `browser` mark
 * rows that need those, so --offline can report them not run rather than pretending.
 */
export const ROWS = [
  /* ---------------------------------------------------------------- mandatory, offline */
  {
    id: 'M1', kind: 'mandatory',
    title: 'An OSI licence file is at the repository root',
    gather: async () => ({ text: read('LICENSE') }),
    decide: ({ text }) => ({
      ok: /MIT License/.test(text),
      evidence: `LICENSE, ${text.split('\n').length} lines, first line "${text.split('\n')[0]}"`,
    }),
  },
  {
    id: 'M2', kind: 'mandatory',
    title: 'The flagship sentence is identical on the README and the page',
    gather: async () => ({ readme: read('README.md'), page: read('index.html') }),
    decide: ({ readme, page }) => {
      const inReadme = flat(readme).includes(flat(FLAGSHIP));
      const inPage = flat(page).includes(flat(FLAGSHIP));
      return {
        ok: inReadme && inPage,
        evidence: `README ${inReadme ? 'carries it' : 'DOES NOT'}, index.html ${inPage ? 'carries it' : 'DOES NOT'}`
          + `, ${FLAGSHIP.split(/\s+/).length} words`,
      };
    },
  },
  {
    id: 'M3', kind: 'mandatory',
    title: 'No judge facing file names another competition, and the sibling entry IS disclosed',
    gather: async () => {
      const texts = {};
      for (const file of [...JUDGE_FACING_FILES, ...SIBLING_MUST_BE_NAMED_IN]) texts[file] = read(file);
      return { texts };
    },
    decide: ({ texts }) => {
      // Two sided, and it became two sided because the two rules genuinely conflict. Naming
      // another CONTEST is a defect. Naming our own second entry in THIS contest, in the
      // provenance section the rules require in order to judge whether two submissions are
      // substantially different, is required. So the ban is narrowed by file and by name, and the
      // disclosure is asserted, which makes this row stricter than the one it replaces.
      const hits = [];
      for (const file of JUDGE_FACING_FILES) {
        // A file that was not read was not scanned, and a gate whose scope quietly shrinks is a
        // failure this repository has already had. Missing input is a failure, never a skip.
        if (typeof texts[file] !== 'string') throw new Error(`${file} could not be read, so it was not scanned`);
        const text = texts[file].toLowerCase();
        for (const name of OTHER_COMPETITIONS) {
          if (name === SIBLING_ENTRY && SIBLING_MAY_BE_NAMED_IN.includes(file)) continue;
          if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(text)) hits.push(`${file}: ${name}`);
        }
      }
      const undisclosed = SIBLING_MUST_BE_NAMED_IN.filter((file) => {
        if (typeof texts[file] !== 'string') throw new Error(`${file} could not be read, so the disclosure was not checked`);
        return !texts[file].toLowerCase().includes(SIBLING_ENTRY);
      });
      for (const file of undisclosed) {
        hits.push(`${file}: does NOT disclose the sibling entry, which the multiple entry rule requires`);
      }
      return {
        ok: hits.length === 0,
        evidence: hits.length ? hits.join('; ')
          : `${JUDGE_FACING_FILES.length} judge facing files clean of ${OTHER_COMPETITIONS.length - 1}`
            + ` other names, and the sibling entry is disclosed in ${SIBLING_MUST_BE_NAMED_IN.join(', ')}`,
      };
    },
  },
  {
    id: 'M4', kind: 'mandatory', network: true,
    title: 'Every tool the README claims is in the DEPLOYED bundle, not just the source',
    // Deliberately the served bytes. Grepping src/ would prove what we wrote, not what is live.
    gather: async () => get(new URL('src/ui/app.js', LIVE_URL).href),
    decide: (served) => {
      if (served.status !== 200) throw new Error(`the deployed app.js answered ${served.status || served.error}`);
      const missing = CLAIMED_TOOLS.filter((name) => !served.body.includes(name));
      return {
        ok: missing.length === 0,
        evidence: missing.length
          ? `claimed but ABSENT from the deployed bundle: ${missing.join(', ')}`
          : `all ${CLAIMED_TOOLS.length} claimed tools present in the served app.js (${served.body.length} bytes)`,
      };
    },
  },

  /* ---------------------------------------------------------------- mandatory, live */
  {
    id: 'M5', kind: 'mandatory', network: true,
    title: 'The live judge URL answers 200',
    gather: async () => get(LIVE_URL),
    decide: (response) => {
      if (response.status !== 200) {
        throw new Error(`${LIVE_URL} answered ${response.status || 'no response'}${response.error ? `: ${response.error}` : ''}`);
      }
      return { ok: true, evidence: `${LIVE_URL} answered 200, ${response.body.length} bytes` };
    },
  },
  {
    id: 'M6', kind: 'mandatory', network: true,
    title: 'Every file the page loads answers 200, taken from the manifest not from a list',
    gather: async () => {
      const fresh = buildManifest(ROOT);
      const wanted = [...LIVE_PATHS, ...Object.keys(fresh.files)];
      const responses = [];
      for (const suffix of wanted) {
        const response = await get(new URL(suffix, LIVE_URL).href);
        responses.push({ suffix, status: response.status, error: response.error });
      }
      return { responses, fileCount: fresh.fileCount };
    },
    decide: ({ responses, fileCount }) => {
      const bad = responses
        .filter((r) => r.status !== 200)
        .map((r) => `${r.suffix || '/'} -> ${r.status || r.error}`);
      return {
        ok: bad.length === 0,
        evidence: bad.length
          ? `not 200: ${bad.join(', ')}`
          : `all ${responses.length} paths answered 200, ${fileCount} of them from the module graph`,
      };
    },
  },
  {
    id: 'M7', kind: 'mandatory', network: true,
    title: 'The live page body carries the flagship sentence',
    gather: async () => get(LIVE_URL),
    decide: (response) => {
      if (response.status !== 200) throw new Error(`the live URL answered ${response.status || response.error}`);
      const carries = flat(response.body).includes(flat(FLAGSHIP));
      return { ok: carries, evidence: carries ? 'the served HTML carries it word for word' : 'the served HTML DOES NOT carry it' };
    },
  },

  /* ---------------------------------------------------------------- mandatory, browser */
  {
    id: 'M8', kind: 'mandatory', browser: true,
    title: 'A real browser opens the live URL and the audit actually runs',
    gather: async () => driveLivePage(),
    decide: decideM8,
  },

  /* ---------------------------------------------------------------- recommended */
  {
    id: 'R1', kind: 'recommended',
    title: 'Every rule in the judge has a mutation proving it can fail',
    gather: async () => ({ text: read('tests/unit/verdict_mutations.test.js') }),
    decide: ({ text }) => {
      // [A-DP] rather than [A-D]: the your-page group uses P ids, and a character class that
      // quietly stops matching a whole group is exactly the shape of gate this repository has
      // already been caught by twice.
      const covered = [...text.matchAll(/^\s{2}([A-DP]\d):\s*\{/gm)].map((m) => m[1]);
      const missing = BEHAVIOURS.map((b) => b.id).filter((id) => !covered.includes(id));
      return {
        ok: missing.length === 0,
        evidence: missing.length ? `no mutation for ${missing.join(', ')}` : `${covered.length} of ${BEHAVIOURS.length} behaviours have one`,
      };
    },
  },
  {
    id: 'R2', kind: 'recommended',
    title: 'The unit tests pass',
    gather: async () => {
      try {
        return {
          output: execFileSync(process.execPath, ['--test', 'tests/unit'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }),
          threw: false,
        };
      } catch (error) {
        return { output: String(error.stdout || ''), threw: true };
      }
    },
    decide: ({ output, threw }) => {
      const pass = (output.match(/^# pass (\d+)/m) || [])[1];
      const fail = (output.match(/^# fail (\d+)/m) || [])[1];
      if (threw) return { ok: false, evidence: `${fail || 'some'} tests failed` };
      return { ok: fail === '0', evidence: `${pass} passed, ${fail} failed` };
    },
  },
  {
    id: 'R3', kind: 'recommended',
    title: 'The style gate passes and proves it can fail first',
    gather: async () => {
      try {
        return {
          output: execFileSync(process.execPath, ['scripts/check_style.mjs', '--selftest'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }),
          threw: false,
        };
      } catch (error) {
        return { output: String(error.stdout || error.message), threw: true };
      }
    },
    decide: ({ output, threw }) => {
      if (threw) return { ok: false, evidence: `the style gate exited non zero: ${output.slice(0, 160)}` };
      const scanned = (output.match(/scanned (\d+) files/) || [])[1];
      const proved = /selftest: PASS/.test(output);
      return {
        ok: /style gate: PASS/.test(output) && proved,
        evidence: `${scanned} files scanned, selftest ${proved ? 'proved every rule can fail' : 'DID NOT RUN'}`,
      };
    },
  },
  {
    id: 'R4', kind: 'recommended',
    title: 'The prior art search is written down and names what would falsify it',
    gather: async () => ({
      present: exists('docs/prior-art.md'),
      text: exists('docs/prior-art.md') ? read('docs/prior-art.md') : '',
    }),
    decide: ({ present, text }) => {
      if (!present) return { ok: false, evidence: 'docs/prior-art.md is missing' };
      const hasFalsifier = /falsif/i.test(text);
      const namesRivals = (text.match(/does the same thing/g) || []).length;
      return {
        ok: hasFalsifier && namesRivals >= 1,
        evidence: `${namesRivals} products marked as doing the same thing, falsification criterion ${hasFalsifier ? 'stated' : 'MISSING'}`,
      };
    },
  },
  {
    id: 'R5', kind: 'mandatory', network: true,
    title: 'Every runtime file the page loads is byte identical to this tree',
    gather: async () => {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      const fresh = buildManifest(ROOT);
      const committed = readManifest(ROOT);
      const servedManifest = await get(new URL(MANIFEST_PATH, LIVE_URL).href);
      const served = {};
      for (const relative of Object.keys(fresh.files)) {
        const response = await get(new URL(relative, LIVE_URL).href);
        served[relative] = { status: response.status, body: response.body, error: response.error };
      }
      return { head, fresh, committed, servedManifest, served };
    },
    decide: ({ head, fresh, committed, servedManifest, served }) => {
      /*
       * THREE DIRECTIONS, BECAUSE ONE WAS NOT ENOUGH.
       *
       * This row used to fetch `behaviours.js` and compare it, while eight other files the page
       * loads were served unverified. It reported the deployment as current on the strength of one
       * ninth of it.
       *
       *   1. the committed manifest matches this tree
       *   2. the served manifest matches the committed one, which is the deployment identity
       *   3. every file the manifest lists is served and hashes the same
       *
       * A missing or unreadable served manifest is a failure, not an excuse: an unknown deployment
       * identity is exactly the state this row exists to refuse.
       */
      const localDrift = manifestDrift(fresh, committed);
      if (localDrift.length) {
        throw new Error(`the committed manifest does not describe this tree, so there is nothing `
          + `trustworthy to compare the deployment against: ${localDrift.slice(0, 3).join('; ')}`);
      }
      if (servedManifest.status !== 200) {
        throw new Error(`the live origin does not serve ${MANIFEST_PATH} (${servedManifest.status
          || servedManifest.error}), so the deployed identity is unknown`);
      }
      const deployed = safeParse(servedManifest.body);
      if (!deployed) {
        throw new Error(`the served ${MANIFEST_PATH} did not parse, so the deployed identity is unknown`);
      }
      const deployedDrift = manifestDrift(fresh, deployed);

      const mismatched = [];
      for (const [relative, expected] of Object.entries(fresh.files)) {
        const response = served[relative];
        if (!response) { mismatched.push(`${relative}: was never fetched`); continue; }
        if (response.status !== 200) { mismatched.push(`${relative}: ${response.status || response.error}`); continue; }
        if (hashOf(response.body) !== expected) mismatched.push(`${relative}: served bytes differ`);
      }

      const ok = deployedDrift.length === 0 && mismatched.length === 0;
      return {
        ok,
        evidence: ok
          ? `all ${fresh.fileCount} runtime files served identical to the tree at ${head.slice(0, 7)}`
            + ', and the deployed manifest matches'
          : [
            deployedDrift.length ? `the deployed manifest differs: ${deployedDrift.slice(0, 3).join('; ')}` : '',
            mismatched.length ? `${mismatched.length} of ${fresh.fileCount} files differ: ${mismatched.slice(0, 4).join('; ')}` : '',
          ].filter(Boolean).join('. '),
      };
    },
  },

  /* ---------------------------------------------------------------- owner gated */
  {
    id: 'O1', kind: 'owner-gated',
    title: 'The account is joined to this hackathon',
    manual: 'Open the event page, sign in, and confirm the account is registered. Five minutes. '
      + 'Do it now, not on deadline day.',
  },
  {
    id: 'O2', kind: 'owner-gated',
    title: 'The owner can upload to YouTube',
    manual: 'Upload a ten second throwaway clip as the identity that will own the entry, and delete '
      + 'it. This is the step that has been discovered too late before.',
  },
  {
    id: 'O3', kind: 'owner-gated',
    title: `A public YouTube video under ${VIDEO_MAX_SECONDS} seconds, Public and not unlisted`,
    manual: 'Render the cut and upload it as PUBLIC. Unlisted does not satisfy the rules on a '
      + 'plain reading.',
  },
  {
    id: 'O4', kind: 'owner-gated',
    title: 'The submission form reads Submitted',
    manual: 'Strictly last, and after everything else is final. The freeze means nothing may be '
      + 'edited afterwards, so this is the one step with no way back.',
  },
];

/* ------------------------------------------------------------------ the browser row's judgement */

/**
 * Everything row M8 requires, in one pure function.
 *
 * WHAT THIS ROW USED TO ACCEPT, AND WHY THAT WAS NOT ENOUGH. It compared three totals, required at
 * least `BEHAVIOURS.length - 2` rows to have reached a verdict, and read the transcript from a
 * SECOND observation taken after the page had already rendered. Each of those is a way to be green
 * while the thing being checked is untrue:
 *
 *   totals agree under an ID SWAP. Fourteen broken and five kept stays fourteen and five when the
 *   page renders A2 broken and B2 kept while the observations say the opposite. The comparison is
 *   now by behaviour id, one row at a time.
 *
 *   a floor of `length - 2` is slack with no owner. Any two rows could go quiet for any reason and
 *   the row stayed green. Abstention is now allowed only for the ids named in MAY_ABSTAIN, each
 *   with its reason, and any other abstention is a failure.
 *
 *   a second observation is a different run. The gate judged a transcript the visitor never saw. It
 *   now wraps the subject frame's entry point BEFORE the button is pressed and captures the exact
 *   object the page consumed, and it requires that exactly one observation happened.
 *
 * Nothing here is a count where a name would do, and nothing is a floor where an exact value is
 * available.
 */
export function decideM8(result) {
  if (!result.hasCtx) {
    throw new Error('the browser opened the page but exposed no WebMCP host object, so nothing was proved');
  }
  if (result.bootFailed) {
    throw new Error(`the page never rendered a single card in 45 s, so the audit was never reachable.`
      + ` status was "${result.statusAfterBoot}". This is a page that a judge would open and find blank.`);
  }
  if (!result.transcript) {
    throw new Error(`the raw transcript the page judged could not be captured, so this row `
      + `could only have checked the page's own conclusions: ${result.transcriptError || 'no reason given'}`);
  }
  if (BEHAVIOURS.length !== EXPECTED_CATALOGUE_ROWS) {
    throw new Error(`the catalogue holds ${BEHAVIOURS.length} behaviours and the pinned number is `
      + `${EXPECTED_CATALOGUE_ROWS}. One of them has moved, and until they agree this row cannot say `
      + 'how many cards it expects.');
  }

  const independent = judge(result.transcript);
  const byId = new Map(independent.findings.map((f) => [f.id, f.verdict]));
  const problems = [];

  /* ---- the catalogue is all there, in the render and in the judgement */
  if (independent.counts.catalogue !== EXPECTED_CATALOGUE_ROWS) {
    problems.push(`the judgement covers ${independent.counts.catalogue} rows and the catalogue has `
      + `${EXPECTED_CATALOGUE_ROWS}`);
  }
  if (result.cards !== EXPECTED_CATALOGUE_ROWS) {
    problems.push(`the page rendered ${result.cards} cards and the catalogue has ${EXPECTED_CATALOGUE_ROWS}`);
  }
  const rendered = Array.isArray(result.cardVerdicts) ? result.cardVerdicts : [];
  if (rendered.length !== EXPECTED_CATALOGUE_ROWS) {
    problems.push(`${rendered.length} cards carried a readable behaviour id, and the catalogue has `
      + `${EXPECTED_CATALOGUE_ROWS}`);
  }

  /* ---- completeness, with a named allowance and never a numeric floor */
  const completeness = independent.completeness || {};
  if (completeness.environmentIdentified !== true) {
    problems.push('the transcript does not identify the environment it was taken in, so it is not a '
      + 'result about any particular browser or page');
  }
  if (completeness.noFatalErrors !== true) {
    problems.push(`the transcript carries ${(independent.errors || []).length} fatal errors: `
      + `${(independent.errors || []).slice(0, 3).join('; ')}`);
  }
  if (completeness.anythingMeasured !== true) {
    problems.push('nothing at all was measured, so there is no result to agree or disagree with');
  }
  const abstained = independent.findings
    .filter((f) => f.verdict === 'not-applicable')
    .map((f) => f.id);
  const unallowed = abstained.filter((id) => !sortedAbstainIds().includes(id));
  if (unallowed.length) {
    problems.push(`${unallowed.length} rows reached no verdict and are not on the declared abstention `
      + `list: ${unallowed.join(', ')}`);
  }
  if (completeness.everySelectedObserved !== true && !abstained.length) {
    problems.push('the judgement reports unobserved rows but names none of them');
  }

  /* ---- every selected row is accounted for */
  if (independent.counts.outOfScope !== 0) {
    problems.push(`${independent.counts.outOfScope} rows were left out of scope, so this run does not `
      + 'cover the catalogue it publishes');
  }
  const selected = (result.transcript.scope && result.transcript.scope.selectedBehaviours) || [];
  const unaccounted = selected.filter((id) => !byId.has(id) || byId.get(id) === 'out-of-scope');
  if (unaccounted.length) {
    problems.push(`${unaccounted.length} behaviours the probe says it selected have no counted `
      + `verdict: ${unaccounted.join(', ')}`);
  }

  /* ---- the page's rendering agrees BY BEHAVIOUR ID, not by total */
  const renderedById = new Map(rendered.map((card) => [card.id, card.verdict]));
  const swaps = [];
  for (const behaviour of BEHAVIOURS) {
    const shown = renderedById.has(behaviour.id) ? renderedById.get(behaviour.id) : 'no card';
    const judged = byId.has(behaviour.id) ? byId.get(behaviour.id) : 'no finding';
    if (shown !== judged) swaps.push(`${behaviour.id}: the page shows ${shown}, the observations say ${judged}`);
  }
  if (swaps.length) {
    problems.push(`${swaps.length} rows are rendered with a different verdict from the one the `
      + `observations carry: ${swaps.slice(0, 4).join('; ')}`);
  }

  /* ---- one run, and the answer on the surface belongs to it */
  if (result.observeCalls !== 1) {
    problems.push(`the subject frame was observed ${result.observeCalls} times, so the result this row `
      + 'judged is not certainly the one the page rendered');
  }
  if (!result.runIdOnPage) {
    problems.push('the page does not say which run produced what it is showing');
  }

  /* ---- nt_get_findings was really executed, while published, and answered for this run */
  const answer = result.findings || {};
  if (answer.called !== true) {
    problems.push('nt_get_findings was never executed, so its being on the surface is all that was proved');
  }
  if (answer.error) {
    problems.push(`executing nt_get_findings failed: ${answer.error}`);
  }
  const parsed = answer.text === null || answer.text === undefined
    ? null
    : readFindingsPayload(answer.text);
  if (answer.called === true && !answer.error && !parsed) {
    problems.push('nt_get_findings answered with something that is not a JSON object, so an agent '
      + `reading it gets no structured result: ${String(answer.text).slice(0, 120)}`);
  }
  if (parsed) {
    const answeredRunId = (parsed.run && parsed.run.id) || null;
    if (!answeredRunId || answeredRunId !== result.runIdOnPage) {
      problems.push(`nt_get_findings answered for run ${answeredRunId || 'nothing'} while the page is `
        + `showing run ${result.runIdOnPage}, so the tool result is not the rendered one`);
    }
    const served = Array.isArray(parsed.findings) ? parsed.findings : [];
    if (served.length !== EXPECTED_CATALOGUE_ROWS) {
      problems.push(`nt_get_findings returned ${served.length} findings and the catalogue has `
        + `${EXPECTED_CATALOGUE_ROWS}`);
    }
    const toolSwaps = served
      .filter((f) => byId.get(f && f.id) !== (f && f.verdict))
      .map((f) => `${(f && f.id) || 'an unnamed row'}: the tool says ${f && f.verdict}`
        + `, the observations say ${byId.get(f && f.id)}`);
    if (toolSwaps.length) {
      problems.push(`${toolSwaps.length} findings the tool serves disagree with the observations: `
        + `${toolSwaps.slice(0, 4).join('; ')}`);
    }
  }

  /* ---- the exact tool surface, before, during and after */
  const atRest = surfaceAtRest();
  const duringWanted = surfaceDuringRun();
  if (!sameMultiset(result.toolsBefore, atRest)) {
    problems.push(`before the run the surface was not the declared one (${multisetDrift(result.toolsBefore, atRest)})`);
  }
  if (!sameMultiset(result.toolsDuring, duringWanted)) {
    problems.push(`during the run the surface was not the declared one plus ${FINDINGS_TOOL} `
      + `(${multisetDrift(result.toolsDuring, duringWanted)})`);
  }
  if (!sameMultiset(result.toolsAfter, atRest)) {
    problems.push(`after the findings were cleared the surface was not back to the declared one `
      + `(${multisetDrift(result.toolsAfter, atRest)})`);
  }
  if (result.namesItsOwnTools !== true) {
    problems.push('the page does not name its own tools anywhere a reader can see them');
  }

  /* ---- the page loaded without complaining, and does not scroll sideways at either width */
  /*
   * THE CONSOLE CHECK IS SCOPED TO THE LOAD, AND HERE IS WHY, MEASURED.
   *
   * A judge opening this page must see a clean console. That is what `loadConsoleErrors` gates, and
   * it is measured between the reload finishing and the button being pressed.
   *
   * Pressing the button is different. The audit's whole method is to provoke refusals from tools it
   * registers itself, and Chrome logs every one of them as "WebMCP tool execution failed". The live
   * run recorded two, both the fixture's own REFUSED_STALE, which is behaviour C1 doing exactly what
   * the catalogue says it does. Gating on those would mean a correct page can never pass, and a gate
   * that a correct page cannot pass gets deleted rather than fixed.
   *
   * So they are counted and printed rather than ignored, and the LIMITATION IS STATED: this row does
   * not distinguish an error the audit provoked from one the page emitted while running. What it
   * refuses outright is any console error before the visitor has touched anything.
   */
  const loadErrors = Array.isArray(result.loadConsoleErrors) ? result.loadConsoleErrors : [];
  const runErrors = Array.isArray(result.runConsoleErrors) ? result.runConsoleErrors : [];
  if (loadErrors.length) {
    problems.push(`${loadErrors.length} console errors before anything was clicked: `
      + `${loadErrors.slice(0, 3).join(' | ')}`);
  }
  const narrow = result.narrow || {};
  const wide = result.wide || {};
  if (narrow.sideScroll !== false) {
    problems.push(`at 375 px the document is ${narrow.scrollWidth} px inside a ${narrow.viewport} px viewport`);
  }
  if (wide.sideScroll !== false) {
    problems.push(`at 1280 px the document is ${wide.scrollWidth} px inside a ${wide.viewport} px viewport`);
  }

  const allowanceUsed = abstained.length
    ? abstained.map((id) => `${id} (${MAY_ABSTAIN[id] ? 'declared' : 'NOT DECLARED'})`).join(', ')
    : 'none';
  return {
    ok: problems.length === 0,
    evidence: `${result.cards} cards, all judged here from the transcript the page consumed: `
      + `${independent.counts.fail} broken / ${independent.counts.pass} kept / `
      + `${independent.counts.notApplicable} unsettled of ${independent.counts.catalogue}`
      + `, and every verdict agrees by behaviour id${swaps.length ? ' EXCEPT the rows named below' : ''}`
      + `. Abstentions: ${allowanceUsed}, against the declared list ${sortedAbstainIds().join(', ')}`
      + `. Run took ${result.elapsedMs} ms after ${result.observeCalls} observation`
      + `, run id on the page ${result.runIdOnPage || 'MISSING'}`
      + `, nt_get_findings executed=${answer.called === true} and answered for run `
      + `${(parsed && parsed.run && parsed.run.id) || 'nothing'}`
      + `, tool surface ${(result.toolsBefore || []).length}/${(result.toolsDuring || []).length}/`
      + `${(result.toolsAfter || []).length} before/during/after`
      + `, ${loadErrors.length} console errors on load and ${runErrors.length} while the audit ran`
      + `${runErrors.length ? ` (not gated, and here they are: ${runErrors.slice(0, 2).join(' | ')})` : ''}`
      + `, document ${narrow.scrollWidth} px at 375 and ${wide.scrollWidth} px at 1280`
      + (problems.length ? `. FAILING: ${problems.join('. ')}` : ''),
  };
}

/* ------------------------------------------------------------------ the browser row */

/**
 * Console errors only, from everything the session has collected so far.
 *
 * Warnings are deliberately not here. The prefixes come from the protocol client's own `problems()`,
 * which labels each line by where it came from. Dropping the errors as well would be the widening
 * this repository refuses; keeping the warnings would fail the row on things that are not errors.
 */
const errorsOnly = (session) => session.problems()
  .filter((line) => /^(console\.error|page error|log error)/.test(line));

/** Open the live URL in a flagged Chrome, press the button, and report what happened. */
async function driveLivePage() {
  const { openSession } = await import('../src/probe/cdp.mjs');
  const port = 9412;
  const launched = await launchWithWebMCP({ url: LIVE_URL, port });

  let socket = null;
  try {
    const target = await waitForPageTarget(port, LIVE_URL);
    if (!target.ok) {
      throw new Error(`the browser never opened ${LIVE_URL}. Page targets seen: ${target.seen.join(', ') || 'none'}`);
    }
    const connection = await openSession(port, targetFor(LIVE_URL));
    socket = connection.socket;
    const { session } = connection;
    await session.send('Runtime.enable');
    // WITHOUT Log.enable THE CONSOLE CHECK IS HALF BLIND. Runtime carries console.error and thrown
    // exceptions; the subresource, network and security failures a judge would also see in the
    // console arrive as Log.entryAdded and were simply never delivered to this session.
    await session.send('Log.enable').catch(() => {});
    await session.send('Page.enable').catch(() => {});

    // RELOAD SO THE CONSOLE CHECK COVERS THE LOAD. We attach after Chrome has already opened the
    // page, so anything logged while it loaded happened before this session existed. Reloading with
    // the domains enabled, and dropping what was collected first, means the errors this row counts
    // are the ones a visitor's own console would show from the first byte.
    //
    // THE MARKER IS NOT DECORATION. `waitForDocument` asks the page for its URL and readyState, and
    // the OLD document answers "complete" at the right URL for the whole round trip to the origin.
    // Waiting on it alone can therefore return ok for the document that is about to be destroyed,
    // and everything after this would then run in a dying context. So a value is written into the
    // current context first and this waits for it to disappear, which only happens when the context
    // has actually been replaced.
    await session.evaluate('window.__ninthtoolPreReload = 1');
    session.events.length = 0;
    await session.send('Page.reload', { ignoreCache: false }).catch(() => {});
    const replacedBy = Date.now() + 30000;
    while (Date.now() < replacedBy) {
      try {
        if (await session.evaluate('window.__ninthtoolPreReload || null', 5000) === null) break;
      } catch { /* the context is being replaced, which is the thing we are waiting for */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const loaded = await waitForDocument(session, LIVE_URL);
    if (!loaded.ok) {
      throw new Error(`${LIVE_URL} never finished loading. The attached document is "${loaded.url}"`
        + ` in state "${loaded.readyState}" after ${loaded.waitedMs} ms.`);
    }

    const booted = await session.evaluate(`(async () => {
      const out = { hasCtx: false, bootFailed: false, observeCalls: 0, transcript: null,
        transcriptError: null, toolsBefore: [], toolsDuring: [], toolsAfter: [],
        cardVerdicts: [], runIdOnPage: null,
        findings: { called: false, error: null, text: null } };
      const ctx = document.modelContext;
      out.hasCtx = !!ctx;
      if (!ctx) return out;

      // WAIT FOR THE APP TO BOOT BEFORE TOUCHING IT. The first version of this row clicked at a
      // fixed four seconds. On a slower runner the module graph had not finished loading, the
      // click landed before app.js attached its listener, and it was simply lost: nought cards,
      // nought findings, sixty seconds of waiting for a status that could never change. The gate
      // reported FAIL, which is correct, but for the wrong reason. So the readiness of the page is
      // now something this waits for and reports on, rather than something it assumes.
      const bootDeadline = Date.now() + 45000;
      while (Date.now() < bootDeadline) {
        const cards = document.querySelectorAll('.groups .card').length;
        const button = document.querySelector('[data-el="run"]');
        const status = document.querySelector('[data-el="status"]');
        if (cards > 0 && button && status && /Ready|cannot run/.test(status.textContent)) break;
        await new Promise(r => setTimeout(r, 250));
      }
      out.bootedInMs = 45000 - (bootDeadline - Date.now());
      // SCOPED TO THE FINDINGS, not every .card on the page. The page also renders a card per
      // WebMCP tool it publishes, so an unscoped count went to 24 and this row would have failed
      // for a reason that was not a defect.
      out.cardsAfterBoot = document.querySelectorAll('.groups .card').length;
      out.statusAfterBoot = (document.querySelector('[data-el="status"]') || {}).textContent || '';
      if (out.cardsAfterBoot === 0) {
        out.bootFailed = true;
        out.cards = 0;
        out.counts = { fail: 0, pass: 0, notApplicable: 0, total: 0 };
        out.elapsedMs = 0;
        return out;
      }

      // THE TRANSCRIPT THE PAGE ACTUALLY CONSUMED, CAPTURED AS IT CROSSES THE FRAME BOUNDARY.
      // This row used to call the subject frame's observer itself, AFTER the page had rendered.
      // That is a second run: a fresh set of tool calls against a surface the first run had already
      // touched. The gate then judged a transcript the visitor never saw and compared it to what
      // the visitor did see, which is only a comparison if the two are the same run. The entry
      // point is now wrapped before the button is pressed, so the object judged in Node is the
      // identical object the page handed to its own judge, and the call count proves there was one.
      const frame = document.querySelector('[data-el="subject"]');
      const observeDeadline = Date.now() + 30000;
      while (Date.now() < observeDeadline
        && typeof ((frame && frame.contentWindow) || {}).__ninthtool_observe !== 'function') {
        await new Promise(r => setTimeout(r, 200));
      }
      const inner = frame && frame.contentWindow;
      if (!inner || typeof inner.__ninthtool_observe !== 'function') {
        out.transcriptError = 'the subject frame never exposed __ninthtool_observe, so there was '
          + 'nothing for this gate to capture';
        return out;
      }
      const real = inner.__ninthtool_observe;
      const captured = { calls: 0, transcript: null };
      window.__ninthtoolCaptured = captured;
      inner.__ninthtool_observe = async function capturingObserve() {
        captured.calls += 1;
        const seen = await real.call(inner);
        captured.transcript = seen;
        return seen;
      };

      out.toolsBefore = (await ctx.getTools()).map(t => String(t.name));
      return out;
    })()`, 90000);

    // THE CONSOLE AS A JUDGE FINDS IT, READ BEFORE ANYTHING IS CLICKED. One total at the end cannot
    // tell a defect in the page from the instrument working, because the audit provokes refusals on
    // purpose and the browser logs every one of them.
    const loadConsoleErrors = errorsOnly(session);

    const drivable = booted.hasCtx && !booted.bootFailed && !booted.transcriptError;
    const driven = !drivable ? {} : await session.evaluate(`(async () => {
      const out = {};
      const ctx = document.modelContext;
      const captured = window.__ninthtoolCaptured;
      const names = async () => (await ctx.getTools()).map(t => String(t.name));
      const started = Date.now();
      document.querySelector('[data-el="run"]').click();
      while (Date.now() - started < 60000) {
        const s = document.querySelector('[data-el="status"]').textContent;
        // EVERY TERMINAL STATE, not just the happy one. The run state machine added PARTIAL and
        // "Nothing could be measured", and this loop did not know them, so a run that finished in
        // about five seconds sat here until the sixty second cap and reported 60210 ms. The
        // counts were right and the timing was fiction, which is the kind of number this
        // repository exists to refuse.
        if (/Done\\.|did not finish|PARTIAL|Nothing could be measured/.test(s)) break;
        await new Promise(r => setTimeout(r, 300));
      }
      out.elapsedMs = Date.now() - started;
      out.status = document.querySelector('[data-el="status"]').textContent;
      out.observeCalls = captured.calls;
      out.transcript = captured.transcript;
      if (!captured.transcript) {
        out.transcriptError = 'the page produced its result without calling the observer this gate '
          + 'had wrapped, so what it judged is unknown';
      }

      out.toolsDuring = await names();
      out.cards = document.querySelectorAll('.groups .card').length;
      out.counts = {
        fail: document.querySelectorAll('.groups .card.v-fail').length,
        pass: document.querySelectorAll('.groups .card.v-pass').length,
        notApplicable: document.querySelectorAll('.groups .card.v-na').length,
        total: document.querySelectorAll('.groups .card').length
      };
      // THE VERDICT THE VISITOR SEES, ROW BY ROW. Counting classes gives three totals, and three
      // totals survive any swap of two rows. The chip carries the behaviour id, so the rendering
      // can be compared to the judgement one behaviour at a time.
      out.cardVerdicts = [...document.querySelectorAll('.groups .card')].map((card) => {
        const chip = card.querySelector('.chip');
        const shown = card.classList.contains('v-fail') ? 'fail'
          : card.classList.contains('v-pass') ? 'pass'
          : card.classList.contains('v-na') ? 'not-applicable' : 'nothing rendered';
        return { id: chip ? chip.textContent.trim() : '', verdict: shown };
      });
      const env = document.querySelector('[data-el="env"]');
      const stamped = env ? /run (run-\\d+-\\d+)/.exec(env.textContent) : null;
      out.runIdOnPage = stamped ? stamped[1] : null;

      // EXECUTE IT, DO NOT JUST WATCH IT APPEAR. A tool on the surface that has never been called
      // is a name, not a capability, and the difference is this suite's whole subject.
      out.findings = { called: false, error: null, text: null, answerTypeof: null };
      try {
        const published = (await ctx.getTools()).filter(t => String(t.name) === 'nt_get_findings');
        if (published.length !== 1) {
          out.findings.error = published.length + ' tools are published under the name nt_get_findings';
        } else {
          out.findings.called = true;
          const answer = await ctx.executeTool(published[0], JSON.stringify({}));
          out.findings.answerTypeof = typeof answer;
          // BOTH SHAPES, BECAUSE THE FIRST GUESS WAS WRONG. This read content[0].text, which is the
          // shape the HANDLER returns. Chrome flattens it: the caller of executeTool is handed the
          // text itself, which is what behaviour B5 records and what the live run measured when this
          // reported "the tool answered with no text content" on a tool that answered perfectly.
          if (typeof answer === 'string') {
            out.findings.text = answer;
          } else {
            const first = ((answer || {}).content || [])[0] || {};
            out.findings.text = typeof first.text === 'string' ? first.text : null;
          }
          if (out.findings.text === null) {
            out.findings.error = 'the tool answered a ' + typeof answer + ' with no readable text in it';
          }
        }
      } catch (error) {
        out.findings.error = String((error && error.message) || error);
      }

      out.namesItsOwnTools = ['nt_list_behaviours', 'nt_explain_behaviour', 'nt_run_audit', 'nt_get_findings']
        .every(n => document.body.textContent.includes(n));
      return out;
    })()`, 180000);

    // MEASURED WHILE THE RESULTS ARE ON SCREEN, AT BOTH WIDTHS. A judge opens this on a phone, and
    // a page that scrolls sideways there looks broken before it has said anything: 411 px of
    // document inside a 375 px viewport, from grid children with no min-width. It was only ever
    // measured at 375, and only after the page had been cleared, so a wide layout that overflowed
    // and a rendered layout that overflowed were both invisible to this row.
    const measure = `(() => {
      const d = document.documentElement;
      return { viewport: d.clientWidth, scrollWidth: d.scrollWidth,
        sideScroll: d.scrollWidth > d.clientWidth + 1 };
    })()`;
    const atWidth = async (width, height, mobile) => {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile,
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 700));
      return session.evaluate(measure, 20000);
    };
    const wide = drivable ? await atWidth(1280, 900, false) : {};
    const narrow = drivable ? await atWidth(375, 812, true) : {};
    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

    // WITHDRAWAL LAST, because clearing the findings nulls the result nt_get_findings serves. Doing
    // this before the tool was executed left a null dereference where a clean verdict belongs.
    const closed = !drivable ? {} : await session.evaluate(`(async () => {
      const ctx = document.modelContext;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise(r => setTimeout(r, 800));
      return { toolsAfter: (await ctx.getTools()).map(t => String(t.name)) };
    })()`, 30000);

    // The events arrive in order, so what came after the load snapshot is what the run produced.
    const runConsoleErrors = errorsOnly(session).slice(loadConsoleErrors.length);

    return { ...booted, ...driven, ...closed, wide, narrow, loadConsoleErrors, runConsoleErrors };
  } finally {
    if (socket) socket.destroy();
    launched.close();
  }
}

/* ------------------------------------------------------------------ the self test */

/**
 * A healthy browser row input, built from a transcript, with the page side derived from the
 * judgement so that the only thing wrong with it is whatever a case deliberately breaks.
 *
 * THE BASELINE IS ASSERTED GREEN BEFORE ANY CASE RUNS. A mutation proves something only when the
 * unmutated input passes; otherwise every case is red for reasons nobody chose and the whole table
 * is decoration. That assertion is the first thing `runSelftest` does.
 */
export function healthyDrive(transcript) {
  const independent = judge(transcript);
  const verdicts = new Map(independent.findings.map((f) => [f.id, f.verdict]));
  const runId = 'run-1-4096';
  const served = independent.findings.map((f) => ({ id: f.id, verdict: f.verdict }));
  return {
    hasCtx: true,
    bootFailed: false,
    statusAfterBoot: 'Ready',
    cards: BEHAVIOURS.length,
    cardVerdicts: BEHAVIOURS.map((b) => ({ id: b.id, verdict: verdicts.get(b.id) })),
    counts: {
      fail: independent.counts.fail,
      pass: independent.counts.pass,
      notApplicable: independent.counts.notApplicable,
      total: independent.counts.total,
    },
    transcript,
    transcriptError: null,
    observeCalls: 1,
    runIdOnPage: runId,
    findings: {
      called: true,
      error: null,
      text: JSON.stringify({ run: { id: runId }, findings: served }),
    },
    toolsBefore: surfaceAtRest(),
    toolsDuring: surfaceDuringRun(),
    toolsAfter: surfaceAtRest(),
    namesItsOwnTools: true,
    loadConsoleErrors: [],
    runConsoleErrors: [],
    elapsedMs: 4900,
    narrow: { viewport: 375, scrollWidth: 375, sideScroll: false },
    wide: { viewport: 1280, scrollWidth: 1280, sideScroll: false },
  };
}

/** The same object with one field replaced, so a case is one variable and not a rewrite. */
const broken = (base, changes) => ({ ...base, ...changes });

/**
 * Every case: a label, the row id it is about, and the input to hand that row's real `decide`.
 *
 * THERE ARE NO EXPRESSIONS IN THIS TABLE ON PURPOSE. The version this replaces held one per case,
 * for example `{ ok: 404 === 200 }` for "M5 with a 404 from the live URL", and those expressions
 * were never connected to the rows they named. Disabling row M5 entirely left this file green. A
 * case here can only say which row and which input, and the harness below does the calling, so the
 * only way to make a case pass is to make the row's own judgement pass.
 */
export async function selftestCases() {
  // Imported here rather than at the top so an ordinary run never loads it. This is the transcript
  // Chrome 152 actually produced, transcribed from the recorded runs, which is the right baseline
  // for the browser row: a synthetic one would prove the row against a page that has never existed.
  const { measuredChrome152, conforming } = await import('../tests/support/transcripts.mjs');
  const live = measuredChrome152();
  const healthy = healthyDrive(live);
  const swapped = (() => {
    const cards = healthy.cardVerdicts.map((card) => ({ ...card }));
    const aFail = cards.find((c) => c.verdict === 'fail');
    const aPass = cards.find((c) => c.verdict === 'pass');
    aFail.verdict = 'pass';
    aPass.verdict = 'fail';
    return broken(healthy, { cardVerdicts: cards });
  })();
  const withoutObservation = (id) => {
    const copy = JSON.parse(JSON.stringify(live));
    delete copy.observations[id];
    return healthyDrive(copy);
  };
  const oneFileTree = () => ({ fileCount: 1, files: { 'src/ui/app.js': hashOf('the tree') } });

  return [
    ['M1 with a licence that is not one', 'M1', { text: 'not a licence' }],
    ['M2 with a page missing the sentence', 'M2', { readme: read('README.md'), page: 'some other page' }],
    ['M3 with a banned name present', 'M3', (() => {
      const name = OTHER_COMPETITIONS.find((n) => n !== SIBLING_ENTRY);
      const texts = {};
      for (const file of [...JUDGE_FACING_FILES, ...SIBLING_MUST_BE_NAMED_IN]) texts[file] = SIBLING_ENTRY;
      texts[JUDGE_FACING_FILES[0]] = `built for ${name}, and it names ${SIBLING_ENTRY} too`;
      return { texts };
    })()],
    ['M3 with the sibling entry not disclosed', 'M3', (() => {
      const texts = {};
      for (const file of JUDGE_FACING_FILES) texts[file] = SIBLING_ENTRY;
      for (const file of SIBLING_MUST_BE_NAMED_IN) texts[file] = 'a readme with no disclosure';
      return { texts };
    })()],
    ['M3 with a judge facing file that could not be read', 'M3', { texts: {} }],
    ['M4 with a tool absent from the bundle', 'M4', { status: 200, body: 'nothing here', error: null }],
    ['M4 with the deployed bundle answering 404', 'M4', { status: 404, body: '', error: null }],
    ['M5 with a 404 from the live URL', 'M5', { status: 404, body: '', error: null }],
    ['M5 with no response at all', 'M5', { status: 0, body: '', error: 'getaddrinfo ENOTFOUND' }],
    ['M6 with one asset missing', 'M6', {
      responses: [{ suffix: '', status: 200, error: null }, { suffix: 'src/ui/app.js', status: 404, error: null }],
      fileCount: 1,
    }],
    ['M7 with a body that lost the sentence', 'M7', { status: 200, body: '<html>nothing</html>', error: null }],

    ['M8 with no WebMCP host object', 'M8', broken(healthy, { hasCtx: false })],
    ['M8 with a page that rendered no cards', 'M8', broken(healthy, { bootFailed: true })],
    ['M8 with no transcript captured from the run the page rendered', 'M8',
      broken(healthy, { transcript: null, transcriptError: 'the observer was never called' })],
    ['M8 with completeness false because a row was never observed', 'M8', withoutObservation('A1')],
    ['M8 with fatal errors present in the transcript', 'M8',
      healthyDrive({ ...live, errors: ['the host object vanished mid run'] })],
    ['M8 with the environment not identified', 'M8',
      healthyDrive({ ...live, meta: { ...live.meta, api: null } })],
    ['M8 with the page and the transcript disagreeing on one behaviour id while the totals match',
      'M8', swapped],
    ['M8 with a card missing from the render', 'M8', broken(healthy, { cards: BEHAVIOURS.length - 1 })],
    ['M8 with a standing tool missing from the surface', 'M8',
      broken(healthy, { toolsBefore: surfaceAtRest().filter((n) => n !== STANDING_TOOLS[0]) })],
    ['M8 with the subject frame tools gone from the surface', 'M8',
      broken(healthy, { toolsBefore: [...STANDING_TOOLS] })],
    ['M8 with a stray tool left on the surface during the run', 'M8',
      broken(healthy, { toolsDuring: [...surfaceDuringRun(), 'nt_probe_leftover'] })],
    ['M8 with nt_get_findings never withdrawn', 'M8',
      broken(healthy, { toolsAfter: surfaceDuringRun() })],
    ['M8 with nt_get_findings never executed', 'M8',
      broken(healthy, { findings: { called: false, error: null, text: null } })],
    ['M8 with malformed nt_get_findings output', 'M8',
      broken(healthy, { findings: { called: true, error: null, text: '{ not json at all' } })],
    ['M8 with an nt_get_findings envelope whose payload is malformed', 'M8', broken(healthy, {
      findings: {
        called: true,
        error: null,
        text: JSON.stringify({ content: [{ type: 'text', text: '{ not json at all' }] }),
      },
    })],
    ['M8 with a stale run id in the tool answer', 'M8', broken(healthy, {
      findings: {
        ...healthy.findings,
        text: JSON.stringify({
          run: { id: 'run-2-9999' },
          findings: JSON.parse(healthy.findings.text).findings,
        }),
      },
    })],
    ['M8 with the subject observed a second time after the page rendered', 'M8',
      broken(healthy, { observeCalls: 2 })],
    ['M8 with no run id on the page', 'M8', broken(healthy, { runIdOnPage: null })],
    ['M8 with a console error before anything was clicked', 'M8',
      broken(healthy, { loadConsoleErrors: ['console.error: Uncaught TypeError'] })],
    ['M8 with sideways scroll at 375 px', 'M8',
      broken(healthy, { narrow: { viewport: 375, scrollWidth: 411, sideScroll: true } })],
    ['M8 with sideways scroll at 1280 px', 'M8',
      broken(healthy, { wide: { viewport: 1280, scrollWidth: 1460, sideScroll: true } })],
    ['M8 with a run that abstained on a row nobody declared', 'M8', healthyDrive(
      (() => { const copy = conforming(); delete copy.observations.D1; return copy; })(),
    )],
    ['M8 with rows the run left out of scope and one it selected but never counted', 'M8',
      healthyDrive({ ...live, scope: { requestedBehaviours: ['A1'], selectedBehaviours: ['A1', 'A2'] } })],

    ['R1 with a behaviour that has no mutation', 'R1', { text: '  A1: {\n' }],
    ['R2 with failing tests', 'R2', { output: '# pass 40\n# fail 3\n', threw: true }],
    ['R3 with a style gate that never proved itself', 'R3',
      { output: 'style gate: scanned 60 files\nstyle gate: PASS\n', threw: false }],
    ['R4 with no falsification criterion', 'R4',
      { present: true, text: 'a document that does the same thing and nothing else' }],
    ['R5 with a deployment behind the head', 'R5', (() => {
      const fresh = oneFileTree();
      return {
        head: '0000000',
        fresh,
        committed: fresh,
        servedManifest: { status: 200, body: JSON.stringify(fresh), error: null },
        served: { 'src/ui/app.js': { status: 200, body: 'something else entirely', error: null } },
      };
    })()],
    ['R5 with no manifest served at all', 'R5', (() => {
      const fresh = oneFileTree();
      return {
        head: '0000000',
        fresh,
        committed: fresh,
        servedManifest: { status: 404, body: '', error: null },
        served: { 'src/ui/app.js': { status: 200, body: 'the tree', error: null } },
      };
    })()],
    ['R5 with a manifest that does not describe the tree', 'R5', (() => {
      const fresh = oneFileTree();
      const stale = { fileCount: 1, files: { 'src/ui/app.js': hashOf('what it used to be') } };
      return {
        head: '0000000',
        fresh,
        committed: stale,
        servedManifest: { status: 200, body: JSON.stringify(fresh), error: null },
        served: { 'src/ui/app.js': { status: 200, body: 'the tree', error: null } },
      };
    })()],
  ];
}

/**
 * One input per automated row that MUST come out green.
 *
 * WITHOUT THESE THE TABLE ABOVE PROVES LESS THAN IT LOOKS. A broken case is only evidence when the
 * same row, handed a healthy input of the same shape, passes. Otherwise a typo in the shape of a
 * hand written case makes it red for a reason nobody chose, and the case would go on reporting
 * success while testing nothing. That is the same defect class as the hollow self test itself, one
 * level down.
 */
export async function greenBaselines() {
  const { measuredChrome152 } = await import('../tests/support/transcripts.mjs');
  const cleanTexts = {};
  for (const file of [...JUDGE_FACING_FILES, ...SIBLING_MUST_BE_NAMED_IN]) cleanTexts[file] = read(file);
  const oneFileTree = { fileCount: 1, files: { 'src/ui/app.js': hashOf('the tree') } };

  return [
    ['M1', { text: read('LICENSE') }],
    ['M2', { readme: read('README.md'), page: read('index.html') }],
    ['M3', { texts: cleanTexts }],
    ['M4', { status: 200, body: CLAIMED_TOOLS.join(' '), error: null }],
    ['M5', { status: 200, body: 'a page', error: null }],
    ['M6', { responses: [{ suffix: '', status: 200, error: null }], fileCount: 1 }],
    ['M7', { status: 200, body: `<html>${FLAGSHIP}</html>`, error: null }],
    ['M8', healthyDrive(measuredChrome152())],
    ['R1', { text: read('tests/unit/verdict_mutations.test.js') }],
    ['R2', { output: '# pass 260\n# fail 0\n', threw: false }],
    ['R3', { output: 'style gate: scanned 45 files\nstyle selftest: PASS\nstyle gate: PASS\n', threw: false }],
    ['R4', { present: true, text: 'a rival that does the same thing, and what would falsify this' }],
    ['R5', {
      head: '0000000',
      fresh: oneFileTree,
      committed: oneFileTree,
      servedManifest: { status: 200, body: JSON.stringify(oneFileTree), error: null },
      served: { 'src/ui/app.js': { status: 200, body: 'the tree', error: null } },
    }],
  ];
}

/**
 * Break every automated row on purpose, by calling that row's own judgement, and require red.
 *
 * A `decide` that throws counts as red: several rows fail by refusing to judge an input they cannot
 * read, and refusing is a failure, not a pass.
 */
export async function runSelftest() {
  const automated = ROWS.filter((r) => r.kind !== 'owner-gated');
  const problems = [];

  // EVERY AUTOMATED ROW HAS THE TWO HALVES. A row with the judgement back inside its gathering
  // cannot be self tested, and this is the check that notices rather than the reader.
  for (const row of automated) {
    if (typeof row.decide !== 'function') problems.push(`${row.id} has no decide, so nothing about it can be proved`);
    if (typeof row.gather !== 'function') problems.push(`${row.id} has no gather, so its judgement is not separated from its input`);
  }

  // GREEN FIRST. If a row's healthy input is not accepted, that row's broken inputs prove nothing,
  // so this runs before the table and says which row it was.
  const green = await greenBaselines();
  const greenIds = new Set(green.map(([rowId]) => rowId));
  for (const row of automated) {
    if (!greenIds.has(row.id)) problems.push(`row ${row.id} has no healthy input, so its failures prove nothing`);
  }
  for (const [rowId, input] of green) {
    const row = ROWS.find((r) => r.id === rowId);
    if (!row || typeof row.decide !== 'function') { problems.push(`the healthy input names row ${rowId}, which has no judgement`); continue; }
    let verdict;
    try { verdict = row.decide(input); } catch (error) { verdict = { ok: false, evidence: String((error && error.message) || error) }; }
    if (verdict.ok !== true) {
      problems.push(`the healthy input for ${rowId} is NOT green, so every case for that row is red `
        + `for reasons nobody chose: ${verdict.evidence}`);
    }
  }

  const cases = await selftestCases();
  for (const [label, rowId, input] of cases) {
    const row = ROWS.find((r) => r.id === rowId);
    if (!row || typeof row.decide !== 'function') {
      problems.push(`"${label}" names row ${rowId}, which has no judgement to call`);
      continue;
    }
    let verdict;
    try { verdict = row.decide(input); } catch { verdict = { ok: false }; }
    if (verdict.ok !== false) problems.push(`"${label}" did NOT go red. Row ${rowId} cannot fail on it.`);
  }

  const covered = new Set(cases.map(([, rowId]) => rowId));
  for (const row of automated) {
    if (!covered.has(row.id)) problems.push(`row ${row.id} has no failure proof. Every automated row needs one.`);
  }

  return { problems, cases: cases.length, rows: automated.length };
}

async function selftest() {
  const { problems, cases, rows } = await runSelftest();
  for (const problem of problems) console.error(`  selftest: ${problem}`);
  if (problems.length) {
    console.error(`readiness selftest: FAIL, ${problems.length} problems.`);
    process.exit(1);
  }
  console.log(`readiness selftest: PASS. All ${rows} automated rows accepted a healthy input, and `
    + `${cases} deliberately broken inputs were handed to those same real judgements and every one `
    + 'of them went red.');
}

/* ------------------------------------------------------------------ run */

async function main() {
  const drift = thresholdDrift();
  if (drift.length) {
    console.error('readiness: REFUSING TO RUN. The thresholds and their fixture disagree:');
    for (const line of drift) console.error(`  - ${line}`);
    console.error('Somebody has changed a threshold in one place only. Fix reality, not the number.');
    process.exit(2);
  }

  if (args.selftest) { await selftest(); process.exit(0); }

  const results = [];
  for (const row of ROWS) {
    if (row.kind === 'owner-gated') {
      results.push({ ...row, state: 'user-gated', evidence: row.manual });
      continue;
    }
    if ((row.network && args.offline) || (row.browser && args.noBrowser)) {
      results.push({ ...row, state: 'not-run', evidence: row.browser ? 'skipped, no browser run requested' : 'skipped, offline' });
      continue;
    }
    try {
      const outcome = row.decide(await row.gather());
      results.push({ ...row, state: outcome.ok ? 'pass' : 'fail', evidence: outcome.evidence });
    } catch (error) {
      results.push({ ...row, state: 'fail', evidence: String((error && error.message) || error) });
    }
  }

  const automated = results.filter((r) => r.kind !== 'owner-gated');
  const mandatory = automated.filter((r) => r.kind === 'mandatory');
  const passed = automated.filter((r) => r.state === 'pass');
  const failed = automated.filter((r) => r.state === 'fail');
  const notRun = automated.filter((r) => r.state === 'not-run');
  const ownerGated = results.filter((r) => r.kind === 'owner-gated');
  const mandatoryPassed = mandatory.filter((r) => r.state === 'pass');

  // A row that could not be run is NOT credit. It divides into the denominator all the same, because
  // a gate that shrinks its own denominator when a check is skipped reports a higher score for doing
  // less.
  const rate = automated.length ? passed.length / automated.length : 0;
  const mandatoryRate = mandatory.length ? mandatoryPassed.length / mandatory.length : 0;
  const ok = mandatoryRate >= MANDATORY_PASS_RATE && rate >= OVERALL_PASS_RATE;

  if (args.json) {
    console.log(JSON.stringify({
      ok, rate, mandatoryRate,
      counts: { total: automated.length, pass: passed.length, fail: failed.length, notRun: notRun.length, ownerGated: ownerGated.length },
      rows: results.map((r) => ({ id: r.id, kind: r.kind, title: r.title, state: r.state, evidence: r.evidence })),
    }, null, 1));
  } else {
    const BAR = '-'.repeat(78);
    console.log(BAR);
    console.log('readiness');
    console.log(BAR);
    const mark = { pass: 'PASS      ', fail: 'FAIL      ', 'not-run': 'NOT RUN   ', 'user-gated': 'USER GATED' };
    for (const row of results) {
      if (row.kind === 'owner-gated') continue;
      console.log(`[${mark[row.state]}] ${row.id} ${row.title}`);
      console.log(`               ${row.evidence}`);
    }
    console.log('');
    console.log('OWNER GATED, counted separately and never a pass:');
    for (const row of ownerGated) {
      console.log(`[${mark[row.state]}] ${row.id} ${row.title}`);
      console.log(`               ${row.evidence}`);
    }
    console.log('');
    console.log(BAR);
    console.log(`mandatory ${mandatoryPassed.length} of ${mandatory.length}`
      + `, automated ${passed.length} of ${automated.length} (${(rate * 100).toFixed(0)} percent)`
      + `${notRun.length ? `, ${notRun.length} could not be run` : ''}`
      + `, ${ownerGated.length} owner gated and still open.`);
    console.log(ok
      ? 'READY on every automated row. The owner gated rows above are what is left.'
      : `NOT READY. Mandatory must be ${MANDATORY_PASS_RATE * 100} percent and overall at least ${OVERALL_PASS_RATE * 100} percent.`);
    console.log(BAR);
  }

  process.exit(ok ? 0 : 1);
}

// Only when this file IS the command. A test that imports ROWS to check every row has a judgement
// must not set off a live run and a process.exit in the middle of the suite.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
