# Data Browser: Spec/Plan vs Implementation Deviations

This document catalogues every meaningful difference between the spec
(`specs/sight_data_browser.md`), the implementation plan
(`.claude/plans/data-browser.md`), and the code that was actually written.

---

## 1. File I/O: readFileSync, not mmap

**Spec said:** "memory-mapped `.dta` file access" and "random access backend"
with `fd.read()` calls against file descriptors.

**Implementation:** `fs.readFileSync()` loads the entire file into a Node.js
Buffer, which is converted to an ArrayBuffer. All reads are ArrayBuffer offset
math — no file descriptor is held open.

**Why:** The spec's mmap/fd.read approach is optimal for huge datasets
(50M rows) where you never want the full file in memory. But Node.js has no
built-in mmap, and the `vview.ado` command writes a temp `.dta` that typically
fits in memory (users can cap it with `Rows()`). For M0–M2, readFileSync is
simpler, correct, and fast. The unlink-on-open pattern still works because the
ArrayBuffer retains the data after unlink. If performance profiling shows memory
pressure on large datasets, mmap can be retrofitted behind the same
`DtaFile.open()` API without changing any callers.

**Impact:** Memory usage scales linearly with file size instead of being bounded
by the page cache. Acceptable for the initial implementation; revisit in M3 if
profiling warrants it.

---

## 2. Grid: HTML table, not glide-data-grid

**Spec said:** Evaluate glide-data-grid (React, canvas-rendered), ag-grid, or a
custom canvas renderer. The spec strongly implies a virtualized grid capable of
millions of rows.

**Plan said:** "Initial HTML table grid (canvas grid upgrade is M3)."

**Implementation:** A plain `<table>` element with sticky headers, rendered via
inline JavaScript in the webview. Rows are appended to the DOM as they load.
No React, no canvas, no virtual scrolling.

**Why:** The plan explicitly deferred the canvas-rendered grid to M3. A plain
table is the fastest path to a working end-to-end pipeline (Stata → signal →
parse → webview). It validates the entire architecture before investing in a
complex grid library. The table approach has known limitations: DOM performance
degrades above ~10K rows, no column resizing, no cell selection. These are M3
concerns.

**Impact:** Datasets above ~10K rows will feel sluggish. The lazy loading
mitigates this somewhat (only loaded rows are in the DOM), but a full
scrollbar-to-arbitrary-position UX requires virtualization. The postMessage
protocol and page cache are already designed for the virtual grid — the upgrade
is a webview-only change.

---

## 3. Missing value classification: lost in read_rows

**Spec said:** "Stata's extended missing values (`.`, `.a`–`.z`) rendered in
gray italic."

**Implementation:** The data reader returns `null` for ALL missing values —
system missing (`.`) and extended (`.a`–`.z`) are indistinguishable. The
`CellValue.missing_type` field exists but is always set to `'.'`.

**Why:** The data reader decodes cells from raw bytes and returns
`number | string | null`. To preserve the specific missing type, the reader
would need to return a richer type (e.g., `{ value: null, missing: '.a' }`)
or the caller would need to re-examine the raw bytes. The `missing-values.ts`
module CAN classify extended missing values, and the raw byte offsets ARE
available — but wiring the classification into the read pipeline was deferred
to keep the initial implementation simple.

**Impact:** Users see `.` for all missing values. Stata power users who rely on
extended missing values (`.a`–`.z`) to encode different reasons for missingness
will lose that information in the browser. This is a real usability gap to fix.

**Fix path:** In `data-reader.ts`, when a missing value is detected, call
`classify_missing_value()` and return a tagged object instead of bare `null`.
Or add a parallel "missing type" array to each row.

---

## 4. Missing value bit patterns: spec was wrong for float

**Spec said:** Missing values use IEEE 754 patterns starting at
`0x7FE0000000000000` for doubles.

**Implementation found:** The spec's double pattern is correct, but:
- **Float** missing values use a completely different bit pattern:
  `.` = `0x7F000000`, each letter adds `0x800` (not analogous to double).
- **Double** extended missing letters are in byte 2 (big-endian), not bytes 6–7
  as the plan's `missing-values.ts` initially assumed. The actual pattern is:
  `.` = `7F E0 00 00 00 00 00 00`,
  `.a` = `7F E0 01 00 00 00 00 00`.

**Why:** The spec gave the double constant correctly but didn't detail the
float encoding. The plan's `missing-values.ts` was written from the spec's
description; the data reader discovered the real patterns when testing against
Stata-generated fixtures.

**Impact:** The `missing-values.ts` module's `is_missing_value()` function for
float/double types does NOT match how the data reader actually detects missing
values. The data reader bypasses `is_missing_value()` entirely and uses its own
inline raw-byte checks. The two implementations are redundant but not
contradictory — `missing-values.ts` works for values already decoded to JS
doubles; the data reader checks raw bytes before decoding.

---

## 5. v117 type codes: modern Stata writes v118 codes in v117 files

**Spec said:** v117 type codes are 251–255 for numerics.

**Implementation found:** Stata 16+ `saveold, version(13)` writes v118/v119
type codes (65526–65530) into the v117 file format. The header says "117" but
the type code section uses the modern codes.

**Why:** Discovered during testing against real fixtures. The plan's
`byte_width_for_type_code()` originally had strict v117 = old codes, v118+ =
new codes. The implementation added a fallback: when parsing v117, if a code
doesn't match the legacy table, try the v118 table.

**Impact:** Without this fix, the parser would crash on any v117 file saved by
modern Stata. This is a correctness fix not anticipated by the spec.

---

## 6. v119 format: indistinguishable from v118 for normal datasets

**Spec said:** Support v117, v118, and v119 as three distinct formats.

**Implementation found:** `auto_v119.dta` saved by Stata 18 is actually tagged
as v118 in its header. Stata only uses the v119 format (with 4-byte K and
8-byte N) when K > 32,767 or N > 2,147,483,647. For normal datasets, `save`
produces v118.

**Why:** The v119 format is an extension of v118 for extremely large datasets.
Most users will never encounter a true v119 file. The parser supports v119's
wider fields (uint32 K, uint64 N) but all test fixtures happen to be v118.

**Impact:** The v119 code path is implemented but not tested against a real v119
file (would need a dataset with >32K variables or >2B observations). The header
parser handles it correctly in theory — the cross-version consistency tests
validate that the v119 fixture parses identically to v118.

---

## 7. Sidecar JSON: simplified fields

**Spec said:** The sidecar includes `timestamp`, `source`, `varlist` (array),
`if` (string), and `in` (string).

**Implementation:** The sidecar includes `version`, `uuid`, `name`, `dtapath`,
`N`, `k`, `replace`, `subsetted`. It omits `timestamp`, `source`, `varlist`,
`if`, and `in`.

**Why:** The spec's sidecar example was aspirational. The reference
implementation in the spec's own `vview.ado` code (which we followed) writes
the simplified format. The omitted fields are nice-to-have metadata but aren't
consumed by the extension — the extension only needs the UUID, name, path,
dimensions, and replace flag. Adding `timestamp`, `source`, etc. would require
more complex Stata string escaping for JSON and more sidecar validation, with
no immediate benefit.

**Impact:** The status bar could show the source file path and filter
expression if the sidecar included them. This is easy to add later by extending
both `vview.ado` and `VviewSidecar`.

---

## 8. Signal watcher: fs.watch, not chokidar

**Spec said:** "Node's `fs.watch` (or a library like `chokidar`)."

**Implementation:** `fs.watch()` with `'rename'` event filtering.

**Why:** The plan chose `fs.watch` over chokidar to avoid adding a dependency.
`fs.watch` is sufficient for this use case (watching a single directory for new
files). Chokidar would add ~400KB to the bundle and handle edge cases (symlinks,
network drives) that aren't relevant here — `~/.sight/browse/` is always a
local directory.

**Impact:** `fs.watch` has known platform quirks (duplicate events on macOS,
missing filename on some Linux kernels). The `'rename'` filter and the
try/catch around file reads handle these gracefully. If users report missed
signals, chokidar is a drop-in replacement.

---

## 9. Property naming: snake_case vs camelCase

**Spec said:** `valueLabelTables`, `datasetLabel`, `readRows`, `colStart`,
`requestId`, `hasValueLabels` (camelCase).

**Implementation:** `value_label_tables`, `dataset_label`, `read_rows`,
`col_start`, `request_id`, `has_value_labels` (snake_case).

**Why:** The codebase convention (CLAUDE.md) mandates snake_case for local
variables and many exported APIs. The spec was written before implementation
and used JavaScript-conventional camelCase. The implementation followed the
codebase's established style.

**Impact:** None — the names are internal. The postMessage protocol types use
snake_case consistently on both sides of the webview boundary.

---

## 10. VariableInfo: extra fields

**Spec said:**
```typescript
interface VariableInfo {
  name: string;
  type: DtaType;
  format: string;
  label: string;
  valueLabelName: string;
}
```

**Implementation adds:** `type_code: number`, `byte_width: number`,
`byte_offset: number`.

**Why:** The data reader needs `byte_width` and `byte_offset` for random-access
row reads. The `type_code` is useful for debugging. These fields are internal to
the parser and don't leak to the webview (the `MetadataMessage` sends a
simplified `VariableDescription`).

**Impact:** None — additive, no breaking change.

---

## 11. Webview toolbar: partial implementation

**Spec said:**
- Toggle value labels on/off
- Toggle display formats on/off
- Search/filter (column-level text filter)
- Row count indicator
- Copy selection to clipboard (as TSV)

**Implementation:**
- Toggle labels: button exists, active by default (functional)
- Toggle formats: button exists but non-functional (marked "future")
- Search/filter: not implemented
- Row count: implemented
- Copy-to-clipboard: not implemented

**Why:** The plan deferred search/filter, copy, and full format toggling to M3.
The initial grid needed to be functional but not feature-complete.

**Impact:** Users can view data and toggle labels. They cannot search, filter,
or copy. These are M3 features.

---

## 12. Unlink-on-open: implemented differently than described

**Spec said:** "Immediately `fs.unlink` the `.dta` file while keeping the
mmap / file descriptor open."

**Implementation:** Unlinks after `DtaFile.open()` completes (which reads the
entire file into an ArrayBuffer). There is no mmap or open file descriptor — the
data lives in memory. The unlink removes the temp file from disk.

**Why:** Since the implementation uses readFileSync (deviation #1), the
unlink-on-open pattern simplifies to "read file, then delete file." The OS
doesn't need to keep an fd open because the data is already in the ArrayBuffer.
The Windows fallback (delete on dispose) is still needed because even the read
may fail if another process holds a lock.

**Impact:** Functionally equivalent for cleanup. The temp directory stays clean
on Unix immediately; on Windows it's cleaned on tab close.

---

## 13. No VS Code command palette registration

**Spec said (M2):** "Register `vview` command in VS Code command palette (for
re-triggering from editor side)."

**Implementation:** Not done. The data browser is only triggered by the signal
watcher (from Stata). There is no `sight.openDataBrowser` command.

**Why:** The plan omitted this. The primary UX is `vview` from Stata. A command
palette entry would need a file picker to select a `.dta` file, which is
closely related to the M3 custom editor provider for `.dta` files. Both are
deferred.

**Impact:** Users cannot open a `.dta` file from VS Code directly. They must
use `vview` in Stata.

---

## 14. No startup sweep for orphaned temp files (Windows)

**Spec said:** "Run a startup sweep on extension activation that prunes any
`.dta` files in `~/.sight/browse/` older than 24 hours (to catch crashes)."

**Implementation:** Not done. The signal watcher creates the browse directory
on start but doesn't clean old files.

**Why:** Plan omitted this. Low priority — orphaned `.dta` files in
`~/.sight/browse/` are harmless (just wasted disk space) and rare (only after
crashes on Windows).

**Impact:** Windows users who crash VS Code repeatedly will accumulate temp
files. Easy to add: a single `fs.readdirSync` + `fs.statSync` + age check on
activation.

---

## 15. Test fixture approach: Stata-generated, not synthetic

**Plan said:** "Write a TypeScript script that generates `.dta` files in the
correct binary format."

**Implementation:** Initially a TypeScript generator was written, then replaced
with a Stata do-file (`generate_fixtures.do`) run via `stata-mp -b` that
generates real Stata fixtures using `save` and `saveold`.

**Why:** The user correctly pointed out that real Stata-generated files are the
ground truth for testing a parser. Synthetic files risk encoding assumptions
that mask parser bugs. The Stata-generated fixtures revealed real format quirks
(deviation #5 above) that a synthetic generator would have papered over.

**Impact:** Fixtures require Stata to regenerate (not a problem for CI if
committed). The fixtures cover v117, v118, and v119 across 7 dataset types
with 17 total files.

---

## 16. DtaFile reads the bundled vview.ado with fs, not vscode.workspace.fs

**Spec said:** "Read from `context.extensionUri` via
`vscode.workspace.fs.readFile`."

**Implementation:** Uses `fs.readFileSync()` with
`vscode.Uri.joinPath(context.extensionUri, ...).fsPath`.

**Why:** `vscode.workspace.fs.readFile` is async and returns a `Uint8Array`.
`fs.readFileSync` is simpler and the path is always local (the extension bundle
is on the local filesystem even in Remote scenarios, since the extension host
runs where the files are). Both approaches work; fs is more direct.

**Impact:** None for local development. In VS Code Remote scenarios, the
extension bundle IS on the remote machine (it's deployed there), so `fsPath`
works correctly.

---

## Summary: What's deferred to M3

| Feature | Spec section | Status |
|---|---|---|
| Virtualized canvas grid | M1: Grid Component | Plain HTML table instead |
| Column resizing | M1: Grid Component | Not implemented |
| Column sorting | M3 | Not implemented |
| Column-level text filter | M3 / M1 toolbar | Not implemented |
| Keyboard navigation | M3 | Not implemented |
| Copy-to-clipboard | M1 toolbar | Not implemented |
| Search/filter | M1 toolbar | Not implemented |
| Display format toggle | M1 toolbar | Button exists, non-functional |
| Extended missing type display | M1 display behavior | All shown as `.` |
| Custom `.dta` editor provider | M3 | Not implemented |
| Command palette entry | M2 | Not implemented |
| Windows orphan cleanup | M2 signal/IPC | Not implemented |
| Performance benchmarking | M3 | Not done |
| Accessibility (ARIA) | M3 | Not implemented |
| Theming | M3 | CSS variables used (partial) |
