/**
 * A SCHEMA CAN DECLARE THE CONTAINER AND FILL IT WITH THE WRONG THING.
 *
 * P2 held when `schema.type === 'object'`, and checked nothing else. So a tool publishing
 * `{type: 'object', properties: 'not-an-object'}` was reported as declaring a readable object
 * schema, and P2 passed. Every consumer then reads `.properties` and gets a string, this probe
 * included: P3 walks that same field one line later and would iterate the characters of a string.
 *
 * The row exists to answer whether a consumer can actually read the schema. Type alone cannot
 * answer that, which is the fail-open this file pins shut.
 *
 * These drive the real `observeAll` and the real `judge` against a fake host, rather than a hand
 * written transcript, because a transcript would encode the answer this test is supposed to derive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { judge } from '../../src/judge/verdict.js';

/** One tool, whose schema is whatever the caller wants to publish. */
function hostPublishing(inputSchema) {
  const tools = [{
    name: 'read_thing',
    description: 'Reads a thing and returns what it read.',
    inputSchema,
    annotations: { readOnlyHint: true },
    origin: 'https://x.test',
  }];
  return {
    async getTools() { return tools.slice(); },
    async registerTool(descriptor) { tools.push(descriptor); return { name: descriptor.name }; },
    async executeTool() { return 'ok'; },
  };
}

async function p2(inputSchema) {
  const transcript = await observeAll(hostPublishing(inputSchema), {
    meta: { url: 'https://x.test/', userAgent: 'node' },
    only: ['P2'],
    expectedOrigin: 'https://x.test',
  });
  const finding = judge(transcript, { only: ['P2'] }).findings.find((f) => f.id === 'P2');
  return { verdict: finding.verdict, observed: finding.observed, raw: transcript.observations.P2 };
}

test('a schema whose properties is a string is not a readable object schema', async () => {
  const r = await p2({ type: 'object', properties: 'not-an-object' });
  assert.notEqual(r.verdict, 'pass',
    `P2 passed a schema a consumer cannot read. It observed: ${r.observed}`);
  assert.match(String(r.observed), /properties/,
    'the row has to say which part of the schema is wrong, not just that something is');
});

test('a schema whose properties is an array is not a readable object schema either', async () => {
  const r = await p2({ type: 'object', properties: [{ id: { type: 'string' } }] });
  assert.notEqual(r.verdict, 'pass',
    `an array is an object to typeof, and that is exactly why this case is here. Observed: ${r.observed}`);
});

test('a well formed schema still passes, so the rule has not simply been made to fail', async () => {
  const r = await p2({
    type: 'object',
    properties: { id: { type: 'string', description: 'Which one to read.' } },
    required: ['id'],
  });
  assert.equal(r.verdict, 'pass', `a readable schema must still pass. Observed: ${r.observed}`);
});

test('a schema with no properties at all is not failed by this rule', async () => {
  // A tool taking no arguments is not a defect, and widening the rule to catch one would be the
  // gate-tightening-into-noise failure rather than a fix.
  const r = await p2({ type: 'object' });
  assert.equal(r.verdict, 'pass', `a no-argument tool must not be failed. Observed: ${r.observed}`);
});

/**
 * THE PROOF THAT THE RULE CAN GO RED, written as the check that used to ship.
 *
 * If someone reverts P2 to reading only `type`, the first two tests go green again for the wrong
 * reason. This one states the old rule directly, so the difference between the two is visible in
 * one file rather than inferred from a diff.
 */
test('the rule that shipped would have passed the malformed schema', () => {
  const malformed = { type: 'object', properties: 'not-an-object' };
  const oldRuleSaysReadable = malformed.type === 'object';
  assert.ok(oldRuleSaysReadable,
    'the old rule must still accept it, or this file is no longer testing the defect it was written for');
  const properties = malformed.properties;
  const newRuleSaysReadable = properties === undefined
    || (typeof properties === 'object' && properties !== null && !Array.isArray(properties));
  assert.equal(newRuleSaysReadable, false, 'the new rule must reject what the old one accepted');
});
