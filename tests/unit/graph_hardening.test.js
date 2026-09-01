/**
 * The blind spots five adversaries found in the module graph, closed and locked.
 *
 * Thirty four attempts were made to load a file the walk could not see. None worked against the
 * tree as it stood, but several were one edit away, and one was ALREADY OCCUPIED: `subject.html`
 * carries an inline module with two imports the HTML branch never read. Both files were in the
 * manifest only because `app.js` happens to import them too. An import that only the fixture had
 * would have been served unverified with nothing saying so.
 *
 * Each test below builds a throwaway tree in the system temp directory and walks it, so none of
 * them touches the repository. The refusals are asserted as refusals rather than as features: a
 * `<base href>` and a worker are things a browser follows and this cannot, and a gate that cannot
 * see something is better off failing than reporting a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runtimeGraph } from '../../scripts/runtime_graph.mjs';

/** Write a throwaway tree and walk it. Cleaned up whatever happens. */
function walkTree(files, entry = 'index.html') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-graph-'));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const full = path.join(root, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    return runtimeGraph(root, entry);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('an inline module script body is scanned, which is the blind spot that was occupied', () => {
  const { files } = walkTree({
    'index.html': '<html><iframe src="fixtures/subject.html"></iframe></html>',
    'fixtures/subject.html': '<script type="module">\nimport { x } from "../src/only-here.js";\n</script>',
    'src/only-here.js': 'export const x = 1;',
  });
  assert.ok(files.includes('src/only-here.js'),
    'a module imported only from an inline script was invisible, so it would be served unverified');
});

test('a plain inline script is scanned too', () => {
  const { files } = walkTree({
    'index.html': '<script>\nimport("./late.js");\n</script>',
    'late.js': 'export default 1;',
  });
  assert.ok(files.includes('late.js'));
});

test('a root relative path resolves from the origin root, not from the file', () => {
  // isExternal needed two slashes, so a single leading slash fell through to the relative branch
  // and joined into a path that does not exist. The walk then called it unresolved.
  const { files, unresolved } = walkTree({
    'index.html': '<link rel="stylesheet" href="/assets/styles.css">',
    'assets/styles.css': 'body { color: red; }',
  });
  assert.deepEqual(unresolved, []);
  assert.ok(files.includes('assets/styles.css'));
});

test('a protocol relative URL is still external', () => {
  const { files, unresolved } = walkTree({
    'index.html': '<script src="//cdn.example/x.js"></script>',
  });
  assert.deepEqual(unresolved, [], 'an external host must not be reported as a missing local file');
  assert.deepEqual(files, ['index.html']);
});

test('a stylesheet import and a url reference are followed', () => {
  const { files } = walkTree({
    'index.html': '<link rel="stylesheet" href="assets/styles.css">',
    'assets/styles.css': '@import "theme.css";\nbody { background: url("bg.png"); }',
    'assets/theme.css': 'body { color: blue; }',
    'assets/bg.png': 'not really a png',
  });
  assert.ok(files.includes('assets/theme.css'), 'an @import was never followed');
  assert.ok(files.includes('assets/bg.png'), 'a url() reference was never followed');
});

test('a base href is refused rather than guessed at', () => {
  const { refused } = walkTree({
    'index.html': '<base href="https://elsewhere.example/"><script src="src/app.js"></script>',
    'src/app.js': 'export default 1;',
  });
  assert.equal(refused.length, 1);
  assert.match(refused[0], /<base href>/,
    'a base href repoints every relative URL, so the manifest would describe files nobody fetches');
});

test('a worker and a service worker are refused', () => {
  const worker = walkTree({
    'index.html': '<script src="src/app.js"></script>',
    'src/app.js': 'new Worker("./w.js");',
  });
  assert.match(worker.refused.join(' '), /Worker/);

  const service = walkTree({
    'index.html': '<script src="src/app.js"></script>',
    'src/app.js': 'navigator.serviceWorker.register("/sw.js");',
  });
  assert.match(service.refused.join(' '), /service worker/);
});

test('this repository refuses nothing today, and that is asserted rather than assumed', () => {
  const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
  );
  const { refused } = runtimeGraph(ROOT);
  assert.deepEqual(refused, [],
    'the page now does something the graph cannot follow, so the manifest no longer describes '
    + 'everything a browser would fetch');
});

test('media and object references are followed', () => {
  const { files } = walkTree({
    'index.html': '<video src="clip.mp4"></video><object data="thing.svg"></object>',
    'clip.mp4': 'x',
    'thing.svg': '<svg></svg>',
  });
  assert.ok(files.includes('clip.mp4'));
  assert.ok(files.includes('thing.svg'));
});

test('a query string and a fragment do not create a different file', () => {
  const { files, unresolved } = walkTree({
    'index.html': '<script src="src/app.js?v=2#top"></script>',
    'src/app.js': 'export default 1;',
  });
  assert.deepEqual(unresolved, []);
  assert.ok(files.includes('src/app.js'));
});
