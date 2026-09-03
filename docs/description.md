# Ninth Tool, Devpost description

Staged here so it is tracked, reviewable and checkable by the readiness gate. The owner pastes it
into Devpost. Nothing in this file is submitted by an agent.

The opening sentence is the flagship, and it is pinned to be identical in `README.md`, the page
metadata and this file. `scripts/readiness_config.mjs` holds the one copy the gate compares.

---

## Inspiration

Ninth Tool executes your page's WebMCP tools in the browser and shows which promises the standard
silently drops, with the command that reproduces each one.

I was adding WebMCP to a page, writing the shape I knew from building MCP servers. I marked a tool
`destructiveHint`. I returned `{ isError: true }` when it refused. I passed a `signal` on the
descriptor so it would withdraw. All three were accepted without complaint and none of them did
anything. Nothing threw, nothing reached the console, and the tool list carried no warning.

Existing checkers read the declarations a page publishes and told me the page was fine, because by
the only thing they look at, it was. The gap is not in what a page declares. It is in what the
browser does with the declaration, and reading cannot see that.

## What it does

It runs twenty behaviours against a live WebMCP tool surface and reports each one with the exact
command that reproduces it.

Six read the tools the page publishes, snapshotted before the probe registers anything of its own.
Those are the rows a page author can act on. The other fourteen are facts about the host, the same
wherever you point it: three where the browser diverges from the specification it implements, five
the standard cannot express, three that fail silently written the obvious way, one deliberate, two
that hold.

On its own page, in Chrome 152 with WebMCP enabled, the reading is **13 broken, 5 kept, 1 by design,
1 unsettled, 20 tested**. It is deliberately not 14. Row C4 was counted broken while its own entry
said the pause it measures is intended, so it became a fourth outcome. The number went down because
the definition got honest.

The unsettled row is the interesting one. P5 asks whether a read only tool demonstrably refuses a
call missing a required argument. This page's tools do refuse, but by returning a result rather than
throwing, because another row measured that throwing erases the page's own reason. The standard
makes an author choose between a refusal a caller can read and one a caller can detect. This suite
can only confirm the second, so it abstains and says why.

## What Devpost asks, answered in its own words

**Why your use case is a strong fit for WebMCP.** The subject being tested is WebMCP itself. Whether
a host honours `destructiveHint`, whether a refusal survives the boundary, whether a tool registered
with a signal actually withdraws: none of it is visible from outside a browser, and none of it can
be read off a declaration. This is not a page that uses WebMCP to deliver something else. WebMCP is
the thing under test, so the only place the work can happen is inside a page that speaks it.

**How it creates a better user experience.** A page author gets what their browser actually did,
next to the one command that reproduces it, instead of a linter's reading of their source. No
account, no install, no uploading their page anywhere, and every row that could not be run says so
rather than counting as a pass.

**What people and agents can do together that was difficult or impossible before.** This page
publishes its own WebMCP tools, so an agent can run the audit, list the twenty behaviours, explain
one row in full and read the findings without touching the screen, while a person watches the same
rows fill in beside it. The findings tool does not exist until a run has produced findings, and it
is withdrawn when they are cleared, so an agent that asks for findings which are not there is
answered by the tool surface rather than left to guess. That is the behaviour this suite is named
for, demonstrated on itself rather than described.

**How WebMCP was implemented.** `document.modelContext.registerTool` publishes three tools from this
page at rest and a fourth while findings exist. Three carry `readOnlyHint`; the one that runs the
audit deliberately does not. The subject
page it drives is a separate document in a same origin frame that promotes two ordinary forms to
tools through the declarative HTML attributes, so both halves of the standard are on one surface.
The probe registers its own throwaway tools with a `signal` in the options bag and withdraws them
when it is finished.

## How I built it

Gathering and deciding are separate files. The probe runs inside a document, calls things, and
records what happened; it has no idea what a pass is. The judge is pure, cannot reach a browser, and
every rule ships with a mutation proving it can fail. The tool this grew from printed what it saw
and exited zero whatever that was, so a run that proved nothing looked like a run that proved
everything.

One probe, two transports: the page drives a subject fixture in a same origin frame, so a visitor
needs no install, and a dependency free DevTools runner drives the same source from a terminal.

The auditor is itself a WebMCP page. Its findings tool does not exist until a run produces findings
and is withdrawn when they are cleared, so the behaviour it is named for is visible rather than
described.

## Challenges

The hardest were in the suite, not the standard.

Its fixture identity boundary said that if any check failed, nothing was submitted. That was false.
Three of the four checks are copyable from a public repository, and the fourth, a nonce the fixture
echoes, can only be read by calling the tool, which for a form is the write. A page that copied the
marker and never echoed was trusted, and one form was submitted to it. No ordering repairs that, so
the scope narrowed: form writing runs only against a fixture the runner owns, and the imitation now
receives zero calls and zero submissions.

The suite also failed its own rows twice, both fixed. Its tools accepted an argument nobody
declared, then still answered a call missing a required one.

## Try it

- Live, no account and no install: **https://upgradedev.github.io/ninthtool/**
- It needs Chrome or Edge with WebMCP enabled at `chrome://flags/#enable-webmcp-testing`. Without it
  the page renders the whole catalogue and refuses to report a result, which is what it does in the
  ChatGPT desktop in-app browser today: that browser exposes the host object on the top document but
  not inside a same origin frame, so every row reads NOT RUN with its reason and no count is shown.
- Point it at your own page from a terminal:

  ```
  npx --yes https://github.com/upgradedev/ninthtool/tarball/main https://your-page.example
  ```

- Ask your own agent, on the live page: `Run nt_run_audit, then explain behaviour C1.`

## Safety

By default it calls no tool of yours and submits no form. Calling your read only tools needs an
explicit flag. Submitting a form runs only against the fixture this tool serves itself. It is not
invisible: registering a probe tool is a document level event, measured at 26 `toolchange` events on
a default run, and that is stated rather than hidden.

## Honest limits

Coverage, counting each file once, averages 97.79 percent of lines across 53 files against a floor
of 85. The raw `all files` row reads 77.88 because it counts some files more than once, and four
files sit below the floor on their own. The gate names them rather than hiding them inside the
average, and `bin/ninthtool.mjs` at 63.34 and `scripts/readiness.mjs` at 70.26 are the two that
matter. Four oracle weaknesses that would each have let a false pass through were reproduced against
the real code and are now closed, and the adversarial inputs that found them are kept as tests. A preregistered study on thirteen independently authored WebMCP pages has now run, and its
hypothesis failed. Five of twenty rows told those pages apart and every one of them was already
readable from the tool list. Taking the other half apart afterwards showed why: at most two rows
could ever have told one of those pages from another, against a threshold of three fixed before
anyone looked, and both of those two were switched off by the run's own read only default. The bar
could not be cleared by any result, which is a defect in the protocol rather than a measurement of
what this tool reaches. Authorising those two rows on the four pages that published a read only tool
moved them from abstaining everywhere to settling somewhere, and neither varied across the pages it
settled on. Two findings it did report were then checked against those pages' own source and
retracted as defects in this tool, with the handler lines cited: one page had rejected the missing
argument at its first line, and on the other this tool's own control call was as malformed as the
one it meant to break. That is the thing worth reading. A conformance suite that runs against
strangers' pages will produce false findings, and the useful question is whether it catches them and
publishes the retraction beside the claim, with the handler cited, in the same generated file. It
did. One of the two weaknesses behind it is now closed: the row refuses to score a tool whose schema
declares a constraint this suite cannot satisfy, so it can no longer blame a page for a call that was
invalid before it left, and the wave was re-run to prove both false findings are gone. The other
stays open on purpose, because excluding oracles that only appear to answer was built and measured
against a copy of the tree and it turned this suite's own flagship true positive into an abstention. The protocol was written and committed before any page ran, the failure
is published in `evidence/impact/results.md`, and the primary metric was not changed afterwards to
make it read better. The same author has
a second entry, ClaimReady; exactly one file is shared, a 200 line DevTools client, and the README
names it with its source commit.
