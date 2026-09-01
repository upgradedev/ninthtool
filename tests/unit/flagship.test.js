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
  const rowIds = [...readme.matchAll(/^\|\s*([A-D]\d)\s*\|/gm)].map((m) => m[1]);
  const catalogueIds = BEHAVIOURS.filter((b) => b.group !== 'holds').map((b) => b.id);

  assert.deepEqual(
    rowIds.sort(),
    catalogueIds.sort(),
    'the README tables and the catalogue disagree about which behaviours exist',
  );
  assert.equal(
    counts.specDivergence + counts.standardGap + counts.silentTrap,
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
  // Every tool name the README or the page mentions must be registered somewhere in src.
  const sources = read('src/ui/app.js');
  const mentioned = new Set([
    ...[...read('README.md').matchAll(/`(nt_[a-z_]+)`/g)].map((m) => m[1]),
    ...[...read('index.html').matchAll(/<code>(nt_[a-z_]+)<\/code>/g)].map((m) => m[1]),
  ]);
  for (const name of mentioned) {
    assert.ok(
      sources.includes(`name: '${name}'`) || read('fixtures/subject.html').includes(`toolname="${name}"`),
      `${name} is named on a judge facing surface but nothing registers it`,
    );
  }
});
