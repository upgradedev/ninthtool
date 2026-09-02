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

Coverage is 76.76 percent of lines, below the 85 the standards ask for, and the gap is the
measurement layer. Four further oracle weaknesses are reproduced and recorded as open in `STATE.md`
rather than quietly fixed. A preregistered study on thirteen independently authored WebMCP pages has now run, and its
hypothesis failed. Five of twenty rows told those pages apart and every one of them was already
readable from the tool list, so on that population this tool found nothing that a declaration only
reading would have missed. The protocol was written and committed before any page ran, the failure
is published in `evidence/impact/results.md`, and the primary metric was not changed afterwards to
make it read better. The same author has
a second entry, ClaimReady; exactly one file is shared, a 200 line DevTools client, and the README
names it with its source commit.
