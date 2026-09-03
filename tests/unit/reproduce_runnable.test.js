/**
 * EVERY REPRODUCE STRING HAS TO SURVIVE BEING COPIED.
 *
 * THE FAILURE THIS EXISTS TO STOP HAS ALREADY HAPPENED, TWICE, IN THE SAME FIELD. All six P rows
 * read `node bin/ninthtool.mjs <your url> --behaviour P1`. `<` is a shell redirection operator, so
 * the line a judge copies dies before node starts, reading a file called `your`. And P5 and P6 are
 * the only two rows whose step needs `readonly-call`, which the CLI refuses on a URL it does not
 * own unless `--allow-tool-calls` is passed: those two printed a command that exits without
 * running while the help text at bin/ninthtool.mjs said the flag was required.
 *
 * This string is not decoration. src/ui/app.js renders it into a <pre><code> beside every row on
 * the live page, bin/ninthtool.mjs prints it under every finding, and nt_explain_behaviour returns
 * it to an agent. Three judge-facing surfaces carrying one unrunnable line.
 *
 * SO THE RULE IS DERIVED, NOT TYPED. The flags a row needs are computed from its own steps through
 * the same modesFor(stepsFor(id)) the runner uses, which means a new row, or a row whose step
 * changes mode, is checked the moment it is authored rather than the next time somebody reads the
 * page. Nothing here is a copy of the answer the code already knows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BEHAVIOURS } from '../../src/judge/behaviours.js';
import { stepsFor, modesFor } from '../../src/probe/steps.js';

/** The mode a step needs, and the flag bin/ninthtool.mjs demands before it will run it on a URL. */
const FLAG_FOR_MODE = Object.freeze({
  'readonly-call': '--allow-tool-calls',
  'fixture-form': '--allow-fixture-forms',
});

/** Anything the shell would act on rather than pass through. */
const SHELL_METACHARACTERS = /[<>|;&`$()]/;

/** A row aimed at somebody else's page, as opposed to the bundled fixture. */
const namesAUrl = (command) => /https?:\/\//.test(command);

test('no reproduce command contains a character the shell would eat', () => {
  for (const behaviour of BEHAVIOURS) {
    const found = behaviour.reproduce.match(SHELL_METACHARACTERS);
    assert.equal(
      found, null,
      `${behaviour.id} prints ${JSON.stringify(behaviour.reproduce)}, and ${JSON.stringify(found && found[0])} `
      + 'is a shell operator. A judge copying this line does not get the run it was promised.',
    );
  }
});

test('a reproduce command aimed at a URL carries every flag its own steps need', () => {
  for (const behaviour of BEHAVIOURS) {
    if (!namesAUrl(behaviour.reproduce)) continue;
    const needed = modesFor(stepsFor([behaviour.id]));
    for (const mode of needed) {
      const flag = FLAG_FOR_MODE[mode];
      if (!flag) continue;
      assert.ok(
        behaviour.reproduce.includes(flag),
        `${behaviour.id} needs mode ${mode} and targets a URL, so the CLI refuses it without ${flag}. `
        + `The printed command is ${JSON.stringify(behaviour.reproduce)}, which exits without running.`,
      );
    }
  }
});

test('a reproduce command aimed at the bundled fixture asks for no flag it does not need', () => {
  for (const behaviour of BEHAVIOURS) {
    if (namesAUrl(behaviour.reproduce)) continue;
    for (const flag of Object.values(FLAG_FOR_MODE)) {
      assert.ok(
        !behaviour.reproduce.includes(flag),
        `${behaviour.id} runs against our own bundled page, where every mode is already authorised. `
        + `Printing ${flag} teaches a reader to pass an authorisation that was never withheld.`,
      );
    }
  }
});

/**
 * THE PROOF THAT THE GATE ABOVE CAN GO RED.
 *
 * A rule nobody has watched fail is a rule nobody has tested. Both defects that shipped are
 * reconstructed here against the real mode table, so this file fails if the assertions above are
 * ever loosened into always-true shapes.
 */
test('the gate fails on the two commands that actually shipped', () => {
  const shipped = 'node bin/ninthtool.mjs <your url> --behaviour P5';
  assert.notEqual(shipped.match(SHELL_METACHARACTERS), null,
    'the redirection defect must still be caught by the metacharacter rule');

  const withoutFlag = 'node bin/ninthtool.mjs https://your-page.example --behaviour P5';
  const needed = modesFor(stepsFor(['P5']));
  assert.ok(needed.includes('readonly-call'),
    'P5 must still need readonly-call, or this proof is testing nothing');
  assert.ok(!withoutFlag.includes(FLAG_FOR_MODE['readonly-call']),
    'the flagless command must still be caught by the authorisation rule');
});
