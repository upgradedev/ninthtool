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
 * from a variable is invisible to it. `tests/unit/manifest.test.js` asserts that every `src/` file
 * the repository ships is reachable from the page or from the runner, which is how that blind spot
 * is covered: an unreachable module is either dead code or a path this cannot see, and both are
 * findings.
 *
 * WHAT WAS ADDED AFTER FIVE ADVERSARIES ATTACKED IT. Thirty four attempts were made to load a file
 * the walk could not see. None worked against the tree as it stood, but several were one edit away,
 * and one blind spot was already occupied:
 *
 *   inline <script> bodies   `fixtures/subject.html` carries an inline module with two imports that
 *                            this never read. Both files were in the manifest only because
 *                            `app.js` happens to import them too. Now scanned.
 *   root relative paths      `isExternal` needed two slashes, so `/assets/x.css` fell through and
 *                            normalised into nonsense on Windows. Now resolved from the root.
 *   stylesheets             `@import` and `url(...)` were never followed, so a font or a second
 *                            sheet would be served unverified. Now followed.
 *   <base href>             would silently repoint every relative URL on the page. REFUSED.
 *   workers                 a Worker or a service worker loads a script nothing here can see.
 *                            REFUSED.
 *
 * The last two are refusals rather than features. This page does not use them, and a gate that
 * cannot see something is better off failing than guessing.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Extensions whose contents are searched for further references. */
const FOLLOWABLE = new Set(['.html', '.js', '.mjs', '.css']);

/**
 * Anything that is not a path on this origin.
 *
 * A single leading slash is NOT external: it is root relative, and it used to fall through to the
 * relative branch, where joining it to a directory produced a path that does not exist. The walk
 * then recorded it as unresolved instead of following it. Protocol relative `//host/x` still is
 * external, which is why the two cases are separated here.
 */
function isExternal(reference) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(reference);
}

/** A reference that is relative to the origin root rather than to the file that names it. */
function isRootRelative(reference) {
  return reference.startsWith('/') && !reference.startsWith('//');
}

/** References out of an HTML file: what a browser would fetch. */
function referencesInHtml(text) {
  const found = [];
  const patterns = [
    /<script[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+href\s*=\s*["']([^"']+)["']/gi,
    /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<source[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<(?:video|audio|embed)[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<object[^>]+data\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }

  // INLINE MODULE BODIES. `fixtures/subject.html` carries one with two imports, and this branch
  // never read it: those files were in the manifest only because `app.js` imports them too. An
  // import that only the fixture had would have been served unverified.
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const reference of referencesInModule(match[1])) found.push(reference);
  }
  return found;
}

/** References out of a stylesheet. */
function referencesInCss(text) {
  const found = [];
  for (const match of text.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) found.push(match[1]);
  return found;
}

/**
 * Things a browser would follow and this walk cannot, which are refused rather than guessed at.
 *
 * A `<base href>` repoints every relative URL on the page, so the manifest would describe files
 * nobody fetches. A worker loads a script from a string this cannot resolve. Neither is used here,
 * and a gate that cannot see something is better off failing than reporting a pass.
 */
function unfollowable(text, relative) {
  const refusals = [];
  if (/<base\b[^>]*\bhref\s*=/i.test(text)) {
    refusals.push(`${relative} carries a <base href>, which repoints every relative URL on the `
      + 'page. This walk resolves against the file, so the manifest would describe files nobody '
      + 'fetches. Remove it, or teach runtime_graph.mjs to honour it.');
  }
  if (/navigator\.serviceWorker\.register\s*\(/.test(text)) {
    refusals.push(`${relative} registers a service worker, whose script is not in this graph and `
      + 'would be served unverified.');
  }
  if (/new\s+(?:Shared)?Worker\s*\(/.test(text)) {
    refusals.push(`${relative} constructs a Worker, whose script is not in this graph and would be `
      + 'served unverified.');
  }
  return refusals;
}

/**
 * Remove comments before looking for imports.
 *
 * WHY. A docblock in `behaviours.js` shows a reader how to recount a number:
 * `node -e "import('./src/judge/behaviours.js')..."`. The dynamic import pattern matched it, the
 * path resolved relative to `src/judge/` into a file that does not exist, and the build stopped on
 * a reference nothing actually loads. A walker that reads commented imports invents files, and
 * would equally miss a real import somebody had wrapped in a comment while debugging.
 *
 * This is a scanner, not a lexer. It tracks single quotes, double quotes, backticks and both
 * comment forms, which is enough for the files in this repository and is asserted by
 * tests/unit/graph_hardening.test.js. It does not understand regular expression literals, so a
 * comment character inside one would confuse it. If that ever matters, the fix is a real lexer,
 * and the test that fails will say so.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1; continue;
    }
    // inside a string
    if (c === '\\') { out += c + (next === undefined ? '' : next); i += 2; continue; }
    if (c === mode) mode = 'code';
    out += c; i += 1;
  }
  return out;
}

/** References out of a module: static and dynamic imports, and re-exports. */
function referencesInModule(source) {
  const text = stripComments(source);
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
 * @returns {{files: string[], unresolved: Array<{from: string, reference: string}>,
 *            refused: string[]}}
 */
export function runtimeGraph(root, entry = 'index.html') {
  const seen = new Set();
  const unresolved = [];
  const refused = [];
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
    for (const refusal of unfollowable(text, relative)) refused.push(refusal);

    let references;
    if (extension === '.html') references = referencesInHtml(text);
    else if (extension === '.css') references = referencesInCss(text);
    else references = referencesInModule(text);

    for (const reference of references) {
      if (isExternal(reference) || reference.startsWith('data:')) continue;
      const bare = reference.split('?')[0].split('#')[0];
      if (!bare) continue;
      const resolved = path
        .normalize(isRootRelative(bare) ? bare.slice(1) : path.join(path.dirname(relative), bare))
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

  return { files: [...seen].sort(), unresolved, refused };
}
