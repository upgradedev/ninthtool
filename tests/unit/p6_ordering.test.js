/**
 * P6 must not erase the side effect it is looking for.
 *
 * THE DEFECT. After the attributed call, the re-read walked every read only tool in list order,
 * which meant it began by calling the very tool that had just caused the effect. A tool whose next
 * call restores what its previous one moved therefore cleaned up before any independent oracle
 * looked, and the movement was recorded as nothing at all.
 *
 * Reproduced against a fake host where calling A moves state that B reports, and A's next call puts
 * it back:
 *
 *   moved   : []
 *   verdict : pass
 *   observed: "calling any of them did not change what the others answered"
 *
 * on a run where A demonstrably moved it. The claim was the strongest one the row makes, and it was
 * false in exactly the case the row exists to catch.
 *
 * The re-read now takes every OTHER oracle first and the target last, so the effect is observed
 * while it is still there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeAll } from '../../src/probe/observe.js';
import { judge } from '../../src/judge/verdict.js';

const ORIGIN = 'https://x.test';

/**
 * A page whose tool A moves state that B can see, and restores it on its own next call.
 *
 * The control reads call A twice before anything is attributed, so A does nothing on calls 1 and 2,
 * which keeps the control stable. It moves on call 3, the attributed one, and would restore on call
 * 4, which under the old ordering was the first call of the re-read.
 *
 * @param {{moveOn: number, restoreOn: number}} when
 */
function selfErasingHost({ moveOn = 3, restoreOn = 4 } = {}) {
  let aCalls = 0;
  let state = 'baseline';
  const calls = [];
  const tools = [
    {
      name: 'a_tool',
      description: 'moves something another tool reports',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      origin: ORIGIN,
    },
    {
      name: 'b_tool',
      description: 'reports the state',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      origin: ORIGIN,
    },
  ];
  return {
    calls,
    ctx: {
      async getTools() { return tools.slice(); },
      async registerTool(descriptor) { tools.push(descriptor); return { name: descriptor.name }; },
      async executeTool(tool) {
        calls.push(String(tool.name));
        if (tool.name === 'a_tool') {
          aCalls += 1;
          if (aCalls === moveOn) state = 'MOVED';
          if (aCalls === restoreOn) state = 'baseline';
          return 'a ok';
        }
        if (tool.name === 'b_tool') return `state is ${state}`;
        return 'ok';
      },
    },
  };
}

async function p6(host) {
  const transcript = await observeAll(host.ctx, {
    meta: { url: `${ORIGIN}/`, userAgent: 'node' },
    only: ['P6'],
    allow: { toolCalls: true },
    expectedOrigin: ORIGIN,
  });
  return {
    observation: transcript.observations.P6,
    verdict: judge(transcript, { only: ['P6'] }).findings.find((f) => f.id === 'P6').verdict,
  };
}

test('a tool that moves state and then restores it on its own next call is still caught', async () => {
  const host = selfErasingHost();
  const { observation, verdict } = await p6(host);

  assert.equal(verdict, 'fail',
    `the movement was erased by the target's own self read: ${JSON.stringify(observation)}`);
  assert.ok(observation.moved.some((m) => /a_tool changed what b_tool answers/.test(m)),
    `moved should name the tool that did it: ${JSON.stringify(observation.moved)}`);
});

test('the re-read asks every other oracle before it asks the tool it just called', async () => {
  /*
   * THE ORDERING ITSELF, asserted rather than inferred from the verdict. If someone restores list
   * order this fails even on a host where the verdict happens to come out right, which is the whole
   * point: the defect was invisible to every outcome-level assertion.
   */
  const host = selfErasingHost();
  await p6(host);

  // Find the attributed call to a_tool: the first a_tool call after the two control reads.
  // Controls call a,b,a,b, so index 4 is the attributed one.
  const attributed = 4;
  assert.equal(host.calls[attributed], 'a_tool',
    `expected the attributed call at index ${attributed}, got ${host.calls.slice(0, 8).join(', ')}`);
  assert.equal(host.calls[attributed + 1], 'b_tool',
    'the re-read must ask the OTHER oracle first, or the target can clean up before anyone looks: '
    + host.calls.slice(0, 8).join(', '));
});

test('a tool that does not move anything still passes, so the fix did not just fail everything', async () => {
  const quiet = selfErasingHost({ moveOn: 0, restoreOn: 0 });
  const { verdict, observation } = await p6(quiet);
  assert.equal(verdict, 'pass', JSON.stringify(observation));
  assert.deepEqual(observation.moved, []);
});
