/**
 * The rules that stop the page scrolling sideways on a phone.
 *
 * WHY THIS IS A TEST AND NOT A BROWSER CHECK. Readiness row M8 does measure 375 px in a real
 * browser, but only on the SUCCESS path, where the blocker is hidden. The error path is a layout
 * too, and it is the one a judge on the wrong browser actually sees. Measured on it:
 *
 *   clientWidth 375, scrollWidth 459, blocker 438 wide inside a 333 box, overflow-wrap "normal"
 *
 * The blocker's text is deliberately unbreakable: it quotes `chrome://flags/#enable-webmcp-testing`
 * and a full subject URL, because that screen exists to tell a reader exactly what to type. The
 * strings stay and the box has to break them.
 *
 * A browser cannot be run in a unit test, so this pins the declarations that were missing. The real
 * measurement lives in the readiness gate; this is the cheap guard that fails the moment somebody
 * rewrites the rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..',
);
const css = fs.readFileSync(path.join(ROOT, 'assets/styles.css'), 'utf8');

/** The declaration block for one selector, so a rule elsewhere cannot satisfy the assertion. */
function ruleFor(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} has no rule at all`);
  const close = css.indexOf('}', at);
  return css.slice(at, close);
}

test('the blocker breaks a long unbreakable string instead of widening the page', () => {
  const rule = ruleFor('.blocker');
  assert.match(rule, /overflow-wrap:\s*anywhere/,
    'without this the error path measured scrollWidth 459 inside a 375 px viewport');
  assert.match(rule, /min-width:\s*0/,
    'a grid or flex child with the default min-width: auto refuses to shrink below its content');
});

test('a command block scrolls inside itself rather than pushing the document', () => {
  // The reproduce commands are `white-space: pre` on purpose, because a wrapped command line is a
  // command you cannot copy. That is only safe while the container scrolls.
  const rule = ruleFor('.cmd');
  assert.match(rule, /overflow-x:\s*auto/,
    'the commands are unwrappable by design, so their container has to scroll');
});

test('every grid and flex child that holds text can shrink', () => {
  // min-width: auto is the default and it is why a long word widens a whole grid. These were added
  // after the page was measured at 411 px of document inside a 375 px viewport.
  for (const selector of ['.groups, .cards, .tiles', '.groups > *, .cards > *, .tiles > *, .card > *, .card-top > *']) {
    assert.match(ruleFor(selector), /min-width:\s*0/, `${selector} lost its min-width: 0`);
  }
});

test('the stylesheet never sets a fixed width in pixels on a text container', () => {
  // A `width: 420px` anywhere in a column layout reintroduces the whole class of defect.
  const offenders = css.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /(^|[^-\w])width:\s*\d{3,}px/.test(line) && !/max-width|min-width/.test(line));
  assert.deepEqual(offenders, [], 'a fixed pixel width on a text container cannot survive 375 px');
});
