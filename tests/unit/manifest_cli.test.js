/**
 * `node scripts/build_manifest.mjs` as a command, rather than as four functions somebody else calls.
 *
 * WHY THE COMMAND NEEDS ITS OWN FILE. tests/unit/manifest.test.js imports the exports and drives
 * them directly, which leaves the entire command line block, a third of the file, never executed.
 * That block is the only thing that decides what actually lands in `runtime-manifest.json`: the JSON
 * indent, the trailing newline, the refusal to write when the page references a file that is not in
 * the tree. Row R5 of the readiness gate fetches every path in that file from the live origin and
 * compares hashes, so a change to how it is written is a change to the deployment gate, and none of
 * it was covered.
 *
 * HOW A SCRIPT IS RUN INSIDE THE TEST PROCESS. A child process would not be measured by the
 * coverage run, and the point here is to measure it. So the module is imported a second time with a
 * query string, which is a fresh instance, with `process.argv[1]` set to its own path. That is the
 * exact condition the file's own `invokedDirectly` check reads, and `fileURLToPath` drops the query
 * string, so the check sees the real path and the command runs.
 *
 * THE ONE THING THAT IS STOOD IN FOR, AND WHY. `fs.writeFileSync` is replaced for the length of the
 * import, so the command writes into this test instead of over `runtime-manifest.json`. That file is
 * committed, another test asserts it matches the tree, and a test that rewrites its own input is a
 * test that cannot fail. Nothing inside the module is stubbed, patched or bypassed: the manifest is
 * built from the real tree, by the real walk, and the bytes asserted below are the bytes the command
 * produced.
 *
 * WHAT STAYS UNCOVERED, STATED RATHER THAN HIDDEN. The two refusals, for a page that references a
 * missing file and for a page doing something the graph walk cannot follow, need a broken tree. This
 * tree is not broken, and breaking it from a test would mean writing outside tests/. They are named
 * here so the next reader knows the gap is deliberate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'build_manifest.mjs');

/**
 * Run the command in this process and hand back what it wrote and what it said.
 *
 * @returns {Promise<{module: object, written: Array<{file: string, body: string}>, logged: string[]}>}
 */
async function runCommand() {
  const realArgv = process.argv;
  const realWrite = fs.writeFileSync;
  const realLog = console.log;
  const written = [];
  const logged = [];
  let module;
  try {
    process.argv = [realArgv[0], SCRIPT];
    fs.writeFileSync = (file, body) => { written.push({ file: String(file), body: String(body) }); };
    console.log = (...parts) => { logged.push(parts.join(' ')); };
    module = await import(new URL('../../scripts/build_manifest.mjs?cli=1', import.meta.url).href);
  } finally {
    process.argv = realArgv;
    fs.writeFileSync = realWrite;
    console.log = realLog;
  }
  return { module, written, logged };
}

/** One temporary directory, holding whatever the caller wants a manifest reader to find. */
function tempRoot(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-manifest-'));
  if (contents !== undefined) fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), contents);
  return dir;
}

let ran = null;

test('the command writes the manifest that is committed, byte for byte', async () => {
  ran = await runCommand();

  assert.equal(ran.written.length, 1, 'the command wrote something other than one file');
  assert.equal(ran.written[0].file, path.join(ROOT, 'runtime-manifest.json'),
    'the command wrote somewhere other than the manifest the readiness gate reads');

  /*
   * THE ASSERTION THAT MATTERS. Not "it wrote valid JSON", but that running the generator today
   * reproduces the committed file: same key order, same indent, same trailing newline, same nine
   * hashes. Change the indent, drop the newline, add a field or let one hash drift and this goes
   * red, which is correct, because the file on the origin would then differ from the file in the
   * tree and row R5 compares them.
   *
   * LINE ENDINGS ARE NORMALISED ON BOTH SIDES, and only line endings. This repository is developed
   * on Windows with core.autocrlf, so the checked out file holds CRLF while the command writes LF,
   * and that difference is not a difference in what is served. It is the same normalisation
   * `hashOf` applies, for the same measured reason, and it is applied to both sides here rather
   * than to the one that is inconvenient.
   */
  const lf = (text) => text.replace(/\r\n/g, '\n');
  assert.equal(lf(ran.written[0].body),
    lf(fs.readFileSync(path.join(ROOT, 'runtime-manifest.json'), 'utf8')),
    'running the command would change the committed manifest');
  assert.ok(ran.written[0].body.endsWith('\n'),
    'the manifest is written without a trailing newline, which every diff will report for ever');

  const parsed = JSON.parse(ran.written[0].body);
  assert.equal(parsed.entryPoint, 'index.html');
  assert.equal(parsed.fileCount, Object.keys(parsed.files).length,
    'the count the manifest states is not the number of files it lists');
  assert.deepEqual(parsed.unresolved, [],
    'the command wrote a manifest for a page that references a file the tree does not hold');
});

test('the command says what it wrote, and names every path it covered', () => {
  assert.ok(ran, 'the command was never run, so this asserts nothing');
  const parsed = JSON.parse(ran.written[0].body);

  assert.equal(ran.logged[0], `build_manifest: wrote runtime-manifest.json covering ${parsed.fileCount} runtime files.`);
  // Every path, not just the count. A summary line that says nine while listing eight is exactly
  // the shape of report this repository has already been caught publishing.
  const listed = ran.logged.slice(1).map((line) => line.trim());
  assert.deepEqual(listed.sort(), Object.keys(parsed.files).sort());
});

/* --------------------------------------------- the readers the command leans on, at their edges */

test('a directory with no manifest reads as no manifest, and a broken one reads the same way', () => {
  const { readManifest } = ran.module;

  const empty = tempRoot();
  const broken = tempRoot('{ this was half written when the process died');
  const good = tempRoot('{"files":{"a.js":"hash"}}');
  try {
    assert.equal(readManifest(empty), null, 'a missing manifest must read as absent, not throw');
    assert.equal(readManifest(broken), null, 'a manifest that does not parse must read as absent');
    assert.deepEqual(readManifest(good), { files: { 'a.js': 'hash' } });

    // And with no argument it reads this repository, which is the call the command itself makes.
    assert.ok(readManifest().files['index.html'], 'the default root is not this checkout');
  } finally {
    for (const dir of [empty, broken, good]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a manifest with no files section is compared as empty rather than throwing', () => {
  // The shape a hand edited or half written manifest takes. Drift has to be reportable against it,
  // because the whole point of the comparison is that the stored file may be wrong.
  const { manifestDrift } = ran.module;

  assert.deepEqual(manifestDrift({}, {}), [],
    'two manifests with nothing in them differ in nothing');
  assert.deepEqual(manifestDrift({ files: { 'a.js': '1' } }, {}),
    ['a.js is in the graph and not in the manifest']);
  assert.deepEqual(manifestDrift({}, { files: { 'a.js': '1' } }),
    ['a.js is in the manifest and no longer in the graph']);
  assert.deepEqual(manifestDrift({ files: { 'a.js': '1' } }, { files: { 'a.js': '2' } }),
    ['a.js has changed since the manifest was written']);
  assert.deepEqual(manifestDrift({}, null), ['there is no committed manifest at all']);
});

test('a page that loads the manifest does not put the manifest inside itself', () => {
  /*
   * THE SELF REFERENCE, AND WHY IT IS NOT HYPOTHETICAL. `runtime-manifest.json` is served, so
   * anything that made the page fetch it would put it in the graph, and hashing it into itself
   * gives a file whose stored hash is stale the instant it is written. It could never be current
   * and `--check` could never pass again.
   *
   * The skip is one line in the middle of the build loop and the real tree cannot reach it, because
   * index.html does not load the manifest today. So the case is built: a two file page in a
   * temporary directory that does load it, walked by the real graph and hashed by the real builder.
   */
  const { buildManifest } = ran.module;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-selfref-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'),
      '<link rel="manifest" href="runtime-manifest.json">\n<script type="module" src="app.js"></script>\n');
    fs.writeFileSync(path.join(dir, 'app.js'), 'export const nothing = 1;\n');
    fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), '{"files":{}}\n');

    const built = buildManifest(dir);
    assert.deepEqual(Object.keys(built.files).sort(), ['app.js', 'index.html'],
      'the manifest hashed itself, so its own hash is wrong the moment it is written');
    assert.equal(built.fileCount, 2, 'the stated count does not match what was hashed');
    // The page really does reference it, so the skip is what removed it rather than the walk
    // never having found it. Without this line the assertion above would hold for the wrong reason.
    assert.deepEqual(built.unresolved, [], 'the fixture page references something that is not there');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the command instance builds the same manifest whether the root is passed or defaulted', () => {
  // `buildManifest()` with no argument is the call the command makes, and `buildManifest(ROOT)` is
  // the call every other caller makes. They resolve the same tree, so they must agree. If they ever
  // stop agreeing, the file the command writes is not the file the server serves.
  const { buildManifest, hashOf } = ran.module;
  assert.deepEqual(buildManifest(), buildManifest(ROOT));
  assert.equal(buildManifest().files['index.html'],
    hashOf(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')),
    'the manifest entry for the page is not the hash of the page');
});
