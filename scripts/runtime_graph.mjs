/**
 * Every file the live page actually loads, discovered by walking from `index.html` rather than
 * listed by hand.
 *
 * WHY IT IS DERIVED AND NOT WRITTEN DOWN. This repository has been bitten twice by a gate whose
 * scope was a hand-maintained list: the style gate silently stopped covering three directories, and
 * the deployment parity row checked exactly one file, `behaviours.js`, while eight others were
 * served unverified. A list somebody has to remember to update is a list that goes stale the first
 * time somebody is in a hurry.
 *
 * So the graph starts at the page and follows what the browser would follow:
 *
 *   index.html          script src, link href, iframe src
 *   any .html reached   the same three
 *   any .js or .mjs     static `import ... from '...'` and dynamic `import('...')`
 *
 * A new module reached by a new import joins the manifest on the next build with nobody deciding
 * anything. A file that stops being imported leaves it. That is the property worth having.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not execute anything, so a path assembled at runtime
 * from a variable is invisible to it. `tests/unit/runtime_graph.test.js` asserts that every
 * `src/` file the repository ships is reachable from the page, which is how that blind spot is
 * covered: an unreachable module is either dead code or a path this cannot see, and both are
 * findings.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Extensions whose contents are searched for further references. */
const FOLLOWABLE = new Set(['.html', '.js', '.mjs']);

/** Anything that is not a relative path on this origin. */
function isExternal(reference) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(reference);
}

/** References out of an HTML file: what a browser would fetch. */
function referencesInHtml(text) {
  const found = [];
  const patterns = [
    /<script[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+href\s*=\s*["']([^"']+)["']/gi,
    /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** References out of a module: static and dynamic imports, and re-exports. */
function referencesInModule(text) {
  const found = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/**
 * Walk the graph from an entry point.
 *
 * @param {string} root absolute path to the repository root
 * @param {string} [entry] relative path to start from
 * @returns {{files: string[], unresolved: Array<{from: string, reference: string}>}}
 */
export function runtimeGraph(root, entry = 'index.html') {
  const seen = new Set();
  const unresolved = [];
  const queue = [entry];

  while (queue.length) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      unresolved.push({ from: relative, reference: relative });
      continue;
    }
    seen.add(relative);

    const extension = path.extname(relative);
    if (!FOLLOWABLE.has(extension)) continue;

    const text = fs.readFileSync(absolute, 'utf8');
    const references = extension === '.html' ? referencesInHtml(text) : referencesInModule(text);
    for (const reference of references) {
      if (isExternal(reference) || reference.startsWith('data:')) continue;
      const resolved = path
        .normalize(path.join(path.dirname(relative), reference.split('?')[0].split('#')[0]))
        .split(path.sep).join('/');
      if (resolved.startsWith('..')) {
        unresolved.push({ from: relative, reference });
        continue;
      }
      if (!fs.existsSync(path.join(root, resolved))) {
        unresolved.push({ from: relative, reference });
        continue;
      }
      queue.push(resolved);
    }
  }

  return { files: [...seen].sort(), unresolved };
}
