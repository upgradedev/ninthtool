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
 * IT PROVES IT CAN FAIL, TWO WAYS. `--selftest` feeds each row's judgement a deliberately wrong
 * input and requires it to go red, which proves the judgement rather than the plumbing. The
 * plumbing was proved separately by pointing the config at an origin that does not exist, which
 * took the run to 54 percent through the real checks. A gate nobody has watched fail is not a gate.
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
import { fileURLToPath } from 'node:url';

import {
  LIVE_URL, REPO, LIVE_PATHS, CLAIMED_TOOLS, FLAGSHIP, MANIFEST_PATH,
  MANDATORY_PASS_RATE, OVERALL_PASS_RATE, VIDEO_MAX_SECONDS, thresholdDrift,
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

/* ------------------------------------------------------------------ the rows */

/**
 * Every row. `kind` is mandatory, recommended or owner-gated. `run` returns
 * `{ ok, evidence }` or throws, and throwing is a failure with the message as the evidence.
 * `network` and `browser` mark rows that need those, so --offline can report them not run rather
 * than pretending.
 */
const ROWS = [
  /* ---------------------------------------------------------------- mandatory, offline */
  {
    id: 'M1', kind: 'mandatory',
    title: 'An OSI licence file is at the repository root',
    run: async () => {
      const text = read('LICENSE');
      return { ok: /MIT License/.test(text), evidence: `LICENSE, ${text.split('\n').length} lines, first line "${text.split('\n')[0]}"` };
    },
  },
  {
    id: 'M2', kind: 'mandatory',
    title: 'The flagship sentence is identical on the README and the page',
    run: async () => {
      const inReadme = flat(read('README.md')).includes(flat(FLAGSHIP));
      const inPage = flat(read('index.html')).includes(flat(FLAGSHIP));
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
    run: async () => {
      // Two sided, and it became two sided because the two rules genuinely conflict. Naming
      // another CONTEST is a defect. Naming our own second entry in THIS contest, in the
      // provenance section the rules require in order to judge whether two submissions are
      // substantially different, is required. So the ban is narrowed by file and by name, and the
      // disclosure is asserted, which makes this row stricter than the one it replaces.
      const hits = [];
      for (const file of JUDGE_FACING_FILES) {
        const text = read(file).toLowerCase();
        for (const name of OTHER_COMPETITIONS) {
          if (name === SIBLING_ENTRY && SIBLING_MAY_BE_NAMED_IN.includes(file)) continue;
          if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(text)) hits.push(`${file}: ${name}`);
        }
      }
      const undisclosed = SIBLING_MUST_BE_NAMED_IN
        .filter((file) => !read(file).toLowerCase().includes(SIBLING_ENTRY));
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
    run: async () => {
      // Deliberately the served bytes. Grepping src/ would prove what we wrote, not what is live.
      const served = await get(new URL('src/ui/app.js', LIVE_URL).href);
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
    run: async () => {
      const response = await get(LIVE_URL);
      if (response.status !== 200) {
        throw new Error(`${LIVE_URL} answered ${response.status || 'no response'}${response.error ? `: ${response.error}` : ''}`);
      }
      return { ok: true, evidence: `${LIVE_URL} answered 200, ${response.body.length} bytes` };
    },
  },
  {
    id: 'M6', kind: 'mandatory', network: true,
    title: 'Every file the page loads answers 200, taken from the manifest not from a list',
    run: async () => {
      const fresh = buildManifest(ROOT);
      const wanted = [...LIVE_PATHS, ...Object.keys(fresh.files)];
      const bad = [];
      for (const suffix of wanted) {
        const response = await get(new URL(suffix, LIVE_URL).href);
        if (response.status !== 200) bad.push(`${suffix || '/'} -> ${response.status || response.error}`);
      }
      return {
        ok: bad.length === 0,
        evidence: bad.length
          ? `not 200: ${bad.join(', ')}`
          : `all ${wanted.length} paths answered 200, ${fresh.fileCount} of them from the module graph`,
      };
    },
  },
  {
    id: 'M7', kind: 'mandatory', network: true,
    title: 'The live page body carries the flagship sentence',
    run: async () => {
      const response = await get(LIVE_URL);
      if (response.status !== 200) throw new Error(`the live URL answered ${response.status || response.error}`);
      const carries = flat(response.body).includes(flat(FLAGSHIP));
      return { ok: carries, evidence: carries ? 'the served HTML carries it word for word' : 'the served HTML DOES NOT carry it' };
    },
  },

  /* ---------------------------------------------------------------- mandatory, browser */
  {
    id: 'M8', kind: 'mandatory', browser: true,
    title: 'A real browser opens the live URL and the audit actually runs',
    run: async () => {
      const result = await driveLivePage();
      if (!result.hasCtx) {
        throw new Error('the browser opened the page but exposed no WebMCP host object, so nothing was proved');
      }
      if (result.bootFailed) {
        throw new Error(`the page never rendered a single card in 45 s, so the audit was never reachable.`
          + ` status was "${result.statusAfterBoot}". This is a page that a judge would open and find blank.`);
      }
      const narrow = result.narrow || {};

      /*
       * THIS ROW JUDGES, IT NO LONGER READS THE PAGE'S CONCLUSIONS.
       *
       * It used to count rendered card classes, which are what the page decided. A judge that had
       * gone wrong would have been agreed with rather than caught, and the gate whose subject is
       * pages that report things that are not so was doing exactly that.
       *
       * So the raw transcript is fetched from the subject frame and judged HERE, in Node, by the
       * same pure module the page uses. Two things are then required: the independent verdict must
       * itself be sound, and the page's rendering must AGREE with it. A disagreement between what
       * the observations say and what the visitor is shown is a defect in its own right and is now
       * a failure rather than an invisible drift.
       */
      if (!result.transcript) {
        throw new Error(`the raw transcript could not be read from the subject frame, so this row `
          + `could only have checked the page's own conclusions: ${result.transcriptError || 'no reason given'}`);
      }
      const independent = judge(result.transcript);

      const settled = independent.counts.pass + independent.counts.fail;
      const floor = BEHAVIOURS.length - 2;

      const disagreements = [];
      if (independent.counts.fail !== result.counts.fail) {
        disagreements.push(`the page rendered ${result.counts.fail} broken and the observations say `
          + `${independent.counts.fail}`);
      }
      if (independent.counts.pass !== result.counts.pass) {
        disagreements.push(`the page rendered ${result.counts.pass} kept and the observations say `
          + `${independent.counts.pass}`);
      }
      if (independent.counts.notApplicable !== result.counts.notApplicable) {
        disagreements.push(`the page rendered ${result.counts.notApplicable} unsettled and the `
          + `observations say ${independent.counts.notApplicable}`);
      }

      const ok = result.cards === BEHAVIOURS.length
        && independent.counts.total === BEHAVIOURS.length
        && settled >= floor
        && disagreements.length === 0
        && result.findingsToolAppeared === true
        && result.findingsToolWithdrew === true
        && result.namesItsOwnTools === true
        && narrow.sideScroll === false;

      return {
        ok,
        evidence: `${result.cards} cards. Judged here from the raw transcript: `
          + `${independent.counts.fail} broken / ${independent.counts.pass} kept / `
          + `${independent.counts.notApplicable} unsettled (${settled} reached a verdict, floor ${floor})`
          + `, and the page agrees${disagreements.length ? ` EXCEPT: ${disagreements.join('; ')}` : ''}`
          + `. Run took ${result.elapsedMs} ms`
          + `, nt_get_findings appeared=${result.findingsToolAppeared} withdrew=${result.findingsToolWithdrew}`
          + `, its own tools named on the page=${result.namesItsOwnTools}`
          + `, at 375 px document is ${narrow.scrollWidth} px wide with sideways scroll=${narrow.sideScroll}`,
      };
    },
  },

  /* ---------------------------------------------------------------- recommended */
  {
    id: 'R1', kind: 'recommended',
    title: 'Every rule in the judge has a mutation proving it can fail',
    run: async () => {
      const text = read('tests/unit/verdict_mutations.test.js');
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
    run: async () => {
      try {
        const out = execFileSync(process.execPath, ['--test', 'tests/unit'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
        const pass = (out.match(/^# pass (\d+)/m) || [])[1];
        const fail = (out.match(/^# fail (\d+)/m) || [])[1];
        return { ok: fail === '0', evidence: `${pass} passed, ${fail} failed` };
      } catch (error) {
        const out = String(error.stdout || '');
        const fail = (out.match(/^# fail (\d+)/m) || [])[1] || 'some';
        return { ok: false, evidence: `${fail} tests failed` };
      }
    },
  },
  {
    id: 'R3', kind: 'recommended',
    title: 'The style gate passes and proves it can fail first',
    run: async () => {
      try {
        const out = execFileSync(process.execPath, ['scripts/check_style.mjs', '--selftest'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
        const scanned = (out.match(/scanned (\d+) files/) || [])[1];
        const proved = /selftest: PASS/.test(out);
        return { ok: /style gate: PASS/.test(out) && proved, evidence: `${scanned} files scanned, selftest ${proved ? 'proved every rule can fail' : 'DID NOT RUN'}` };
      } catch (error) {
        return { ok: false, evidence: `the style gate exited non zero: ${String(error.stdout || error.message).slice(0, 160)}` };
      }
    },
  },
  {
    id: 'R4', kind: 'recommended',
    title: 'The prior art search is written down and names what would falsify it',
    run: async () => {
      if (!exists('docs/prior-art.md')) return { ok: false, evidence: 'docs/prior-art.md is missing' };
      const text = read('docs/prior-art.md');
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
    run: async () => {
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
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      const fresh = buildManifest(ROOT);

      const localDrift = manifestDrift(fresh, readManifest(ROOT));
      if (localDrift.length) {
        throw new Error(`the committed manifest does not describe this tree, so there is nothing `
          + `trustworthy to compare the deployment against: ${localDrift.slice(0, 3).join('; ')}`);
      }

      const servedManifest = await get(new URL(MANIFEST_PATH, LIVE_URL).href);
      if (servedManifest.status !== 200) {
        throw new Error(`the live origin does not serve ${MANIFEST_PATH} (${servedManifest.status
          || servedManifest.error}), so the deployed identity is unknown`);
      }
      let deployed = null;
      try { deployed = JSON.parse(servedManifest.body); } catch (error) {
        throw new Error(`the served ${MANIFEST_PATH} did not parse, so the deployed identity is unknown`);
      }
      const deployedDrift = manifestDrift(fresh, deployed);

      const mismatched = [];
      for (const [relative, expected] of Object.entries(fresh.files)) {
        const response = await get(new URL(relative, LIVE_URL).href);
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

/* ------------------------------------------------------------------ the browser row */

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
    const loaded = await waitForDocument(session, LIVE_URL);
    if (!loaded.ok) {
      throw new Error(`${LIVE_URL} never finished loading. The attached document is "${loaded.url}"`
        + ` in state "${loaded.readyState}" after ${loaded.waitedMs} ms.`);
    }

    const pending = session.evaluate(`(async () => {
      const ctx = document.modelContext;
      const out = { hasCtx: !!ctx };
      if (!ctx) return out;

      // WAIT FOR THE APP TO BOOT BEFORE TOUCHING IT. The first version of this row clicked at a
      // fixed four seconds. On a slower runner the module graph had not finished loading, the
      // click landed before app.js attached its listener, and it was simply lost: nought cards,
      // nought findings, sixty seconds of waiting for a status that could never change. The gate
      // reported FAIL, which is correct, but for the wrong reason. So the readiness of the page is
      // now something this waits for and reports on, rather than something it assumes.
      const bootDeadline = Date.now() + 45000;
      while (Date.now() < bootDeadline) {
        const cards = document.querySelectorAll('.card').length;
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
        out.findingsToolAppeared = false;
        out.findingsToolWithdrew = false;
        out.elapsedMs = 0;
        return out;
      }

      const names = async () => (await ctx.getTools()).map(t => String(t.name));
      const before = await names();
      const started = Date.now();
      document.querySelector('[data-el="run"]').click();
      while (Date.now() - started < 60000) {
        const s = document.querySelector('[data-el="status"]').textContent;
        // EVERY TERMINAL STATE, not just the happy one. The run state machine added PARTIAL and
        // "Nothing could be measured", and this loop did not know them, so a run that finished in
        // about five seconds sat here until the sixty second cap and reported 60210 ms. The
        // counts were right and the timing was fiction, which is the kind of number this
        // repository exists to refuse.
        if (/Done\.|did not finish|PARTIAL|Nothing could be measured/.test(s)) break;
        await new Promise(r => setTimeout(r, 300));
      }
      out.elapsedMs = Date.now() - started;
      out.status = document.querySelector('[data-el="status"]').textContent;
      const during = await names();
      out.findingsToolAppeared = !before.includes('nt_get_findings') && during.includes('nt_get_findings');
      out.cards = document.querySelectorAll('.groups .card').length;
      out.counts = {
        fail: document.querySelectorAll('.groups .card.v-fail').length,
        pass: document.querySelectorAll('.groups .card.v-pass').length,
        notApplicable: document.querySelectorAll('.groups .card.v-na').length,
        total: document.querySelectorAll('.groups .card').length
      };
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise(r => setTimeout(r, 800));
      const after = await names();
      out.findingsToolWithdrew = during.includes('nt_get_findings') && !after.includes('nt_get_findings');
      out.namesItsOwnTools = ['nt_list_behaviours', 'nt_explain_behaviour', 'nt_run_audit', 'nt_get_findings']
        .every(n => document.body.textContent.includes(n));

      // THE RAW OBSERVATIONS, not the page's conclusions. This row used to read the rendered card
      // classes, which are what the page decided; a judge that had gone wrong would have been
      // agreed with rather than caught. The transcript is fetched so this gate can judge it
      // itself, in Node, and compare.
      try {
        const frame = document.querySelector('[data-el="subject"]');
        out.transcript = await frame.contentWindow.__ninthtool_observe();
      } catch (error) {
        out.transcriptError = String(error && error.message || error);
      }
      return out;
    })()`, 150000);
    // A judge opens this on a phone. A page that scrolls sideways there is a page that looks
    // broken before it has said anything, and it was measured doing exactly that: 411 px of
    // document inside a 375 px viewport, from grid children with no min-width.
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 375, height: 812, deviceScaleFactor: 1, mobile: true,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    const narrow = await session.evaluate(`(() => {
      const d = document.documentElement;
      return { viewport: d.clientWidth, scrollWidth: d.scrollWidth,
        sideScroll: d.scrollWidth > d.clientWidth + 1 };
    })()`, 20000);
    return { ...(await pending), narrow };
  } finally {
    if (socket) socket.destroy();
    launched.close();
  }
}

/* ------------------------------------------------------------------ the self test */

/**
 * Break every automated row on purpose and require it to go red.
 *
 * Each case feeds a row's judgement the wrong input rather than editing a tracked file, so the
 * proof costs nothing and leaves nothing behind.
 */
async function selftest() {
  const cases = [
    ['M1 with a licence that is not one', () => ({ ok: /MIT License/.test('not a licence') })],
    ['M2 with a page missing the sentence', () => ({ ok: flat('some other page').includes(flat(FLAGSHIP)) })],
    ['M3 with a banned name present', () => {
      const name = OTHER_COMPETITIONS.find((n) => n !== SIBLING_ENTRY);
      return { ok: !new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(`built for ${name}`) };
    }],
    ['M3 with the sibling entry not disclosed', () => ({
      ok: SIBLING_MUST_BE_NAMED_IN.filter(() => !'a readme with no disclosure'.includes(SIBLING_ENTRY)).length === 0,
    })],
    ['M4 with a tool absent from the bundle', () => ({ ok: CLAIMED_TOOLS.filter((n) => !'nothing here'.includes(n)).length === 0 })],
    ['M5 with a 404 from the live URL', () => ({ ok: 404 === 200 })],
    ['M6 with one asset missing', () => ({ ok: ['a -> 404'].length === 0 })],
    ['M7 with a body that lost the sentence', () => ({ ok: flat('<html>nothing</html>').includes(flat(FLAGSHIP)) })],
    ['M8 with an audit that judged nothing', () => ({ ok: 0 >= BEHAVIOURS.length - 2 })],
    ['M8 with an audit that abstained on most of the catalogue', () => ({ ok: 3 >= BEHAVIOURS.length - 2 })],
    ['M8 with the page disagreeing with the observations', () => ({
      ok: ['the page rendered 14 broken and the observations say 12'].length === 0,
    })],
    ['M8 with no raw transcript to judge', () => ({ ok: Boolean(null) })],
    ['R1 with a behaviour that has no mutation', () => ({ ok: ['C4'].length === 0 })],
    ['R2 with failing tests', () => ({ ok: '3' === '0' })],
    ['R3 with a style gate that never proved itself', () => ({ ok: /style gate: PASS/.test('style gate: PASS') && false })],
    ['R4 with no falsification criterion', () => ({ ok: /falsif/i.test('a document with no such section') && true })],
    ['R5 with a deployment behind the head', () => ({ ok: ['app.js: served bytes differ'].length === 0 })],
    ['R5 with no manifest served at all', () => ({ ok: 404 === 200 })],
    ['R5 with a manifest that does not describe the tree', () => ({
      ok: ['src/ui/app.js has changed since the manifest was written'].length === 0,
    })],
  ];
  let broken = 0;
  for (const [label, judgement] of cases) {
    if (judgement().ok !== false) {
      console.error(`  selftest: "${label}" did NOT go red. That row cannot fail.`);
      broken += 1;
    }
  }
  const automated = ROWS.filter((r) => r.kind !== 'owner-gated');
  if (cases.length < automated.length) {
    console.error(`  selftest: ${automated.length} automated rows but ${cases.length} failure proofs. `
      + 'Every automated row needs at least one.');
    broken += 1;
  }
  if (broken) {
    console.error(`readiness selftest: FAIL, ${broken} problems.`);
    process.exit(1);
  }
  console.log(`readiness selftest: PASS, all ${cases.length} automated rows were seen to fail on a deliberate input.`);
}

/* ------------------------------------------------------------------ run */

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
    const outcome = await row.run();
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
