/**
 * The workflow files are structurally sound.
 *
 * WHY THIS IS A TEST. A malformed workflow does not fail loudly. It fails in zero seconds, is shown
 * by filename rather than by name, and `gh run view --log-failed` answers "log not found". There is
 * no output to read because nothing ever started.
 *
 * It happened here: a JavaScript regex went inside a shell double-quoted string inside a YAML block
 * scalar, three levels of escaping, and the `\r\n` became two real newlines. That terminated the
 * shell string mid-line and the file stopped being YAML. Every gate in the repository was green and
 * the gate that measures the deployment simply was not running.
 *
 * Node has no YAML parser and this repository has no dependencies, so this does not parse YAML. It
 * checks the two things that actually broke: the top level keys are present at column zero, and no
 * line leaves a double quote open. The second is what caught the real bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const DIR = path.join(ROOT, '.github/workflows');

const workflows = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

test('there are workflow files to check', () => {
  assert.ok(workflows.length >= 2, `found ${workflows.length} workflow files`);
});

for (const file of workflows) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  const lines = text.split(/\r?\n/);

  test(`${file} has its top level keys at column zero`, () => {
    for (const key of ['name:', 'on:', 'jobs:']) {
      assert.ok(
        lines.some((l) => l.startsWith(key)),
        `${file} has no top level "${key}". A workflow missing one is not a workflow, and GitHub `
        + 'reports that by failing in zero seconds with no log at all.',
      );
    }
  });

  test(`${file} leaves no double quote open on any line`, () => {
    // The check that would have caught the real bug. An escaped \\r\\n became two real newlines
    // inside a shell string, so one line ended with an odd number of quotes and the file stopped
    // being YAML. Escaped quotes are discounted before counting.
    const offenders = [];
    lines.forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      const quotes = (line.replace(/\\"/g, '').match(/"/g) || []).length;
      if (quotes % 2 !== 0) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 70)}`);
    });
    assert.deepEqual(offenders, [], 'these lines leave a double quote open');
  });

  test(`${file} has no lone carriage return inside a line`, () => {
    assert.ok(!/[^\r]\r[^\n]/.test(text), `${file} holds a lone CR, which will confuse the shell`);
  });

  test(`${file} indents every step consistently`, () => {
    const stepLines = lines.filter((l) => /^\s+- (name|uses):/.test(l));
    assert.ok(stepLines.length > 0, `${file} declares no steps`);
    const indents = [...new Set(stepLines.map((l) => l.match(/^(\s*)/)[1].length))];
    assert.equal(indents.length, 1,
      `${file} mixes step indentation at ${indents.join(' and ')} spaces, which YAML will read as `
      + 'different lists');
  });
}

test('the readiness workflow does not run on pull requests', () => {
  // Deliberate, and asserted so it is not "fixed" by somebody who has not read why. It measures the
  // DEPLOYED submission, and a branch is not deployed.
  const readiness = fs.readFileSync(path.join(DIR, 'readiness.yml'), 'utf8');
  const trigger = readiness.slice(readiness.indexOf('\non:'), readiness.indexOf('permissions:'));
  assert.ok(!/pull_request/.test(trigger),
    'the readiness gate must not run on pull requests: it can only report that a branch is not '
    + 'deployed, which is true and useless, and a gate that fails for a reason nobody can act on '
    + 'is a gate everyone learns to ignore');
});

test('the readiness workflow waits for the manifest before measuring', () => {
  const readiness = fs.readFileSync(path.join(DIR, 'readiness.yml'), 'utf8');
  assert.match(readiness, /runtime-manifest\.json/,
    'the wait step must poll the manifest. Watching one source file said nothing on the commit '
    + 'that added the manifest, and the gate ran against an origin that did not have it yet');
  assert.ok(
    readiness.indexOf('Wait for Pages') < readiness.indexOf('Readiness, live and driven'),
    'the wait must come before the measurement',
  );
});
