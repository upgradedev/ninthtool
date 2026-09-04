# Prior art

First searched 2026-09-01. Re-searched and re-verified 2026-09-02, and this version is a **retraction
of three claims the earlier one made**. Every row below carries a link and the date somebody here
opened it. Where a thing could not be verified it says so in those words rather than hedging.

This document exists because an unchecked novelty claim is the defect that costs most, and because
the first design for this project was killed by what is in these tables.

## What was retracted, and why it was wrong

Three sentences were in this file on 2026-09-01 and are withdrawn. They are printed here rather than
quietly deleted, because a reader who saw the old version deserves to know which way the correction
runs.

| Withdrawn | Why it was wrong | What replaced it |
|---|---|---|
| A hedge that upstream Web Platform Tests might exist | They do exist, they were one directory listing away, and the hedge advertised a search that was not finished | The [official suite](#the-official-suite-and-the-conformance-work), listed and counted below |
| That every WebMCP tool in these tables only reads what a page declares | False for at least three of them. The Model Context Tool Inspector, webmcpinspector.com and Glass Box all call tools | The first table is now split into readers and executors |
| That nothing runs a behavioural WebMCP catalogue live in a browser | Glass Box does, and it publishes its own WebMCP tools while doing it | A named [closest neighbour](#the-closest-neighbour-glass-box) and a narrower falsifier |

**Ninth Tool is not a conformance suite and does not claim to be one.** An earlier version of this
line said it was not the FIRST one, which still claimed to be one. The conformance suite for WebMCP
is upstream in Web Platform Tests, and at least two package suites and one published npm package
exist besides. This is a behaviour probe: it executes a page's tools and reports what the browser
did with them, over twenty hand-picked rows rather than systematic coverage of the draft. What is left is stated at the end, is narrower than what was withdrawn, and each part
of it names its nearest neighbour inline.

## What was searched

- The `webmcp` directory of `web-platform-tests/wpt`, listed through the contents API rather than
  through a search box.
- GitHub repository and code search for `webmcp`, `navigator.modelContext`, `document.modelContext`,
  and those terms beside conformance, test, eval, audit, lint, verify and inspector.
- The npm registry, by package metadata rather than by the web page.
- `webmachinelearning/webmcp`, the W3C incubation repository, and its published draft.
- The MCP-B ecosystem: the `WebMCP-org` organisation repository list, and the `@mcp-b/` npm scope.
- The `webfuse-com/awesome-webmcp` list and the `webmcp.com` directory of live sites.
- Chrome's developer documentation and `GoogleChromeLabs/webmcp-tools`.

## The official suite and the conformance work

| Work | What it is | How close | Checked |
|---|---|---|---|
| [`web-platform-tests/wpt`, `webmcp/`](https://github.com/web-platform-tests/wpt/tree/master/webmcp) | The official Web Platform Tests for WebMCP. **15 test files under `declarative/` and 44 under `imperative/`**, plus `idlharness.https.window.js`, which runs the draft's IDL against the browser. Its `META.yml` names the W3C draft as the spec and `domfarolino` as reviewer. The tests execute tools: `unregister-during-executeTool`, `executeTool-abort`, `executeTool-target-navigation`, `register_tool_signal` and `execute_tool_change_event` are all runtime assertions, not declaration reads | **This is the conformance suite for WebMCP.** It tests the browser against the standard | 2026-09-02 |
| [`webmachinelearning/webmcp`](https://github.com/webmachinelearning/webmcp) | The W3C incubation repository behind the draft at <https://webmachinelearning.github.io/webmcp/>. Last push 2026-08-26 | The standard itself, and the source every row in this repository's catalogue is checked against | 2026-09-02 |
| [`WebMCP-org/npm-packages`](https://github.com/WebMCP-org/npm-packages), `conformance/` and `docs/TESTING.md` | **This is the MCP-B line**, the browser side Model Context Protocol work that ran ahead of the W3C draft. It started at [`MiguelsPizza/WebMCP`](https://github.com/MiguelsPizza/WebMCP), "Bringing the power of MCP to the web", 1093 stars, last pushed 2025-10-07, and now sits under the `WebMCP-org` organisation with [`mcp-b`](https://github.com/WebMCP-org/mcp-b) as its core and [`docs`](https://github.com/WebMCP-org/docs) as the ecosystem documentation. Its packages publish under the `@mcp-b/` scope, which is why the lane names below read `@mcp-b/webmcp-polyfill` and `@mcp-b/global`, and its shared suites import `@mcp-b/webmcp-types`. Two of those suites, `runtime-core-conformance.shared.ts` and `declarative-forms-conformance.shared.ts`, run against more than one runtime from one source. `docs/TESTING.md` names the lanes: shared conformance lanes for the polyfill and the global build, a **native contract lane on Chrome 152+ with WebMCP flags**, a lane that runs a **pinned revision of the upstream WebMCP Web Platform Tests** against the polyfill, and an IDL shape lane it reports as passing 20 of 20 subtests, matching native Chrome Canary. It states its own limit: frame tree, origin policy and navigation tests are excluded because they need native browser behaviour | Runtime execution against a real runtime, in CI, for that project's packages. The **native runtime lane is the closest thing to this work that runs on the shipping browser** | 2026-09-02 |
| [`Skopaq-AI/webmcpregistry`](https://github.com/Skopaq-AI/webmcpregistry), `packages/conformance` | Published as [`@webmcpregistry/conformance`](https://www.npmjs.com/package/@webmcpregistry/conformance), latest 0.2.1, published 2026-03-15 per the registry metadata. **12 scenarios, each mapped to a section of the W3C draft**, run against any implementation and reported as a pass rate. It executes: it registers tools, expects duplicate and empty name registrations to throw, and reads schemas back | A real conformance suite, published, before this one. It targets the implementation, not a page | 2026-09-02 |
| [`TueJon/webmcpify`](https://github.com/TueJon/webmcpify), mirrored as the `webmcpify` skill in [`github/awesome-copilot`](https://github.com/github/awesome-copilot/tree/main/skills/webmcpify) | An agent skill that makes an existing app agent ready and then verifies it. Its `references/verify.md` requires a real headed Chrome with `chrome://flags/#enable-webmcp-testing`, polls for asynchronous registration, parses the stringified `inputSchema`, and states that mutating declarative forms pause mid execution and deadlock a plain `await` | **Executes tools and asserts runtime behaviour.** It verifies one app it was pointed at, from a coding agent, in CI or on a developer machine | 2026-09-02 |

Two things follow from that table and both are in this entry's favour rather than against it.

The upstream suite tests the **browser** against the standard. It asserts that
`registerTool(tool, { signal })` withdraws a tool when the signal aborts, which is the working path.
It does not assert what happens when a page author puts the signal on the descriptor instead, which
is not a browser defect and is the trap this repository is named for. That is the same distinction
this catalogue draws per row.

The npm package suites test an **implementation**, native or polyfill. None of the five rows takes a
page a stranger points at and reports on that page.

## Validators, which read what a page declares

Every product in this table reads declared metadata: names, descriptions, schemas, annotations,
discovery files. None of them calls a tool on the page under test.

| What | What it does | How close | Checked |
|---|---|---|---|
| [admintoolkit.io WebMCP Tool Validator](https://admintoolkit.io/webmcp-tool-validator/) | Registers 24 read only diagnostics on its own root page, one of them `admintoolkit_validate_webmcp_tool`, the 24 names listed on the `webmcp.com` directory. Its own page says it inspects declarative and imperative **static source without executing JavaScript**, and that runtime tools need actual browser observation | **does the same thing**, for metadata, and says plainly where it stops | 2026-09-02 |
| [agent-ready.dev](https://agent-ready.dev) | Scores a URL for agent readability against readability and agent protocol specifications, 72 checks by its own count, over discovery files, structure and protocol manifests. `awesome-webmcp` records it as returning the result to the agent through `scan_site` and `get_scan`, with an `ask` tool over the scanned site | **does the same thing**, for metadata | 2026-09-02 |
| [audit.wordlift.io](https://audit.wordlift.io/) | Listed in `awesome-webmcp` as scanning a site for WebMCP and agent readiness. The page renders client side, so the audit was read from that listing rather than from the page | **does the same thing**, for metadata | 2026-09-02 |

## Inspectors, which do call tools

Naming these correctly is the main thing the earlier version of this file got wrong.

| What | What it does | How close | Checked |
|---|---|---|---|
| [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools) | The extension from GoogleChromeLabs, listed on the Chrome Web Store, part of the official `webmcp-tools` toolkit. It lists a page's registered tools with their schemas and **executes them, by hand or through Gemini** | Executes. It is a privileged extension, it is driven by a developer, and it asserts nothing | 2026-09-02 |
| [webmcpinspector.com](https://webmcpinspector.com/) ([`aogz/webmcpinspector`](https://github.com/aogz/webmcpinspector)) | Discovers declarative and imperative tools, shows schemas, lets you edit attributes and **execute tools**, in a hosted sandboxed browser session | Executes. Hosted rather than in the visitor's own browser, manual, and asserts nothing | 2026-09-02 |
| [`mr-shitij/webmcp_inspector`](https://github.com/mr-shitij/webmcp_inspector) | A browser extension inspector. Last push 2026-02-20. The repository carries no description; what it does was not read beyond that | Adjacent and privileged. **Not read in detail, and said so** | 2026-09-02 |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | The official developer tool for backend MCP servers. Connects, lists tools, calls them by hand | The honest edge case. It is execution, for the older server side protocol, manual, asserting nothing, with no notion of a tool appearing and withdrawing inside a live page | 2026-09-02 |

## The closest neighbour, Glass Box

[`philbritton/webmcp-glassbox`](https://github.com/philbritton/webmcp-glassbox), live at
<https://philbritton.github.io/webmcp-glassbox/>, checked 2026-09-02. Its repository history shows
two commits, both on 2026-09-01, so it is very recent, and it is public, which is what matters here.

What it does, from its own README and its `verify/FINDINGS.md`: one script tag wraps every tool a
page registers and records the arguments, whether they matched the declared `inputSchema`, the
duration, the result, the failure and the DOM change. **It then registers itself over WebMCP** so
that an agent whose call failed can ask it for a structured diagnosis. Its findings file reports
Chrome 152.0.7977.65 measurements dated 2026-08-28, including that `navigator.modelContext` is
undefined in that build while `document.modelContext` is present, and that `unregisterTool` does not
exist so withdrawal goes through an `AbortSignal`.

That overlaps this entry on two of its five parts, and the overlap is stated here rather than left
for a judge to find:

- it runs live in a browser, not in CI, and reports runtime behaviour rather than declarations
- the auditor is itself a WebMCP tool surface

Where it differs, and these were checked against this repository's own source on 2026-09-02:

- Glass Box is installed **by the page author** into their own page, as a script tag loaded before
  the tools register. This runs as a page a **visitor** opens, against a subject page it drives, with
  nothing added to the subject
- Glass Box reports per call. This carries a **fixed catalogue of 20 rows**, each with its own
  `reproduce` string, so a row is an assertion with a command rather than a trace
- every row here declares `subject: 'browser'` or `subject: 'page'`, **14 and 6** of the 20, so a
  build knows which findings are its own defects. Recount both with
  `node -e "import('./src/judge/behaviours.js').then(m=>console.log(m.BEHAVIOURS.length, m.BEHAVIOURS.filter(b=>b.subject==='page').length))"`
- the findings tool here is **scoped to the result lifecycle**. `nt_get_findings` does not exist
  before an audit produces findings, is registered with an `AbortController` signal, and is
  withdrawn when the result is cleared, at `src/ui/app.js:569-616` and `src/ui/app.js:622-627`. Glass Box's
  self registered tools are documented as an install time option, not as tools that come and go with
  a result

## The first design, and why it was abandoned

The plan this repository started from was "a page whose WebMCP tools audit other pages' WebMCP
tools". Three of the validators above already are that, and two of the inspectors are more than
that. Building it would have shipped a weaker copy of something already live.

The transport it needed also does not exist. The `tools` Permissions Policy defaults to `self`, so a
cross origin frame contributes nothing. That was measured rather than assumed: a frame on a
different origin of the same server contributed **zero** tools while a same origin frame contributed
its whole list. The one browser that discovers no tools in frames at all, same origin included, is a
judging surface for this event.

So the promise "give it any URL" was never deliverable from a page, and the part that is deliverable
was taken.

## What is left, with each part's nearest neighbour beside it

Not a first, and not a claim about execution. Five parts, and the claim is the **conjunction**. Each
line names the closest thing found to it.

| Part | Nearest neighbour found |
|---|---|
| Behavioural diagnostics that run **in an ordinary visitor's own browser**, against a subject page served beside the auditor, with no install, no extension and no account | Glass Box, which runs in the browser but is installed by the page author into their own page. The upstream Web Platform Tests, the package conformance lanes and the `webmcpify` verify step all need a checkout, a flag and a developer |
| **Every row carries a `reproduce` command**, so a reader re-runs the row rather than believing it. 20 of 20 rows carry one | Glass Box's findings file carries one command for the whole document. The Web Platform Tests are themselves the command, which is stronger, and they are run by a developer rather than read by a visitor |
| **Browser fact and page defect are an explicit per row field**, `subject`, so a build fails on its own 6 rows and reports the other 14 without failing | Not found elsewhere. The upstream suite is entirely browser facts by construction, since a browser is what it tests. The validators are entirely page facts. Nothing found mixes them and labels the mixture |
| **The auditor is itself a WebMCP page**, so a visitor's agent drives the audit through tools the auditor publishes | Glass Box does this, and did it first as far as this search can tell. Stated plainly rather than claimed |
| **The findings tool appears and withdraws with the result lifecycle**, which is the behaviour the whole catalogue is named for, practised on the auditor's own surface | Not found elsewhere. The upstream `register_tool_signal` test asserts the mechanism in the browser. No product found uses it on its own reporting surface |

Only the third and fifth rows are stated as not found, and both are narrow. The other three are
shared with something named above.

## What would falsify what is left

The conjunction, not any single part. This entry is wrong, and the README changes the same day, if
somebody finds a tool that does **all** of the following:

1. runs its checks in an ordinary visitor's browser, with no install and no account
2. against a subject page the **visitor** chooses, rather than one the page author instrumented
3. reports a fixed catalogue where **every row carries its own reproducing command**
4. labels each row as a fact about the browser or a defect in the page under test
5. publishes its own WebMCP tools, one of which appears and withdraws with the result

Glass Box meets 1 and 5. The upstream Web Platform Tests meet a stronger version of 3 and,
by construction, 4 in one direction only. `webmcpify` meets a stronger version of 2 for a developer
rather than a visitor. **Anything meeting all five falsifies this entry**, and finding it would be
good news for the standard.

The wider claim, that nothing executes WebMCP tools and asserts runtime semantics, was already
falsified and is withdrawn at the top of this file. It should never have been written.

## What could not be verified

Marked rather than hedged, dropped or quietly softened.

- **`[NOT VERIFIED]`** The exact WebMCP tool name published by `audit.wordlift.io`. The page renders
  client side and the `webmcp.com` directory listing read on 2026-09-02 did not carry an entry for
  it. The `awesome-webmcp` list describes what the service does but names no tool. An earlier
  version of this file named a tool for it; that name is withdrawn for want of a source.
- **`[NOT VERIFIED]`** Whether `@webmcpregistry/conformance` still runs against a current Chrome
  build. Its source on the repository head, read 2026-09-02, reads
  `globalThis.navigator.modelContext`, while the upstream Web Platform Tests and Chrome 152 use
  `document.modelContext`. Whether the published 0.2.1 therefore reports zero passes on a current
  build was not tested here, and nothing in this document depends on the answer.
- **`[NOT VERIFIED]`** What `mr-shitij/webmcp_inspector` does beyond being an inspector extension.
  The repository was listed, not read.
- **`[NOT VERIFIED]`** Whether any private or unpublished conformance work exists. Only public
  sources were searched.
