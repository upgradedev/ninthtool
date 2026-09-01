# Ninth Tool

**Ninth Tool executes your page's WebMCP tools in the browser and shows which promises the standard
silently drops, with the command that reproduces each one.**

Named for the tool that has to disappear. A page registers eight tools, a ninth appears when the
state that justifies it appears, and it is supposed to withdraw when that state goes away. Write the
withdrawal the obvious way and it never happens, and nothing is thrown.

---

## What this is

Not a website scanner. Several of those already exist and they read a page's declared metadata:
names, descriptions, schemas. This one **calls the tools and watches what happens**, because the
measurements below say that is where the defects are. A page can pass every metadata linter, look
correct in a tool inspector, and still tell an agent that a write succeeded when it was refused.

Twenty behaviours. **Six read the tools your page publishes and are the ones you can fix.** The
other fourteen are the host, and are the same wherever you point this. Every one carries one command
that reproduces it.

## Your page

These read the tool surface as it was **before this probe registered anything of its own**, so a
failure here is a defect a page author can act on today. This is the group a build should go red on,
which is what `--fail-on page` does.

| # | The row | What it catches |
|---|---|---|
| P1 | every tool you publish says whether it writes | a tool with no `readOnlyHint` is one an agent has to guess about, and the safe guess is not to call it |
| P2 | every tool declares a schema an agent can read | a missing or unparseable schema, in a standard where the browser validates nothing on the script path |
| P3 | every tool and every parameter is described | an undescribed parameter is one a model fills with something plausible |
| P4 | nothing on your surface came from a frame you may not control | anything you embed same origin can put a tool in front of an agent on your page, under your origin |
| P5 | your read only tools notice a call that breaks their own required list | the browser ignores `required`, so the promise is yours to keep |
| P6 | a tool you marked read only does not move state your other read tools can see | an annotation nobody checks is a promise nobody keeps |

**This page fails two of its own six, and owns both.** P1 fails because two of its tools come from
HTML forms and the standard has no way to annotate those at all, which is behaviour B4 below. P4
fails because this page deliberately embeds a subject frame whose tools join its surface, and
nothing on that surface says where they came from. That is the finding, not an accident.

P5 also failed here on the first run that measured it, and that one was a real defect: the tools on
this page did not check their own arguments. They do now.

## The host

Fourteen rows that are the same whatever page you point this at, and they are three different kinds
of thing.

An earlier draft reported one number: "the browser ignores six of these". That was an overstatement.
Three of the six were never the browser failing to implement anything, they were fields that do not
exist in WebMCP at all. A reader who checked one row and found it was not a browser defect would
have been right to discount the rest. So they are separate claims, each defensible on its own terms.

### The browser diverges from the specification it implements

| # | The contract | Chrome 152.0.7977.65 |
|---|---|---|
| A1 | `ToolExecuteCallback = Promise<any>(object input, ToolExecuteCallbackOptions options)`, with a required `AbortSignal`, in both the W3C draft and Chromium IDL | the callback gets **one argument**. `options` is `undefined`, so `execute(args, {signal})` throws |
| A2 | `RegisteredTool.inputSchema` is `object` in the W3C draft | a **JSON string**. Code written to the draft reads `.type` and gets `undefined` |
| A3 | `consequentialHint` is in current Chromium IDL | **absent** from this build |

### The standard provides no way to do it

The W3C draft flags the first of these itself: *"Support more granular errors than “UnknownError”,
based on each failure case."*

| # | What a page needs to do | WebMCP today |
|---|---|---|
| B1 | **tell the agent why it refused** | **impossible.** Resolving reads as success. Rejecting flattens every error, a named `DOMException` included, to `UnknownError` with one generic sentence |
| B2 | mark a result as failed in band | `isError` is ordinary payload. The promise still resolves and the agent reads success |
| B3 | warn that a tool is destructive | no such field. `destructiveHint`, `idempotentHint` and `openWorldHint` are backend MCP's and vanish silently |
| B4 | annotate a declarative tool | form derived tools carry **no annotations at all**, not even `readOnlyHint` |
| B5 | tell the caller whether to parse the result | none. A string comes back raw, an object comes back as JSON, nothing distinguishes them |

### It works, but the obvious way to write it fails silently

| # | Trap | What happens |
|---|---|---|
| C1 | a missing required property is **not refused, it is filled from the control's stale value** | a call omitting a required property resolved, and the handler was handed the name left in the DOM by the previous, unrelated call |
| C2 | withdrawal only works via `registerTool(desc, { signal })` | `signal` on the descriptor registers a tool that can never withdraw, and throws nothing |
| C3 | validation depends on which half registered the tool | script registered: none at all. Form derived: strict. The halves behave oppositely and neither says so |
| C4 | a declarative form without `toolautosubmit` | produces a real tool that **never answers**. Timed at 8016 ms with no settlement and no browser timeout |

### And two that hold

`toolchange` fires on both registration and withdrawal, so the surface is observable without
polling. Form derived schemas are built richly from markup, including `enum` from a `<select>` and
`minimum` and `maximum` from a number input. A suite that only ever prints failures cannot be
trusted to notice a pass, so these are reported too.

## How it decides

One pure module, `src/judge/verdict.js`. A transcript goes in, a verdict comes out. It has no way to
reach a browser, no clock and no network, so the same transcript always produces the same verdict
and a stored result is checkable by a reader who does not trust us.

Gathering and judging are separate on purpose. The probe this grew from used to print what it saw
and exit zero whatever that was, so pointed at a browser with no WebMCP it printed `api: null` and
reported success. A run that proved nothing looked exactly like a run that proved everything.

**Every rule is broken once, on purpose.** `tests/unit/verdict_mutations.test.js` starts from a
transcript that passes everything, changes one field, and requires that behaviour to turn red. A
structural assertion at the bottom of that file fails the build if a behaviour is added to the
catalogue without a mutation proving its rule can fail.

## Run it

With no arguments and no separate terminal. It starts a loopback server, launches your Chrome with
the feature enabled in a throwaway profile, drives this page and prints the report. It audits the
page itself rather than the subject frame, because same origin frames contribute their tools to the
top document, so from there both halves of the standard are on one surface at once:

```bash
node bin/ninthtool.mjs
```

Against a page of your own, on any origin:

```bash
node bin/ninthtool.mjs https://your-page.example
```

One behaviour only, which is what every `reproduce` line in the report gives you:

```bash
node bin/ninthtool.mjs --behaviour B1
```

In a build, where a defect in your page should stop the run. A broken promise is the expected
finding of this instrument rather than an error in running it, so the exit code is zero by default
whenever the run completed, and `--fail-on` is how you ask for the other behaviour:

```bash
node bin/ninthtool.mjs https://your-page.example --fail-on page
```

`--fail-on page` exits 1 on any of the six your-page rows failing, and ignores the fourteen host
rows, because your build should not go red over something Chrome does to everybody. `--fail-on any`
exits 1 on anything. An incomplete run always exits 3, because a behaviour that was never observed
is not a behaviour that passed.

The probe **calls only tools your page has marked `readOnlyHint`**. A tool carrying no annotations is
never called, and that refusal is reported as a finding, because a page that gives an auditor no way
to know a tool is safe gives an agent no way either. Two rows submit a form, which is a write, and
they run only against the subject page this repository ships.

## Run the checks

```bash
node --test tests/unit
```

```bash
node scripts/check_style.mjs --selftest
```

```bash
node scripts/readiness.mjs
```

No dependencies, no lock file, nothing to install. Node 20 or later, and a Chromium browser for the
runner. Firefox and Safari have no WebMCP implementation, so there is nothing for this to measure
there.

## The readiness gate

Thirteen automated rows and four the owner has to close. It answers one question: could a stranger
with no account reach every mandatory artifact right now?

**It fetches the live URL and fails on anything but 200**, checks every asset that page needs, greps
the **deployed bytes** rather than the source for the tools this README claims, and then opens the
live origin in a real browser and presses the button a visitor presses. That last row asserts the
audit judged all fourteen behaviours, that none was skipped, and that the conditional tool both
appeared and withdrew.

A file existence check and a regular expression over the source prove that something was written,
not that anything is deployed. A gate elsewhere once stayed green through a two day outage because
every check read the repository.

Three things it will not do:

- **A row that could not be run is not a pass.** It stays in the denominator, so skipping the
  browser row drops the score to 92 percent and the gate exits 1. A gate that shrinks its own
  denominator reports a higher score for doing less.
- **Owner gated is a third status.** The four rows only a person can close are printed separately
  with their exact manual step and never counted as credit.
- **A threshold cannot be moved quietly.** Each number is pinned in `scripts/readiness_config.mjs`,
  again in the fixture beside it, and again in `tests/unit/readiness_thresholds.test.js`. The gate
  compares the first two before running anything and exits 2 with the disagreement named.

Every row has been watched failing. `--selftest` feeds all thirteen a deliberately wrong input and
requires each to go red, and the live rows were proved by pointing them at an origin that does not
exist, which turned M4 through M7 and R5 red and took the run to 54 percent.

## The console is not silent during a run, on purpose

Behaviour B1 asks whether a refusal can reach the caller, and the only way to ask is to throw inside
a tool handler and to reject with a `DOMException`. Chrome logs both. So an audit leaves four
entries in the console that read like errors and are the instrument doing its job. They appear only
while the audit runs, they come from tools this suite registered and withdrew, and the page is quiet
before and after.

## Reused components

The rules require pre-existing work to be named. One file is carried over from an earlier project by
the same author:

| File | What it is |
|---|---|
| `src/probe/cdp.mjs` | a dependency free Chrome DevTools Protocol client, about 200 lines, enough for `Runtime.evaluate` and watching the console |

Everything else is new: the catalogue, the judge, the mutation suite, the probe, the subject page,
the page, its tools, the runner, the style gate and the tests.

## What it does not do

- **It does not scan other people's sites.** A page cannot reach another origin's tool surface. The
  `tools` Permissions Policy defaults to `self`, and a cross origin iframe was measured
  contributing zero tools. That boundary is why this is shaped as a suite you run against your own
  page rather than a scanner you point at a stranger's.
- No writes, anywhere, ever. No account, no backend, no database, no crawling.
- No verdict is published about anybody's named page.

## Evidence

Every `measured` value in `src/judge/behaviours.js` was taken on 2026-09-01 against
**Chrome 152.0.7977.65** launched with `--enable-features=WebMCP`. Nothing in that file is copied
from documentation. Where the documentation disagrees with the measurement, the row says what the
documentation promised and is reported as a divergence.

`tests/support/transcripts.mjs` holds the transcript that browser actually produced, transcribed
rather than summarised, so the twelve failures and two passes are reproducible from a checkout.

## Licence

MIT. See [LICENSE](LICENSE).
