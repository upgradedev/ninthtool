/**
 * The coverage gate, handed reports it must reject.
 *
 * A THRESHOLD CHECK IS EXACTLY THE KIND OF CODE THAT QUIETLY STOPS CHECKING. It is a parser and a
 * comparison, both of which go on returning something plausible after they stop being right: a
 * regex that no longer matches yields no rows, no rows yields no findings, and no findings prints
 * PASS. This repository has already shipped a gate that stayed green through a two day outage.
 *
 * So the gate is driven here against reports that are deliberately below the floor, one metric at a
 * time, and against reports that are not reports at all. It also runs the gate's own `--selftest`
 * as a child process and requires exit 0, which is the same shape as the style gate's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCoverage, checkCoverage, checkDeduplicated, selftest, DEFAULT_THRESHOLD } from './coverage_gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'coverage_gate.mjs');

/**
 * Run the gate the way the workflow runs it, and hand back its exit code and everything it said.
 *
 * THE EXIT CODE IS THE PRODUCT. Nothing else in this file can check it, and it is the only part of
 * the gate CI reads. A check whose findings are right and whose exit code is zero is a check that
 * does nothing.
 */
function runGate(text, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-gate-'));
  const file = path.join(dir, 'coverage.txt');
  fs.writeFileSync(file, text);
  try {
    const stdout = execFileSync(process.execPath, [GATE, file, ...args], { encoding: 'utf8' });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A report in the shape node prints, with the numbers under test. */
function report({ lines = '91.00', branches = '88.00', functions = '90.00', extra = [] } = {}) {
  return [
    '# start of coverage report',
    '# --------------------------------------------------',
    '# file                       | line % | branch % | funcs % | uncovered lines',
    '# --------------------------------------------------',
    '# src\\probe\\observe.js       |  99.91 |    95.55 |   96.08 | 101',
    '# src\\judge\\verdict.js       |  99.49 |    83.65 |  100.00 | 505-508',
    ...extra,
    '# --------------------------------------------------',
    `# all files                   |  ${lines} |    ${branches} |   ${functions} |`,
    '# --------------------------------------------------',
    '# end of coverage report',
  ].join('\n');
}

test('the floor is 85, written here as a literal so moving it takes more than one edit', () => {
  // The number is pinned in three places: DEFAULT_THRESHOLD, the `--threshold=85` the workflow
  // passes, and this line. A threshold that lives in one place moves in one commit and nobody
  // reading the diff sees what it used to be.
  assert.equal(DEFAULT_THRESHOLD, 85,
    'the coverage floor moved. STANDARDS says above 85, and .github/workflows/ci.yml passes 85');
});

test('the parser reads the rows and the total out of the shape node prints', () => {
  const { rows, total } = parseCoverage(report());
  assert.deepEqual(total, { file: 'all files', lines: 91, branches: 88, functions: 90 });
  assert.deepEqual(rows.map((row) => row.file), ['src/probe/observe.js', 'src/judge/verdict.js']);
  assert.equal(rows[0].branches, 95.55);
});

test('the parser normalises windows separators, so one floor holds on both checkouts', () => {
  const { rows } = parseCoverage(report());
  assert.ok(rows.some((row) => row.file === 'src/probe/observe.js'),
    'a path written with backslashes did not match a floor written with forward slashes');
});

test('the parser ignores headings, rules and the TAP output around the report', () => {
  const noise = ['ok 1 - a test that passed', '  duration_ms: 3', '# tests 310', report()].join('\n');
  const { rows, total } = parseCoverage(noise);
  assert.equal(total.lines, 91);
  assert.equal(rows.length, 2, `the parser picked up ${rows.map((r) => r.file).join(', ')}`);
});

test('a report above every floor produces no findings', () => {
  const { failures } = checkCoverage(report(), { files: ['src/probe/observe.js'] });
  assert.deepEqual(failures, []);
});

test('each metric below the floor is its own finding, named', () => {
  for (const metric of ['lines', 'branches', 'functions']) {
    const { failures } = checkCoverage(report({ [metric]: '84.99' }));
    assert.equal(failures.length, 1, `${metric}: ${failures.join('; ')}`);
    assert.equal(failures[0], `all files: ${metric} 84.99 is below ${DEFAULT_THRESHOLD}`);
  }
});

test('a floor is a floor: exactly at it passes, a hundredth under it fails', () => {
  assert.deepEqual(checkCoverage(report({ lines: '85.00' })).failures, []);
  assert.equal(checkCoverage(report({ lines: '84.99' })).failures.length, 1);
});

test('a named file below the floor fails even when the total is comfortably above it', () => {
  // THE POINT OF THE SECOND LEVEL. An aggregate can hide a file that fell to nothing, and the file
  // this suite exists to measure is one file.
  const sunk = report().replace('99.91 |    95.55 |   96.08', '45.33 |    54.64 |   57.41');
  assert.deepEqual(checkCoverage(sunk).failures, [],
    'the total alone noticed a file that halved, which means this test proves nothing');
  const { failures } = checkCoverage(sunk, { files: ['src/probe/observe.js'] });
  assert.equal(failures.length, 3, failures.join('; '));
  assert.match(failures[0], /^src\/probe\/observe.js: lines 45.33 is below 85$/);
});

test('a file named as a floor and missing from the report is a failure, not a pass', () => {
  const { failures } = checkCoverage(report(), { files: ['src/probe/gone.js'] });
  assert.deepEqual(failures, ['src/probe/gone.js: no row in the report, so its floor was never checked']);
});

test('a file counted more than once must clear the floor on EVERY instance', () => {
  /*
   * WHY EVERY INSTANCE. Node reports one record per module instance, so a file imported with a
   * query string appears more than once. Reading the best of those rows would let a floor be
   * cleared by adding an instance that happens to cover a lot, which is measuring the harness
   * rather than the code.
   */
  const twice = report({
    extra: [
      '# src\\ui\\app.js               |  95.75 |    90.00 |   90.00 | ',
      '# src\\ui\\app.js               |  38.43 |    58.33 |   36.84 | 94-136',
    ],
  });
  const { failures, duplicates } = checkCoverage(twice, { files: ['src/ui/app.js'] });
  assert.equal(duplicates['src/ui/app.js'], 2);
  assert.equal(failures.length, 3, failures.join('; '));
  for (const failure of failures) {
    assert.match(failure, /instance 2 of 2/,
      'a failing instance was reported without saying which one it was');
  }
});

test('a report with no total is a failure, because a run that printed no summary did not pass', () => {
  // The gate has to go red on a truncated report, an empty file, or a run that crashed before the
  // summary. Green on missing input is how a gate survives an outage.
  for (const text of ['', '# nothing to see', 'ok 1 - a test\n# tests 1\n# fail 0']) {
    const { failures } = checkCoverage(text);
    assert.equal(failures.length, 1, `"${text.slice(0, 20)}" produced ${failures.length} findings`);
    assert.match(failures[0], /carries no "all files" row/);
  }
});

test('per metric floors are independent, so a stricter line floor does not move the others', () => {
  const { failures } = checkCoverage(report({ lines: '86.00', branches: '86.00' }),
    { lines: 90, branches: 85, functions: 85 });
  assert.equal(failures.length, 1, failures.join('; '));
  assert.match(failures[0], /^all files: lines 86.00 is below 90$/);
});

test('--only-files holds the named files and leaves the aggregate to its own run', () => {
  // IT REMOVES NO CHECK. The workflow runs the file floor and then the aggregate, both blocking,
  // so this only decides which step carries which failure.
  const sunk = report({ lines: '10.00', branches: '10.00', functions: '10.00' });
  const onlyFiles = checkCoverage(sunk, { files: ['src/probe/observe.js'], onlyFiles: true });
  assert.deepEqual(onlyFiles.failures, [], onlyFiles.failures.join('; '));

  const withTotal = checkCoverage(sunk, { files: ['src/probe/observe.js'] });
  assert.equal(withTotal.failures.length, 3,
    'the aggregate went unchecked when nobody asked for --only-files');
});

test('--only-files still fails on a named file, and still fails on a report with no total', () => {
  const sunk = report().replace('99.91 |    95.55 |   96.08', '45.33 |    54.64 |   57.41');
  assert.equal(checkCoverage(sunk, { files: ['src/probe/observe.js'], onlyFiles: true }).failures.length, 3);
  assert.match(checkCoverage('', { onlyFiles: true }).failures[0], /carries no "all files" row/);
});

test('the gate\'s own selftest passes in process', () => {
  assert.equal(selftest(), true);
});

/* ------------------------------------------------------------------ the command CI actually runs */

test('the gate exits zero on --selftest', () => {
  const out = execFileSync(process.execPath, [GATE, '--selftest'], { encoding: 'utf8' });
  assert.match(out, /coverage gate selftest: PASS/);
});

test('the gate exits zero on a report above the floor, and says what it read', () => {
  const { code, output } = runGate(report(), ['--threshold=85', '--file=src/probe/observe.js']);
  assert.equal(code, 0, output);
  assert.match(output, /all files 91.00 lines, 88.00 branches, 90.00 functions, over 2 rows/);
  assert.match(output, /src\/probe\/observe.js 99.91 lines/);
  assert.match(output, /PASS, every floor held/);
});

test('the gate exits ONE on a report below the floor, and attributes the gap by filename', () => {
  const { code, output } = runGate(report({
    lines: '81.14',
    extra: [
      '# src\\ui\\app.js               |  38.43 |    58.33 |   36.84 | 94-136',
      '# src\\ui\\app.js               |  47.24 |    57.69 |   36.36 | 94-136',
    ],
  }), ['--threshold=85']);
  assert.equal(code, 1, 'a report below the floor did not fail the build');
  assert.match(output, /coverage gate: FAIL/);
  assert.match(output, /all files: lines 81.14 is below 85/);
  assert.match(output, /the rows carrying the gap, worst first/);
  assert.match(output, /38.43 L\s+58.33 B\s+36.84 F\s+src\/ui\/app.js/);
  assert.match(output, /2 rows for src\/ui\/app.js/,
    'a file counted twice was not named as counted twice, so the gap looks unexplained');
});

test('the gate exits ONE when a named file falls, even with --only-files', () => {
  const sunk = report().replace('99.91 |    95.55 |   96.08', '45.33 |    54.64 |   57.41');
  const { code, output } = runGate(sunk, ['--only-files', '--file=src/probe/observe.js']);
  assert.equal(code, 1, output);
  assert.match(output, /src\/probe\/observe.js: lines 45.33 is below 85/);
});

test('the gate exits TWO when it was given nothing to read, which is not a pass', () => {
  let missing = 0;
  try {
    execFileSync(process.execPath, [GATE, 'a-file-that-is-not-there.txt'], { stdio: 'pipe' });
  } catch (error) { missing = error.status; }
  assert.equal(missing, 2, 'a missing report was not distinguished from a report that passed');

  let noArgs = 0;
  try {
    execFileSync(process.execPath, [GATE], { stdio: 'pipe' });
  } catch (error) { noArgs = error.status; }
  assert.equal(noArgs, 2, 'the gate run with no arguments at all reported success');
});

test('a threshold passed on the command line is the one enforced', () => {
  const text = report({ lines: '86.00' });
  assert.equal(runGate(text, ['--threshold=85']).code, 0);
  assert.equal(runGate(text, ['--threshold=90']).code, 1,
    'a floor given on the command line was ignored in favour of the default');
  assert.equal(runGate(text, ['--lines=90']).code, 1, 'a per metric floor was ignored');
  assert.equal(runGate(text, ['--branches=99']).code, 1);
});

/* ------------------------------------------- the aggregate that counts each file once */

/*
 * THE RAW `all files` ROW IS NOT A COVERAGE MEASUREMENT ON THIS TREE.
 *
 * Node writes one record per module INSTANCE. `ui_state.test.js` imports `src/ui/app.js?fresh=N`
 * once per mount, and `manifest_cli.test.js` imports `scripts/build_manifest.mjs` a second time to
 * run its command line block, so those two files contribute several records each. The aggregate
 * therefore moves when a test adds an instance, which makes it a number about the harness.
 * Measured on 369c769: raw 81.65 lines, one record per file 96.74. Both figures have moved since,
 * which is the point of them being dated, and the gate prints today's pair on every run.
 *
 * These pin the deduplicated reading, including that it can still fail and that it never hides a
 * weak file inside an average.
 */
test('the deduplicated aggregate counts a repeated file once', () => {
  const report = [
    '# file      | line % | branch % | funct % |',
    '# src/a.js  |  90.00 |    90.00 |   90.00 |',
    '# src/a.js  |  40.00 |    40.00 |   40.00 |',
    '# src/a.js  |  40.00 |    40.00 |   40.00 |',
    '# src/b.js  | 100.00 |   100.00 |  100.00 |',
    '# all files |  55.00 |    55.00 |   55.00 |',
  ].join('\n');
  const d = checkDeduplicated(report, { threshold: 85 });
  assert.deepEqual(d.failures, [], JSON.stringify(d.mean));
  assert.equal(d.duplicates['src/a.js'], 3, 'the duplication must be reported, not silently folded');
  assert.equal(d.mean.lines, 95, 'the best record per file is what the average is built from');
});

test('the deduplicated aggregate still fails when the files are genuinely thin', () => {
  const report = [
    '# file      | line % | branch % | funct % |',
    '# src/a.js  |  50.00 |    50.00 |   50.00 |',
    '# src/b.js  |  60.00 |    60.00 |   60.00 |',
    '# all files |  55.00 |    55.00 |   55.00 |',
  ].join('\n');
  const d = checkDeduplicated(report, { threshold: 85 });
  assert.ok(d.failures.length >= 3, `a thin suite passed: ${JSON.stringify(d)}`);
  assert.match(d.failures[0], /averages 55\.00 across 2 files/);
});

test('a file below the floor is named even when the average clears it', () => {
  // THE HIDING PROBLEM. An average lets one weak file shelter behind strong ones, so the weak ones
  // are listed by name and the caller prints them.
  const report = [
    '# file      | line % | branch % | funct % |',
    '# src/a.js  |  20.00 |    20.00 |   20.00 |',
    '# src/b.js  | 100.00 |   100.00 |  100.00 |',
    '# src/c.js  | 100.00 |   100.00 |  100.00 |',
    '# src/d.js  | 100.00 |   100.00 |  100.00 |',
    '# src/e.js  | 100.00 |   100.00 |  100.00 |',
    '# src/f.js  | 100.00 |   100.00 |  100.00 |',
    '# all files |  86.00 |    86.00 |   86.00 |',
  ].join('\n');
  const d = checkDeduplicated(report, { threshold: 85 });
  assert.deepEqual(d.failures, [], 'the average clears the floor, so this must not fail');
  assert.deepEqual(d.filesBelow, ['src/a.js'], 'the weak file must be named');
});

test('a report with no file rows fails rather than averaging nothing', () => {
  const d = checkDeduplicated('# nothing useful here', { threshold: 85 });
  assert.ok(d.failures.length > 0);
  assert.match(d.failures[0], /named no files/);
});
