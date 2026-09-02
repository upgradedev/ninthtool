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

/**
 * The declaration block for one selector, so a rule elsewhere cannot satisfy the assertion.
 *
 * IT MATCHES THE WHOLE SELECTOR AT A LINE START, NOT A SUBSTRING ANYWHERE.
 *
 * This used to be `css.indexOf(selector + ' {')`, which finds the first place those characters
 * occur and does not care what is in front of them. Measured, not imagined: adding
 * `.blocker-do .cmd { margin: 8px 0; min-width: 0; }` above the real `.cmd` rule made
 * `ruleFor('.cmd')` return the descendant rule, and the assertion that command blocks scroll went
 * red against a stylesheet where they still do. The same shape would equally have hidden a REAL
 * regression behind a narrower rule that happened to sit higher in the file, which is the failure
 * this repository has already been caught by twice with gates that select by content.
 *
 * So the selector is anchored to the start of a line and matched in full.
 */
function openingOf(text, selector) {
  const opening = `${selector} {`;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith(opening)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

function ruleFor(selector) {
  const at = openingOf(css, selector);
  assert.notEqual(at, -1, `${selector} has no rule of its own at the start of a line`);
  const close = css.indexOf('}', at);
  return css.slice(at, close);
}

test('a rule is found by its whole selector and not by a substring of a longer one', () => {
  // The hardening above, proved rather than described, on a sample rather than on the real
  // stylesheet, so it goes on proving it after the stylesheet has changed again.
  const sample = ['.blocker-do .cmd { margin: 8px 0; }', '.cmd { overflow-x: auto; }', ''].join('\n');
  const bySubstring = sample.slice(sample.indexOf('.cmd {'), sample.indexOf('}'));
  assert.ok(!/overflow-x/.test(bySubstring),
    'the sample no longer reproduces the defect, so this test proves nothing');
  assert.match(sample.slice(openingOf(sample, '.cmd')), /overflow-x:\s*auto/,
    'the anchored match must find the rule that owns the selector');
});

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
