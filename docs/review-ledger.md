# Per-file review ledger

One entry for every file in this repository that ships to a user or gates a build. It records what
each file is for, what a defect in it would cost, which test files exercise it, and any weakness the
file or its test already writes down.

**What this is not.** It is not an assessment. No file here is scored, graded or called correct.
Absence of a recorded weakness means nothing was recorded, not that nothing is wrong. Presence of a
test file in a coverage cell means that test loads or runs the file, not that the test is sufficient.

Measured at commit `481d0f2` on branch `docs/per-file-review-ledger`.

## How the line counts were produced

Every `lines` number below is the `wc -l` count from this one command, run from the repository root:

```
wc -l $(git ls-files 'src/*' 'scripts/*' 'bin/*' 'tests/*') index.html fixtures/subject.html assets/styles.css
```

It reports 44 files and `12875 total`. Those 44 files are the scope of this ledger. `wc -l` counts
newlines, so the CRLF working tree on this machine and the LF tree on a runner give the same number.

## How coverage was decided

A test **exercises** a file when it does one of three things:

1. imports it, statically or with a dynamic `import()`;
2. spawns it as a process, or reads its source and evaluates it in a browser;
3. reads its bytes and asserts on the content.

A test that only names the path as a string, inside an assertion about a different module, does
**not** exercise it. That distinction matters here: `manifest.test.js`, `package.test.js`,
`graph_hardening.test.js` and `serve.test.js` all assert over *lists of paths* produced by
`scripts/runtime_graph.mjs`, so a naive `grep -rl <basename> tests/` credits them with covering
about fifteen files each. They cover the graph, not those files.

The checks that produced every coverage cell:

```
grep -rn "^import\|await import(\|require(" tests/            # static and dynamic imports
grep -rn "readFileSync(" tests/                               # byte reads
grep -rn "spawn(" tests/                                      # spawned processes
grep -rl "<basename>" tests/                                  # candidate set, then read by hand
```

The last one is the wide net. Every hit it produced was opened and classified against the three
rules above before it was written into a cell.

**Two things are deliberately not counted as coverage**, because counting them would make the
"no coverage" number zero and therefore useless:

- `tests/unit/modules_parse.test.js` runs `node --input-type=module --check` over every `.js` and
  `.mjs` file under `src`, `src/judge`, `src/probe`, `src/ui`, `scripts`, `bin`, `tests/support` and
  `tests/integration`. That is a blanket syntax check across most of the tree, not coverage of any
  one file's behaviour.
- The runner itself. `npm test` is `node --test tests/unit`, so every file under `tests/unit`
  executes on every run. Executing a test is not the same as having a test.

Both are stated once here and left out of the rows.

## Ships or gates

`package.json` `files` packs `bin`, `src`, `scripts/build_manifest.mjs`, `scripts/runtime_graph.mjs`,
`index.html`, `assets`, `fixtures`, `runtime-manifest.json`, `LICENSE` and `README.md`. So of the 44
files in scope, **15 ship** to anyone who runs `npx`, and **29 gate only**: the four remaining
scripts and all 25 files under `tests/`.

## Index

| Path | Lines | Ships or gates | Exercised by a test |
|---|---|---|---|
| `src/judge/behaviours.js` | 534 | ships | yes |
| `src/judge/verdict.js` | 778 | ships | yes |
| `src/probe/cdp.mjs` | 218 | ships | yes |
| `src/probe/fixture_identity.js` | 217 | ships | yes |
| `src/probe/launch.mjs` | 383 | ships | yes |
| `src/probe/observe.js` | 1150 | ships | yes |
| `src/probe/serve.mjs` | 118 | ships | yes |
| `src/probe/steps.js` | 147 | ships | yes |
| `src/ui/app.js` | 635 | ships | yes |
| `scripts/build_manifest.mjs` | 123 | ships | yes |
| `scripts/runtime_graph.mjs` | 241 | ships | yes |
| `scripts/check_style.mjs` | 168 | gates | **NONE** |
| `scripts/readiness.mjs` | 1423 | gates | yes |
| `scripts/readiness_config.mjs` | 180 | gates | yes |
| `scripts/style_config.mjs` | 69 | gates | yes |
| `bin/ninthtool.mjs` | 431 | ships | yes |
| `index.html` | 178 | ships | yes |
| `fixtures/subject.html` | 178 | ships | yes |
| `assets/styles.css` | 177 | ships | yes |
| `tests/support/transcripts.mjs` | 256 | gates | yes |
| `tests/integration/side_effect_isolation.mjs` | 220 | gates | **NONE** |
| `tests/unit/cdp.test.js` | 506 | gates | **NONE** |
| `tests/unit/decidability.test.js` | 91 | gates | **NONE** |
| `tests/unit/fixture_ownership.test.js` | 173 | gates | **NONE** |
| `tests/unit/flagship.test.js` | 136 | gates | **NONE** |
| `tests/unit/graph_hardening.test.js` | 176 | gates | **NONE** |
| `tests/unit/group_copy.test.js` | 82 | gates | **NONE** |
| `tests/unit/keep_open.test.js` | 203 | gates | **NONE** |
| `tests/unit/launch.test.js` | 468 | gates | **NONE** |
| `tests/unit/layout.test.js` | 66 | gates | **NONE** |
| `tests/unit/manifest.test.js` | 128 | gates | **NONE** |
| `tests/unit/modules_parse.test.js` | 52 | gates | **NONE** |
| `tests/unit/p5_causality.test.js` | 125 | gates | **NONE** |
| `tests/unit/package.test.js` | 91 | gates | **NONE** |
| `tests/unit/profile_cleanup.test.js` | 333 | gates | **NONE** |
| `tests/unit/readiness_selftest.test.js` | 231 | gates | **NONE** |
| `tests/unit/readiness_thresholds.test.js` | 128 | gates | **NONE** |
| `tests/unit/safety.test.js` | 381 | gates | **NONE** |
| `tests/unit/serve.test.js` | 105 | gates | **NONE** |
| `tests/unit/style_coverage.test.js` | 68 | gates | **NONE** |
| `tests/unit/ui_state.test.js` | 771 | gates | **NONE** |
| `tests/unit/verdict.test.js` | 126 | gates | **NONE** |
| `tests/unit/verdict_mutations.test.js` | 515 | gates | **NONE** |
| `tests/unit/workflows.test.js` | 96 | gates | **NONE** |

A test file with **NONE** in that column is a runner, not something to be run against. The summary
at the bottom keeps the two kinds of NONE apart.

---

## `src/`

### `src/judge/behaviours.js`

- **Lines**: 534
- **Responsible for**: the catalogue of all 20 behaviours as pure data, imported by the judge, the
  page, the command line runner and the tests so one row cannot say two different things.
- **If it were wrong**: a row's group, subject or expected value is the input to every verdict, so a
  mislabelled row turns a browser fact into a page defect on the live page, in the README and in the
  printed report at once. `EXPECTED_CATALOGUE_ROWS` is pinned at 20 in `scripts/readiness_config.mjs`
  line 87, so a row added or removed here also moves a readiness threshold.
- **Coverage**: `tests/unit/decidability.test.js`, `flagship.test.js`, `group_copy.test.js`,
  `readiness_selftest.test.js`, `readiness_thresholds.test.js`, `safety.test.js`, `ui_state.test.js`,
  `verdict.test.js`, `verdict_mutations.test.js`. All nine import it by name.
- **Known weakness**: its own docblock (lines 5 to 8) records that the README is hand written rather
  than generated from this file, so the two are kept in step by `flagship.test.js` failing on a
  drift rather than by there being one source.

### `src/judge/verdict.js`

- **Lines**: 778
- **Responsible for**: turning a transcript into a verdict. Its docblock states nothing else in the
  repository decides anything.
- **If it were wrong**: this is the only thing that produces a pass, a fail or a `not-applicable`,
  so a wrong rule here is a wrong answer on the page, in the CLI report and in the exit code, with
  no second opinion anywhere to disagree with it.
- **Coverage**: `tests/unit/verdict.test.js` (both bounding transcripts),
  `tests/unit/verdict_mutations.test.js` (every rule broken once and required to turn red),
  `tests/unit/p5_causality.test.js`, and `tests/integration/side_effect_isolation.mjs` imports
  `judge` directly.
- **Known weakness**: lines 26 to 31 record a deliberate duplication. The fixture form tool name
  `nt_form_answers` is declared here rather than imported from the probe, so that this module stays
  reachable without a browser, and a test asserts the two spellings agree.

### `src/probe/cdp.mjs`

- **Lines**: 218
- **Responsible for**: the only Chrome DevTools Protocol client here, speaking WebSocket frames
  itself because Node 20 ships no client and this repository installs nothing.
- **If it were wrong**: `tests/unit/cdp.test.js` lines 5 to 9 state the failure shape. A wrong offset
  in the message pump does not crash, it drops a message or splices two together, and the run
  continues and reports fewer behaviours than it saw.
- **Coverage**: `tests/unit/cdp.test.js` imports `Session`, `openSession` and `evaluateInPage`;
  `tests/integration/side_effect_isolation.mjs` imports `openSession` and drives a real Chrome.
- **Known weakness**: its docblock names it as a reused component carried over from an earlier
  project of the same author, listed in the README under reused components. `cdp.test.js` records
  that before it existed there was no Chrome in the 146 tests that came before, so nothing was
  looking at the pump at all.

### `src/probe/fixture_identity.js`

- **Lines**: 217
- **Responsible for**: proving that a page about to have a form submitted on it is the fixture this
  repository ships, through four independent checks read before anything is written.
- **If it were wrong**: three catalogue rows submit a form, which is a write on somebody else's
  page. The docblock records this already happening: an audit pointed the runner at an unrelated
  page that declared the public tool name `nt_form_answers` and watched it get submitted twice.
- **Coverage**: `tests/unit/fixture_ownership.test.js` and `tests/unit/safety.test.js` both import
  it; `tests/integration/side_effect_isolation.mjs` reads its source (line 101) and evaluates it in
  a real page.
- **Known weakness**: the docblock states plainly that none of the four checks is sufficient on its
  own, that three of them are copyable from a public repository, and that the fourth cannot be read
  without writing first, which is why writing is bound to a fixture the runner owns.

### `src/probe/launch.mjs`

- **Lines**: 383
- **Responsible for**: finding a Chromium browser, starting it with WebMCP on, waiting until it
  answers, and taking the throwaway profile away afterwards.
- **If it were wrong**: `tests/unit/launch.test.js` lines 4 to 8 record the measured failure. A run
  once attached to the initial blank document, found no WebMCP on it, and reported every behaviour
  unobserved. Nought measurements is an instrument failure that looks like a clean report.
- **Coverage**: `tests/unit/launch.test.js` imports `findChrome`, `waitForDebugger`,
  `waitForPageTarget`, `targetFor`, `waitForDocument`; `tests/unit/profile_cleanup.test.js` imports
  `removeProfile`, `registerTeardown`, `TERMINATION_SIGNALS` and also spawns a generated script that
  imports this module; `tests/integration/side_effect_isolation.mjs` imports four of its functions.
- **Known weakness**: the docblock records that two callers previously held a copy each and the
  copies disagreed about the debugger timeout, 4000 ms against 2500 ms, and the shorter one failed
  on a CI runner. `launch.test.js` lines 11 to 14 record that its session is a scripted double and
  the global `fetch` is replaced, so no browser starts in the unit tests.

### `src/probe/observe.js`

- **Lines**: 1150
- **Responsible for**: running inside a document, exercising that document's WebMCP surface, and
  returning a transcript. Its docblock states it decides nothing.
- **If it were wrong**: it is the only source of the evidence every verdict rests on, and it runs
  inside a page it does not own. A mistake here is either a wrong transcript that the judge then
  faithfully turns into a wrong verdict, or a side effect on a stranger's page.
- **Coverage**: `tests/unit/fixture_ownership.test.js` and `tests/unit/p5_causality.test.js` import
  `observeAll`; `tests/unit/verdict_mutations.test.js` line 281 dynamically imports
  `FIXTURE_FORM_ANSWERS` and line 445 reads the file as text;
  `tests/integration/side_effect_isolation.mjs` reads its source (line 102) and runs it in Chrome.
- **Known weakness**: the docblock claims it has no code path that could write anywhere, and calls
  that a property of the file rather than a setting. It is a claim about the whole 1150 lines, and
  the end to end check on it needs a browser, so it is only asserted in the CI `integration` job.

### `src/probe/serve.mjs`

- **Lines**: 118
- **Responsible for**: the loopback server the runner starts when no URL is given, and the allowlist
  of what it will hand out.
- **If it were wrong**: the docblock records what it used to do. Anything under the repository root
  was fair game, including `.git/config`, every script and every untracked file. The allowlist is
  now `runtime-manifest.json`, so a defect here republishes a checkout to a browser being driven by
  a script.
- **Coverage**: `tests/unit/serve.test.js` imports `allowlistFor` and `resolveRequest` and asserts
  both halves, what is served and what is refused by name.
- **Known weakness**: its containment uses `path.relative` and an `lstat` rather than a `startsWith`
  prefix test, and the docblock says why. A prefix test is not segment aware, so a sibling directory
  called `ninthtool-evil` starts with `ninthtool`.

### `src/probe/steps.js`

- **Lines**: 147
- **Responsible for**: declaring, as data, what each behaviour needs in order to be observed and
  which of the four modes it runs in, from `metadata` up to `fixture-form`.
- **If it were wrong**: the mode table is what the runner refuses against before Chrome launches. The
  docblock records the incident that produced the file: `--behaviour A1` ran all twenty probes and
  only filtered the printed report, so selecting one behaviour selected nothing at all, and a
  stranger's read only handler was called twice.
- **Coverage**: `tests/unit/safety.test.js` imports `STEPS`, `STEP_ORDER`, `stepsFor`,
  `behavioursFrom`, `modesFor`, `refusedModes`, `permittedSteps`, `MODES`;
  `tests/integration/side_effect_isolation.mjs` reads its source (line 100) and runs it in Chrome.
- **Known weakness**: none recorded.

### `src/ui/app.js`

- **Lines**: 635
- **Responsible for**: the live page. It renders the catalogue, runs the audit against the subject
  frame, and publishes this page's own tools so a visitor's agent can do the same without the screen.
- **If it were wrong**: `tests/unit/ui_state.test.js` lines 4 to 9 record two measured defects, both
  in this state machine. A second failing run handed the previous run's counts back to the screen
  and to `nt_run_audit`; and a host that observed nothing was announced as "0 of 20 promises broken"
  with `nt_get_findings` published on the strength of it. `group_copy.test.js` records a third: a
  missing group heading threw inside the render and the page came up with nought cards.
- **Coverage**: `tests/unit/ui_state.test.js` line 204 dynamically imports it with a cache busting
  query so it can be booted more than once; `tests/unit/group_copy.test.js` line 24 and
  `tests/unit/readiness_thresholds.test.js` line 88 read its source and assert on the content;
  `tests/unit/flagship.test.js` lines 94 and 117 read it and assert on the tool names registered in it.
- **Known weakness**: `ui_state.test.js` lines 11 to 13 record that this module exports nothing and
  calls `boot()` at import time, which is why two other tests read its constants out of the source
  as text rather than importing them.

## `scripts/`

### `scripts/build_manifest.mjs`

- **Lines**: 123
- **Responsible for**: generating `runtime-manifest.json`, the deployment identity, listing every
  file the live page loads with a hash of each.
- **If it were wrong**: three things depend on it at once. Readiness row R5 compares the served bytes
  against it, `src/probe/serve.mjs` builds its allowlist from it, and CI fails when the committed
  manifest is stale. A wrong hash makes a live parity gate pass on bytes nobody checked.
- **Coverage**: `tests/unit/manifest.test.js` imports `buildManifest`, `readManifest`,
  `manifestDrift`, `hashOf` and `MANIFEST_PATH`.
- **Known weakness**: the docblock records that newlines are normalised before hashing, and states it
  as a decision rather than convenience. The tree is developed on Windows with `core.autocrlf` while
  GitHub Pages serves LF, so raw byte hashing would fail every row for a difference that is not one.

### `scripts/check_style.mjs`

- **Lines**: 168
- **Responsible for**: the style gate. It walks the declared directories, applies the banned words,
  banned phrases, dash and other project rules per line, prints the number of files scanned, and
  exits non zero on any finding.
- **If it were wrong**: it is one of two gates on judge facing prose, and its failure mode is
  silence. Its own docblock records that a version written with `grep -c` returned 0 on a file that
  genuinely held an em dash, so the gate could not fail at all on this machine.
- **Coverage**: **NONE**. Checked three ways: no test imports it (`grep -rn "^import" tests/`
  returns no hit for `check_style`), no test spawns it (`grep -rn "spawn(" tests/` shows only
  `bin/ninthtool.mjs` and generated scripts), and the single mention of the name anywhere under
  `tests/` is `tests/unit/package.test.js` line 60, which asserts the file is *not* packed by
  `package.json` `files`. Its exported `findingsForLine` has no external caller in the test tree.
  What does exist: `node scripts/check_style.mjs --selftest` runs in the CI `style` job and feeds
  six deliberate samples to the real `findingsForLine`, and
  `tests/unit/style_coverage.test.js` covers the scope list in `style_config.mjs` but not this file.
- **Known weakness**: `style_config.mjs` line 33 puts `check_style.mjs` in `EXEMPT`, so the gate
  never scans itself. The stated reason is that this file contains the banned list and scanning a
  rule against itself finds the rule.

### `scripts/readiness.mjs`

- **Lines**: 1423
- **Responsible for**: the readiness gate. Eighteen rows that answer whether a stranger with no
  account can reach every mandatory artifact right now, including rows that fetch the live URL and
  one that drives it through a real browser.
- **If it were wrong**: this is the gate that is supposed to catch a dead deployment. Its docblock
  cites a nine thousand line gate elsewhere that stayed green through a two day total outage because
  every check read the repository rather than the network. A row that cannot fail turns this into
  the same thing.
- **Coverage**: `tests/unit/readiness_selftest.test.js` imports `ROWS`, `decideM8`, `healthyDrive`,
  `selftestCases`, `greenBaselines` and `runSelftest` and looks rows up by id to call their real
  `decide`; `tests/unit/readiness_thresholds.test.js` imports from it and also reads its source at
  lines 116 and 122.
- **Known weakness**: `.github/workflows/readiness.yml` records in its header that this gate is
  deliberately not run on `pull_request`, because a branch is not deployed, so the deployed surface
  rows are never measured on a branch. `readiness_selftest.test.js` records the defect that produced
  its own existence: the self test held a hand written expression per row, so row M5 could be
  changed to `if (false)` and the self test still printed PASS.

### `scripts/readiness_config.mjs`

- **Lines**: 180
- **Responsible for**: the readiness thresholds, the live URL, the repository name and the tool
  surfaces the gate checks, in one importable place.
- **If it were wrong**: every number the gate judges against comes from here, so a single edit could
  turn a red build green and look like any other diff.
- **Coverage**: `tests/unit/readiness_thresholds.test.js` imports thirteen named exports and asserts
  each number a third time; `tests/unit/readiness_selftest.test.js` imports `STANDING_TOOLS`,
  `FINDINGS_TOOL`, `MAY_ABSTAIN`, `surfaceAtRest`, `surfaceDuringRun`.
- **Known weakness**: none recorded as a weakness. The docblock records the design instead: each
  number is pinned again in `THRESHOLD_FIXTURE` at the bottom of the same file, the validator
  asserts the two agree before running a check, and the test asserts it a third time from outside.

### `scripts/runtime_graph.mjs`

- **Lines**: 241
- **Responsible for**: discovering every file the live page loads by walking imports from
  `index.html`, so the manifest, the server allowlist and the packing check are all derived rather
  than written down.
- **If it were wrong**: three gates take their scope from it. The docblock names two failures caused
  by hand maintained lists in this repository: the style gate silently stopped covering three
  directories, and the deployment parity row checked exactly one file while eight others were served
  unverified.
- **Coverage**: `tests/unit/graph_hardening.test.js`, `tests/unit/manifest.test.js` and
  `tests/unit/package.test.js` all import `runtimeGraph`.
- **Known weakness**: the docblock states what it cannot see. It executes nothing, so a path
  assembled at run time from a variable is invisible to it. `graph_hardening.test.js` records that
  thirty four attempts were made against it, that a `<base href>` and a worker are refused rather
  than followed, and that `fixtures/subject.html` carries an inline module with two imports the HTML
  branch never read.

### `scripts/style_config.mjs`

- **Lines**: 69
- **Responsible for**: the style gate's scope and lists, held apart from the gate so a test can check
  them: scanned directories, scanned extensions, exempt filenames, the other project names, the
  judge facing file list, and the sibling entry rules.
- **If it were wrong**: a directory missing from `SCANNED_DIRS` removes it from the gate while the
  gate still prints PASS. The docblock records this happening for one commit, with `assets/`, `bin/`
  and the workflow files outside the gate.
- **Coverage**: `tests/unit/style_coverage.test.js` imports `SCANNED_DIRS`, `SCANNED_EXTENSIONS` and
  `IGNORED_DIRS`, then walks the tree and fails on a directory holding a scannable file that is not
  listed.
- **Known weakness**: `SCANNED_DIRS` is a flat list of exact directory paths with no recursion, so a
  new nested directory is covered only because `style_coverage.test.js` fails when it appears. Line
  33 exempts this file and `check_style.mjs` from the word rules, for the stated reason that both
  contain the banned list.

## `bin/`

### `bin/ninthtool.mjs`

- **Lines**: 431
- **Responsible for**: the command line runner. It parses the arguments, refuses a mode it was not
  authorised for before launching anything, starts the browser, injects the probe, calls the judge
  and prints the report.
- **If it were wrong**: this is the whole product for anyone who runs the `npx` line in the README,
  and it is the half that holds the authorisation flags. A wrong exit code here also silently
  changes what CI proves, since the e2e job asserts exit 0 for a complete scoped run and exit 2 for
  a bad `--fail-on`.
- **Coverage**: `tests/unit/keep_open.test.js` spawns it twice (lines 109 and 183) with the arguments
  a reader would type; `tests/unit/package.test.js` line 37 reads its first line and asserts the
  shebang.
- **Known weakness**: `keep_open.test.js` records the defect it was written for. `--keep-open`
  promised to leave the browser running and killed it, because `process.exit()` emits `exit` and the
  launcher's cleanup was registered against that event. It also records why the test spawns the real
  runner: a decision extracted into a testable helper proves nothing about whether the runner calls it.

## Static files

### `index.html`

- **Lines**: 178
- **Responsible for**: the live judge URL's page. Masthead, flagship sentence, catalogue container,
  status line, run control and blocker, plus the stylesheet and module tags the graph walk starts from.
- **If it were wrong**: it is the entry point of the module graph, so a broken tag here changes the
  manifest, the server allowlist and the packing check at once. The flagship sentence in it is
  checked against the README and against the bytes the live origin serves.
- **Coverage**: `tests/unit/flagship.test.js` reads it and asserts the flagship sentence word for
  word, the title and the description meta tag; `tests/unit/ui_state.test.js` line 77 reads it to
  build the element list the state machine drives; `tests/unit/readiness_thresholds.test.js` line 104
  reads it and asserts on the tool names.
- **Known weakness**: the flagship sentence exists in three files rather than one, kept in step by a
  test that refuses a drift. The comment at lines 16 to 18 says so in the file.

### `fixtures/subject.html`

- **Lines**: 178
- **Responsible for**: the subject page the suite owns and is allowed to write to. It publishes the
  form tools, carries the build marker, and is what the page loads in a same origin iframe.
- **If it were wrong**: it is the only page three catalogue rows may submit a form on, so its marker
  and tool names are half of the write authorisation. If its identity signals stop matching, those
  rows go unobserved; if they become easier to imitate, the write boundary widens.
- **Coverage**: `tests/unit/safety.test.js` line 233 reads it and asserts on the identity marker;
  `tests/unit/flagship.test.js` line 95 reads it and asserts on the tool names it declares.
- **Known weakness**: `graph_hardening.test.js` lines 5 to 8 record that this file carries an inline
  module with two imports the HTML branch of the walk never read, and that both files were in the
  manifest only because `app.js` happens to import them too. An import that only the fixture had
  would have been served unverified.

### `assets/styles.css`

- **Lines**: 177
- **Responsible for**: the one stylesheet. Light and dark are both defined from tokens on `:root`,
  and the dark block redefines only the tokens.
- **If it were wrong**: the page is the judge facing surface, and the recorded failure is at 375 px
  on the error path, where the blocker text quotes an unbreakable flag URL and a full subject URL.
- **Coverage**: `tests/unit/layout.test.js` reads it at line 26 and asserts the declarations that
  stop sideways scrolling.
- **Known weakness**: `layout.test.js` lines 4 to 8 record that readiness row M8 measures 375 px in a
  real browser but only on the success path, where the blocker is hidden, and that the error path,
  which is the one a judge on the wrong browser sees, is covered only by this file level check. The
  measured numbers are in the docblock: clientWidth 375, scrollWidth 459, blocker 438 wide in a 333 box.

## `tests/`

Every file below has **NONE** in its own coverage cell, for the same reason: nothing in this
repository tests the tests. Where a file runs is stated instead, because that differs.

### `tests/support/transcripts.mjs`

- **Lines**: 256
- **Responsible for**: the two transcripts the judge is measured against, `conforming()` and
  `measuredChrome152()`.
- **If it were wrong**: every assertion about the judge rests on these two objects. A wrong value in
  the measured transcript would make the judge agree with a browser that never behaved that way.
- **Coverage**: exercised by `tests/unit/verdict.test.js`, `tests/unit/verdict_mutations.test.js` and
  `tests/unit/readiness_selftest.test.js`, which import it. It is the one file under `tests/` that
  something else loads.
- **Known weakness**: its docblock records that nothing has ever produced `conforming()`. It is a
  constructed object, not an observation, and it exists so the judge can be shown passing.
  `measuredChrome152()` is transcribed by hand from the seven runs in `docs/evidence.md`.

### `tests/integration/side_effect_isolation.mjs`

- **Lines**: 220
- **Responsible for**: the adversarial end to end check. It points the runner at a page imitating the
  bundled fixture and asserts the counters that must stay at zero.
- **If it were wrong**: it is the only place the central safety claim is checked against a real
  browser and a real hostile page. Everything else about that claim is checked over fake tools.
- **Coverage**: **NONE**, and it is also not run by `npm test`, which is `node --test tests/unit`.
  Nothing imports it: `grep -rn "side_effect_isolation" .` outside the file itself returns three
  hits, `.github/workflows/ci.yml` line 172 which runs it, and two docblock references in
  `cdp.test.js` line 504 and `safety.test.js` line 10. It executes only in the CI `integration` job,
  which fails when the runner has no Chrome.
- **Known weakness**: line 94 records that it inlines the probe "the way `bin/ninthtool.mjs` inlines
  it", so it reproduces the runner's injection rather than spawning the runner. The two could drift.

### `tests/unit/cdp.test.js`

- **Lines**: 506
- **Responsible for**: the frame codec and message pump in `src/probe/cdp.mjs`.
- **If it were wrong**: the pump is the only wire protocol code here and its failures are silent, so
  a weak test here removes the only check on dropped or spliced messages.
- **Coverage**: NONE. Runs in `npm test` and in the CI `tests` job.
- **Known weakness**: its docblock records a deliberate constraint. The fixtures are written out from
  the wire format by hand rather than by calling the module's own `frame()`, because a test whose
  input comes from the code under test agrees with it by construction and can never fail.

### `tests/unit/decidability.test.js`

- **Lines**: 91
- **Responsible for**: the one comparative number the entry makes, computed from the catalogue rather
  than typed, plus the row by row classification behind it.
- **If it were wrong**: the number reaches judge facing prose, so a misclassified row inflates a
  public claim.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: the docblock states the limits of the number itself. It is not a survey, not a
  benchmark against a named product, and it is a property of these twenty rows, so a different
  catalogue would score differently.

### `tests/unit/fixture_ownership.test.js`

- **Lines**: 173
- **Responsible for**: asserting that nothing is written to a page the run cannot prove it owns, and
  that the proof happens before the write.
- **If it were wrong**: the ordering defect it was written for is invisible in the shape of the code,
  so nothing else would catch its return.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. Its docblock records the defect, reproduced in a real browser:
  identity read `trusted true` while `form submissions: 1` had already happened.

### `tests/unit/flagship.test.js`

- **Lines**: 136
- **Responsible for**: asserting the one sentence and the counts are identical on every surface that
  carries them, and that the catalogue and README agree about which rows exist.
- **If it were wrong**: the docblock calls this the cheapest criterion on the board and one already
  lost before, so a weak assertion here restores a discrepancy a judge finds quickly.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. It compares text after whitespace flattening, so it checks the
  sentence is present word for word, not that it is in a sensible place.

### `tests/unit/graph_hardening.test.js`

- **Lines**: 176
- **Responsible for**: the blind spots five adversaries found in the module graph walk, each built as
  a throwaway tree in the system temp directory.
- **If it were wrong**: the walk decides what is hashed, served and packed, so a hole here reopens
  all three.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: the docblock records that the refusals are asserted as refusals rather than as
  features. A `<base href>` and a worker are things a browser follows and the walk cannot.

### `tests/unit/group_copy.test.js`

- **Lines**: 82
- **Responsible for**: asserting every catalogue group has copy on the page, at authoring time.
- **If it were wrong**: the recorded failure is the page rendering nought cards, which the docblock
  calls the worst failure available for a page whose job is to show you something.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: it reads `src/ui/app.js` as text (line 24) rather than importing it, because
  that module boots at import time. A text match is weaker than a value check.

### `tests/unit/keep_open.test.js`

- **Lines**: 203
- **Responsible for**: driving the real command line runner, spawned as a process, to check
  `--keep-open` without a browser.
- **If it were wrong**: it is the only test that runs the shipped entry point as a reader would.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. Its docblock argues the opposite, that spawning the real runner
  is the point, because a decision extracted into a helper proves nothing about whether the runner
  calls it.

### `tests/unit/launch.test.js`

- **Lines**: 468
- **Responsible for**: the launcher's browser discovery, target matcher and two waiters, tested
  without starting a browser.
- **If it were wrong**: the failure it guards is a run attaching to a blank document and reporting
  everything unobserved, which reads as a clean result.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: the docblock records what is faked. The session is a scripted double whose last
  entry repeats for ever, and the global `fetch` is replaced for the length of a single test and
  restored in `t.after`.

### `tests/unit/layout.test.js`

- **Lines**: 66
- **Responsible for**: pinning the CSS declarations that stop the page scrolling sideways at 375 px.
- **If it were wrong**: the error path layout has no other check, since readiness row M8 measures the
  success path.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: the docblock states it directly. A browser cannot be run in a unit test, so
  this pins declarations rather than measuring a rendered page.

### `tests/unit/manifest.test.js`

- **Lines**: 128
- **Responsible for**: asserting the manifest describes this tree, and that every module under `src/`
  is reachable from the page graph or the runner graph.
- **If it were wrong**: a forgotten regeneration would reach a deploy nobody is watching, and readiness
  row R5 would compare the origin against a stale identity.
- **Coverage**: NONE. Runs in `npm test` and in the CI `tests` job.
- **Known weakness**: none recorded. Its reachability test is the stated cover for the static walk's
  blind spot, so it and `runtime_graph.mjs` share an assumption about what "reachable" means.

### `tests/unit/modules_parse.test.js`

- **Lines**: 52
- **Responsible for**: parsing every shipped module with `node --input-type=module --check`.
- **If it were wrong**: the docblock records why it exists. `node --check` parses a file as CommonJS,
  so it accepted a module with a syntax error that shipped and left the page with nought registered
  tools and one console error.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: its directory list is hand written inside the file (`src`, `src/judge`,
  `src/probe`, `src/ui`, `scripts`, `bin`, `tests/support`, `tests/integration`) and `tests/unit` is
  not on it. Its only scope assertion is `files.length >= 12`, which is a floor rather than a
  coverage check, and nothing walks the tree to confirm the list is complete.

### `tests/unit/p5_causality.test.js`

- **Lines**: 125
- **Responsible for**: asserting P5 sees cause rather than coincidence, by sending good, bad, bad,
  good so neither kind of call owns a position.
- **If it were wrong**: the defect it records scored a tool that rejects every second call exactly
  like a tool that validates its input, and the verdict was PASS.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded.

### `tests/unit/package.test.js`

- **Lines**: 91
- **Responsible for**: checking `package.json` against the tree it describes, including that
  everything both graphs load is packed and that tests, workflows and the gates are not.
- **If it were wrong**: the docblock names the landing place. A runtime module left out of `files`
  produces a command that resolves, starts, then dies on an import, in front of whoever ran the one
  line the README gives.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. Its docblock says explicitly that neither this nor the CI end to
  end job is enough alone, which is why both exist.

### `tests/unit/profile_cleanup.test.js`

- **Lines**: 333
- **Responsible for**: whether a run actually takes the throwaway browser profile away again, across
  the termination signals.
- **If it were wrong**: both leaks it records were silent. A directory left on disk with nothing
  printed, and a run ended by SIGTERM that never cleaned up at all.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. It spawns a generated script that imports the real launcher, so
  the generated source at lines 181 to 185 is a second place the import list has to stay right.

### `tests/unit/readiness_selftest.test.js`

- **Lines**: 231
- **Responsible for**: asserting the readiness self test proves the real rows, by looking each row up
  by id and calling its own `decide`.
- **If it were wrong**: the recorded defect is a row changed to `if (false)`, incapable of failing on
  any input, while `--selftest` still printed PASS. The printed sentence was false and nothing in the
  repository could tell.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded.

### `tests/unit/readiness_thresholds.test.js`

- **Lines**: 128
- **Responsible for**: pinning each readiness threshold a third time, from outside the gate.
- **If it were wrong**: a threshold edited to make a red build green looks like any other diff, and
  this is the copy that sits outside the file being edited.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. Some of its assertions read `scripts/readiness.mjs` as text
  (lines 116 and 122), so those are string matches against source rather than value checks.

### `tests/unit/safety.test.js`

- **Lines**: 381
- **Responsible for**: the two modules that decide what the suite may touch, `steps.js` and
  `fixture_identity.js`, asserted without a browser.
- **If it were wrong**: both measured incidents it guards produced writes and calls on a page the
  suite did not own, while the README said it never does that.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: its docblock states the boundary. These two modules are pure so it all runs
  without a browser, and the end to end proof against a real hostile page is
  `tests/integration/side_effect_isolation.mjs`, which needs Chrome and runs separately.

### `tests/unit/serve.test.js`

- **Lines**: 105
- **Responsible for**: asserting what the loopback server serves and what it refuses by name.
- **If it were wrong**: the thing it stops is a checkout, including `.git/config`, being handed to a
  scripted browser.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. Its allowlist input is the committed `runtime-manifest.json`
  (line 26), so its refusal assertions are only as current as that file.

### `tests/unit/style_coverage.test.js`

- **Lines**: 68
- **Responsible for**: walking the tree and failing when a directory holding a scannable file is not
  in the style gate's list.
- **If it were wrong**: the recorded failure is three tracked directories outside the gate for one
  commit while it printed PASS over thirteen files.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. It covers the gate's scope only. No test covers the gate's rules
  from outside the gate.

### `tests/unit/ui_state.test.js`

- **Lines**: 771
- **Responsible for**: driving the run state machine in `src/ui/app.js` for real, in Node, with a
  hand built DOM.
- **If it were wrong**: the two defects it records are orderings and neither is visible in the shape
  of the code, so nothing static would find them again.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: the docblock records that `app.js` exports nothing and boots at import time, so
  this file re-imports it with a cache busting query string per mount. That is a test harness
  standing in for a browser, not a browser.

### `tests/unit/verdict.test.js`

- **Lines**: 126
- **Responsible for**: asserting the judge against both bounding transcripts, id by id.
- **If it were wrong**: the docblock gives the reason for the pair. A judge shown only the failing
  transcript might always fail; one shown only the conforming transcript might always pass.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded. One of the two transcripts is constructed rather than observed,
  which `tests/support/transcripts.mjs` records.

### `tests/unit/verdict_mutations.test.js`

- **Lines**: 515
- **Responsible for**: breaking every rule in the judge once, on purpose, and requiring red each time,
  plus a structural assertion that a new catalogue row without a mutation fails this file.
- **If it were wrong**: a check nobody has watched fail is the failure mode the docblock says this
  repository is most likely to have.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: none recorded.

### `tests/unit/workflows.test.js`

- **Lines**: 96
- **Responsible for**: checking the workflow files are structurally sound, after a malformed one
  failed in zero seconds with no log.
- **If it were wrong**: the recorded outcome is every gate green while the gate that measures the
  deployment was not running at all.
- **Coverage**: NONE. Runs in `npm test`.
- **Known weakness**: it states it plainly. Node has no YAML parser and this repository has no
  dependencies, so it does not parse YAML. It checks two things only: top level keys at column zero,
  and no line leaving a double quote open.

---

## Summary

### Files with no direct test coverage

**Shipping or gating files, excluding tests: 1 of 19.**

- `scripts/check_style.mjs`, 168 lines. No test imports it, spawns it or reads its bytes. Its only
  failure proof is the `--selftest` block inside the same file, which does call the real
  `findingsForLine` on six deliberate samples and runs in the CI `style` job.
  `tests/unit/style_coverage.test.js` covers the scope list in `style_config.mjs`, not the rules here.

The other 18 all have at least one test that imports them, spawns them, or reads and asserts on their
bytes, listed per entry above.

**Test files: 24 of 25.** Nothing tests a test, which is expected rather than a gap, and they are
listed separately for that reason. The exception is `tests/support/transcripts.mjs`, which three
tests import. Two of the 24 do not run under `npm test`:

- `tests/integration/side_effect_isolation.mjs` runs only in the CI `integration` job, since
  `npm test` is `node --test tests/unit`. That job fails when the runner has no Chrome, so it is not
  silently skipped.

**Raw total: 25 of 44 files in scope have no test that exercises them.** That number is only
meaningful when partitioned as above, because 24 of the 25 are test files.

### Largest files by line count

From the same `wc -l` command:

| Path | Lines |
|---|---|
| `scripts/readiness.mjs` | 1423 |
| `src/probe/observe.js` | 1150 |
| `src/judge/verdict.js` | 778 |
| `tests/unit/ui_state.test.js` | 771 |
| `src/ui/app.js` | 635 |
| `src/judge/behaviours.js` | 534 |
| `tests/unit/verdict_mutations.test.js` | 515 |
| `tests/unit/cdp.test.js` | 506 |

**Is size a finding here?** Recorded rather than judged, with the counts that bear on it:

- No rule inside this repository sets a line limit. `grep -rn "max-lines\|maxLines" src scripts bin tests` returns
  nothing, there is no linter configuration, and no test asserts a file length.
- `scripts/readiness.mjs` is mostly a table plus prose. `grep -c "^    id: '"` finds 18 row objects, and
  281 of its 1423 lines are comment lines by `grep -c "^\s*\(\*\|//\|/\*\)"`. It has 6 exports. Its
  own docblock states every row is split into a `gather` and a pure `decide`, and
  `readiness_selftest.test.js` looks rows up by id, which is only possible because the rows are data.
- `src/probe/observe.js` has 338 comment lines of 1150 by the same command and 4 exports. It is the
  single file that runs inside somebody else's document, and its central claim, that it has no code
  path that could write anywhere, is a claim over all 1150 lines. That claim gets easier to check the
  smaller the file is, and nothing in the repository records a plan to split it.
- The three largest test files are wide rather than deep: `verdict_mutations.test.js` is one mutation
  per rule and asserts structurally that a new catalogue row without a mutation fails the file, so it
  grows with the catalogue by design.

So: size on its own is not a finding against any rule this repository states. The one entry worth a
second look is `src/probe/observe.js`, because the size interacts with a stated safety property
rather than with readability.

### Observations, out of scope for this ledger to act on

Recorded for whoever owns each area. None was changed.

1. **`scripts/check_style.mjs` is the only shipping or gating file with no external test, and it is
   also exempt from its own scan.** `style_config.mjs` line 33 puts it in `EXEMPT`, for the stated
   reason that it holds the banned list. Both facts are defensible on their own. Together they mean
   the file that decides what judge facing prose may say is neither scanned nor imported by anything
   outside itself, and its only failure proof lives inside it.

2. **`tests/unit/modules_parse.test.js` selects its files from a hand written directory list, which
   is the exact failure class the repository documents twice elsewhere.** `style_config.mjs` and
   `runtime_graph.mjs` both exist because a hand maintained list went stale. This test's list is at
   line 24, `tests/unit` is not on it, and its only scope assertion is `files.length >= 12`.
   `style_coverage.test.js` is the pattern that would fix it: walk the tree, fail on an unlisted
   directory holding a matching file.

3. **The readiness rows skip M9.** `grep -n "^    id: '"` over `scripts/readiness.mjs` returns M1
   to M8, then M10, then R1 to R5 and O1 to O4, 18 rows in total, and
   `grep -rn "M9" src scripts bin tests .github index.html` returns no hit across those paths.
   Nothing records whether a row was removed, renamed or reserved. Counts are computed
   from `ROWS.length` rather than typed, so no number is wrong today, but a reader comparing row
   labels against a count has no way to tell which of the three happened.

4. **The end to end safety check does not run the shipped entry point.**
   `tests/integration/side_effect_isolation.mjs` line 94 inlines the probe "the way
   `bin/ninthtool.mjs` inlines it" instead of spawning `bin/ninthtool.mjs`. The comment is honest
   about it. It does mean the runner's own injection path is exercised end to end nowhere, and the
   two copies can drift. `tests/unit/keep_open.test.js` is the file that does spawn the real runner,
   and it deliberately runs without a browser.

5. **The readiness gate never runs on a branch.** `.github/workflows/readiness.yml` documents this as
   deliberate, and the reasoning holds: a branch is not deployed. The consequence is still worth
   naming, that every row measuring the deployed surface is first evaluated after a merge to `main`.

6. **`src/probe/serve.mjs` imports `scripts/build_manifest.mjs`.** A `scripts/` module is therefore a
   run time dependency of a `src/` module and is packed by `package.json` `files` for that reason,
   alongside `scripts/runtime_graph.mjs`. Nothing is broken by it; the directory names simply no
   longer split the tree into shipped code and build tooling, and a reader would expect them to.

7. **Row M8 measures 375 px on the success path only.** `tests/unit/layout.test.js` lines 4 to 8
   record it, with the measured error path numbers: clientWidth 375, scrollWidth 459, blocker 438
   wide inside a 333 box. The CSS level test now pins the declarations, so the gap is guarded, but
   the browser measurement still never reaches the layout a visitor on an unflagged browser sees.
