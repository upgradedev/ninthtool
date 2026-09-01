/**
 * Every group in the catalogue has copy on the page, checked at authoring time.
 *
 * THE FAILURE THIS EXISTS TO STOP HAS ALREADY HAPPENED HERE. A group was added to the catalogue and
 * not to the page's copy table. `GROUP_COPY[group].heading` threw inside the render, the whole
 * catalogue failed to draw, and the page came up with **nought cards** and a truncated status line.
 * For a page whose entire job is to show you something, rendering nothing is the worst failure
 * available, and it would have shipped had a run not happened to look at the card count.
 *
 * So it is a failing test now, and the render also falls back to the group's own name rather than
 * throwing, because two defences against a blank page is the right number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { GROUPS, BEHAVIOURS } from '../../src/judge/behaviours.js';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
);
const app = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');

/** The keys of GROUP_COPY, read out of the source rather than imported, since app.js touches the DOM. */
function groupCopyKeys() {
  const block = app.slice(app.indexOf('const GROUP_COPY = {'), app.indexOf('const VERDICT_CLASS'));
  return [...block.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);
}

test('every group in the catalogue has copy on the page', () => {
  const covered = groupCopyKeys();
  const missing = GROUPS.filter((group) => !covered.includes(group));
  assert.deepEqual(missing, [],
    'these groups are in the catalogue and have no heading on the page. '
    + 'Add them to GROUP_COPY in src/ui/app.js.');
});

test('the page has no copy for a group that no longer exists', () => {
  const orphans = groupCopyKeys().filter((group) => !GROUPS.includes(group));
  assert.deepEqual(orphans, [], 'the page carries copy for a group that is not in the catalogue');
});

test('every behaviour belongs to a group the page can render', () => {
  for (const behaviour of BEHAVIOURS) {
    assert.ok(GROUPS.includes(behaviour.group),
      `${behaviour.id} is in group "${behaviour.group}", which is not in GROUPS`);
  }
});

test('the render survives a group with no copy rather than blanking the page', () => {
  assert.match(app, /GROUP_COPY\[group\] \|\| \{/,
    'renderGroups must fall back when a group has no copy. Reading .heading off undefined threw '
    + 'inside the render and left the page empty.');
});

test('every behaviour carries the fields the page renders', () => {
  for (const behaviour of BEHAVIOURS) {
    for (const field of ['id', 'group', 'subject', 'title', 'promise', 'measured', 'why', 'reproduce']) {
      assert.ok(typeof behaviour[field] === 'string' && behaviour[field].length > 0,
        `${behaviour.id} has no ${field}, and the page renders it`);
    }
    assert.ok(behaviour.subject === 'browser' || behaviour.subject === 'page',
      `${behaviour.id} has subject "${behaviour.subject}", which the page cannot label`);
  }
});

test('the your-page group is the only one whose subject is the page', () => {
  // The distinction the whole report rests on: a browser fact is not your fault, and telling a
  // reader otherwise is the fastest way to make a conformance tool useless. Six rows carried the
  // wrong label for one commit.
  for (const behaviour of BEHAVIOURS) {
    if (behaviour.group === 'your-page') {
      assert.equal(behaviour.subject, 'page', `${behaviour.id} is a your-page row and must have subject page`);
    } else {
      assert.equal(behaviour.subject, 'browser',
        `${behaviour.id} is not in the your-page group, so it is measured by registering our own `
        + 'tools and is a fact about the host, not a defect in the page under test');
    }
  }
});
