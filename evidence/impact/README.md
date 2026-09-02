# The corpus, and how each entry was admitted

`corpus.json` is the population for the preregistered study in `protocol.md`. This file says where
it came from, what was checked, and what a reader has to take on trust. Nothing in the corpus has
been run. Selection and provenance are one job and running the pages is another.

The protocol was committed before any page was selected and its criteria are not adjusted here.
Section 6 holds the five inclusion criteria and all five must hold. Section 7 holds the exclusion
criteria and any one of them is enough. Every entry names the numbered criterion that admitted or
excluded it.

## Where the candidates came from

Five GitHub code searches, run on 2026-09-02, paged to the API limit:

    search/code?q="document.modelContext" "registerTool"
    search/code?q="navigator.modelContext" "registerTool"
    search/code?q="modelContext.registerTool"
    search/code?q="tooldescription=" "toolname=" language:html
    search/code?q="modelContext" "registerTool" language:html

Together they returned **2,884 distinct repository and path pairs across 1,076 distinct
repositories**. Reproduce the repository count with:

    for Q in '%22document.modelContext%22+%22registerTool%22' \
             '%22navigator.modelContext%22+%22registerTool%22' \
             '%22modelContext.registerTool%22' \
             '%22tooldescription%3D%22+%22toolname%3D%22+language%3Ahtml' \
             '%22modelContext%22+%22registerTool%22+language%3Ahtml'; do
      for P in $(seq 1 10); do
        gh api "search/code?q=$Q&per_page=100&page=$P" \
          --jq '.items[] | [.repository.full_name, .path] | @tsv'
        sleep 8
      done
    done | sort -u | cut -f1 | sort -u | wc -l

Two things about that number. GitHub code search returns at most 1,000 results per query, so five
queries give a bounded view of the field and not the whole of it. And the `total_count` GitHub
reports moves between calls, which is why no total is quoted anywhere in `corpus.json`. The pacing
matters as well: an unpaced first attempt was rate limited part way through and silently dropped
pages, and the counts from that attempt were thrown away rather than used.

## How the field was narrowed

**Every one of the 1,076 repositories** had its licence, default branch, homepage and Pages flag
read from its repository record. That pass is the licence census in `corpus.json`, and it is the
single most useful thing the screen produced:

| Licence | Repositories |
|---|---|
| MIT | 479 |
| none found | 371 |
| Apache-2.0 | 107 |
| present but unidentified | 61 |
| AGPL-3.0 | 26 |
| everything else | 30 |
| record could not be fetched | 1 |

Four in ten of the repositories that write a WebMCP tool registration carry no licence that permits
running them for inspection. Under section 6 criterion 3 that removes them, and it removes them
before anything about the code matters.

**52 repositories were then read file by file.** They were ordered by how likely the returned path
was to be a page rather than a library: an `.html` file first, then a `.js` or `.mjs` file outside
`node_modules`, `dist`, `build` and minified bundles. For each one the blob was fetched at the
pinned commit and read for three things:

1. the receiver of the `registerTool` call, because a grep for the method name alone is satisfied by
   a `.d.ts` file, a README code block, or a call on some unrelated object;
2. bare package imports, which mean the page cannot be served without an install step;
3. `<script src>` and `<link rel=stylesheet href>` pointing off origin, which mean the page cannot
   be served without a network.

File by file inspection stopped once the included set passed the protocol's target of ten. So the
52 recorded entries are a screened subset of the 1,076 and not a random sample of it, and the
1,024 repositories with no entry were screened by licence and path only. That is the whole
procedure, stated so a reader can judge it rather than guess at it.

## What came out

**Thirteen included. Thirty-nine excluded.** Protocol section 8 sets the target at `n >= 10` and
says that if fewer than ten are eligible the study is reported as a census. Thirteen are eligible,
so the census framing does not apply and is not claimed.

Every included entry is `local-static`: an HTML page reachable from the pinned commit through a
plain static file server, with no install step and no off origin script. That was a deliberate
choice. Several repositories fail the local limb of criterion 5 but declare a public URL that would
satisfy its other limb. Those URLs were **not fetched**, because selection did no network reads at
all, so nothing here can rest on one. They are recorded as excluded on criterion 5 with the URL
written down and a note saying it was not verified. If a run establishes that one of them answers
anonymously, that entry moves to included, and the note says so by name.

The decisive reason for each exclusion:

| Reason | Count |
|---|---|
| Section 7 bullet 1: the runtime, the standard, or a tool whose subject is the runtime | 12 |
| Section 6 criterion 5: no credential free, network free route to the page | 9 |
| Section 6 criterion 3: no licence permitting local execution | 7 |
| Section 6 criterion 1: a library, integration or type declaration rather than a page | 5 |
| Section 7 bullet 4: a copy with no independent WebMCP code | 4 |
| Section 7 bullet 3: a library's own test fixture | 1 |
| Section 6 criterion 2: the sibling entry | 1 |

Several entries fail more than one criterion. Each names the one recorded as decisive and lists the
others in its notes.

## Three judgements a reader should check rather than accept

**Criterion 1 is about who wrote the registration, not about who wrote the file.** A repository that
only depends on a WebMCP library is not eligible, and neither is one that implements the library.
This is why `angular/angular`, `Automattic/wp-calypso` and `WordPress/wordpress-playground` are out:
in each case the WebMCP path is inside a package that provides the capability to other people's
pages. `google/perfetto` is the interesting one in that group, because it goes the other way. Its
plugin takes `const mc = document.modelContext` and registers on it, so it is a page declaring its
own tools and criterion 1 holds. It is excluded on criterion 5 instead, and its entry says so, so
nobody later reads "excluded" as "not a real WebMCP page".

**One page appeared in four repositories.** `pro-test/welcome.html` resolves to the same blob,
`d95d3d94d74f963e0f6545c8ecaacd4dac342401`, in `arpitagarwala/worldmonitor`,
`arrenzdev/worldmonitor`, `diazaraujo/monitor-integridad-administrativa` and `sifaq00/Helios`. None
of the four is marked as a fork by GitHub, so the flag would not have caught it; the blob hash did.
The earliest created of the four is included and the other three are excluded under section 7
bullet 4, which keeps `n` honest under section 8. A fifth repository, `koala73/worldmonitor`, is
older still and carries a different blob, so it is not a copy and is excluded on criterion 5
instead.

**One licence was read from the file rather than from the API.** `Barrot-Agent/B-Agent` reports
`NOASSERTION` on its repository record, which means GitHub found a licence file it could not
identify. The `LICENSE` blob at the pinned commit is the Apache License 2.0 header. The corpus
records `Apache-2.0` and the entry says where that came from, because a reader who checks only the
API field will see something different. Everywhere else the SPDX id is the API field at the same
commit, and where it could not be established the field is `null` with the reason in `notes`.

## What is not established here

- **No page has been run.** Nothing in `corpus.json` says what Ninth Tool will report.
- **No public URL was fetched.** Every URL in the file comes from a repository's `homepage` field.
- **`entryPoint` is a claim about the checkout, not a measurement.** It says which file a browser
  should open and, where it matters, which directory the static server must be rooted at. That was
  read from the script tags, not tested.
- **Licences are recorded, not interpreted.** The corpus records the SPDX id it read. Whether a
  given licence permits a given use is not decided here beyond criterion 3's plain reading, which is
  that running the program locally to inspect it is permitted.
- **No repository is named as defective.** `included: false` is a statement about one numbered
  criterion, never about the quality of somebody's code. Several excluded entries hold pages that
  would run perfectly well, and their notes say so.

## One note on the style gate, because the scope moved under this work

Selection started from `a1dbaa7`, where `evidence/impact` was missing from `SCANNED_DIRS` in
`scripts/style_config.mjs`. The style gate printed PASS over 74 files while `protocol.md` sat
outside it, and `tests/unit/style_coverage.test.js` was already red for exactly that reason: it
walks the tree and refuses a directory holding a file the gate would scan that is not on the gate's
list. Both files here were therefore written to the gate's rules and checked against them directly,
by importing the real scanner rather than trusting that an unread directory is a clean one:

    node --input-type=module -e "
    import fs from 'node:fs';
    import { findingsForLine } from './scripts/check_style.mjs';
    for (const f of ['evidence/impact/corpus.json','evidence/impact/README.md'])
      fs.readFileSync(f,'utf8').split(/\r?\n/)
        .forEach((l,i) => { const h = findingsForLine(f,l,i); if (h.length) console.log(h.join('\n')); });
    "

That check found two findings, both on the one entry that section 6 criterion 2 rules out, because
naming it tripped the ban on naming our own other entry outside the four files that must disclose
it. While this work was in progress, `497158d` put `evidence/impact` on the gate's list and reworded
criterion 2 to describe that entry rather than name it, which turned a documented conflict into a
settled one. The corpus follows the criterion as it now stands: the entry is recorded, described,
and not named, and the name stays in the root `README.md` where the rules require the disclosure.
The gate now scans 80 files across 17 directories and passes over both files here.
