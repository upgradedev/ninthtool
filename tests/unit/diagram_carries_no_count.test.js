/**
 * THE PICTURE MAY NOT CARRY A NUMBER THAT ROTS.
 *
 * assets/architecture.jpg is the first image in the Devpost gallery, and it was corrected three
 * times in two days. Every correction was the same defect: a test count and a coverage percentage
 * typed into a picture, going stale the moment anyone added a test. Nothing failed when the picture
 * and the tree disagreed, so each one was found by a human reading the image.
 *
 * The rule this file pins is the one c3_published_claims.test.js already applies to the catalogue:
 * judge facing prose describes the SHAPE of a finding and carries no count. The floor is fine, it
 * is a decision and it does not move. The mean and the test total are measurements, and they belong
 * in the run that produced them.
 *
 * This tests the SOURCE, docs/architecture-diagram.html, because the jpg is generated from it and a
 * test that read the pixels would be testing a renderer instead of a claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);
const SOURCE = 'docs/architecture-diagram.html';

/** A test total: three or four digits next to the word tests, or an N / N pair. */
const A_TEST_COUNT = /\b\d{3,4}\s*(?:\/\s*\d{3,4})?\s*(?:unit\s+)?tests?\b|\btests?\s*(?:passed|passing)\b/i;

/** A coverage reading, as opposed to the floor. Any percentage that is not a round decade. */
const A_MEASURED_PERCENTAGE = /\b(?!(?:[1-9]0|100)%)\d{1,3}\.\d+\s*%/;

test('the architecture diagram source carries no test count', () => {
  const html = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8');
  const hit = html.match(A_TEST_COUNT);
  assert.equal(hit, null,
    `${SOURCE} carries ${JSON.stringify(hit && hit[0])}. A count typed into a picture cannot track `
    + 'a tree that moves; it went stale three times. Describe the shape and let the run carry the number.');
});

test('the architecture diagram source carries no measured percentage', () => {
  const html = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8');
  const hit = html.match(A_MEASURED_PERCENTAGE);
  assert.equal(hit, null,
    `${SOURCE} carries ${JSON.stringify(hit && hit[0])}, which is a measurement rather than a `
    + 'decision. The 85 percent floor is fine because a floor does not move.');
});

test('the floor is still stated, so this rule did not empty the picture', () => {
  const html = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8');
  assert.match(html, /85\s*%/,
    'the diagram must still name the coverage floor. Removing the claim entirely is not the fix.');
});

/** The proof that both rules bite, written as the strings that actually shipped. */
test('the rules reject the exact text that shipped on the image', () => {
  assert.notEqual('524 / 524 tests passed'.match(A_TEST_COUNT), null,
    'the badge that shipped must still be caught');
  assert.notEqual('Line coverage, counting each file once: 98.51% across 54 files'.match(A_MEASURED_PERCENTAGE), null,
    'the footer that shipped must still be caught');
  assert.equal('Coverage floor 85% per file'.match(A_MEASURED_PERCENTAGE), null,
    'the floor must not be caught, or the rule is unusable');
});
