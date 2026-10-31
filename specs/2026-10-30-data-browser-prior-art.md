# Data browser prior art: Stata, labelled, and missing-coded data

Companion to [2026-10-30-data-browser-redesign.md](2026-10-30-data-browser-redesign.md).

Raven's survey (`raven/docs/superpowers/specs/2026-10-29-data-viewer-prior-art.md`) already covers grid mechanics, RStudio's paging and summary budgets, Positron's general layout, Buckaroo, VisiData and others. This file does not repeat it. It covers what matters for a Stata browser: value labels, the 27 missing codes, display formats, strL, and variable-heavy survey files.

Sight is GPL-3.0. "Copy" means code may be ported with its notice kept. "Study" means design only.

## Raven's current viewer (GPL-3.0, copy)

Raven's viewer is the main reference. What it has, and whether it fits Sight:

| Piece | Raven file | Fit for Sight |
|---|---|---|
| Stable LSD radix sort over 32-bit keys; a class byte splits value / NaN / NA before radix; descending by bit complement | `radix.ts` | Port. Generalize the class split to 28 classes (value, `.`, `.a` … `.z`). dta-parser 1.0's `missing` array (0, or 1–27) is that class byte. |
| Rank sort for strings: distinct values sorted once, rows radix-sorted by rank | `radix.ts` `rankDistinct`, `sort.ts` | Port. A labelled column sorted by label is a rank sort over its few distinct labels. |
| Byte-bounded sort-key cache (512 MiB), keys over all rows so a sort under a filter sorts survivors only | `sort.ts` `SortKeyCache` | Port. |
| Scan worker + reader thread; host is the commit authority (prepare/commit/abort, generations, adoption acks) | `worker-engine.ts`, `transform-coordinator.ts`, `scan-core.ts`, `reader-core.ts`, `threads/` | Port the scan worker, its `ThreadClient` restart/terminate logic and the generation discipline. Do not port the reader thread until measurement shows the host's viewport reads miss their budget (redesign spec, "Viewport reads stay on the host"). |
| Regex filters cancelled by terminating the worker; a 10-minute deadline | `worker-engine.ts` `terminateAndRestart`, `panel.ts` | Port. |
| Profiles: two-pass moments, exact distinct up to 100k then HyperLogLog, Space-Saving top values, reservoir quantiles, exact quantiles from a cached sort key | `profile-engine.ts`, `sketches.ts`, `profile-scheduler.ts` | Port `sketches.ts` and the profile logic. Add per-missing-code counts. |
| Histograms with edge-corrected bin index, half-open bins, last bin closed | `histograms.ts` | Port `binIndex`. Sight's current `compute_histogram` uses a plain `Math.floor`. |
| Find (displayed text, refinement over previous matches), go to row | `find.ts` | Port the structure. Matching must use Sight's display (labels, formats, missing codes). |
| Tile cache by (row page, column page), pinned viewport tiles | `webview/tile-cache.ts` | Port. Sight's webview requests all columns of a row page today. |
| Gutter showing the source row number; display-column mapping; pins; header slots; summary band; Columns sidebar | `webview/display-columns.ts`, `header-layout.ts`, `summary-band.ts`, `columns-sidebar.tsx` | Port, adapted to Stata (`_n` in the gutter, storage type tags, value-label indicator). |
| Truthful display: missing never blank, `###` for numbers that do not fit, never for labels | `display-format.ts`, `webview/App.tsx` | Port the rules. Formatting itself comes from dta-parser (below). |
| Benchmark harness with event-loop measurement and budgets | `tests/bun/bench/data-viewer/` | Sight's harness (`scripts/bench-data-browser/`) follows the same method but drives Sight's real panel through a fake webview. |

Not applicable: Arrow IPC reading (`arrow-reader.ts`, `arrow-ipc.ts`, `batch-iter.ts`), Copy as R code, factors and dictionary paths, row names, NA vs NaN, BigInt keys, POSIXct zones, locale collation as the default.

Raven's reviewer history (revisions 1–12 of its spec) is a list of objections this plan must also answer: shared mutable state across threads, what the screen shows versus what the reader serves during cancel and reload races, exactness labels on estimates, buffer lifetime, and claims without measurements. The redesign spec answers each in "Review history carried over from Raven".

## table-viewer (github.com/jbearak/table-viewer, GPL-3.0, copy)

Uses `@jbearak/dta-parser` 0.6 (`src/data-source/dta-source.ts`, `file-dta-source.ts`).

- **Missing identity.** `src/data-source/stata-missing-cell.ts` gives each missing code a comparison key (`stata:missing:.a`). A test (`src/test/stata-missing-comparison.test.ts`) checks that all 27 codes stay pairwise distinct, and distinct from the string `".a"`, through sort, filter and diff. Sight should carry the same test.
- **Categorical heuristic.** A column defaults to categorical only if its value-label set labels at least one non-missing value. A set that names only `.d`/`.r` does not turn a continuous variable into a category list.
- **strL.** Text strLs decode through a bounded LRU. Binary strLs render as `binary (N bytes): <first 32 bytes hex>…`.
- **Bounds.** Label tables are capped (65,536 entries, 16 MiB) and parsed lazily, only for referenced sets.
- **Encoding.** `TextDecoder('iso-8859-1')` actually decodes Windows-1252; pre-118 files need care (`docs/plans/stata-stage4-blockers.md`). dta-parser 1.0 takes an explicit encoding.
- No label-vs-code cue, no variable labels in headers.

## Stata's Data Editor and `browse` (proprietary, study)

Sources: [D] edit (stata.com/manuals/dedit.pdf), [GSW] 6 and 9.

- **Colour carries meaning.** Strings red, value labels blue, other values black (configurable). Blue tells you a cell shows a label, not the stored value.
- **Missing codes are never blank.** A missing value with a value label shows the label (blue); without one, the literal `.` or `.a`. Missing values sort `. < .a < … < .z`, after every number.
- **`browse, nolabel`** shows codes. Copy uses labels by default, with a preference to copy numbers.
- **Variables pane.** Checkbox per variable to hide/show, drag to reorder the view. Its filter box ignores case and matches names *and* variable labels.
- **Properties pane.** Name, label, type, format, value label, notes for the selected variable.
- **Go to.** The cursor box shows `varname[obs]`; typing `rep78 74` jumps there.
- **Filter observations** takes a Stata expression. With an `if`/`in` in effect, sorting is disabled.
- **Long strings** get a tooltip; double-click opens a viewer.
- **Pins** for variables and observations. "Show variable labels in column headers" is a View option.

## Positron Data Explorer (Elastic 2.0, study) and ark (MIT, copy)

- Profiles are computed asynchronously for visible columns only; sort and filter run in the backend and return row indices.
- **Missing values collapse on the wire.** The only special codes are NULL, NA, NaN, NaT, None, ±INF (`tableDataCache.ts`). No tagged or extended missing reaches the UI.
- **haven_labelled is typed as String** in ark and converted with `as_factor` before profiling, so numeric statistics disappear; the frequency table drops missing rows (`x[!is.na(x)]`). Zero-count labels are kept, which is good.
- Variable labels appear only on hover (positron#14239 asks for header labels).
- Column search matches names only.

## Data Wrangler (Microsoft, proprietary, study)

A quick-insights row under each header: missing count, distinct count, distribution or top values. Opens no `.dta` or `.sav` directly; Stata data arrives through pandas with its missing values already collapsed. No value or variable labels. The idea worth taking is the glanceable header line; the single "missing" number is what to avoid.

## R, Python, Julia, SPSS

- **RStudio `View()`** (AGPL-3, study) shows the variable label under the name, but formats haven_labelled as codes and then overwrites every tagged NA with plain NA (`formatted[is.na(col)] <- NA`, `SessionDataViewer.R`). The clearest instance of the collapse pitfall.
- **pillar's haven_labelled printing** (MIT, copy): `1 [Male]`, `NA(a) [Refused]`. Code first and aligned, label as an annotation. The best existing "both" display.
- **labelled `look_for()`** (GPL ≥ 3, copy): searches names, variable labels and value labels; its dictionary columns (variable, label, type, missing, value labels, unique values, range) are a model for a variables sidebar.
- **pandas `read_stata`** (BSD-3): missing codes become NaN by default; `convert_missing=True` keeps them only as object-dtype `StataMissingValue`s. `convert_categoricals=True` replaces codes with labels, and the codes are gone. Used here as an independent oracle for the benchmark fixtures.
- **pyreadstat** (Apache-2.0): NaN by default; `user_missing=True` keeps `'a'`–`'z'`.
- **ReadStatTables.jl** (MIT): tagged missing becomes plain `missing` on read, leaving labels for tagged values that no cell can show.
- **SPSS** (proprietary, study): a toolbar toggle switches codes and labels; user-missing values stay visible as codes or labels. FREQUENCIES splits rows into Valid and Missing, one row per missing code, with Percent and Valid Percent. Stata's `tab x, missing` lists `.` and `.a` separately too.

## What the survey implies for Sight

1. Keep all 27 missing identities from the reader to the pixels: display, sort, filter, counts, copy.
2. Never render a numeric missing as blank. A labelled missing shows its label, styled as both missing and label, so "Refused" is not read as an answer.
3. Three label modes: Values, Labels, Both (`1 [Yes]`, `.r [Refused]`). Mark label text with a theme-mapped colour, as Stata marks labels blue. Codes without a label in a labelled column look different, which exposes stray codes.
4. Frequency tables for labelled variables split Valid / Missing like SPSS, include zero-count labels and unlabelled codes, and filter on click.
5. A variables sidebar that searches names, variable labels and value-label text.
6. A missing bar per header split into system (`.`) and extended (`.a`–`.z`), with per-code counts on hover.
7. strL cells show a truncated preview with a length; the full text loads on demand. No page response inlines a multi-kilobyte payload.
8. Go to `varname[obs]` / `varname obs` / `obs`, and a gutter that shows `_n`, not the display position.
9. Missing codes sort among themselves in Stata's order.
10. Filters choose which missing codes to keep, not one "include missing" switch.

Pitfalls: collapsing extended missings; blank missing cells; labels with no cue and no way back; typing labelled numerics as strings; frequency tables that drop missing rows or zero-count labels; names-only search; unbounded label tables or strL payloads; display mode silently changing sort or filter semantics.
