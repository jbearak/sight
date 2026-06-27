# Data viewer: explain (and let users cancel) the saved-sort/filter reload

## Problem

Sight's `.dta` viewer (opened via `vview` or by clicking a `.dta` file) opens
instantly because it uses a virtualized grid: only the visible window of rows is
read from disk at any moment. Sorting and filtering break that frugality — to
apply either, the extension must read the relevant column(s) *in their entirety*
into memory to compute a sort permutation or a filter survivor set.

Sort and filter preferences are persisted per `dataset_key × schema_hash` and
**re-applied automatically on reopen** (`browser-panel.ts` `maybe_restore_sort` /
`maybe_restore_filter`). On reopen of a file with saved preferences, the
extension does the heavy column reads *before* it posts the `metadata` message:

```
initialize() → send_metadata():
    maybe_restore_sort(schema_hash)     // reads sort-key column(s) fully
    maybe_restore_filter(schema_hash)   // reads filter column(s) fully
    recompute_effective()
    postMessage(metadata)               // only now does the grid populate
```

Until `metadata` arrives, the webview has `metadata === null`, so
`describe_browser_row_count()` (`grid-model.ts:282`) returns a bare `'Loading…'`.

Two user-facing problems result:

1. **No explanation.** A user who reopens a large file sees `Loading…` for a
   few seconds — or much longer — with no hint that the wait exists *because*
   Sight is reapplying their remembered sort/filter and reading whole columns to
   do it. (There is already a clearer `'Sorting…'` / `'Filtering…'` progress
   string, but it is only wired to *interactive* sort/filter changes made after
   the grid is up — never to this initial restore.)

2. **No escape hatch.** There is no way to say "skip it, just show me the data."
   The user must wait for the full restore to finish.

## Goal

On reopen with saved preferences:

1. Replace the bare `Loading…` with an explanation — e.g. *"Applying your saved
   sort & filter…"* — so the wait is self-explanatory.
2. Offer a **Cancel** control. Cancelling abandons the restore, **forgets** the
   saved preferences for this dataset (clears the persisted sort/filter), and
   shows the data in its natural (unsorted, unfiltered) order.
3. Keep today's "no visible reorder" property: rows must never appear in the
   wrong order and then jump. Data appears only once its final order is known
   (or, on cancel, in natural order).

For Cancel to be meaningful, the column read it interrupts must actually yield
the event loop — which today it does not (see Background). This requires a small
change to `@jbearak/dta-parser` as well.

## Non-goals

- **Showing the grid in natural order first, then re-sorting** (an alternative
  that makes Cancel trivial). Rejected: it causes a visible reorder "jump,"
  which the goal explicitly forbids.
- **Cancel for interactive sort/filter** (`handle_set_sort` /
  `handle_set_filters`, applied after the grid is up). Out of scope; those keep
  their single-shot reads. Noted as a possible follow-up — they would benefit
  from the same chunked read for event-loop responsiveness.
- **Interruptible permutation/index computation.** Cancel interrupts the
  *column-reading* phase (the dominant cost). The final `compute_permutation`
  and the filter-index scan over `nobs` are synchronous CPU and remain
  uninterruptible; they are comparatively cheap. Acceptable, documented
  limitation.
- **"Remember but don't auto-apply" semantics.** Cancel means *forget entirely*.

## Background: why Cancel needs a dta-parser change

`DtaFile.read_rows` (`@jbearak/dta-parser`, node entry) is declared `async` but
does **no awaiting internally** — its body is fully synchronous:

```js
async read_rows(start, count, col_start, col_end) {
    const my_data_buffer = read_data_rows(this._fd, ...);   // fs.readSync (blocking)
    const the_rows = read_rows_from_data_buffer(...);        // synchronous parse
    if (this._strl_col_indices.length > 0) this._resolve_strls(...);
    return the_rows;
}
```

`read_data_rows` → `read_range` uses `fs.readSync`. `read_full_column` in sight
reads a whole column with a single `read_rows(0, nobs, col, col+1)` call. Because
that call runs to completion synchronously, it **blocks the host event loop for
its entire duration**. A `cancelRestore` message posted from the webview sits
unprocessed in the IPC queue until the read returns — so a naive Cancel button
would have no effect until the very read it targets has already finished. The
`generation`-counter checkpoints only help *between* awaits, and the full-column
read is effectively one uninterruptible await.

Therefore the column read must become **chunked and yield to the event loop**
between chunks, so the abort message can be processed. The fix belongs in the
library (decided): the bulk read is a library-level operation, and a first-class
cancellable API is reusable and keeps sight's call sites simple.

---

## Part 1 — `@jbearak/dta-parser` (0.1.1 → 0.1.2)

### API

Extend `read_rows` with an optional, backward-compatible options argument:

```ts
read_rows(
    start: number,
    count: number,
    col_start?: number,
    col_end?: number,
    options?: { signal?: AbortSignal; chunk_rows?: number }
): Promise<Row[]>
```

### Behavior

- **No `options.signal` (default / existing callers):** unchanged — a single
  `read_data_rows` + `read_rows_from_data_buffer` + (if needed) `_resolve_strls`,
  no chunking, no yields. The fast virtualized-viewport path and all existing
  perf/tests are untouched. This is the critical backward-compat guarantee.

- **With `options.signal`:** read in chunks of `chunk_rows` rows (default
  ~65 536). For each chunk, in order:
  1. If `signal.aborted`, throw `DOMException('The read was aborted',
     'AbortError')` (Node provides global `DOMException`).
  2. If the file was closed mid-read (`this._closed` / fd null), stop and return
     the rows accumulated so far (consistent with the existing "closed returns
     `[]`" contract; the caller discards partial results on abort anyway).
  3. `read_data_rows(fd, metadata, chunk_start, chunk_count)` → parse via
     `read_rows_from_data_buffer` → if any strL column falls in
     `[col_start, col_end)`, `_resolve_strls` on **that chunk's** rows and
     buffer. (Per-chunk resolution is correct: the layout is row-major
     (`read_data_rows` reads `count * obs_length` contiguous bytes at the row
     offset, node.js:1755/1780), so each chunk's buffer fully covers its own
     rows.)
  4. Append the chunk's rows to the accumulator.
  5. `await new Promise(resolve => setImmediate(resolve))` to release the event
     loop so a queued abort is observed on the next chunk's check.

  After the loop, a final `signal.aborted` check before returning.

The `setImmediate` yield is load-bearing: aborting depends on the host event
loop running the handler that calls `controller.abort()`; chunk reads must
release the loop for that handler to run.

### Tests (dta-parser)

- **Regression / equivalence:** a signal-less `read_rows` returns byte-identical
  `Row[]` to the current implementation (covers the fast path).
- **Chunk-boundary equivalence:** with a deliberately small `chunk_rows`, the
  chunked result equals the single-shot result — including a dataset with a
  strL column whose rows span a chunk boundary, and including `col_start`/
  `col_end` sub-ranges.
- **Abort before first chunk:** an already-aborted signal rejects with
  `AbortError` and reads nothing.
- **Abort mid-read:** aborting after the first `setImmediate` yield rejects with
  `AbortError`; no rows are returned to the caller.
- **Closed mid-read:** closing the file between chunks stops cleanly.

### Release / consumption

Bump to `0.1.2`; build esm + cjs + types; publish. Sight's existing `^0.1.1`
range accepts `0.1.2`, so no manifest edit is strictly required once published —
only a lockfile update via `bun install`. For development *before* publish, link
the local build into the sight worktrees (`bun link`, or a temporary `file:` /
git dependency) so Part 2 can be built and tested end-to-end.

---

## Part 2 — sight data viewer

### Message protocol (`client/src/data-browser/webview/types.ts`)

Add two messages:

- **Extension → webview:** `{ type: 'restorePending'; sort: boolean; filter: boolean }`
  — posted at the top of `send_metadata`, *before* the column reads, when a
  stored sort and/or filter actually exists for this `dataset_key × schema_hash`.
- **Webview → extension:** `{ type: 'cancelRestore' }` — posted when the user
  clicks Cancel.

### Extension side (`browser-panel.ts`)

State added to the panel: `restore_abort: AbortController | null`,
`restore_cancelled: boolean`, `restoring: boolean`.

`send_metadata`, on first restore for the dataset:

1. Peek both stores. If either has a stored pref, set `restoring = true`, create
   `this.restore_abort = new AbortController()`, and post
   `restorePending { sort, filter }` **before** the heavy reads.
2. Call `maybe_restore_sort` / `maybe_restore_filter`, threading
   `this.restore_abort.signal` down:
   - `read_full_column(col, signal)` →
   - `compute_sort_permutation(sort, signal)` /
     `compute_filter_indices(filter, signal)` →
   - `read_rows(0, nobs, col, col+1, { signal })`.
3. Between the two restores, short-circuit if `restore_cancelled` so a cancel
   during the sort read does not then trigger a long filter read.
4. The existing `try { … } catch { … = null }` around each compute turns an
   `AbortError` (or any read failure) into "no permutation / no indices," i.e.
   natural order. `maybe_restore_*` already only apply `this.sort` /
   `this.filter` when the compute returned a non-null result, so an aborted
   restore leaves them empty.
5. On the cancelled path, `send_metadata`:
   - clears **both** persisted prefs for this `dataset_key × schema_hash`
     (`sort_state_store.set(…, { keys: [], … })` and the filter equivalent;
     set-empty deletes the entry, sort-state.ts:145–152) — *forget entirely*;
   - posts `metadata` with `stored_sort` / `stored_filter` **omitted** (so no
     chips render);
   - skips `post_filter_applied` (no filter is active).
6. Clear `restoring` (and `restore_abort`) once `metadata` is posted, on both
   the normal and cancelled paths.

`handle_message` gains a `cancelRestore` case:

- If `!this.restoring`, ignore (defensive against a stray/late cancel after the
  grid is already up).
- Otherwise: `this.restore_cancelled = true; this.restore_abort?.abort();`

Note: on the normal (non-cancelled) completion, behavior is exactly as today —
`metadata` is posted with the restored sort/filter applied; the only difference
is the earlier `restorePending` signal, which the webview clears when `metadata`
arrives.

### Webview side (`app.tsx`, `use-row-loader.ts`, `grid-model.ts`)

- Track `restore_pending: { sort: boolean; filter: boolean } | null`. Set it on
  `restorePending`; clear it when `metadata` arrives (both the normal and
  cancelled paths end by posting `metadata`).
- While `restore_pending` is set and `metadata` is still `null`, render — in
  place of the bare `Loading…`, reusing the `toolbar-progress` styling — an
  explanatory line plus an inline **Cancel** button:
  - both → *"Applying your saved sort & filter…"*
  - sort only → *"Applying your saved sort…"*
  - filter only → *"Applying your saved filter…"*
- **Debounce:** only reveal this UI if `restore_pending` persists past ~200 ms,
  so small/fast files (where `metadata` arrives almost immediately) do not flash
  the message.
- The Cancel button posts `cancelRestore` and optimistically shows a transient
  *"Cancelling…"* until `metadata` arrives, after which the grid renders in
  natural order with no chips.

### Edge cases

- **Persistence disabled** (`persistSort` / `persistFilters` = false): no stored
  prefs → no `restorePending` → behavior unchanged.
- **Stored filter that drops all chips** on schema mismatch, or yields an empty
  survivor set: only post `restorePending` when a stored pref genuinely exists to
  apply (peek the stores, mirroring `maybe_restore_*`'s own guards).
- **Refresh** (`ready` received while `dta_file` is already set): same path; the
  `generation` bump on refresh already discards stale in-flight reads.
- **Cancel arriving after restore completed:** guarded by `restoring`; the
  webview also stops showing the button once `metadata` arrives, so it should
  not be sent — but the guard makes it a no-op regardless.
- **Cancel during the sort read, with a filter also stored:** the
  `restore_cancelled` short-circuit (step 3) prevents the subsequent filter read.

### Tests (sight)

- **Extension unit:** a `cancelRestore` during restore (a) aborts the read,
  (b) clears both persisted stores, (c) results in `send_metadata` emitting
  natural-order `metadata` with no `stored_sort` / `stored_filter` and no
  `filterApplied`; a normal completion still applies the stored sort/filter and
  emits `restorePending` before `metadata`.
- **Webview unit (`grid-model` / loader):** `restorePending` produces the
  correct explanatory text per flag combination; the message is suppressed
  before the debounce threshold and shown after; it clears on `metadata`.
- **Integration (`data-browser-smoke` style):** reopen a `.dta` with saved
  sort and filter → `restorePending` is posted before `metadata`; without
  cancel, the restored order is applied.

## Sequence summary

Normal reopen with saved prefs:

```
webview: ready
ext:     restorePending {sort,filter}      ← new; webview shows explanation (after 200ms)
ext:     [chunked, cancellable column reads]
ext:     metadata (stored_sort/filter set) ← webview clears restore_pending, renders sorted
ext:     filterApplied (if filtered)
```

Cancelled reopen:

```
webview: ready
ext:     restorePending {sort,filter}
webview: [user clicks Cancel] → cancelRestore
ext:     controller.abort() → reads reject AbortError → prefs forgotten
ext:     metadata (no stored_sort/filter)  ← webview renders natural order, no chips
```
