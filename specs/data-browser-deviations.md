# Data Browser: Remaining Spec Deviations

This document records the ways the current implementation still deviates from
`specs/sight_data_browser.md` after the follow-up work that added tagged
missing values, richer sidecar metadata, startup cleanup, and the virtualized
webview grid.

It intentionally lists only the deltas that still remain.

---

## 1. `vview` sidecar metadata is richer, but not fully spec-accurate

**Spec said:** The sidecar example showed:
- ISO-like UTC timestamp (`2026-03-26T14:30:00Z`)
- original dataset source path
- exact `varlist`, `if`, and `in` metadata

**Current implementation:** [`stata/vview.ado`](../stata/vview.ado)
now emits `timestamp`, `source`, `varlist`, `if`, and `in`, but:
- `timestamp` is `c(current_date) + " " + c(current_time)`, not ISO UTC
- `source` comes from `c(filename)`, which is often only a dataset name and may
  be empty; it is not guaranteed to be the original absolute dataset path

**Impact:** The browser can now show subset/source context, but it still cannot
reliably display the exact original file path promised by the spec.

---

## 2. Value labels render as text only; raw numeric value is not shown in a tooltip

**Spec said:** Value-labeled cells should display the label, with the numeric
value available in a tooltip or equivalent affordance.

**Current implementation:** The cell model preserves both raw and labeled
representations, and the toolbar toggle switches between them, but the grid does
not currently attach the raw numeric value as hover text or another secondary UI
surface.

**Impact:** The data is preserved and toggleable, but the richer “label plus raw
value at once” behavior from the spec is still missing.

---

## 3. Search / column filtering is still not implemented

**Spec said:** The toolbar should include search/filter support, specifically
column-level text filtering.

**Current implementation:** The toolbar currently exposes only label and format
toggles plus the visible-row indicator. There is no search box or filter model
in the webview.

**Impact:** Users can inspect and copy data, but they still cannot narrow the
grid client-side from the browser UI.

---

## 4. Status bar content is close, but not identical to the spec

**Spec said:** The status bar should show dataset name, `N × K`, source file
path, and whether the dataset is subsetted.

**Current implementation:** The bottom status area shows name, dataset label,
source (when available), and subset summary. The `N × K` indicator is shown in
the top toolbar/row-count text instead of the status bar.

**Impact:** All key metadata is present somewhere in the UI, but the exact
status-bar layout differs from the spec.

---

## 5. PERSONAL ado directory resolution still uses hardcoded platform defaults

**Spec said:** `sight.personalAdoDir` should be an override, but the fallback
should effectively respect the user's actual PERSONAL ado directory rather than
assuming defaults.

**Current implementation:** [`client/src/data-browser/index.ts`](../client/src/data-browser/index.ts)
uses `sight.personalAdoDir` when set, otherwise falls back to hardcoded
platform-default PERSONAL locations.

**Impact:** Non-standard Stata setups still require manual configuration. The
extension does not truly discover a user-customized PERSONAL directory.

---

## 6. Remaining deferred M3 polish is still deferred

The follow-up intentionally did **not** implement the following spec items:

- column sorting
- keyboard navigation polish
- explicit accessibility work / ARIA review
- performance benchmarking against the spec table

These are product polish gaps rather than correctness gaps, but they remain
differences from the full spec.
