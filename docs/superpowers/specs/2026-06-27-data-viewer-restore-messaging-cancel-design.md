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

## Part 1 — `@jbearak/dta-parser` (0.1.1 → 0.2.0)

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
  2. If the file was closed mid-read (`this._closed` / fd null), return `[]`
     — **never the partially-accumulated rows.** Matching the existing "closed
     returns `[]`" contract keeps a truncated read from masquerading as a
     successful short read; a partial column must never be silently handed back,
     since a caller computing a sort/filter over it would produce wrong results.
     (The signal-less path keeps its current single-shot behavior; this rule is
     specifically about the chunked loop, where a close can land between chunks.)
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
- **Closed mid-read:** closing the file between chunks returns `[]` (not a
  partial column) — assert the result is empty, not truncated.

### Release / consumption

Bump to `0.2.0`; build esm + cjs + types; publish. Sight's manifests
(`package.json` and `client/package.json`) are updated to `^0.2.0`, plus a
lockfile update via `bun install`. For development *before* publish, link
the local build into the sight worktrees (`bun link`, or a temporary `file:` /
git dependency) so Part 2 can be built and tested end-to-end.

---

## Part 2 — sight data viewer

### Message protocol (`client/src/data-browser/webview/types.ts`)

Add two messages. Both carry a `restore_id` (the panel's `generation` value at
the moment `restorePending` is posted) so stale/crossed messages from an earlier
lifecycle can be dropped at the protocol level rather than relying on ordering
assumptions:

- **Extension → webview:** `{ type: 'restorePending'; restore_id: number; sort: boolean; filter: boolean }`
  — posted at the top of `send_metadata`, *before* the column reads, when a
  stored sort and/or filter actually exists for this `dataset_key × schema_hash`.
- **Webview → extension:** `{ type: 'cancelRestore'; restore_id: number }` —
  posted when the user clicks Cancel, echoing the `restore_id` it is cancelling.

The extension ignores a `cancelRestore` whose `restore_id` does not match the
current restore (see late-cancel handling below). The webview records the latest
`restore_id` from `restorePending` and stamps it onto any `cancelRestore`.

### Extension side (`browser-panel.ts`)

State added to the panel: `restore_abort: AbortController | null`,
`restoring: boolean`, `restore_id: number`. Cancellation is read directly from
the restore's `AbortSignal` (there is no separate `restore_cancelled` flag):
each `send_metadata` captures its own controller as `my_abort` and tests
`my_abort.signal.aborted` through a local `is_cancelled()`, so a concurrent
`send_metadata` reassigning `this.restore_abort` cannot change what the
in-flight call sees. `restore_id` is the `generation` at restore start, with
`-1` meaning "no active restore".

`send_metadata`, on first restore for the dataset:

1. `maybe_begin_restore(schema_hash)` peeks both stores. If either has a stored
   pref, it **arms a fresh restore** (`this.restore_abort =
   new AbortController()`, `restore_id = this.generation`, `restoring = true`)
   and posts `restorePending { restore_id, sort, filter }` **before** the heavy
   reads, returning whether a restore began. A fresh `AbortController` per
   restore (rather than a reused boolean) keeps a prior cancel from poisoning a
   later restore — see finding #4.
2. Call `maybe_restore_sort` / `maybe_restore_filter`, threading the
   **captured** `my_abort.signal` (not `this.restore_abort.signal`, which a
   concurrent `send_metadata` could reassign) down:
   - `read_full_column(col, signal)` →
   - `compute_sort_permutation(sort, signal)` /
     `compute_filter_indices(filter, signal)` →
   - `read_rows(0, nobs, col, col+1, { signal })`.
3. Between the two restores, short-circuit if `is_cancelled()` so a cancel
   during the sort read does not then trigger a long filter read.
4. **Distinguish abort from real failure.** The compute wrappers must catch and
   classify via `is_abort_error()`: an `AbortError` (matched by name, since the
   chunked reads reject with a `DOMException`) → quiet natural
   order; any *other* error (corruption, I/O, parser bug) → natural order **plus**
   a non-blocking notice (e.g. a toolbar note / `showWarningMessage`,
   "Couldn't reapply saved sort/filter"), and the persisted prefs are **kept**
   (only an explicit user cancel forgets them — finding #7). A bare
   `catch { … = null }` that swallows everything is explicitly rejected.
5. On the **cancelled** path (user cancel, `is_cancelled()` true),
   `send_metadata`:
   - **resets all in-memory restore effects**, not just the persisted/chip view:
     `this.sort = { keys: [], … }`, `this.permutation = null`,
     `this.filter = { entries: [], … }`, `this.filtered_indices = null`, then
     `recompute_effective()`. This is required because a *completed* sort restore
     may already have applied `this.sort` / `this.permutation` before the cancel
     landed during the filter read — without this reset the grid would show
     sorted rows with no chip (finding #1);
   - clears **both** persisted prefs for this `dataset_key × schema_hash`
     (`sort_state_store.set(…, { keys: [], … })` and the filter equivalent;
     set-empty deletes the entry, sort-state.ts:145–152) — *forget entirely*;
   - posts `metadata` with `stored_sort` / `stored_filter` **omitted** (so no
     chips render);
   - skips `post_filter_applied` (no filter is active).
6. **Cleanup in a `finally`,** not only after a successful `postMessage`: when
   this call still owns the active restore (`my_began && this.restore_abort ===
   my_abort`), clear `restoring` and null `restore_abort`. The ownership guard
   keeps a superseded call from clobbering a restore a concurrent refresh
   started. Tying cleanup to a `finally` ensures an early throw inside
   `send_metadata` (before `metadata` is posted) cannot strand the panel in a
   permanent `restoring` state (finding #3). The existing `try/catch` that
   surfaces "Failed to open .dta file" stays; the cleanup is its `finally`.

`handle_message` gains a `cancelRestore` case keyed on `restore_id`:

- If `msg.restore_id !== this.restore_id`, ignore (stale cancel from a previous
  lifecycle — finding #6).
- Else if `this.restoring` is still true: `this.restore_abort?.abort();` — the
  in-flight reads observe the aborted signal via `is_cancelled()` and take the
  cancelled path (the normal in-flight cancel).
- Else (the restore already completed and posted `metadata` in the cross-window
  race — finding #5): the user still asked to cancel, so honor it as an explicit
  **clear-and-forget**: reset in-memory sort/filter as in step 5, clear both
  persisted stores, bump `generation`, clear the row cache, and post
  `sortApplied` / `filterApplied` (and an updated `metadata` if chips must
  disappear) so the grid drops to natural order. This guarantees a click that the
  user saw as "Cancel" is never silently dropped.

Note: on the normal (non-cancelled) completion, behavior is exactly as today —
`metadata` is posted with the restored sort/filter applied; the only difference
is the earlier `restorePending` signal, which the webview clears when `metadata`
arrives.

### Webview side (`app.tsx`, `use-row-loader.ts`, `grid-model.ts`)

- Track `restore_pending: { restore_id: number; sort: boolean; filter: boolean } | null`.
  Set it on `restorePending` (recording `restore_id`); clear it when `metadata`
  arrives (both the normal and cancelled paths end by posting `metadata`).
- While `restore_pending` is set and `metadata` is still `null`, render — in
  place of the bare `Loading…`, reusing the `toolbar-progress` styling — an
  explanatory line plus an inline **Cancel** button:
  - both → *"Applying your saved sort & filter…"*
  - sort only → *"Applying your saved sort…"*
  - filter only → *"Applying your saved filter…"*
- **Debounce:** only reveal this UI if `restore_pending` persists past ~200 ms,
  so small/fast files (where `metadata` arrives almost immediately) do not flash
  the message.
- The Cancel button posts `cancelRestore { restore_id }` and optimistically
  shows a transient *"Cancelling…"* until `metadata` arrives. On the normal path
  the grid then renders in natural order with no chips. In the cross-window race
  (the extension had already completed the restore when the cancel arrived), the
  extension honors the late cancel as a clear-and-forget (see extension side), so
  the grid still ends in natural order — the optimistic UI is never contradicted.

### Edge cases

- **Persistence disabled** (`persistSort` / `persistFilters` = false): no stored
  prefs → no `restorePending` → behavior unchanged.
- **`restorePending` gating is on *existence*, not outcome (finding #8):** post
  `restorePending` whenever a stored pref *exists and is schema-applicable* —
  which is exactly what the cheap store peek can determine (mirroring
  `maybe_restore_*`'s own guards: persistence enabled, entry present, predicate
  fits the column kind). Whether the filter ultimately yields an *empty survivor
  set* is unknowable without the very read the UI exists to explain, so it must
  **not** gate `restorePending`. A stored filter that later resolves to zero rows
  still shows the explanation while it computes; `metadata` then clears it.
- **Restore read fails for a real reason (not cancel) (finding #7):** the dataset
  opens in natural order, a non-blocking notice tells the user the saved
  sort/filter couldn't be reapplied, and the persisted prefs are **retained** so
  the next reopen can retry. This is deliberately distinct from cancel
  (forget) and must not be silently conflated with it.
- **Reload after a completed restore** (`ready` received while `dta_file` is
  already set and no restore is in flight): the one-shot guards
  (`sort_restored` / `filter_restored`) are already consumed, so
  `maybe_begin_restore` returns early — **no** `restorePending` is posted and no
  columns are re-read; the queued `send_metadata` simply re-sends the in-memory
  sort/filter.
- **Reload/refresh that interrupts an in-flight restore:** here the one-shot
  guards are deliberately re-armed so the saved prefs *are* re-applied. The
  `ready` branch resets `sort_restored` / `filter_restored` to `false` and
  `refresh()` resets them as part of its full dataset reset; both then call
  `abort_and_clear_restore()` (abort the controller, then clear `restoring` /
  `restore_abort` / `restore_id`) *after* bumping `generation`. The bump makes
  the abandoned restore bail before posting or forgetting (so prefs survive),
  and the abort lets the serialized `send_metadata` chain advance at once
  instead of waiting on the dropped read; the queued send then re-reads and
  re-restores. The fresh `restore_id` (step 1) also makes any crossed
  `cancelRestore` from the prior lifecycle a no-op.
- **Late cancel after completion (finding #5):** handled by the `restore_id`
  match + clear-and-forget fallback in `handle_message`, so the user's click is
  honored rather than dropped.
- **Cancel during the sort read, with a filter also stored:** the
  `is_cancelled()` short-circuit (step 3) prevents the subsequent filter read;
  step 5's in-memory reset guarantees a sort that *did* complete before the cancel
  is also undone (finding #1).

### Tests (sight)

- **Extension unit — basic cancel:** a `cancelRestore` during restore (a) aborts
  the read, (b) clears both persisted stores, (c) results in `send_metadata`
  emitting natural-order `metadata` with no `stored_sort` / `stored_filter` and no
  `filterApplied`; a normal completion still applies the stored sort/filter and
  emits `restorePending` before `metadata`.
- **Extension unit — sort-done, filter-cancelled (finding #1):** with a stored
  sort *and* filter, complete the sort restore then cancel during the filter
  read; assert the final state is fully natural order — `this.permutation` is
  null, `effective_nobs` is the full count, and `metadata` carries no chips. (A
  naive implementation that only omits `stored_sort` would leave `permutation`
  set; this test must fail against that.)
- **Extension unit — real read error vs cancel (finding #7):** a non-`AbortError`
  failure from `read_rows` opens in natural order, surfaces the notice, and
  **keeps** the persisted prefs; assert the stores are unchanged (contrast with
  the cancel test, which clears them).
- **Extension unit — stale/late cancel (findings #5, #6):** a `cancelRestore`
  with a non-matching `restore_id` is a no-op; a matching one that arrives after
  completion drops the grid to natural order and forgets the prefs.
- **Extension unit — no stranded state (finding #3):** force `send_metadata` to
  throw before posting `metadata`; assert `restoring` is cleared and
  `restore_abort` nulled (the `finally`).
- **dta-parser — closed mid-read (finding #2):** closing the file between chunks
  yields `[]`, asserted empty (not a truncated column).
- **Webview unit (`grid-model` / loader):** `restorePending` produces the
  correct explanatory text per flag combination; the message is suppressed
  before the debounce threshold and shown after; it clears on `metadata`; a
  `cancelRestore` echoes the recorded `restore_id`.
- **Integration (`data-browser-smoke` style):** reopen a `.dta` with saved
  sort and filter → `restorePending` is posted before `metadata`; without
  cancel, the restored order is applied.

## Sequence summary

Normal reopen with saved prefs:

```
webview: ready
ext:     restorePending {restore_id,sort,filter}  ← new; webview shows explanation (after 200ms)
ext:     [chunked, cancellable column reads]
ext:     metadata (stored_sort/filter set)        ← webview clears restore_pending, renders sorted
ext:     filterApplied (if filtered)
```

Cancelled reopen:

```
webview: ready
ext:     restorePending {restore_id,sort,filter}
webview: [user clicks Cancel] → cancelRestore {restore_id}
ext:     restore_id matches & restoring → controller.abort()
ext:       reads reject AbortError → reset in-memory sort+filter, recompute_effective, prefs forgotten
ext:     metadata (no stored_sort/filter)         ← webview renders natural order, no chips
```
