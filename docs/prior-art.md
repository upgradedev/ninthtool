# Prior art

Searched 2026-09-01. This document exists because an unchecked novelty claim is the defect that
costs most, and because the first design for this project **was killed by what is in this table**.

## What was searched

GitHub repositories and code search for `webmcp`, `navigator.modelContext`, `document.modelContext`,
and for those terms alongside conformance, test, eval, audit, lint and inspector. The npm registry.
The W3C and WICG repositories and their issue trackers, including
`github.com/webmachinelearning/webmcp`. Chrome's developer documentation. Project galleries. Plain
web search for "WebMCP conformance", "WebMCP test suite", "WebMCP linter" and "audit WebMCP tools".

## What exists

| What | What it does | How close |
|---|---|---|
| **admintoolkit.io WebMCP Tool Validator** | 24 read only diagnostics registered on its own root page. You give it a page URL or paste page source and it inspects that page's declarative form metadata | **does the same thing**, for metadata |
| **agent-ready.dev** | publishes `scan_site`, `get_scan` and `ask`. Scores a site for agent readiness | **does the same thing**, for metadata |
| **audit.wordlift.io** | publishes `run-audit` | **does the same thing**, for metadata |
| **Chrome Tool Inspector extension** | lists the tools a page has registered, with their schemas, and lets you call them by hand | adjacent, and privileged |
| **mr-shitij/webmcp_inspector** | a browser extension inspector | adjacent, and privileged |
| **webmcp-evals** | a Puppeteer harness that drives a page's tools from a script | adjacent |
| **webmcpinspector.com** | a hosted sandboxed browser session that inspects a page | adjacent, and hosted |
| **MCP Inspector** (`modelcontextprotocol/inspector`) | the official developer tool for backend MCP servers. Connects, lists tools, calls them by hand | the closest neighbour in the older, server side protocol |

## The first design, and why it was abandoned

The plan this repository started from was "a page whose WebMCP tools audit other pages' WebMCP
tools". Three of the products above already are that. Building it would have shipped a weaker copy
of something already live.

The transport it needed also does not exist. The `tools` Permissions Policy defaults to `self`, so a
cross origin frame contributes nothing. That was measured rather than assumed: a frame on a
different origin of the same server contributed **zero** tools while a same origin frame contributed
its whole list. The one browser that discovers no tools in frames at all, same origin included, is a
judging surface for this event.

So the promise "give it any URL" was never deliverable from a page, and the part that is deliverable
was taken.

## The claim, narrowed after a second search

**An earlier version of this file said no existing tool executes a page's WebMCP tools and asserts
runtime semantics. That was too broad and it is withdrawn.** A second search, prompted by an
adversarial audit on 2026-09-01, found work that does execute tools:

| Also found | What it is | Checked |
|---|---|---|
| `WebMCP-org/npm-packages`, `docs/TESTING.md` | a testing guide for that monorepo's own packages. Its own words: it covers "the runtime testing lanes in this monorepo", and its end to end lane registers tools "inside the real runtime, discovered through that runtime's public boundary". It asserts package integration, not the standard's semantics. **It does refer to upstream WebMCP Web Platform Tests and native Chrome contract testing**, which is the closest neighbour to a conformance suite named anywhere in this document | read, 2026-09-01 |
| `Skopaq-AI/webmcpregistry` | named in the audit as carrying a conformance package | **not read.** Named here rather than left out |
| `github/awesome-copilot`, the `webmcpify` verification flow | named in the audit as a verification flow | **not read.** Named here rather than left out |

Two of those three were not opened, and this document says so rather than implying a search that did
not happen. **Web Platform Tests for WebMCP, if they exist upstream, are the closest thing to this
and would be the right place for several of these rows to end up.**

## What is left that is distinctive

Not "nobody executes tools". What survives is narrower and can be checked in one visit:

- the catalogue runs **live, in the visitor's own browser**, against a subject page served beside it,
  rather than in a CI harness or a package test lane
- the auditor is **itself a WebMCP page**, so a visitor's agent runs the audit through tools the
  auditor publishes, and one of those tools appears and withdraws while it happens
- every row carries **the command that reproduces it** and separates a fact about the browser from a
  defect in the page under test, which is the distinction that decides whether a build should fail

Those three together are what this entry claims, and each is visible on the live page in under a
minute. Everything wider than that has been removed.

## What the products in the first table do not do

Every product in that table reads a page's **declared metadata**: names, descriptions, schemas,
readability. None of them calls a tool and checks what happens afterwards.

Seven probe runs against Chrome 152.0.7977.65 on 2026-09-01 say that is where the defects are. A
page can pass every one of those tools, render correctly in the Tool Inspector, and still:

- tell an agent a write succeeded when it was refused, because `isError` is not a failure signal
- publish a conditional tool that can never withdraw, because the abort signal was put on the
  descriptor instead of in the options bag, which throws nothing
- publish a tool that never answers at all, because a form has no `toolautosubmit`
- accept a call that omits a property its own schema marks required, and hand its handler a value
  left in the DOM by an earlier, unrelated call

None of those is visible in metadata. All four are visible in one run of this suite.

## The one sentence

> Every WebMCP tool that exists reads what a page **declares**. This one calls the tools and reports
> what the page and the browser actually **do**, which is where all four of the defects above live.

## What would falsify what is left

A tool that runs a behavioural WebMCP catalogue **live in an ordinary visitor's browser**, publishing
its own WebMCP tools so an agent can drive it. If one is found, this document is wrong and the README
changes the same day.

The broader claim, that nothing executes WebMCP tools and asserts runtime semantics, has already been
falsified and withdrawn above. Upstream Web Platform Tests would falsify it further, and finding them
would be good news for the standard and a reason to narrow this entry again.

The MCP Inspector is the honest edge case. It calls backend MCP tools by hand, which is execution.
It is a manual instrument for a different protocol, it asserts nothing, and it has no notion of a
tool appearing and withdrawing in a live page. It is named here rather than left out so a reader can
judge that for themselves.
