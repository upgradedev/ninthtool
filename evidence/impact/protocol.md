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

None.
