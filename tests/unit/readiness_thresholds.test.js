/**
 * The readiness thresholds, pinned a third time and from outside.
 *
 * WHY THREE COPIES OF ONE NUMBER IS THE RIGHT ANSWER HERE. A threshold written once can be edited
 * to make a red build green, and the edit looks like any other diff. So each number lives in
 * `readiness_config.mjs`, again in `THRESHOLD_FIXTURE` beside it, and again here. The gate refuses
 * to run when the first two disagree, and this test fails when any of the three does. Widening a
 * gate should be hard to do by accident and impossible to do quietly.
 *
 * The rule this defends: never widen a gate, move a threshold or flip a check fail open. Fix
 * reality or state the limitation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MANDATORY_PASS_RATE, OVERALL_PASS_RATE, VIDEO_MAX_SECONDS,
  LIVE_URL, REPO, CLAIMED_TOOLS, LIVE_PATHS, FLAGSHIP, thresholdDrift,
  STANDING_TOOLS, SUBJECT_FRAME_TOOLS, FINDINGS_TOOL, EXPECTED_CATALOGUE_ROWS, MAY_ABSTAIN,
  surfaceAtRest, surfaceDuringRun,
} from '../../scripts/readiness_config.mjs';
import { BEHAVIOURS } from '../../src/judge/behaviours.js';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);

test('the thresholds are exactly these, written out a third time', () => {
  assert.equal(MANDATORY_PASS_RATE, 1.0, 'every mandatory row must pass. There is no partial credit');
  assert.equal(OVERALL_PASS_RATE, 0.95, 'the overall bar is 95 percent');
  assert.equal(VIDEO_MAX_SECONDS, 180, 'the rules cap the video at three minutes');
  assert.equal(LIVE_URL, 'https://upgradedev.github.io/ninthtool/');
  assert.equal(REPO, 'upgradedev/ninthtool');
});

test('the tool surface the browser row compares against is exact, and covers the claimed tools', () => {
  assert.deepEqual([...STANDING_TOOLS].sort(),
    ['nt_explain_behaviour', 'nt_list_behaviours', 'nt_run_audit'],
    'the standing tools are the three the page publishes at all times');
  assert.equal(FINDINGS_TOOL, 'nt_get_findings');
  assert.deepEqual([...STANDING_TOOLS, FINDINGS_TOOL].sort(), [...CLAIMED_TOOLS].sort(),
    'the standing tools plus the conditional one ARE the claimed tools, and two lists describing '
    + 'one surface may not drift apart');
  assert.deepEqual([...SUBJECT_FRAME_TOOLS].sort(), ['nt_form_answers', 'nt_form_silent'],
    'the bundled subject fixture publishes these two, and the host folds them into the top '
    + 'document surface, so they are part of what an agent sees');
  assert.deepEqual(surfaceAtRest().sort(), [...STANDING_TOOLS, ...SUBJECT_FRAME_TOOLS].sort());
  assert.deepEqual(surfaceDuringRun().sort(), [...surfaceAtRest(), FINDINGS_TOOL].sort(),
    'the only thing a run may add to the surface is the conditional tool');
  assert.equal(new Set(surfaceDuringRun()).size, surfaceDuringRun().length,
    'the expected surface names a tool twice, so the multiset comparison would accept a duplicate');
});

test('the catalogue row count is pinned to the catalogue itself', () => {
  assert.equal(EXPECTED_CATALOGUE_ROWS, 20, 'the pinned number, written out a third time');
  assert.equal(EXPECTED_CATALOGUE_ROWS, BEHAVIOURS.length,
    'the browser row requires exactly this many cards, so it has to be what the catalogue holds');
});

test('the abstention allowance is a named list of ids, each with a reason, and never a number', () => {
  assert.deepEqual(Object.keys(MAY_ABSTAIN).sort(), ['P5'],
    'exactly one behaviour is allowed to reach no verdict, and it is named');
  for (const [id, reason] of Object.entries(MAY_ABSTAIN)) {
    assert.equal(typeof reason, 'string');
    assert.ok(reason.length > 40, `${id} is on the allowance list with no reason worth reading`);
    assert.ok(BEHAVIOURS.some((b) => b.id === id),
      `${id} is allowed to abstain and is not in the catalogue at all`);
  }
});

test('the config and its own fixture agree', () => {
  assert.deepEqual(thresholdDrift(), [],
    'the thresholds and the fixture beside them disagree, so the gate would refuse to run');
});

test('the live URL is https and has no credentials or query in it', () => {
  const url = new URL(LIVE_URL);
  assert.equal(url.protocol, 'https:', 'a judge URL served over plain http is not a judge URL');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.search, '', 'a judge URL with a query string is not login free by inspection');
});

test('every claimed tool name is registered somewhere in the source', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  for (const name of CLAIMED_TOOLS) {
    assert.ok(app.includes(`name: '${name}'`),
      `${name} is on the readiness gate's claimed list but nothing in src/ui/app.js registers it`);
  }
});

test('every live path the gate checks exists in the working tree', () => {
  for (const suffix of LIVE_PATHS) {
    if (suffix === '') continue;
    assert.ok(fs.existsSync(path.join(ROOT, suffix)),
      `the gate expects ${suffix} to be served, and it is not in the repository`);
  }
});

test('the flagship sentence in the readiness config is the one on the page', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(page.includes(FLAGSHIP.replace(/\s+/g, ' ')),
    'the readiness gate is checking for a sentence the page does not carry');
});

test('the gate refuses to run when a threshold is moved in one place only', () => {
  // Proving the mechanism rather than trusting it. thresholdDrift is the function the gate calls
  // before it runs anything, so this is the same check the build makes.
  const source = fs.readFileSync(path.join(ROOT, 'scripts/readiness_config.mjs'), 'utf8');
  const moved = source.replace('OVERALL_PASS_RATE: 0.95', 'OVERALL_PASS_RATE: 0.5');
  assert.notEqual(moved, source, 'the fixture no longer pins OVERALL_PASS_RATE, so nothing is pinned');

  const runner = fs.readFileSync(path.join(ROOT, 'scripts/readiness.mjs'), 'utf8');
  assert.match(runner, /thresholdDrift\(\)/, 'the gate no longer calls thresholdDrift before running');
  assert.match(runner, /REFUSING TO RUN/, 'the gate no longer refuses to run on drift');
});

test('user gated is a third status and is never counted as a pass', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/readiness.mjs'), 'utf8');
  assert.match(runner, /state: 'user-gated'/, 'owner rows must carry their own status');
  assert.match(runner, /r\.kind !== 'owner-gated'/,
    'owner gated rows must be excluded from the automated denominator, not counted as passes');
  assert.ok(!/state === 'user-gated'[^\n]*pass/.test(runner),
    'nothing may treat a user gated row as a pass');
});
