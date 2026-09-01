/**
 * The one comparative number this entry makes, and the guards that keep it honest.
 *
 * Every existing WebMCP checker named in docs/prior-art.md reads a page's DECLARED METADATA: names,
 * descriptions, schemas, annotations. So the fair question is how much of this catalogue that
 * reaches, and the answer is computed from the catalogue rather than typed anywhere.
 *
 * WHAT THE NUMBER IS NOT. It is not a survey, not a benchmark against a named product, and not a
 * measurement of how well anybody implements the metadata half. It is a property of these twenty
 * rows. A different catalogue would score differently, and the README says so where the number is
 * printed.
 *
 * The classification is the thing that could rot, so it is asserted row by row below rather than
 * only in aggregate. A row moved from execution to metadata to flatter the number would have to be
 * moved here too, in a file that explains what the word means.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BEHAVIOURS, decidability, DECIDABLE_FROM } from '../../src/judge/behaviours.js';

test('every behaviour declares how it could be decided', () => {
  for (const b of BEHAVIOURS) {
    assert.ok(DECIDABLE_FROM.includes(b.decidableFrom),
      `${b.id} has decidableFrom "${b.decidableFrom}"`);
  }
});

test('the counts are computed from the catalogue and add up', () => {
  const d = decidability();
  assert.equal(d.total, BEHAVIOURS.length);
  assert.equal(d.metadata + d.execution, d.total);
  assert.equal(d.yourPageMetadata + d.yourPageExecution,
    BEHAVIOURS.filter((b) => b.group === 'your-page').length);
});

test('the metadata rows are exactly the ones readable from a published tool list', () => {
  // Row by row, because an aggregate assertion would let a single reclassification through.
  // "metadata" means: decidable by reading getTools() on the page under test, calling nothing and
  // registering nothing of our own.
  const expected = ['A2', 'B4', 'D2', 'P1', 'P2', 'P3', 'P4'];
  const actual = BEHAVIOURS.filter((b) => b.decidableFrom === 'metadata').map((b) => b.id);
  assert.deepEqual(actual, expected,
    'the metadata set changed. If that is deliberate, say in this test why the row can now be '
    + 'decided without calling or registering anything, because the comparative number depends on it');
});

test('every row that needs a call or a registration is classed as execution', () => {
  // The other direction, spelled out, so the reasoning is auditable rather than assumed.
  const mustExecute = {
    A1: 'the callback arity is only visible from inside a handler that ran',
    A3: 'needs a tool of our own registered with consequentialHint to see it dropped',
    B1: 'three refusal routes have to be called',
    B2: 'the promise has to settle to see that it resolved',
    B3: 'needs a tool of our own registered with six annotations',
    B5: 'two handlers have to return and be compared',
    C1: 'the form has to be submitted twice',
    C2: 'a tool has to be registered and then aborted',
    C3: 'eight bad calls, four per half',
    C4: 'the tool has to be called to find it never settles',
    D1: 'the event only fires on a real registration and withdrawal',
    P5: 'the tool has to be called well formed and then broken',
    P6: 'a differential needs the tools called',
  };
  for (const [id, why] of Object.entries(mustExecute)) {
    const b = BEHAVIOURS.find((x) => x.id === id);
    assert.ok(b, `${id} left the catalogue and this reasoning is stale`);
    assert.equal(b.decidableFrom, 'execution', `${id} is classed as metadata, but ${why}`);
  }
  assert.equal(Object.keys(mustExecute).length, decidability().execution,
    'the reasoning above covers a different number of rows than the catalogue classes as execution');
});

test('the majority of the catalogue is beyond a metadata checker, which is the claim', () => {
  const d = decidability();
  assert.ok(d.execution > d.metadata,
    'if most rows became metadata decidable, the entry would no longer be saying anything an '
    + 'existing checker does not, and the README would need rewriting rather than the number');
});

test('the README prints the same numbers the catalogue computes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
  );
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const d = decidability();
  assert.ok(readme.includes(`${d.execution} of the ${d.total}`),
    `the README does not state "${d.execution} of the ${d.total}", which is what the catalogue computes`);
});
