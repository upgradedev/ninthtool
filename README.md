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

Fourteen behaviours, each measured against the shipping browser, each with one command that
reproduces it.

## The findings, and they are three different kinds of thing

An earlier draft of this work reported one number: "the browser ignores six of these". That was an
overstatement. Three of the six were never the browser failing to implement anything, they were
fields that do not exist in WebMCP at all. A reader who checked one row and found it was not a
browser defect would have been right to discount the rest. So the findings are three separate
claims, each defensible on its own terms.

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

Against the bundled subject page, with no arguments and no separate terminal. It starts a loopback
server, launches your Chrome with the feature enabled in a throwaway profile, drives the page and
prints the report:

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

`--fail-on page` exits 1 on a defect in the page under test and ignores facts about the browser,
because your build should not go red over something Chrome does to everybody. `--fail-on any` exits
1 on anything. An incomplete run always exits 3, because a behaviour that was never observed is not
a behaviour that passed.

## Run the checks

```bash
node --test tests/unit
```

```bash
node scripts/check_style.mjs --selftest
```

No dependencies, no lock file, nothing to install. Node 20 or later, and a Chromium browser for the
runner. Firefox and Safari have no WebMCP implementation, so there is nothing for this to measure
there.

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
