# Evidence

Every measurement this repository states, with the command that produced it and the date it was
taken. Nothing here is copied from documentation.

## The environment

| | |
|---|---|
| Browser | **Chrome 152.0.7977.65**, stable channel, Windows 11 |
| Launched with | `--headless=new --disable-gpu --enable-features=WebMCP --remote-debugging-port=9333 --user-data-dir=<throwaway>` |
| Pages served by | `python -m http.server --bind 127.0.0.1` |
| Driver | `src/probe/cdp.mjs`, a dependency free Chrome DevTools Protocol client |
| Date | **2026-09-01** |

The documented route for enabling the feature in a browser you drive yourself is
`chrome://flags/#enable-webmcp-testing`. The command line switch above is what these runs used.

## Reproducing all of it in one command

```bash
node bin/ninthtool.mjs
```

That starts a loopback server for the bundled subject page, launches your Chrome with the feature
on in a throwaway profile, drives the page and prints one block per behaviour with what was expected
and what was seen. No arguments, no separate terminal, nothing installed.

One behaviour at a time:

```bash
node bin/ninthtool.mjs --behaviour B1
```

## What was measured, on the day

Both surfaces, the page and the command line runner, produced the same verdict:
**12 of 14 promises broken, 2 kept, 0 unobserved.**

| id | verdict | what was observed |
|---|---|---|
| A1 | broken | `arguments.length=1`, `typeof options=undefined`, no signal |
| A2 | broken | `typeof tool.inputSchema === "string"` |
| A3 | broken | annotations read back: `readOnlyHint`, `untrustedContentHint` |
| B1 | broken | `isError` envelope resolved; throw and `DOMException` both rejected as `UnknownError` with the page's reason gone |
| B2 | broken | the promise resolved, so the caller reads success |
| B3 | broken | 4 of 6 annotations dropped with no error |
| B4 | broken | `typeof tool.annotations === "undefined"` on a form derived tool |
| B5 | broken | a string handler and an object handler both returned `typeof "string"` |
| C1 | broken | the call resolved, and the handler was handed `M. Okafor` from the previous call |
| C2 | broken | signal in the options bag withdraws; signal on the descriptor does not, and nothing is thrown |
| C3 | broken | script registered tools do not enforce, form derived tools do |
| C4 | broken | never settled, still pending after 2502 ms |
| D1 | **holds** | 1 event on register, 1 on withdraw |
| D2 | **holds** | synthesised descriptions, numeric bounds, enum and a required list |

## The page, driven end to end

Pressed the button a visitor presses, through the same flagged Chrome:

| step | result |
|---|---|
| the page boots | 14 cards, 4 groups, 3 tools published, no blocking message |
| tool aggregation | 5 tools visible: 3 from the page, 2 from the same origin subject frame |
| the audit | 12 broken, 2 kept, 0 unobserved, in **4033 ms** |
| the ninth tool appears | 5 tools before the run, **6 after**, `nt_get_findings` present |
| an agent reads the findings | `executeTool` returned the findings as structured JSON |
| the ninth tool withdraws | 6 tools before clearing, **5 after**, `nt_get_findings` gone |

## The cross origin boundary, measured rather than assumed

An auditor page with one tool of its own loaded two frames of the same document, one same origin and
one on a different origin of the same server.

```
sameOriginIframeToolsVisible : true      (3 tools, each with tool.window === that frame)
crossOriginIframeToolsVisible: false     (0 tools)
```

The top document could also execute a tool registered inside the same origin frame. This is the
measurement that decided the shape of the product: an in page auditor can drive any page it can host
on its own origin and nothing else.

## The counts in this repository

| Claim | Command |
|---|---|
| unit tests | `node --test tests/unit` |
| style gate scope | `node scripts/check_style.mjs`, which prints the files scanned and the directories declared |
| the gate can fail | `node scripts/check_style.mjs --selftest` |
| every judge rule can fail | `node --test tests/unit/verdict_mutations.test.js` |

## Honesty notes

**The catalogue's stored values are a snapshot.** They were taken against one build on one day. The
reading the page gives you is what your browser does now, and where the two differ your browser is
the newer fact. The page says so on itself.

**The console is not silent during a run.** Behaviour B1 can only be asked by throwing inside a tool
handler and rejecting with a `DOMException`, and Chrome logs both. Four entries appear while the
audit runs, from tools this suite registered and withdrew. The page is quiet before and after.

**`consequentialHint` is reported as a divergence, not a gap.** It is in current Chromium IDL and
absent from this build, so it is newer than 152. Nothing here claims it works.
