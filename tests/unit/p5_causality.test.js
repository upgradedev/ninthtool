/**
 * P5 has to see CAUSE, not coincidence.
 *
 * THE DEFECT. The probe sent the well formed call and then the broken one, always in that order,
 * and read a rejection of the second as validation. So a tool that rejects every SECOND call, for
 * reasons having nothing to do with its arguments, scored exactly like a tool that checks its
 * input. Reproduced against a fake host before the fix: an alternator returned
 * `refused: ["read_thing: rejected the call"]`, verdict PASS.
 *
 * THE FIX. The order is good, bad, bad, good. Each kind is sent twice and neither kind owns a
 * position, so a refusal counts only when it tracks the INPUT: every broken call refused and no
 * well formed call refused. Everything else is inconclusive, because a tool that refuses
 * unpredictably has not demonstrated validation.
 *
 * These drive the real `observeAll` against fake hosts rather than hand written transcripts, because
 * the defect was in HOW the evidence was gathered. A transcript fixture would have been written by
 * hand from the same assumption that was wrong.
 *
 * No timeouts are exercised here on purpose: the settle deadline is 2.5 seconds and a unit suite
 * that waits on it stops being run. The timeout path is covered by the inconclusive branch, which
 * treats any non-resolved well formed call the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { judge } from '../../src/judge/verdict.js';

/** A page with one read-only tool whose behaviour is whatever you say it is. */
function hostWhere(behave) {
  let n = 0;
  const tools = [{
    name: 'read_thing',
    description: 'reads a thing',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    origin: 'https://x.test',
  }];
  return {
    async getTools() { return tools.slice(); },
    async registerTool(descriptor) { tools.push(descriptor); return { name: descriptor.name }; },
    async executeTool(tool, argsJson) {
      if (tools.indexOf(tool) !== 0) return 'ok';
      n += 1;
      return behave(n, JSON.parse(argsJson || '{}'));
    },
  };
}

async function p5(behave) {
  const transcript = await observeAll(hostWhere(behave), {
    meta: { url: 'https://x.test/', userAgent: 'node' },
    only: ['P5'],
    allow: { toolCalls: true },
    expectedOrigin: 'https://x.test',
  });
  const result = judge(transcript, { only: ['P5'] });
  return {
    verdict: result.findings.find((f) => f.id === 'P5').verdict,
    observation: transcript.observations.P5,
  };
}

test('a tool that really validates its input passes', async () => {
  const { verdict, observation } = await p5((n, args) => (
    args.id === undefined ? Promise.reject(new Error('id is required')) : 'answer'
  ));
  assert.equal(verdict, 'pass', JSON.stringify(observation));
  assert.match(observation.refused[0], /in both orders/,
    'the pass must be justified by the counterbalanced evidence, not by one rejection');
});

test('an alternator that rejects every second call does not pass', async () => {
  // THE ONE THE OLD ORDER COULD NOT SEE. Nothing about this tool depends on its arguments.
  let n = 0;
  const { verdict, observation } = await p5(() => {
    n += 1;
    return n % 2 === 0 ? Promise.reject(new Error('nope')) : 'answer';
  });
  assert.equal(verdict, 'not-applicable', JSON.stringify(observation));
  assert.equal(observation.refused.length, 0, 'an alternator was counted as a refusal');
  assert.match(observation.inconclusive[0], /a well formed call itself failed/);
});

test('a tool that rejects one broken call and answers the other does not pass', async () => {
  let seen = 0;
  const { verdict, observation } = await p5((n, args) => {
    if (args.id === undefined) { seen += 1; return seen === 1 ? Promise.reject(new Error('no')) : 'answer'; }
    return 'answer';
  });
  assert.equal(verdict, 'not-applicable', JSON.stringify(observation));
  assert.match(observation.inconclusive[0], /rejected 1 of 2 identical broken calls/,
    'a rejection that does not track the arguments must be named as such');
});

test('a tool that fails on one call number does not pass', async () => {
  let n = 0;
  const { verdict, observation } = await p5(() => {
    n += 1;
    return n === 3 ? Promise.reject(new Error('flaky')) : 'answer';
  });
  assert.equal(verdict, 'not-applicable', JSON.stringify(observation));
  assert.equal(observation.refused.length, 0);
});

test('a tool that ignores its input still fails, which is the only proof of a defect', async () => {
  const { verdict, observation } = await p5(() => 'answer');
  assert.equal(verdict, 'fail', JSON.stringify(observation));
  assert.match(observation.ignored[0], /changed nothing in the answer/);
});

test('both kinds of call are sent twice, and neither kind owns a position', async () => {
  // The counterbalance itself, asserted rather than assumed. If someone reverts to good-then-bad
  // this fails even though every verdict above might still come out right by luck.
  const order = [];
  await p5((n, args) => { order.push(args.id === undefined ? 'bad' : 'good'); return 'answer'; });
  assert.equal(order.length, 4, `expected four calls, got ${order.join(', ')}`);
  assert.equal(order.filter((k) => k === 'good').length, 2, order.join(', '));
  assert.equal(order.filter((k) => k === 'bad').length, 2, order.join(', '));
  assert.notEqual(order[0], order[1], 'the first two calls must differ, or there is no control');
  assert.notEqual(order[0], order[order.length - 1] === order[0] ? order[1] : order[0],
    'a kind must not occupy only one end');
  assert.deepEqual(order, ['good', 'bad', 'bad', 'good'],
    'the order is part of the claim: each kind twice, neither kind owning a position');
});
