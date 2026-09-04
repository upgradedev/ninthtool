# Ninth Tool: A Reproducible Behaviour Probe for WebMCP

Ninth Tool executes your page's WebMCP tools in the browser and shows which promises the browser silently drops, with the command that reproduces each one.

* **Live, no account:** https://upgradedev.github.io/ninthtool/
* **Code (MIT):** https://github.com/upgradedev/ninthtool
* **Compatibility:** Chrome or Edge with `chrome://flags/#enable-webmcp-testing`.

---

## Inspiration

I was adding WebMCP to a page, writing the shape I knew from building MCP servers. I marked a tool `destructiveHint`. I returned `{ isError: true }` when it refused. I passed a `signal` on the descriptor so it would withdraw. All three were accepted without complaint and none of them did anything. Nothing threw, nothing reached the console, and the tool list carried no warning.

Existing checkers read the declarations a page publishes and told me the page was fine, because by the only thing they look at, it was. The gap is not in what a page declares. It is in what the browser does with the declaration, and reading cannot see that.

---

## What it does

It runs twenty behaviours against a live WebMCP tool surface and reports each one with the exact command that reproduces it.

* **Six rows** read the tools the page publishes, snapshotted before the probe registers anything of its own.
* **Fourteen rows** are facts about the host: 3 where the browser diverges from the W3C draft, 5 the draft cannot express, 3 silent traps, 1 by design, 2 that hold.

On its own page, in Chrome 152 with WebMCP enabled, the reading is **13 broken, 5 kept, 1 by design, 1 unsettled, 20 tested**. It labels that run **PARTIAL** rather than rounding the unsettled row up.

---

## Why your use case is a strong fit for WebMCP

The subject being tested is WebMCP itself. Whether a host honours `destructiveHint`, whether a refusal survives the boundary, whether a tool registered with a signal actually withdraws: none of it is visible from outside a browser, and none of it can be read off a declaration.

This is not a page that uses WebMCP to deliver something else. WebMCP is the thing under test, so the only place the work can happen is inside a page that speaks it.

---

## How it creates a better user experience

A page author gets what their browser actually did, next to the one command that reproduces it, instead of a linter's reading of their source.

No account, no install, and nothing about their page is uploaded anywhere. The audit runs in the tab they already have open, against a subject document in a same-origin frame.

Every row that could not be run says so, with the reason, rather than counting as a pass. A run with one unobserved row reports **PARTIAL**. That is the difference between a result you can act on and a green tick you have to trust.

---

## What people and agents can do together that was difficult or impossible before

This page publishes its own WebMCP tools, so an agent can run the audit, list the twenty behaviours, explain one row in full and read the findings without touching the screen, while a person watches the same rows fill in beside it.

The `nt_get_findings` tool does not exist until a run has produced findings, and it is withdrawn when they are cleared. An agent that asks for findings which are not there is answered by the tool surface itself rather than left to guess.

That is the behaviour this suite is named for, demonstrated on itself rather than described. The auditor is a WebMCP page, so it is also a subject.

---

## How WebMCP was implemented

`document.modelContext.registerTool` publishes three tools from this page at rest and a fourth while findings exist. Three carry `readOnlyHint`. The one that runs the audit deliberately does not, because it drives forms.

The subject page it drives is a separate document in a same-origin frame that promotes two ordinary forms to tools through the declarative HTML attributes, so both halves of the standard sit on one surface.

The probe registers its own throwaway tools with a `signal` in the options bag and withdraws them when it is finished, which is how the withdrawal row gets measured at all.

---

## How I built it

* **Gathering is not deciding.** The probe runs inside a document and records what happened, with no opinion about what a pass is. The judge is pure, runs deterministically, and cannot reach a browser.
* **533 unit tests and 98.57% line coverage across 56 files at commit `badb9ce`**, counting each file once against a floor of 85 per file. Five files sit below that floor and the gate names every one instead of averaging it away. The figure carries a commit because it moves whenever a test is added; reproduce it with `node --experimental-test-coverage --test tests/unit`.
* **Dual transports.** The in-browser runner, plus a zero-dependency headless Chrome DevTools Protocol client. No bundler, no test framework, no lock file, no runtime dependencies.

Run it against any page from a terminal:

```
npx --yes https://github.com/upgradedev/ninthtool/tarball/main https://your-page.example
```

The package is not published to npm, so the tarball URL is the whole install.

---

## Safety

By default it calls no tool of yours and submits no form. Calling your read-only tools needs an explicit flag you pass yourself. Submitting a form runs only against the fixture this tool serves itself.

It is not invisible, and that is stated rather than hidden: registering a probe tool is a document-level event that your page can see.

---

## Honest limits

A preregistered study on thirteen independently authored WebMCP pages has run, and **its hypothesis failed**. Five of twenty rows told those pages apart, and every one of them was already readable from the tool list. Taking it apart afterwards showed why: at most two rows could ever have told one of those pages from another, against a threshold of three fixed before anyone looked, and both were switched off by the run's own read-only default. The bar could not be cleared by any result. That is a defect in the protocol, not a measurement of what this tool reaches.

Two findings it did report about strangers' pages were checked against their own source and **retracted as defects in this tool**, with the handler lines cited. One page had rejected the missing argument at its first line. On the other, this tool's own control call was as malformed as the one it meant to break.

That is the thing worth reading. Any suite that runs against pages it does not own will produce false findings. The useful question is whether it catches them and publishes the retraction beside the claim, in the same generated file. It did.

One of the two oracle weaknesses behind those retractions is now closed. The other stays open on purpose: the obvious fix was built, measured against a copy of the tree, and it turned this suite's own flagship true positive into an abstention. That measurement is published rather than the fix.

The protocol was written and committed before any page ran, the failure is published in `evidence/impact/results.md`, and the primary metric was not changed afterwards to make it read better.

**Three rows still fail open, found by an external review of this code and reproduced before publishing.** They are listed here rather than fixed quietly on the last night, because a probe that hides its own fail-open oracles has no business reporting anyone else's:

* **P4** decides provenance with `t.fromThisDocument === false`. A tool whose provenance cannot be read is neither true nor false, so it falls out of the filter and the row reports *all tools were registered by this document*. Unknown is counted as ours.
* **P3** walks only the top level of a schema's `properties`. A nested parameter with no description is never visited, so it passes.
* **D1** listens for a `toolchange` event without correlating it to the tool that should have caused it, so an unrelated event satisfies the row.

A fourth, **P2**, held whenever `type` was `object` and checked nothing else, so `properties: "not-an-object"` counted as a readable schema. That one is closed, with a test that was watched failing first.

Three files sit below the coverage floor on their own. The gate names them instead of hiding them inside the average.

**The demo video was recorded earlier and two of its numbers have since moved.** It says line coverage is ninety seven point eight and that four files sit below the floor. Both were true at the commit it was recorded against. A test added afterwards, closing a defect where six rows printed a command a reader could not run, moved them to **98.51** and **three**. The video was not recut; the README carries the same correction with the command that reproduces either number.

---

## What was reused

The same author has a second entry in this hackathon, **ClaimReady**. Exactly one file is shared: `src/probe/cdp.mjs`, a 200-line Chrome DevTools Protocol client with no dependencies. The README names it with its source commit. Everything else here was written for this entry.

---

## Where to start

Open https://upgradedev.github.io/ninthtool/ and press **Run the audit**. Nothing to install, nothing to sign into. Devpost lists the same two links below.
