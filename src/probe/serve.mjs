/**
 * The loopback server the runner starts when no URL is given, and the allowlist that decides what
 * it will hand out.
 *
 * IT USED TO SERVE THE WHOLE CHECKOUT. Anything under the repository root that existed was fair
 * game: `.git/config`, every script, every test, and any untracked file somebody had left in the
 * tree. It binds a loopback port so the exposure was to this machine, and that is still not a
 * reason to publish a checkout to a browser being driven by a script.
 *
 * THE ALLOWLIST ALREADY EXISTED. `runtime-manifest.json` is built by walking the module graph from
 * index.html, so it is exactly the set of files a browser legitimately needs, and it is derived
 * rather than maintained. Serving that set plus the manifest itself needs no second list and cannot
 * drift from what the page loads.
 *
 * CONTAINMENT USES path.relative, NOT startsWith. A prefix test is not segment aware: a sibling
 * directory called `ninthtool-evil` starts with `ninthtool`. And the stat is an lstat, so a symlink
 * pointing out of the tree is refused rather than followed.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { buildManifest } from '../../scripts/build_manifest.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * What this server will hand out: every file the page loads, plus the manifest that says so.
 * @param {string} root
 * @returns {Set<string>}
 */
export function allowlistFor(root) {
  const manifest = buildManifest(root);
  return new Set([...Object.keys(manifest.files), 'runtime-manifest.json']);
}

/**
 * Decide one request without doing any I/O beyond a stat, so it can be tested without a socket.
 *
 * @param {string} root
 * @param {Set<string>} allowed
 * @param {string} url the raw request url
 * @returns {{status: number, file: (string|null), said: string}}
 */
export function resolveRequest(root, allowed, url) {
  let wanted;
  try { wanted = decodeURIComponent(String(url).split('?')[0].split('#')[0]); }
  catch { return { status: 400, file: null, said: 'bad request' }; }

  const relative = wanted === '/' ? 'index.html' : wanted.replace(/^\/+/, '');
  if (!allowed.has(relative)) {
    return {
      status: 404,
      file: null,
      said: 'not served: this server publishes only the files runtime-manifest.json lists',
    };
  }

  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    return { status: 403, file: null, said: 'outside the served root' };
  }
  let stat;
  try { stat = fs.lstatSync(target); } catch { return { status: 404, file: null, said: 'not found' }; }
  if (!stat.isFile()) return { status: 404, file: null, said: 'not a file' };

  return { status: 200, file: target, said: 'ok' };
}

/**
 * Start the server on a free loopback port.
 * @param {string} root
 * @returns {Promise<{server: object, origin: string, allowed: Set<string>}>}
 */
export async function serveRuntime(root) {
  const allowed = allowlistFor(root);
  const server = http.createServer((req, res) => {
    const decision = resolveRequest(root, allowed, req.url);
    if (decision.status !== 200) {
      res.writeHead(decision.status);
      res.end(decision.said);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(decision.file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(decision.file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, allowed };
}

/**
 * Hold this process open until something terminates it.
 *
 * WHY --keep-open NEEDED THIS. The runner has two surfaces a reader might want to keep: the
 * browser it started, and the loopback origin that browser is reading. Both die with this process,
 * and the runner used to call process.exit() unconditionally, so --keep-open closed the very
 * things it promised to leave running. Not exiting is most of the fix, but it is not all of it: a
 * run given a URL of its own starts no server, so with nothing left listening the event loop would
 * drain and the process would end anyway, a second or two later, for a different reason.
 *
 * A timer that never usefully fires is the whole mechanism. It is deliberately not unref'd,
 * because holding the loop open is the entire point.
 *
 * @returns {{release: function(): void}} release lets the process end again
 */
export function keepAlive() {
  const timer = setInterval(() => {}, 1 << 30);
  return { release() { clearInterval(timer); } };
}
