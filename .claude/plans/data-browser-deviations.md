# Data Browser: Remaining Spec Deviations

This document records the ways the current implementation still deviates from
`specs/sight_data_browser.md` after the follow-up work that added tagged
missing values, richer sidecar metadata, startup cleanup, and the virtualized
webview grid.

It intentionally lists only the deltas that still remain.

---

## 1. File I/O is still full-buffer, not mmap / fd-backed random access

**Spec said:** The browser should support lazy row loading via memory-mapped
access or explicit file-offset reads against an open file descriptor.

**Current implementation:** [`DtaFile.open()`](/Users/jmb/repos/sight-viewer-codex/src/dta-parser/index.ts)
still uses `fs.readFileSync()` to load the entire `.dta` into memory, then all
row reads are `ArrayBuffer` offset math.

**Impact:** The webview grid is now virtualized, but extension memory still
scales with file size rather than page-cache-backed demand reads. This is the
largest remaining architecture gap versus the original performance model.

---

## 2. `vview` sidecar metadata is richer, but not fully spec-accurate

**Spec said:** The sidecar example showed:
- ISO-like UTC timestamp (`2026-03-26T14:30:00Z`)
- original dataset source path
- exact `varlist`, `if`, and `in` metadata

**Current implementation:** [`stata/vview.ado`](/Users/jmb/repos/sight-viewer-codex/stata/vview.ado)
now emits `timestamp`, `source`, `varlist`, `if`, and `in`, but:
- `timestamp` is `c(current_date) + " " + c(current_time)`, not ISO UTC
- `source` comes from `c(filename)`, which is often only a dataset name and may
  be empty; it is not guaranteed to be the original absolute dataset path

**Impact:** The browser can now show subset/source context, but it still cannot
reliably display the exact original file path promised by the spec.

---

## 3. Column headers do not surface variable labels yet

**Spec said:** Column headers should show the variable name with the variable
label as a subtitle or tooltip.

**Current implementation:** The virtual grid in
[`client/src/data-browser/webview/app.tsx`](/Users/jmb/repos/sight-viewer-codex/client/src/data-browser/webview/app.tsx)
uses `title: my_variable.name` only. Variable labels are present in the
metadata payload but are not rendered in the grid header.

**Impact:** Variable labels are available to the extension, but the header UX is
still less informative than specified.

---

## 4. Value labels render as text only; raw numeric value is not shown in a tooltip

**Spec said:** Value-labeled cells should display the label, with the numeric
value available in a tooltip or equivalent affordance.

**Current implementation:** The cell model preserves both raw and labeled
representations, and the toolbar toggle switches between them, but the grid does
not currently attach the raw numeric value as hover text or another secondary UI
surface.

**Impact:** The data is preserved and toggleable, but the richer “label plus raw
value at once” behavior from the spec is still missing.

---

## 5. Search / column filtering is still not implemented

**Spec said:** The toolbar should include search/filter support, specifically
column-level text filtering.

**Current implementation:** The toolbar currently exposes only label and format
toggles plus the visible-row indicator. There is no search box or filter model
in the webview.

**Impact:** Users can inspect and copy data, but they still cannot narrow the
grid client-side from the browser UI.

---

## 6. Status bar content is close, but not identical to the spec

**Spec said:** The status bar should show dataset name, `N × K`, source file
path, and whether the dataset is subsetted.

**Current implementation:** The bottom status area shows name, dataset label,
source (when available), and subset summary. The `N × K` indicator is shown in
the top toolbar/row-count text instead of the status bar.

**Impact:** All key metadata is present somewhere in the UI, but the exact
status-bar layout differs from the spec.

---

## 7. No VS Code command-palette entry for opening data browser content directly

**Spec said:** M2 called for a VS Code command-palette entry so the browser
could also be triggered from the editor side.

**Current implementation:** The browser is still opened only via the Stata
`vview` signal flow. There is no `sight.openDataBrowser`-style command.

**Impact:** Users still need Stata to initiate the browser session.

---

## 8. No custom readonly editor for `.dta` files

**Spec said:** M3 proposed a `CustomReadonlyEditorProvider` so double-clicking a
`.dta` in the explorer would open the Sight browser directly.

**Current implementation:** No custom editor provider is registered in the
client extension.

**Impact:** Explorer-driven `.dta` browsing remains unavailable.

---

## 9. PERSONAL ado directory resolution still uses hardcoded platform defaults

**Spec said:** `sight.personalAdoDir` should be an override, but the fallback
should effectively respect the user's actual PERSONAL ado directory rather than
assuming defaults.

**Current implementation:** [`client/src/data-browser/index.ts`](/Users/jmb/repos/sight-viewer-codex/client/src/data-browser/index.ts)
uses `sight.personalAdoDir` when set, otherwise falls back to hardcoded
platform-default PERSONAL locations.

**Impact:** Non-standard Stata setups still require manual configuration. The
extension does not truly discover a user-customized PERSONAL directory.

---

## 10. Remaining deferred M3 polish is still deferred

The follow-up intentionally did **not** implement the following spec items:

- column sorting
- keyboard navigation polish
- explicit accessibility work / ARIA review
- performance benchmarking against the spec table

These are product polish gaps rather than correctness gaps, but they remain
differences from the full spec.
