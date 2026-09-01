/**
 * The one sentence, and the counts, asserted identical on every surface that carries them.
 *
 * THIS IS THE CHEAPEST CRITERION ON THE BOARD AND THE ONE WE HAVE LOST BEFORE. A README that says
 * one thing, a page that says another and a description that says a third is a discrepancy a judge
 * finds in thirty seconds. So the sentence lives in three files and this test reads all three and
 * refuses a drift, and the counts are computed from the catalogue rather than typed anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BEHAVIOURS, headlineCounts } from '../../src/judge/behaviours.js';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Collapse every run of whitespace, so a line wrap in one file is not a difference. */
const flat = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * The sentence. 25 words or fewer, no em dash, mechanism plus consequence.
 * If this needs to change, change it HERE and the test will tell you which files disagree.
 */
const FLAGSHIP = "Ninth Tool executes your page's WebMCP tools in the browser and shows which "
  + 'promises the standard silently drops, with the command that reproduces each one.';

test('the flagship sentence is 25 words or fewer and carries no em dash', () => {
  const words = FLAGSHIP.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 25, `the flagship sentence is ${words.length} words, the cap is 25`);
  assert.ok(!FLAGSHIP.includes(String.fromCharCode(0x2014)), 'the flagship sentence holds an em dash');
  assert.ok(!FLAGSHIP.includes(String.fromCharCode(0x2013)), 'the flagship sentence holds an en dash');
});

test('the README opens with the flagship sentence', () => {
  const readme = flat(read('README.md'));
  assert.ok(readme.includes(flat(FLAGSHIP)),
    'README.md does not carry the flagship sentence word for word');
});

test('the page carries the flagship sentence', () => {
  const page = flat(read('index.html'));
  assert.ok(page.includes(flat(FLAGSHIP)),
    'index.html does not carry the flagship sentence word for word');
});

test('the page description meta tag carries it too', () => {
  const page = read('index.html');
  const match = page.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(match, 'index.html has no description meta tag');
  assert.equal(flat(match[1]), flat(FLAGSHIP));
});

test('the title tag names the product and what it is', () => {
  const page = read('index.html');
  const match = page.match(/<title>([^<]+)<\/title>/);
  assert.ok(match, 'index.html has no title');
  assert.match(match[1], /Ninth Tool/);
});

test('the README group counts agree with the catalogue', () => {
  const readme = read('README.md');
  const counts = headlineCounts();

  // Count the table rows under each group heading by their id prefix, which is how the README
  // renders them. If a behaviour is added to the catalogue and not to the README, this fails.
  const rowIds = [...readme.matchAll(/^\|\s*([A-DP]\d)\s*\|/gm)].map((m) => m[1]);
  const catalogueIds = BEHAVIOURS.filter((b) => b.group !== 'holds').map((b) => b.id);

  assert.deepEqual(
    rowIds.sort(),
    catalogueIds.sort(),
    'the README tables and the catalogue disagree about which behaviours exist',
  );
  assert.equal(
    counts.yourPage + counts.specDivergence + counts.standardGap + counts.silentTrap + counts.byDesign,
    catalogueIds.length,
  );
});

test('the repository states the browser and date every measurement was taken against', () => {
  for (const file of ['README.md', 'index.html']) {
    const text = read(file);
    assert.match(text, /Chrome 152\.0\.7977\.65/, `${file} does not name the browser measured against`);
    assert.match(text, /2026-09-01/, `${file} does not name the date the measurements were taken`);
  }
});

test('no surface claims a capability the code does not carry', () => {
  const sources = read('src/ui/app.js');
  const fixture = read('fixtures/subject.html');
  const mentioned = new Set([
    ...[...read('README.md').matchAll(/`(nt_[a-z_]+)`/g)].map((m) => m[1]),
    ...[...read('index.html').matchAll(/<code>(nt_[a-z_]+)<\/code>/g)].map((m) => m[1]),
  ]);
  assert.ok(mentioned.size > 0,
    'no judge facing surface names a single tool, so this check was iterating an empty set and '
    + 'passing without looking at anything');
  for (const name of mentioned) {
    assert.ok(
      sources.includes(`name: '${name}'`) || fixture.includes(`toolname="${name}"`),
      `${name} is named on a judge facing surface but nothing registers it`,
    );
  }
});

test('every tool this page registers is named on a judge facing surface', () => {
  // The other direction, and the one that was missing. Criterion one asks how thoroughly the
  // project uses WebMCP, and the strongest answer this repository owns is that the auditor is
  // itself a WebMCP host. A judge on a browser without the flag never learns that unless the page
  // and the README say it in words, because the only other place those names appear is a tool list
  // that needs a flagged browser and a button press.
  const app = read('src/ui/app.js');
  const registered = [...app.matchAll(/name: '(nt_[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(registered.length >= 4, `only ${registered.length} tools found in src/ui/app.js`);

  const readme = read('README.md');
  const page = read('index.html');
  for (const name of registered) {
    assert.ok(readme.includes(name), `${name} is registered and the README never names it`);
    assert.ok(page.includes(name), `${name} is registered and the page never names it`);
  }
});

test('the conditional tool is described as conditional wherever it is named', () => {
  for (const file of ['README.md', 'index.html']) {
    const text = read(file).replace(/\s+/g, ' ');
    assert.ok(text.includes('nt_get_findings'), `${file} does not name the conditional tool`);
    assert.match(text, /does not exist until|withdrawn when/,
      `${file} names nt_get_findings without saying it appears and withdraws, which is the whole point`);
  }
});
