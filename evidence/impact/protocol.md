# Preregistered protocol: what Ninth Tool finds on independently authored WebMCP pages

**Written before a single external page was run.** Nothing below may be edited after results exist.
Corrections append, with a date and a reason, under `Amendments`.

Frozen Ninth Tool commit: `6bcf551e165843731340c74c550b4442b6bc8cab`
Written: 2026-09-02, 14:45 UTC
Browser: whatever `node bin/ninthtool.mjs` launches, recorded per run, with
`--enable-features=WebMCP` in a throwaway profile.

---

## 1. The primary hypothesis

A reading of what a page DECLARES cannot see behaviours that only appear when a tool is called or
registered. So on independently authored WebMCP pages, Ninth Tool reports actionable findings that
a declaration-only reading of the same page cannot produce.

The hypothesis is about the METHOD, not about the products in `docs/prior-art.md`. Several of those
execute tools; the comparison below is against a declaration-only reading, named as such.

## 2. The primary metric

For each page in the corpus:

> **the number of catalogue rows that reached a verdict and could NOT have been reached from the
> tool list alone.**

`decidability()` already partitions the catalogue into `metadata` and `execution`. A row marked
`execution` needs a tool to be called, or one of ours registered. That partition was written before
this study and is not adjusted for it.

Reported per page and summed. `n` is the number of pages that ran.

## 3. Secondary metrics

- rows that reached a verdict at all, against 20
- rows that ABSTAINED, and why, because an abstention is a result
- findings carrying a one-command reproduction, which should be all of them or the claim is false
- wall clock per page
- pages where Ninth Tool itself failed, refused, or crashed

## 4. Success threshold

The hypothesis holds if, across the corpus, the median page yields **at least three** verdicts on
`execution` rows that a declaration-only reading could not produce.

**Chosen before any page was run.** Three, because a claim resting on one row is a claim resting on
one row.

## 5. What failure looks like, and it gets published

- Fewer than three: the hypothesis fails and `results.md` says so in its first line.
- If most pages abstain, the honest reading is that the instrument does not generalise beyond its
  own fixture, and that is the finding.
- Losing cases are NOT removed. A page that ran and produced nothing stays in the table with its
  reason.

## 6. Inclusion criteria, fixed now

A repository is eligible when ALL hold:

1. It calls `registerTool` on `document.modelContext` or `navigator.modelContext` in code it
   authored. A repository that only DEPENDS ON a WebMCP library is not eligible.
2. It is not this repository, and not the author's other entry in this hackathon, which is
   named in `README.md` where the rules require the disclosure.
3. It carries a licence permitting local execution for inspection.
4. A specific commit can be named.
5. A page can be served locally from that commit without credentials, without a network, and
   without a build that reaches outside the checkout, OR it exposes a public URL that can be read
   without an account.

## 7. Exclusion criteria, fixed now

- The WebMCP polyfill, the W3C incubation repository, WPT, and any tool whose subject is the
  runtime rather than a page. Those are comparators or the standard, not corpus.
- Anything requiring a login, a key, or a paid service.
- Anything whose only WebMCP code is inside a test fixture for a WebMCP library, because that is
  the library's own fixture and not an independently authored page.
- Forks with no independent WebMCP code.

## 8. Target n

**`n >= 10`.** If fewer than ten are eligible, the study is reported as a **census of every
repository meeting the criteria above**, with the number found, and never as a sample. `n` is not
inflated by counting several pages from one repository as several entries.

## 9. Comparators

1. **Declaration-only reading**, which is an ablation of this tool and is NAMED as an ablation, not
   presented as a third-party product. It is the `metadata` partition of the same catalogue, run on
   the same page, at the same commit.
2. At least one **named third-party checker** from `docs/prior-art.md`, included ONLY if it can be
   run on the same page and the same task without special access. If none can be run fairly, that
   is recorded as a limitation and no third-party number is invented.

## 10. Safety, and it binds

- Runs are **read-only by default**. `--allow-tool-calls` is used only where the page's tools are
  marked `readOnlyHint`, and its use is recorded per run.
- **`--allow-fixture-forms` is never used against an external page.** Since `6bcf551` the runner
  refuses to write to a fixture it does not own, so this is enforced by code as well as by rule.
- No external network writes. No forms submitted anywhere. No issues filed, no messages sent.
- Public URLs are read anonymously. Local checkouts run from an exact commit in a throwaway
  directory with no credentials present.
- No page is named as defective in any judge-facing document without the owner's explicit approval,
  and no third party is contacted by an agent.

## 11. Analysis rules

- The metric is computed by a script from the raw run files. No number is typed by hand.
- `results.md` is generated and the generator is committed. CI compares the generated output with
  the committed one byte for byte.
- Runs that error are reported as errors, not dropped.
- The primary metric is not changed after results exist. If a better metric becomes obvious, it is
  reported as a SECONDARY one and labelled post hoc.

## 12. What this study cannot show

It cannot show adoption, willingness to pay, or that any maintainer agrees a finding matters. It is
a measurement of what one instrument reports on a defined population of pages, at one commit, in one
browser version. Any sentence in a judge-facing file that implies more than that is wrong.

---

## Amendments

### 2026-09-02, after the thirteen runs existed. Two reporting defects, and the primary metric stands.

Both were found by looking at the generated numbers rather than at the code, and both are recorded
here because the protocol says corrections append instead of overwriting.

**One.** The first generated `results.md` read *"The hypothesis holds on this population"* on a
median of 8 against a threshold of 3. It was wrong. Every one of the twelve judged pages had
returned the SAME eight execution verdicts, so the metric had one value for the whole population
and could not have distinguished a page from a browser. Nothing in the metric could report that,
because a median does not know whether its inputs varied. `report.mjs` now computes, from the run
files, whether any `execution` row varies across pages, and the headline is decided by that.

**Two.** The corrected version then stated, as a measured fact, *"13 of 13 pages exposed zero tools
of their own."* That was a misspelt field: the transcript publishes `pageTools` and the report read
`transcript.tools`, which is `undefined` on every run and reports zero. Seven of the twelve pages
had published between 2 and 14 tools. A wrong field name does not throw, it returns a number, and a
number in a generated table is believed.

**The primary metric and its threshold are NOT changed**, and the median of 8 is still reported.
Section 11 forbids changing it once results exist, and it would be self-serving to swap a metric
that technically passed for one that says something better. The reading that the execution rows
measure the browser rather than the page is reported as a SECONDARY, post-hoc result and labelled
so in `results.md`.

**What the study is now understood to have measured**, stated plainly: 5 of 20 rows vary between
pages and all 5 are `metadata` rows, so on this population Ninth Tool did not produce page-specific
findings beyond what a declaration-only reading reaches. The preregistered hypothesis fails.

### 2026-09-02, later. The threshold in section 4 was unreachable when it was written.

Taking the 13 `execution` rows apart, which nobody did before fixing the threshold at three:

- 8 register this tool's own probe tools and read what the browser does with them. One browser, one
  answer, identical on all 12 pages.
- 3 need a form submitted. Since `6bcf551` the runner refuses to write to a fixture it does not own,
  so on an external page they can never settle.
- 2 read the page's own tools, and both abstained on every page because no corpus entry authorised a
  tool call.

So at most **two** rows could ever have told one page from another, against a threshold of **three**.
The bar could not be cleared by any result, which is a defect in this protocol rather than a finding
about the instrument.

**The threshold is NOT lowered and the metric is NOT changed.** Section 11 binds, and moving a bar
after seeing that it cannot be met is the exact move this protocol exists to prevent. What changes
is the EXPLANATION in `results.md`, which had attributed the flat result to the tool's reach when the
measured cause is this study's own read only default. A false statement in the modest direction is
still false.

A second wave running the four pages whose tools are marked `readOnlyHint` under `--allow-tool-calls`,
which section 10 already authorises, would let those two rows speak. If it is run it is reported
separately and labelled a second wave, and the primary result above stands as published either way.

### 2026-09-02, later still. The second wave ran, and neither row told one page from another.

Reported in `results-wave2.md`, generated by the same generator. The primary result above is
untouched: `results.md` gained one cross-reference and not one number changed.

Selection was by rule, not by hand: every wave 1 page that published at least one tool it annotated
`readOnlyHint`, read back out of the wave 1 run files. That came to four. Each row was run in its own
process, because P6 issues N squared plus 3N calls at up to 2500 ms each and the CLI gives the whole
evaluation 120 seconds.

**Each row settled on some pages and abstained on others, and counting only the verdicts that
SETTLED, neither row varied.** P5 settled twice and said `fail` both times. P6 settled once. A row
with one settled result has nothing to differ from.

**The first version of this amendment said both rows discriminated, and that was wrong.** It counted
`not-applicable` as a verdict, so a row that settled here and abstained there looked like a row
telling two pages apart. It is not: the settled-or-abstained split is decided before a single tool
is called, by the declared schemas alone. P6 refuses below two read only tools
(`src/probe/observe.js:1011`) and P5 needs a required property that appears in its own schema
(`:908-922`). That is variation a declaration only reading already reaches, which is precisely what
this wave existed to rule out. The generator now counts over settled verdicts and says so itself.

**Both findings are retracted, and they were about somebody else's code.** `recommend_provider`
rejects the omitted property at `assertObject`, before its body runs; this instrument misread a
redacted error envelope that RESOLVES rather than rejects. `getAvailability` does read `startDate`;
the comparison leg was worthless because `synthesiseArguments` ignores `format` and sent the string
`ninthtool` for a date, so the well formed call was as broken as the deliberately broken one. Both
retractions are published in `results-wave2.md` with the handler citations, read from
`grounding.json` so they are data rather than prose.

**Two instrument weaknesses, one now closed and one open with a measured reason.**

`P5` is CLOSED, 2026-09-03. The row no longer scores a tool whose schema declares `format`,
`pattern`, `minLength`, `maxLength`, `multipleOf` or an exclusive bound, nor one whose required
property has a type this suite cannot build. It skips the tool and quotes the constraint it cannot
honour. The guard reads the SCHEMA and never the outcome, so it cannot fire in response to a defect
being found, and a test named for that holds a tool which ignores a plain string argument and
asserts the row still fails it. The wave was re-run afterwards: both false findings are gone and
neither page is blamed for anything.

`P6` is OPEN and stays open. Excluding oracles that only appear to answer was implemented against a
copy of the tree and measured: `controlAnswered` is the row's arity gate, read before stability and
before the moved list, so any subtraction from it vetoes the whole row. The suite's own flagship
true positive, a `readOnlyHint` tool that answers a constant while silently moving state another
tool reports, turned from `fail` into `not-applicable` while the correct finding stayed in the
transcript. A false pass traded for a false silence is not a fix. What changed instead is the
sentence the row publishes: it now says the tools returned something, and that a resolved error
envelope cannot be told apart from an answer, which is what the code's own docblock already said and
the published sentence did not.

**What survives.** Authorising the calls moved two rows from abstaining everywhere to settling
somewhere, which is a reach result and not a discrimination result. The preregistered failure stands
and was never in question: two rows against a threshold of three.

**The honest limit on the safety story.** `readOnlyHint` is the page's own claim, and this suite
exists to doubt exactly that class of claim. What is enforced is narrower: nothing outside a page's
own declared read only set is ever SELECTED for calling, at `src/probe/observe.js:903` and `:1010`
by a strict `=== true`. That rests on the code path and not on the records, because no run stores a
ledger of the calls it made. `launchWorldMonitor` was excluded by that filter and the exclusion is
visible in the run record.

**And the browser had unrestricted network egress**, which the first version of this amendment did
not say. `src/probe/launch.mjs` sets no proxy and no resolver rule, and `worldmonitor-pro-test`
loads an analytics script from a third party host on load, in wave 1 as well as wave 2. Nothing was
submitted anywhere, and a request did leave this machine. The Downloads folder held 121 entries
before the eight runs and 121 after, counted by hand once.


## Amendment, 2026-09-04: three statements above are withdrawn

Appended rather than edited, as the header requires. Nothing above is changed.

**1. The reach claim is withdrawn and narrowed.** The `What survives` paragraph says authorising the
calls moved *two* rows from abstaining everywhere to settling somewhere. Counted from the eight
records in `evidence/impact/runs-wave2`, one did:

| row | runs | settled | where |
|---|---|---|---|
| P5 | 4 | **0** | abstained on all four |
| P6 | 4 | **1** | `pass` on `comicsol-web`, abstained on the other three |

So the reach bought by authorisation is one row on one page. The discrimination result is unchanged
and was never in question: two rows against a threshold of three, fixed before anyone looked.

**2. The settled counts at the paragraph beginning `Each row settled on some pages`** were taken
before the P5 schema guard landed. Re-counted from the same directory today they read as the table
above. The conclusion that paragraph draws is unaffected: a row with one settled result still has
nothing to differ from.

**3. The frozen commit in the header is the commit this protocol was written at, not the commit the
runs executed.** Recorded here so a reader can check out what actually ran. Wave 1 records name
`c4104380e7a3`. Wave 2 records name `92d12e7028d1 (clean)`. Where a record says the tree was dirty, the commit is a hint
about when, not a provenance that can be checked out, which the wave 2 provenance table already
prints in full.

**4. The `browser` column in `results.md` was not a browser.** It recorded
`Opening in existing browser session.` on all thirteen wave 1 rows. That is what `chrome.exe
--version` prints on Windows when a Chrome is already open, because the call is forwarded to the
running instance. The study rested on `one browser version` and named no browser anywhere. The
report now reads `transcript.meta.userAgent`, reported by the browser the probe actually drove over
the same DevTools session that ran the behaviours, which is the stronger evidence and was in the
artifact all along: twelve of thirteen read `HeadlessChrome/152.0.0.0`, and `incident-command`,
which never reached a page, reads `not recorded`. No count, threshold or verdict moved.
