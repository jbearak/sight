# Automated real-layout test for the data-browser toolbar chip wrapping

> **Handoff spec for a fresh orchestrator session.** Self-contained: everything
> needed to execute is below. The feature under test already shipped on a branch
> with a PR open; this spec is ONLY about adding the automated real-layout test
> layer that was deferred.

## 1. Current state (what exists before this work)

- **Branch:** `data-browser-toolbar-chip-wrap` (off `main`). **PR #172** open to
  `main`. Three commits: spec (`16491e1`), feat (`37057cb`), review-fix
  (`08879b7`). Work tree is clean.
- **Feature already implemented and merged-to-branch:** the data-browser toolbar
  drops its sort/filter chip strips onto a full-width second row when they would
  crowd the Labels/Formats/Columns buttons; buttons stay pinned top-right; each
  strip scrolls horizontally if it still overflows row 2.
  - Hook + pure policy: `client/src/data-browser/webview/use-toolbar-wrap.ts`
    (`use_toolbar_wrap` hook; pure `should_wrap`; `WRAP_HYSTERESIS_PX = 8`,
    `TOOLBAR_GAP_PX = 8`; a `ResizeObserver` that guards on `clientWidth`-only
    changes; re-measures on `content_deps`).
  - Toolbar JSX: `client/src/data-browser/webview/app.tsx` ~lines 1059-1153.
    Structure: `.toolbar`(`toolbar_ref`, gets `is-wrapped` class) >
    `.row-count`(`row_count_ref`) + `.toolbar-chips`(`toolbar_chips_ref`,
    contains `ToolbarSortStrip` + `ToolbarFilterStrip`) +
    `.toolbar-actions`(`toolbar_actions_ref`). Hook called ~line 827 with
    `content_deps: [sort.keys, filter.entries, row_count_text, hidden_columns.size]`.
  - CSS: `client/src/data-browser/webview/styles.css` — `.toolbar { display:flex;
    gap:8px }`, `.toolbar.is-wrapped { flex-wrap:wrap }`,
    `.toolbar.is-wrapped .toolbar-chips { order:1; flex-basis:100% }`,
    `.toolbar-chips { display:flex; gap:8px; min-width:0 }`.
  - Strips: `sort-strip.tsx` renders nothing when `keys.length === 0`;
    `filter-strip.tsx` renders nothing when `entries.length === 0`. Each strip has
    `min-width:0; overflow-x:auto`.
- **Existing fast logic tests (keep, do not duplicate):**
  `tests/unit/data-browser/toolbar-wrap.test.ts` — 9 `bun test` cases covering
  `should_wrap` math, hysteresis band, empty-chips guard, gap counting. These run
  in ms with no DOM. **This is the "logic layer"; it stays as-is.**
- **Design spec for the feature:**
  `docs/superpowers/specs/2026-05-27-toolbar-chip-wrap-design.md`.

## 2. The gap this work closes

`jsdom`/`happy-dom` do **no layout** (`getBoundingClientRect` returns zeros) —
confirmed limitation. So the existing unit tests verify the *decision policy*
but nothing verifies that the **real CSS actually wraps**, that the **real
`ResizeObserver` fires**, or that the **hook toggles the class in a real
browser**. This spec adds that real-layout layer.

## 3. Decision: use `@vscode/test-electron` + the self-measure pattern (NOT Playwright)

A webview runs in **real Chromium inside VS Code**, so it can measure its own
real layout. Research conclusion (with VS Code maintainer confirmation,
[vscode-extension-samples#846](https://github.com/microsoft/vscode-extension-samples/issues/846)):

- The extension host **cannot** read the webview's DOM directly — the webview is
  a sandboxed (nested) iframe; the only bridge is `postMessage`.
- **Endorsed technique ("self-measure"):** the webview script measures itself
  (`getBoundingClientRect`, `classList`, `getComputedStyle`) and `postMessage`s
  the numbers back to the extension-host test, which asserts.
- This gives **real flexbox layout in the real webview**, **reuses the repo's
  existing `@vscode/test-electron` harness** (`client/test/runTest.js`), and adds
  **no browser dependency**.

Rejected alternatives: Playwright/Puppeteer (only tests a standalone harness, not
the real VS Code context; adds a browser driver/binary); ExTester/WebdriverIO
(most faithful but heaviest/flakiest, downloads VS Code + chromedriver); happy-dom
(no layout, and in this repo hits a **dual-React** problem — root and `client/`
each have a separate `react@18.3.1` copy with different inodes, so a root
`bun test` rendering the client hook would throw "invalid hook call").

## 4. Architecture (reconciled from two independent architecture passes)

Both passes agreed on the core; reconciled decisions are marked **[DECIDED]**.

### 4.1 Dedicated test-harness webview (not the real data browser) **[DECIDED]**

Do **not** drive the production data-browser webview: `use-row-loader.ts:176`
posts `{type:'ready'}` and then blocks waiting for a `metadata` message, and it
boots `@glideapps/glide-data-grid` (canvas/WebGL). Wrap behavior depends only on
three `scrollWidth`s + one `clientWidth`, none of which need real data.

Build a **minimal harness** that mounts ONLY the real toolbar markup with the
**real** `use_toolbar_wrap` hook, the **real** `ToolbarSortStrip`/
`ToolbarFilterStrip` components, and the **real** `styles.css`. No data layer.
This is full layout fidelity (same hook, same CSS, real Chromium) at near
zero setup cost and with deterministic inputs.

> **Correction (2026-05-27, follow-up bug):** the original harness also omitted
> the real `.browser-root` **grid** and instead pinned the toolbar width with a
> `display:block; overflow:hidden` wrapper. That masked a real bug: the toolbar
> is a *grid item*, and its automatic minimum size (`min-width:auto`) let it
> grow to the chips' content width and overflow `.browser-root` — pushing
> Labels/Formats/Columns off-screen and defeating the chip strips' `overflow-x`
> scroll. The harness now mounts the toolbar inside the real `.browser-root`
> grid (the width-pinned `#harness-root` is only the viewport analog). The
> "data layer" (glide-data-grid below the toolbar) stays omitted; the toolbar's
> own *containing* grid is what matters and must be reproduced. Fix:
> `min-width:0` on `.toolbar` (`styles.css`).

### 4.2 Deterministic width control **[DECIDED]**

The toolbar's `clientWidth` normally depends on the VS Code window — not
controllable from JS. Solution: the harness wraps the toolbar in a block-level
wrapper (`<div id="harness-root" style="display:block; overflow:hidden">`) and a
test message sets `wrapper.style.width = '<N>px'`. That pins the toolbar's
`clientWidth` to N and makes the **real `ResizeObserver` fire** (it observes
`toolbar_ref`). Do NOT resize the VS Code window. Note the hook's width-guard
(`use-toolbar-wrap.ts` ~line 170: `if (my_width_px === last_width_px) return`) —
tests must use **distinct** widths between transitions (e.g., go wide → narrow,
not narrow → narrow).

### 4.3 Keep the harness OUT of the shipped extension **[DECIDED]**

- Harness entry: `client/src/data-browser/webview/test-harness/index.tsx`.
- Separate esbuild target outputs to `client/dist-test/toolbar-wrap-harness/`
  (NOT the shipped `dist/`).
- **Amend the existing `client/.vscodeignore`** (it already exists, ~385 bytes)
  to add `dist-test/**`. `vscode:prepublish` does not run the harness build.

### 4.4 Message protocol

Host→webview via `panel.webview.postMessage`; webview receives via
`window.addEventListener('message', e => e.data)`. Webview→host via
`acquireVsCodeApi().postMessage` (available because it runs in a real webview);
host receives via `panel.webview.onDidReceiveMessage`. Use a `test:*` namespace
to avoid colliding with production message types in
`client/src/data-browser/types.ts`.

Host → webview:
- `{ type:'test:reset' }` — clear to a known baseline (0 chips, baseline width).
- `{ type:'test:setWidth', width_px:number }` — set the wrapper width.
- `{ type:'test:setState', sort_chip_count:number, filter_chip_count:number,
  hidden_col_count:number, row_count_text:string }` — drive chip counts + the
  Columns badge + lead text. (Render synthetic chips with fixed labels so
  intrinsic widths are real-font-rendered and stable across machines.)
- `{ type:'test:requestSnapshot' }` — force a snapshot now.

Webview → host:
- `{ type:'test:ready' }` — posted once after first layout + first
  `ResizeObserver` callback (so initial `clientWidth` is non-zero).
- `{ type:'test:layoutSnapshot', ...payload }` — posted after each state/width
  change (settled) and on request.

Snapshot payload (serialize rects as plain `{top,bottom,left,right,width,height}`
— `DOMRect` is not structured-clone-safe across the boundary):
- `is_wrapped: boolean` (`toolbar.classList.contains('is-wrapped')`)
- `toolbar_rect`, `chips_rect`, `actions_rect`, `lead_rect`
- `chips_scroll_width`, `chips_client_width`
- `sort_strip_scroll_width`, `filter_strip_scroll_width` (0 if strip absent)
- Computed styles for unambiguous wrap detection:
  `toolbar_flex_wrap` (`getComputedStyle(toolbar).flexWrap`),
  `chips_order`, `chips_flex_basis`.

### 4.5 Assertions (zero-ambiguity invariants)

- **single-row:** `is_wrapped === false` AND `toolbar_flex_wrap` is `nowrap`/`''`
  AND `chips_order !== '1'` AND `|chips_rect.top - actions_rect.top| < 4`.
- **wrapped:** `is_wrapped === true` AND `toolbar_flex_wrap === 'wrap'` AND
  `chips_order === '1'` AND `chips_flex_basis === '100%'` AND
  `chips_rect.top > actions_rect.bottom` (chips geometrically on row 2).
- **buttons pinned right (both states):**
  `actions_rect.right >= toolbar_rect.right - 12` (allow padding) and, when
  wrapped, `|actions_rect.top - lead_rect.top| < 4` (actions stay on top row).
- **row-2 scroll tier:** when chips content exceeds the row,
  `sort_strip_scroll_width > chips_client_width` (overflow → scrollable).
- **Columns-badge regression** (the bug fixed in `08879b7`; guards the
  `hidden_columns.size` content-dep): at a fixed width that is single-row with
  `hidden_col_count = 0`, setting `hidden_col_count` large must (a) report a wider
  `actions_rect.width`, and (b) at a width tuned to the boundary, flip to wrapped.

### 4.6 Determinism / anti-flake **[DECIDED]**

- Emit the snapshot from a `useLayoutEffect` in the harness keyed on
  `[is_wrapped, chip_state, width_set_counter]` (a counter incremented per
  `setWidth` so a snapshot is sent even when `is_wrapped` doesn't change). For the
  resize path, also schedule a **double-`requestAnimationFrame`** before reading,
  so the `ResizeObserver` callback → `set_is_wrapped` → React commit has settled.
- Post `test:ready` only after the first `ResizeObserver` callback fires (avoids
  measuring a 0-width pre-layout toolbar).
- Host `wait_for_snapshot(timeout=5000)`: register `onDidReceiveMessage` BEFORE
  posting; resolve on `test:layoutSnapshot`, reject on timeout. Optionally
  retry-until the reported `is_wrapped` matches expectation (re-`requestSnapshot`
  up to ~5×/100ms) to absorb rare layout latency.
- Use wide margins so sub-pixel font differences can't flip results (e.g. ~10
  synthetic chips ≈ 700px content; assert single-row at 1200px and wrapped at
  400px).

### 4.7 Runner **[DECIDED: use Mocha programmatically]**

The current `client/test/extension-smoke.js` is a hand-rolled `async run()` (no
Mocha). For ~10 sequenced cases with reset-between, use **Mocha programmatically**
(cleaner isolation + reporting; this is the standard VS Code extension-test
pattern). Add `mocha` + `@types/mocha` as `client` devDependencies.
(Acceptable lighter alternative if avoiding the dep matters: replicate the
hand-rolled `run()` pattern — but Mocha is recommended.)

The `@vscode/test-electron` `extensionTestsPath` points at a module exporting
`run()`; that `run()` constructs a `Mocha` instance, adds the test file, and
resolves/rejects on the failure count. Reuse `runTest.js`'s
`find_code_binary` (system `code`) → `runTests` (download) fallback.

### 4.8 CI / no-binary behavior **[DECIDED]**

Default: if no VS Code binary is available and download fails, **fail** (the
real-layout assertion is the point). Provide an escape hatch:
`SIGHT_SKIP_LAYOUT_TESTS=1` → exit 0 cleanly (for sandboxes that cannot run VS
Code; note this repo's CI network may only reach github.com, and VS Code/Electron
download from Microsoft CDNs).

## 5. Files to create / modify (verified paths)

Create:
1. `client/src/data-browser/webview/test-harness/harness-app.tsx` — React
   component rendering the real `.toolbar` structure (wrapper + `.row-count` +
   `.toolbar-chips` with real `ToolbarSortStrip`/`ToolbarFilterStrip` +
   `.toolbar-actions` with the Columns badge), wiring `use_toolbar_wrap` with the
   same four refs as `app.tsx`; imports the real `styles.css`; handles `test:*`
   inbound messages; posts `test:ready` and `test:layoutSnapshot`. Maintains a
   synthetic `columns: VariableDescription[]` (≥ the max `col_index` used) and
   builds synthetic `SortKey[]`/`FilterEntry[]` from the requested counts. Does
   NOT import glide-data-grid or `use-row-loader`.
2. `client/src/data-browser/webview/test-harness/index.tsx` — mounts
   `HarnessApp` into `#root` (mirrors `webview/index.tsx`).
3. `client/test/toolbar-wrap-layout/harness-panel.js` — extension-host helper:
   `createWebviewPanel`, set HTML (reuse the CSP+nonce shape from
   `client/src/data-browser/webview-html.ts`, but point the script src at
   `dist-test/toolbar-wrap-harness/index.js`), `send(msg)` +
   `wait_for_snapshot()`/handshake helpers.
4. `client/test/toolbar-wrap-layout/toolbar-wrap-layout.test.js` — Mocha
   `describe/it` suite; opens the panel in `before`, `test:reset` in
   `beforeEach`, closes in `after`; the ~8-10 cases from §6.
5. `client/test/toolbar-wrap-layout/index.js` — programmatic Mocha runner
   exporting `run()` (the `extensionTestsPath` target).

Modify:
6. `client/package.json` — add `mocha`+`@types/mocha` devDeps; add scripts:
   - `"bundle:webview-test": "bunx esbuild src/data-browser/webview/test-harness/index.tsx --bundle --platform=browser --format=iife --outfile=dist-test/toolbar-wrap-harness/index.js --loader:.css=css"`
   - `"test:layout": "bun run bundle && bun run bundle:webview-test && node ./test/runTest.js --suite layout"`
7. `client/test/runTest.js` — read a `--suite layout` arg (or a second runner
   script) to point `extensionTestsPath` at `toolbar-wrap-layout/index.js`; reuse
   the existing binary-detection/download fallback; honor
   `SIGHT_SKIP_LAYOUT_TESTS`.
8. `client/.vscodeignore` — add `dist-test/**`.

## 6. Test cases

1. No chips, wide (1200px) → single-row (`is_wrapped===false`).
2. Many sort chips, narrow (400px) → wrapped; `chips_rect.top > actions_rect.bottom`;
   `actions_rect.right ≈ toolbar_rect.right`.
3. Resize wide (1200px) → unwraps; chips back on actions' row.
4. Re-narrow (400px) → re-wraps (exercises distinct-width guard).
5. Many filter chips only, narrow → wrapped.
6. Overflow chips at a mid width → `sort_strip_scroll_width > chips_client_width`
   (scroll tier available).
7. Columns-badge regression: at width W single-row with `hidden_col_count=0`;
   with large `hidden_col_count` → `actions_rect.width` larger AND wraps at the
   tuned boundary.
8. (Optional) Hysteresis: cross the boundary by a few px both directions; confirm
   no flap (stable `is_wrapped`).

## 7. How to run

```bash
cd client
bun run test:layout      # builds bundles, then runs the layout suite in VS Code
# Existing fast logic tests (unchanged), from repo root:
bun test tests/unit/data-browser/toolbar-wrap.test.ts
```

## 8. Risks / notes

- `acquireVsCodeApi()` is injected by VS Code in the real webview — available in
  the harness exactly as in production.
- CSP: harness HTML must carry a per-panel nonce in `script-src` (reuse the
  pattern in `webview-html.ts`). Setting `element.style.width` from JS is allowed
  (nonce `style-src` restricts inline HTML `style` attributes, not scripted style
  mutations).
- esbuild IIFE inlines the CSS into the JS bundle for the harness; the toolbar
  selectors are identical to production (same `styles.css` source).
- Keep the two suites (smoke + layout) in separate VS Code instances (separate
  temp `--user-data-dir`/`--extensions-dir`, as `runTest.js` already does) to
  avoid panel-state leakage.

## 9. Definition of done

- New harness + layout suite created; `bun run test:layout` passes on a machine
  with VS Code (or system `code`) available.
- `should_wrap` unit tests still pass; `bun run typecheck` clean; `bun run test`
  (full suite) green; webview production bundle (`bun run bundle:webview`) still
  builds.
- Harness excluded from the packaged extension (`dist-test/**` in `.vscodeignore`;
  confirm via `vsce package`/`--exclude` if needed).
- Commit to branch `data-browser-toolbar-chip-wrap` and push to PR #172.
