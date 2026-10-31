# Data browser redesign: look, feel, and performance at scale

Status: plan, revision 6, agreed by both reviewers (Claude Sonnet and GPT-6.1 Terra) after six rounds; see the "Changes in revision N" sections. Prior art: [2026-10-30-data-browser-prior-art.md](2026-10-30-data-browser-prior-art.md).

## Goal

Make Sight's data browser the best way to look at a Stata dataset in an editor, on these axes, in priority order:

1. **It never misrepresents the data.** Each of the 27 numeric missing codes stays distinct and visible. A label is never mistaken for a value, or a value for a label. Display formats render as Stata renders them. Row numbers are Stata's `_n`. Estimates are marked as estimates.
2. **It reads like Stata.** Variable labels, value labels (including labels on `.a`–`.z`), storage types, display formats and strL are first-class. Interaction follows Stata's Data Editor where that makes sense (Values/Labels toggle, label colour, `varname[obs]`, a variables pane that searches labels).
3. **It answers "what is in this column?"** without a filter round trip: missing counts by code, distinct count, distribution, frequency table for labelled variables.
4. **It stays responsive on long files (10M rows) and wide ones (1M × 500 with strL).** The extension host's event loop is never blocked by a full-column operation, and every budget below is checked by a benchmark.

These are targets. "Acceptance" turns them into checks.

### Decided before this plan (not reopened here)

- No shared repo or package with Raven. Code ported from Raven carries a header comment naming the Raven file, as `client/src/data-browser/sort.ts` already does.
- No conversion to Arrow. Sight keeps reading `.dta` directly, for both entry points (vview and opening a `.dta` file).
- Stata semantics stay first-class: extended missing values, value labels, display formats (`%td`/`%tc` and masks, `%9.2f`, `%-20s`, …) and strL are correct end to end. Raven's cell wire format, Copy as R code, factors, row names and NA-vs-NaN do not carry over.

## Measurements: where the browser stands

### Method

`scripts/bench-data-browser/` (added on this branch, becomes Phase 0):

- `make-fixtures.ts` streams deterministic release-118 `.dta` files. Writers that take the whole dataset in memory (dta-parser 1.0's `writeDta`, Stata) would not fit 1M × 500 comfortably, and Stata is not installed on the benchmark machine. pandas `read_stata` reads every fixture and agrees on missing-code counts (for example 5,005 `.`, 1,008 `.a`, 519 `.b` in `income` of the 100k-row fixture).
- `bench.ts` drives the **real** `DataBrowserPanel` under Node (the extension host's runtime) with a stub `vscode` module and a fake webview that sends the messages the webview sends (`ready`, `requestRows`, `setSort`, `setFilters`, `requestHistogram`, `copyColumn`). A 2 ms heartbeat measures the event loop: *blocked* is the longest gap between beats minus 2 ms.
- `run.ts` runs each scenario in its own `node` process with a kill timeout, because a scenario that blocks the event loop cannot time itself out.
- `reader-bench.ts` compares one full-column scan through dta-parser 0.6 (what Sight ships), dta-parser 1.0 (the unpublished Rust/wasm rewrite in `dta-parser.new`), and a hand-written strided scan (the floor).
- `vview-latency.ts` times vview's signal file to the watcher's callback, and a raw sequential write as a lower bound for Stata's `save`.

Machine: Apple M4 Max (16 cores, 128 GiB), macOS 26.7.1, Node 26.12.1. Page cache warm (each fixture is read once before timing); cold-cache numbers need `purge`, which the sandbox does not allow. Medians of 3 runs where the table says "×3", otherwise single runs.

Fixtures:

| Fixture | Shape | File | Contents |
|---|---|---|---|
| narrow | 10M × 10 | 429 MiB | long id, byte age, labelled byte region (with labelled `.d`/`.r`), double income (`%10.2f`, 5% `.`, 1% `.a`, 0.5% `.b`), float weight, `%td` date, `%tc` time, int score (`.n`), str12 district (1,001 distinct), labelled byte consent |
| wide | 1M × 500 | 2,604 MiB | str16 id; 300 labelled byte questions (10% `.`, labelled `.d`/`.r`/`.n`); 80 int; 60 float/double with extended missings; 54 strN (str8–str40, ~200 distinct each); 5 strL columns (60% empty, 2% of 2–4 KB), 1,999,487 strLs |

### Baseline: Sight today (dta-parser 0.6, all work on the extension host)

| Operation | narrow 10M × 10 | wide 1M × 500 |
|---|---|---|
| Open → metadata posted | 1.1 ms | 3.1 ms |
| Open → first page reply | 3.3 ms (×3) | **634 ms, all of it blocking** (×3) |
| First page payload (JSON) | 149 KB, 200 rows | **5.28 MB**, 131 rows |
| RSS after first page | 17 MiB | **940 MiB** |
| Numeric sort (`income` / `x2`) | **3,487 ms, blocked 3,485 ms** (×3), RSS 961 MiB | 599 ms, blocked 597 ms (×3), RSS 1,817 MiB |
| Labelled sort, Labels on (`region` / `q1`) | 2,938 ms, blocked 2,936 ms | 533 ms, blocked 531 ms |
| String sort (`district` / `s1`) | **14,672 ms, blocked 14,670 ms** | 1,138 ms, blocked 1,136 ms |
| Page reply after sort | 1.4 ms | 10.7 ms, 5.31 MB |
| Numeric filter (`> 1000` / `> 0`) | 477 ms, blocked 475 ms (×3) | 344 ms, blocked 363 ms (×3) |
| String filter (`district` contains `_12` / strL `open1` contains `water`) | 808 ms, blocked 806 ms (×3) | 949 ms, blocked 948 ms |
| Pathological regex (`^([a-z_]+\d?)+!$` / strL `^(\w+\s?)+!$`) | **29,044 ms, blocked 29,042 ms** | **did not finish; killed at 120 s, blocked throughout** |
| Histogram for the filter brush | 524 ms, blocked 522 ms (×3) | 340 ms, blocked 338 ms (×3) |
| Copy column | 2,150 ms, blocked 2,148 ms (70.6 MB) | 722 ms, blocked 720 ms |

vview entry point (both fixtures): the watcher sees `signal_<uuid>` and claims it in **52 ms** (median of 30; max 57.5 ms; macOS FSEvents). When Stata's working directory is outside every workspace folder, Sight then waits another **300 ms** (`WORKSPACE_MATCH_DELAY_MS`, `client/src/data-browser/index.ts:53`) so a matching window can claim first. After the claim, vview and direct open run the same `DataBrowserPanel.initialize`, so the rows above apply to both. Stata's `frame put` + `save` could not be timed (no Stata on this machine); a raw sequential write plus `fsync` of the same bytes takes 435 ms for 2.6 GB and 85 ms for 429 MB, which only bounds it from below.

### Readers: one full-column scan

| Column | dta-parser 0.6 `read_columns` | dta-parser 1.0 `readColumns` | Floor (strided `readSync` + `DataView`) |
|---|---|---|---|
| narrow `income` (double, 10M) | 250 ms, +437 MiB RSS | 73 ms, +349 MiB | 48 ms, +309 MiB |
| narrow 4 numeric columns, one pass | 441 ms | 173 ms | — |
| narrow `district` (str12, 10M) | 537 ms | **1,039 ms** | — |
| wide `x2` (double, 1M; 2.2 GB data section) | 207 ms | 107 ms | 99 ms |
| wide `q1` (byte) | 150 ms | 106 ms | 96 ms |
| wide 8 numeric columns, one pass | 543 ms | 148 ms | — |
| wide `s1` (str) | 286 ms | 245 ms | — |
| wide `open1` (strL) | 1,418 ms, +1,418 MiB | 883 ms, +624 MiB | — |

All three readers agree on a checksum of every scanned numeric column. Page reads (131 rows × all 500 columns of wide): 0.6 takes 643 ms on the first page and +905 MiB because it reads and keeps the whole strL section (`DtaFile._ensure_gso`); 1.0 takes 234 ms and +280 MiB building its strL index, then 4 ms per page. A sorted page (131 scattered rows) takes 25 ms over all 500 columns and **2.7 ms over 32 columns** with 1.0. Narrow pages take ≤ 5 ms with either reader.

### Spike: the same work on typed columns

A throwaway spike (dta-parser 1.0 columns + Raven's `radix.ts`, unmodified, plus a 28-class missing split) measures what a worker would spend. Read + compute:

| Operation | narrow | wide |
|---|---|---|
| Numeric sort | 68 + 326 = **394 ms** (today 3,487) | 102 + 39 = 141 ms (today 599) |
| String sort, natural collation, rank sort | 1,034 + 675 = 1,709 ms (today 14,672) | 236 + 71 = 307 ms (today 1,138) |
| Labelled sort by label | 64 + 482 = 546 ms (today 2,938) | 100 + 46 = 146 ms (today 533) |
| Numeric filter | 71 + 50 = 121 ms (today 477) | 102 + 5 = 107 ms (today 344) |
| String contains, per-distinct memo | 1,033 + 507 = 1,540 ms (today 808) | strL: 888 + 147 = 1,035 ms (today 949) |
| Regex `^([a-z_]+\d?)+!$`, per-distinct memo | 1,040 + 498 = 1,538 ms (today 29,044) | — |
| Histogram | 70 + 50 = 120 ms (today 524) | 102 + 6 = 108 ms (today 340) |

The spike ran on the main thread; in the design it runs in a worker, so the host's share is message handling only.

### What the numbers say

1. **The host blocks for the whole duration of every full-column operation.** `read_columns` without an `AbortSignal` is synchronous, and sort, filter and histogram compute synchronously after it. Stalls range from 0.3 s (wide filter) to 29 s (regex), and are unbounded for a catastrophic regex. While stalled, every other extension in the window (the language server client, Git, terminals) waits. This is the first thing to fix, and moving the existing scans into a worker fixes it without porting anything from Raven.
2. **Opening a file with strLs costs 634 ms of blocking and ~900 MiB**, because dta-parser 0.6 loads the whole strL section to resolve the first page. 1.0 cuts this to 234 ms and +280 MiB, still on the host.
3. **Pages carry three pre-formatted strings per cell and every strL in full.** A wide page is 5.28 MB of JSON. Raw cells with strings truncated to 256 characters (a spike; the design cuts at 256 bytes) are 424 KB for the same page (12.5× smaller), 14 KB for a 32-column tile, and 10.8 KB for a 131-row narrow page (vs ~98 KB today).
4. **The comparator sort is the bottleneck, not I/O.** A 10M double column reads in 73 ms (1.0) but sorts in 3.4 s with `Array.prototype.sort` and a closure; a radix sort takes 326 ms. The string sort calls `Intl.Collator.compare` per comparison (14.7 s); ranking the 1,001 distinct values once makes it 675 ms.
5. **dta-parser 1.0 is faster everywhere except string decoding,** where it is 1.9× slower than 0.6 on 10M short strings (one `TextDecoder.decode` per cell). Adopting it unchanged would regress string sort and filter I/O. A dictionary-encoded string read (D1 below) addresses this; the R binding already builds dictionaries for the same reason (ADR 0011).
6. **Viewport reads are cheap but not safe on the host.** Warm, they take 0.1–3.3 ms per page and 2.7 ms per sorted 32-column gather. But a sorted tile is 131 scattered positional reads; on a cold cache, a network share or a file larger than RAM each is a disk round trip, and the first read of a strL column builds the strL index (234 ms, +280 MiB). Neither belongs on the extension host thread.
7. **Display is not yet truthful** (checked in code and with `apply_display_format` from 0.6):
   - Custom date masks render as raw numbers: `%tdDD/NN/CCYY` shows `21521`, not `03/12/2018`; so do `%tcHH:MM` and `%tdMon_DD,_CCYY`. `%th` and `%tC` also fall back to the raw number. 1.0's `formatValue` gets all of these right.
   - `%9.0g` shows `1234567.891`, not `1234568` (1.0: correct). Remaining 1.0 gaps: `%9.0g` of 0.5 shows `0.5`, Stata `.5`; `%10.0g` of 123456789012 shows `1.2345679e+11`, Stata `1.235e+11`; `%21x` falls back.
   - The gutter is Glide's `rowMarkers="number"` (`webview/app.tsx:1201`): under a sort or filter it shows the display position, not `_n`.
   - Numbers are left-aligned (no `contentAlign`); Stata right-aligns them unless the format has `-`.
   - Labels mode shows a label with no cue that it is a label (`grid-model.ts:get_cell_display_value`), and has no "both" mode.
   - Missing codes tie among themselves in a sort (`sort.ts:compare_rows` returns 0 for two missings), so `.a` and `.z` interleave in file order instead of Stata's `. < .a < … < .z`.
   - Cells not yet loaded render `''`, the same as an empty string.
   - The single "Include missing" switch keeps or drops all 27 codes together.
8. **A page request in flight when a sort or filter starts is dropped without a reply.** The host's generation check discards the read (`browser-panel.ts:1751`); today's webview recovers only because it re-requests the viewport after `sortApplied`. Phase 0's scroll-during-sort scenario counts these drops; the epoch protocol below replaces silent drops with `stale` replies.
9. **Host-side bookkeeping is small.** Composing a 10M-row survivor set with a 10M-row permutation (`compose_effective`) takes 11–17 ms; `JSON.stringify` of a raw 32-column tile takes 0.14 ms and of a raw 500-column page 2.1 ms (synthetic cells, same shapes). These are below the stall budget but not free, which is why composition moves to the worker.

## Design

### Architecture

```text
 Stata ── vview ── temp .dta + sidecar + signal ──┐
                                                  ▼
 .dta opened as custom editor ───────────▶ Extension host (DataBrowserPanel)
                                           │  opens the fd; owns sort/filter state, persistence,
                                           │  the committed order and its epoch; maps tile rows
                                           │  to original row indices; never reads file data
                                           │
                                           ├── Row reader thread (worker_threads)
                                           │     stateless: "these original rows × these
                                           │     non-strL columns"; never indexes strL
                                           │
                                           ├── strL thread (worker_threads)
                                           │     builds the strL index; bounded previews,
                                           │     full values on demand
                                           │
                                           ├── Scan worker (worker_threads)
                                           │     cooperative full-column work: sort keys, masks,
                                           │     composed order, histograms, profiles, find
                                           │
                                           ├── Step workers (short-lived worker_threads)
                                           │     non-cooperative steps (regex masks; Phase 1
                                           │     comparator sorts) and accepted actions (copy)
                                           │
                                           └── Webview (React + Glide)
                                                 tiles of raw cells; formats them itself
```

**Host.** Opens the file once (`fs.openSync`) and passes the descriptor number to each thread. It keeps one dta-parser reader of its own for metadata only (open measured at 1–2 ms). Owns sort/filter state, persistence, the committed order (`effective_perm`, possibly null) and `order_epoch`. For a tile request it maps display rows to original rows (a subarray read of `effective_perm`, or identity) and forwards `{rows, columns}` to the row reader. It does no full-column work from Phase 1a on (the scan worker arrives in 1a with today's algorithms; Phase 3 replaces them), and no data reads after open from Phase 1b on (in 1a it still reads row pages, as today).

**Row reader thread.** Holds a dta-parser reader on the shared descriptor and answers "these original row indices × these non-strL columns" with raw cells. It never reads a strL column, so dta-parser never builds a strL index in it (1.0 builds the index only inside a read that includes a strL column, `reader.rs:216-218`). It has no permutation, generation or transform state, so there is nothing to commit to it and no adoption step: the host decides which rows a tile means, under which epoch, before asking. This is why Sight can have a reader thread without Raven's prepare/commit/adopt protocol, which exists because Raven's reader thread holds the permutation. Reads in the thread may block on a cold disk without blocking the host. The thread starts at open, before the first tile.

- **Startup.** Spawning the thread, loading dta-parser 1.0, opening the descriptor and reading a 131-row × 32-column tile took 11.6–12.7 ms in total (4 runs, both fixtures), so the first tile does not need the host to read.
- **Independence.** The row reader never waits for the scan worker or the strL thread, so a long sort, a stuck regex or a strL index build cannot delay scrolling (Raven revision 3). Raven measured a postMessage round trip to a thread at 0.09–0.14 ms; Phase 0 re-measures it under VS Code.

**strL thread.** strL cells in a tile are sent as `{p: 1}` (pending) in the tile itself. In the same step the host asks the strL thread for those cells, tagged with the tile's `request_id`, rows and epoch. The strL thread builds its index on first use (234 ms and +280 MiB warm in 1.0 today; longer cold), then answers with previews read through D2 (bounded: at most 256 bytes of payload read per cell, plus the source length from the index). The host forwards them to the webview as a `cells` patch: `{type: 'cells', tile_request_id, order_epoch, cells: [row, col, WireCell][]}`. Ordering and binding:

- The host posts a patch only after it has posted the tile with that `tile_request_id`; a strL reply that arrives first (possible when the index is warm) is held until the tile is posted, and dropped if the tile's reply became `stale`.
- The webview stores each cached tile's `request_id` and applies a patch only to the tile whose `request_id` equals the patch's `tile_request_id` and whose epoch matches. A replacement tile at the same coordinates has a new `request_id`, so a late patch for the old one is ignored. Patches never touch the row-request tracker; their ids are tile ids, not request ids.
- When a tile is evicted, or re-requested, the old patch is ignored and the new tile request issues its own strL request.
- The strL thread's queue is newest-first with depth 8. At dequeue it drops requests whose epoch is no longer current; a request pushed out of the queue is answered with `{type: 'cellsDropped', tile_request_id}`, and the webview re-asks (`requestStrl`, by tile id) only if that tile is visible again.
- A strL request not answered within 30 s, or a strL thread failure, yields a patch of `{e: 1}` cells (drawn as "unreadable", with the reason in the tooltip). No cell stays `{p: 1}` indefinitely. The full value for the strL viewer (Phase 5) comes from the strL thread, also bounded (first 1 MiB, with the length). Scans over strL columns (a strL filter, a strL profile) run in a terminable step worker, one at a time, in ranges, so no whole strL column is held at once; the step worker builds its own index unless D3 lets it import the strL thread's (an import of typed arrays, with no section scan). The RSS budget below covers that case.

**Scan worker.** One per panel, started after the first tile is posted. Same descriptor. Runs every *cooperative* full-column computation (filter masks other than regex, sort keys once they are radix-based, composition, histograms, restore, and later profiles and find) and produces the composed order. It owns the step outputs and caches.

**Step workers.** Work that cannot be interrupted cooperatively, or that must not die with the scan worker, runs in a short-lived worker spawned for it (spawn + load + open measured at ~12 ms): a regex mask; in Phase 1, a sort step that still uses today's `Array.prototype.sort` comparator (`sort.ts:139`, no check point); in every phase, any step that reads a strL column, because both readers build their strL state synchronously and without a cancellation point on the first strL read: 0.6 loads and indexes the whole section (`_ensure_gso`, `dist/esm/node.js:2653`), and 1.0 builds its index inside the read (`reader.rs:216-218`, 234 ms warm on wide). The scan worker never reads a strL column; strL-reading steps use the two strL slots described under "strL arbitration"; and an accepted copy. A step worker gets the descriptor (in 1a, the path), its inputs (for a copy, a clone of the pinned order) and returns its output by transfer. Cancelling it is `terminate()`, which never touches the scan worker, its caches or any other job.

Step workers come from two separate pools, so neither kind of work can starve the other:

- **Transform pool: 2 slots**, used only by steps of the latest requested state. The pools guarantee that copies never delay transforms and transforms never kill copies. Within the transform pool there is no further guarantee: two regex or strL filter entries can hold both slots and a Phase 1 comparator sort waits for one, which is harmless for the result (composition needs every mask anyway) but delays warming the sort key.
- **Action pool: 2 slots**, used only by accepted copies. A third copy waits; copies never take a transform slot, and a transform never preempts a copy.

In Phase 1a a step worker opens the file by path and fails its step on a mismatch ("The file changed on disk") so a step never reads a different file than the host's metadata describes: it compares inode, size and mtime with the values the host recorded from its own `fstat` at open (not a path `stat`, to avoid a race).

**strL arbitration.** Two strL slots exist per panel: one shared by transform steps, find and profiles, and one in the action pool for accepted copies of strL columns (one strL copy at a time; further strL copies wait in the action pool). The copy guarantees therefore hold for strL columns too: a strL copy never takes the slot a strL filter needs, and a strL filter never preempts a copy. With the strL thread's own index, at most three strL states exist at once in 1b (strL thread, shared slot, copy slot) and two in 1a (shared slot and copy slot, besides the host's 0.6 section from page reads); the strL RSS rows count them. Within the shared slot: A higher-class strL step that finds the slot taken by a lower class terminates that step and requeues it; a step that has been preempted twice is not preempted again and keeps the slot until it finishes, so lower classes cannot starve; a higher-class step waiting behind it shows "Waiting for a strL scan…" in the pending pill; find and profiles over strL columns run in step workers, never in the scan worker. Without D3 each strL step builds its own index (234 ms and +280 MiB warm on wide), serially; this repeat cost is accepted until D3.

**Job classes.** The scan worker serves, in priority order: (1) transform steps of the latest requested state; (2) user actions that need a full pass (find, the go-to inverse map); (3) background work (profiles, histogram prefetch). A higher class preempts a lower one cooperatively at its next check: every 65,536 elements in compute loops, and between range reads, where a range is sized by bytes touched, not rows (at most 64 MiB of the data section; the measured 2.2 GB section scans in ~100 ms, so a range takes ~3 ms warm). Ranges shrink adaptively (halving after any range read slower than 25 ms, down to 4 MiB) so cold or network reads keep check intervals short. This cannot bound the first slow read, or a slow read at the 4 MiB floor; those cases are what the cold measurement in Phase 0 sizes, and the budget is reset from it. The cancellation latency budget is < 50 ms warm; Phase 0 measures it cold on Linux and resets it if needed. A preempted background job is requeued. A preempted action resumes only if the transform settles without changing the order; if the transform commits a new epoch, the action is cancelled and the webview re-issues it under the new epoch if it is still wanted (find re-runs on the new order; go-to recomputes its inverse map). Copies run in step workers, so a sort never waits for a copy and a copy is never killed by a transform.

**Descriptor lifecycle.** Worker threads share the process's descriptor table; this was checked by reading a descriptor in a worker after the main thread unlinked the file, which is vview's temp-file lifecycle on POSIX (unlink right after open). On refresh and dispose the host awaits `terminate()` of every thread before `fs.closeSync`, then (Windows) unlinks the temp file. The wait is bounded (5 s): a thread stuck in a native read on a slow or network disk is abandoned, the descriptor is left open and logged as leaked (process exit reclaims it), and dispose completes; refresh opens a new descriptor rather than reusing the old one. Today `refresh()` and `dispose_core()` close synchronously (`browser-panel.ts:238`, `:302`); both become async with the panel marked closed first, so no message is handled in between. Tests cover POSIX unlink-after-open, Windows delete-after-close, refresh while a scan runs, and dispose while a regex worker is being terminated.

**File changed on disk.** The guarantee is *best-effort detection*, not an immutable snapshot: an open descriptor does not freeze a file's contents, and size and mtime cannot prove contents unchanged (a same-size rewrite within the filesystem's mtime granularity is undetectable). What the browser does:

- vview temp files are private to Sight and nothing writes them after vview's `save`; from 1b they are also unlinked after open. In 1a they stay on disk until close, and Sight never modifies them (their protection from the sweep is a separate lease file, below), so every check in this section applies to them unchanged. The path watcher below is attached only to directly opened files.
- A directly opened file that is replaced atomically (written elsewhere and renamed over the path) leaves the open descriptor on the old inode, so the browser keeps showing a consistent old snapshot. A `vscode.workspace.createFileSystemWatcher` on the path, plus a `stat(path)` comparison of inode, size and mtime against the descriptor's `fstat`, detects the replacement and shows "The file changed on disk. Reload". Whether Stata's `save, replace` replaces atomically or rewrites in place is checked in Phase 0 on a machine with Stata; both cases are handled.
- A file modified in place (same inode) can make reads inconsistent. Every thread compares `fstat(fd)` size and mtime with the values recorded at open *after* each tile read and after each range read of a scan (microseconds per call), so a change that lands during a read discards that read. The host checks once more immediately before posting any tile or patch and before any commit. On a difference: the read is discarded, all in-flight work is invalidated, nothing further is served or committed, and the panel shows the Reload banner. A path `stat` that fails with ENOENT shows "The file was deleted or moved".
- Tests mutate the file during the last range read of a scan, immediately before a commit, and during a tile read.

**Runtime.** `client/package.json` declares `engines.vscode ^1.75.0` (Electron 19, Node 16), and `@types/vscode ^1.75.0` (`:834`). dta-parser 1.0 declares Node ≥ 20. Phase 0 runs 1.0's wasm load, its `TextDecoder` use and the worker-thread lifecycle on Node 16 and 18 to find what actually fails, maps that to the oldest VS Code (and the VS Code bases of Positron and VSCodium) that works, and raises `engines.vscode` and `@types/vscode` to it in Phase 1b (a user-visible change, noted in the release notes). VS Code and the marketplace will not install the new version on an older editor, so users there keep the last compatible release; there is no second, 0.6-based code path to maintain. dta-parser compiles its wasm from bytes embedded in its CommonJS bundle, in Node, so the webview CSP does not apply to the threads. The two threads are separate esbuild entry points (CommonJS, like the extension bundle), resolved with `path.join(context.extensionPath, 'dist', …)` and packaged in the vsix; Phase 1's extension smoke test (`client/test/extension-smoke.js`) opens a fixture through them.

### Data layer: dta-parser 1.x

Sight moves from `@jbearak/dta-parser` 0.6 to 1.x. 1.0's columnar API (`readColumns` → `{values: Float64Array, missing: Uint8Array}`, missing 0, 1 = `.`, 2–27 = `.a`–`.z`) is the representation a scan wants; it reads numeric columns 1.4–3.7× faster than 0.6 (table above); its `formatValue` fixes the date-mask and `%g` errors; and it opens a borrowed descriptor (`openDtaFile(fd)`), which 0.6 cannot (`DtaFile.open(path)` only).

A `DtaSource` adapter (`client/src/data-browser/dta-source.ts`) is the only module that imports dta-parser, so the host and every thread share one adapter and tests can substitute fixtures.

Proposed dta-parser changes. Each is justified by a measurement; none is a hard gate unless the phase table says so:

| | Change | Why (measured) | Without it |
|---|---|---|---|
| D1 | `readColumns(cols, {strings: "dictionary"})`: `{codes: Uint32Array, values: string[]}`, giving up to plain strings by the R binding's rule (more than half of ≥ 65,536 rows distinct) | 1.0 decodes 10M str12 in 1,039 ms vs 537 ms in 0.6; rank sort and per-distinct filters want codes + distinct values anyway | string sort/filter budgets relax (see Budgets); the worker builds the dictionary itself after decoding |
| D2 | `maxStringBytes` on `readRows`: longer strings/strLs come back truncated at a UTF-8 boundary, with their full byte length | the wide page is 5.28 MB; a 4 KB strL is read and decoded in full to show 40 characters | **none: required for Phase 1b.** Without it a preview reads and decodes the whole value, and 1.0 allocates a strL's declared length, up to 4 GiB (`reader.rs:394-403`), so previews are not bounded. D2 must also report the *source* byte length (the GSO length less its terminator), which for pre-118 encodings differs from the decoded UTF-8 length (`reader.rs:408-410`) |
| D3 | strL index as typed arrays (sorted 64-bit keys `v·2⁴⁰+o`, payload offsets, lengths, binary flags; ~21 B per entry, ~42 MB for 2M), exported by one reader and accepted by another on open | today's index is a `HashMap<(u32,u64),StrlEntry>` (`reader.rs:131`), +280 MiB for 2M strLs, built separately by every reader | each thread that touches strL builds its own |
| D4 | browser-safe `@jbearak/dta-parser/format` subpath exporting `formatValue` and `MISSING`, no wasm | the main bundle embeds ~290 KB of wasm and would need `wasm-unsafe-eval` in the webview CSP | Sight vendors `format.ts` (same author, GPL-3) with a header naming its source, until D4 ships |
| D5 | `formatValue`: `%g` without leading zero (`.5`), `%g` exponent within the width (`1.235e+11`), `%21x` | three remaining format deviations | they stay listed as known deviations in `docs/data-browser.md` |
| D6 | `readRowsAt(indices, columns)` in one call | a sorted 131-row gather is 131 calls (2.7 ms at 32 columns) | per-row calls, off the host |

1.0 itself is not on npm (latest is 0.11.2). Publishing 1.x with D2 is Phase 1b's hard dependency.

### Transforms: sort and filter

**State.** The host keeps the *requested* state (latest sort spec, latest filter spec) and the *committed* state (the specs whose order is installed, `effective_perm`, `order_epoch`). The webview shows chips for the requested state with a pending marker on any component not yet committed.

**One compute for the whole requested state, made of steps.** A compute of the requested state `{sort, filter}` is a sequence of *steps*: one mask per enabled filter entry, one key per sort key, then composition. Step outputs are *live* while any queued or running compute needs them: a compute holds a reference to each output it uses, and live outputs are never evicted, whatever their number (17 active filters means 17 live masks, nobs bytes each, counted in the RSS figures). When no compute holds an output it moves to an evictable cache (Phase 3: masks, 16 entries; sort keys, byte-bounded, 256 MiB default), keyed by column, storage type and, for labelled columns, label mode, but *not* by direction, so flipping a sort's direction reuses its key. Phase 1 has the live-output rule and no evictable cache. Each compute has an increasing `compute_seq`; the worker runs one at a time, with a queue of depth one (a newer request replaces a queued one).

When the requested state changes while a compute runs, the host compares the running step with the new state:

- If the running step is still needed (the user sorts while a filter entry's mask is computing), nothing is signalled. The new compute is queued; the running compute stops at its next step boundary (before each step it checks whether a newer request is queued) and the queued compute starts, finding the finished mask in the cache. A sort never drops a pending filter, and a filter never drops a pending sort.
- If the running step is no longer needed (the user changed or removed that filter entry), the host cancels it: a cooperative step stops at its next check (< 50 ms); a step in a step worker (a regex mask, or in Phase 1 a comparator sort) is terminated, which leaves the scan worker and its caches intact.
- A superseded compute posts nothing; only the compute with the latest `compute_seq` produces a result.

This keeps the guarantee of `enqueue_user_action` (`browser-panel.ts:408`), that every requested component is eventually applied, without making a quick sort wait for a slow filter that is no longer wanted.

A retained regex mask that never finishes (a catastrophic pattern) runs in its step worker and blocks only the compute that needs it; profiles, find and other actions continue in the scan worker. The pending pill names the step ("Filtering open1 by regex…") and offers **Cancel this filter**, which removes only that filter entry from the requested state (keeping every other requested sort and filter, including a queued sort) and terminates only its step worker; the queued compute then runs without it. When the 10-minute deadline fires, the step worker is terminated, the requested state reverts to the committed state, and the panel says which step was stopped. Tests cover a finite slow regex followed by a sort (the sort applies to the regex's survivors, and the mask is computed once) and a catastrophic regex followed by a sort and then Cancel.

**Composition in the worker.** The worker produces the final display order (survivors in sorted order, or null for natural order) and the survivor count. It keeps a copy of the committed order for later work (go-to, find, copy, re-sorting survivors) and transfers a clone to the host, so ownership of the host's buffer is unambiguous. The host's commit is an O(1) swap. After a restart the host re-seeds the worker with the committed specs *and a copy of its committed order* (40 MB for 10M rows), so the worker never recomputes a committed order (which could take minutes, or differ if the file changed).

**Commit.** When a result arrives with the current `compute_seq`, the host swaps in the order, increments `order_epoch`, clears its tile bookkeeping, and posts one announcement carrying `order_epoch`, the committed specs and the effective row count. A result with an older `compute_seq` is dropped. A settle that leaves the order unchanged (a Skip of a restore, an empty restore, a disabled-only filter) posts the announcement without incrementing the epoch, so the webview keeps its tiles (today's rule, `browser-panel.ts:595-608`).

**Epochs on the wire.** `metadata`, `sortApplied`, `filterApplied`, `restoreSettled` and the new `orderCleared` all carry `order_epoch`; the webview adopts each atomically on receipt (set epoch, drop tiles of other epochs, re-request the viewport). Every request that depends on order (`requestRows`, `copyColumn`, go-to, find) carries the epoch the webview shows.

- **On arrival**, the host serves a request only if its epoch is current, and otherwise replies `{type: 'stale', request_id, order_epoch}`.
- **On completion**, a row-reader or strL reply is forwarded only if the epoch it was forwarded under is still current; otherwise the host sends `stale` for its `request_id` instead of the data (today's equivalent is the generation check after each awaited read, `browser-panel.ts:1751`). The host stores the epoch with each forwarded request.
- Because the host commits and posts the announcement in one synchronous step, and postMessage preserves order, any `stale` reply arrives after the announcement that made it stale. The webview has already adopted the new epoch; it clears that request's pending entry by `request_id` (`row-request-tracker.ts` gains `clear(start, request_id)`, so a stale reply can never leave a page pending, `use-row-loader.ts:449`) and requests the viewport again under its epoch. Each tile is re-requested at most once per announcement.
- **Actions are not retried automatically.** A copy or go-to that gets `stale` reports "The row order changed; try again", because the user acted on an order that is no longer on screen.
- **An accepted action is pinned.** Once the host accepts a copy at epoch E, a step worker completes it with a clone of the order of epoch E (40 MB for 10M rows, counted in the RSS budget, freed when the copy ends), even if E+1 commits meanwhile, so the clipboard matches what was on screen when the user clicked. Find results carry their epoch and are dropped if it is no longer current.

**Reload.** A webview `ready` no longer increments anything that drops an in-flight compute (today it bumps `generation`, `browser-panel.ts:950`). The host re-sends metadata with the current epoch and requested/committed specs; the in-flight compute commits normally.

**Cancellation.**

- Cooperative: a 4-byte `SharedArrayBuffer` flag per compute (`Atomics.store` by the host, `Atomics.load` by the worker every 65,536 elements and between range reads of at most 64 MiB, the reading pattern dta-parser 1.0 recommends in ADR 0002).
- Terminating: only step workers are terminated on cancel. The scan worker is terminated only if it crashes or a cooperative step misses its check for 10 s (a bug); then the host starts a fresh one re-seeded with the committed specs and order, its caches are lost, and the next sort's pill says it is rebuilding keys. Accepted copies run in their own step workers and are unaffected; if a copy's own worker fails, the user is told "Copy failed" with the reason.
- After 500 ms the pending pill offers **Cancel all**, which reverts the whole requested state to the committed state and cancels or terminates every running step of it. **Cancel this filter** (above) is the per-step control. Tests cover both in the regex-then-sort case: Cancel this filter applies the sort alone; Cancel all leaves the committed order and both chips revert.

**Restore** keeps paint-first and the `restore_id` handshake (`restore-cancel.test.ts`); it is one compute of the saved `{sort, filter}`, cancellable like any other, settling through `restoreSettled` with the epoch rule above. When a user sort or filter supersedes a running restore, the host posts `restoreSettled` for that `restore_id` at once (natural order, no chips, current epoch) so the banner clears, marks the restore consumed as `supersede_restore_attempt` does today (`browser-panel.ts:873`), and the user's compute proceeds; the superseded restore compute posts nothing.

### Sort

Port Raven's `radix.ts` and `SortKeyCache` (default 256 MiB per panel; keys over all rows, so a sort under a filter sorts survivors only).

**Order, precisely.** For each sort key, a row is in one of two partitions: *present* (a non-missing number, or any string, including `""`) and *missing* (a numeric missing code).

1. Present rows come first and are ordered by the key's value in the chosen direction. The value is the label text when the column is value-labelled and Labels or Both is on (a present code without a label uses its formatted number as its text); otherwise the number, or the string in the chosen string order.
2. Missing rows come after present rows in both directions, ordered by code `.`, `.a`, …, `.z` in both directions, whatever the labels mode. Labels on `.d`/`.r` never reorder the missing partition.
3. Rows tied on key *k* (same present value, or same missing code) are ordered by key *k*+1, and rows tied on every key keep their original row order.

This is not Stata's order for a descending sort (`gsort -x` puts missing first, and in reverse code order); the docs say so. String order defaults to natural numeric-aware collation (today's behavior); "Stata order" (byte order, what `sort` uses) is a per-sort choice. A reference comparator implementing exactly rules 1–3 is the oracle for property tests over all storage types, directions, label modes and multi-key sorts.

### Filter

Port Raven's mask-per-entry evaluation, per-distinct string memo (100k) and mask cache. Every existing predicate and invariant in `filter.ts` stays.

**Missing selection.** Numeric predicates other than `isEmpty`/`isNotEmpty` replace `include_missing: boolean` with `missing_codes`: the set of codes (`.`, `.a`–`.z`) whose rows pass regardless of the predicate. The editor lists the codes present in the column, with labels and counts once profiles exist (Phase 4). `isEmpty` and `isNotEmpty` keep their meaning exactly (all missing codes pass / none pass, `filter.ts:111`); "Is missing" gains an optional code subset. String columns have no codes: `""` is their missing value, `include_missing` stays a boolean for them, and `isEmpty` keeps matching `""`. New filters keep no missing codes, as today's default.

**Migration.** Persisted filter state gains `version: 2`. For one release Sight writes both the v1 entry (with `include_missing` derived as "any code kept") and the v2 entry, so rolling back one version does not lose saved filters. Loading v1 (`filter-state.ts`) maps by predicate and column kind: numeric non-empty predicates `include_missing: true` → all 27 codes, `false` → none; `isEmpty`/`isNotEmpty` and string predicates unchanged. An older Sight reading v2 entries drops them (its loader requires a boolean, `filter-state.ts:167`), which the release notes say. Tests restore v1 states for every predicate kind.

### Profiles and histograms

Port `sketches.ts` (HyperLogLog p = 14, Space-Saving k = 1,000, reservoir 100k) and the profile logic from Raven's `profile-engine.ts`, with Stata changes:

- Missing counts by code, all 27. For strings, `""` is counted as empty (Stata's string missing), not as a code.
- Numeric: min, max, mean, sd (two passes), quantiles (exact from a cached sort key, else reservoir, marked ≈), 20-bin histogram with Raven's edge-corrected `binIndex`.
- Labelled numeric: a frequency table split like SPSS FREQUENCIES and `tab, missing`. Valid rows list every label in the set, including zero-count labels, plus codes present without a label; Missing rows list each code present with its label; count, percent, valid percent. A column is labelled-categorical only if its set labels at least one non-missing value (table-viewer's rule).
- Strings: distinct (exact to 100k, then ≈), top values, empty count, byte-length range.
- Estimates carry "≈" and say how they were estimated.

**Scheduling.** Port `profile-scheduler.ts`: visible columns first, one compute at a time, paused while a transform or find is pending. A `.dta` scan reads the whole data section, so the scheduler batches interesting columns into one pass (8 numeric columns: 148 ms vs 107 ms for one, wide) and accumulates per range read.

The filter brush uses the profile's 50-bin histogram (spike: 120 ms narrow, 108 ms wide, in the worker).

### Wire format and tiles

The webview requests tiles: a row page × a 32-column page (Raven `tile-cache.ts`, ported), only those the viewport needs.

```ts
type WireCell =
    | number                                  // present numeric value
    | string                                  // string, complete
    | { m: number }                           // missing code: 1 = ., 2 = .a, … 27 = .z
    | { m: number; l: string }                // missing code with label (oversized sets only)
    | { v: number; l: string }                // present value with label (oversized sets only)
    | { t: string; n: number }                // truncated: preview, full length in bytes
    | { b: number }                           // binary strL of n bytes
    | { p: 1 }                                // strL not yet resolved
    | { e: 1 };                               // strL could not be read (reason in a tooltip)

interface TileMessage {
    type: 'tile'; request_id: string; order_epoch: number;
    row_start: number; col_start: number;
    obs: number[];        // _n (original row + 1) for each row of the tile
    cells: WireCell[][];  // rows × columns
}
```

- Truncation: a string longer than 256 bytes is cut at the last UTF-8 character boundary at or before 256 bytes (the payload sizes above were measured with a 256-character cut on mostly ASCII text) (D2, or after decoding in the row reader), and `n` is its full length in bytes, which is what Stata stores and `strlen()` reports. The cell shows the preview's first line and "… 3,412 bytes".
- Labels: metadata carries each value-label set once, by name, when it has ≤ 10,000 entries (`MAX_SHIPPED_VALUE_LABELS`, unchanged); the webview resolves labels for those. For a column whose set is larger, every cell of every tile carries its label in `l` (absent means "no label for this value"; an empty-string label is `l: ""`), so Values/Labels/Both switch from cached tiles in either case. Search over oversized sets and their full table in the properties view are served by the worker, paged.
- Formatting: the webview formats with `formatValue` (D4 or vendored) and memoizes the display string per (tile, cell, mode), since Glide calls `getCellContent` per visible cell per frame. `{m}` maps to dta-parser's frozen `MISSING` objects, which label maps are keyed by.
- `obs` gives the gutter `_n` and lets go-to and selection speak in `_n`.
- Sizes: a full wide page is 424 KB instead of 5.28 MB; a 32-column tile 14 KB; a narrow page 10.8 KB. JSON stays (Raven's F6 measured a typed-array wire gain under 20%; Sight's gain comes from dropping duplicated strings and long strLs).

### Look and feel

**Grid.** Keep Glide Data Grid. Pin it to an exact version and apply Raven's accessibility patch (header names, row labels carrying `_n`).

**Truthful cells** (Phase 2):

- Numeric missing is never blank: `.`/`.a`… or its label. The missing style (`sight.dataBrowser.missingValueStyle`) applies to labelled missings, so "Refused" reads as missing.
- **Values / Labels / Both.** Both renders `1 Yes`, `.r Refused` (code, then the label dimmed). In Labels and Both, label text uses a theme colour (Stata draws labels blue), so a label is recognizable at a glance. A code with no label in a labelled column shows in the value colour, which exposes stray codes.
- Numbers right-aligned; a `-` format left-aligns. Strings follow `%-20s` / `%20s`. A number that does not fit shows `###` with the value in the tooltip; a label never does.
- Dates and times through `formatValue`.
- Not-yet-loaded cells draw a skeleton bar, never `''`; `{p: 1}` draws a loading glyph.
- Long strings and strL: preview plus byte length; binary strL: "binary, 1,204 bytes".

**Gutter.** A frozen first column shows `_n` from the tile's `obs`. Its header shows `shown / total` while filtered.

**Header.** Name in bold; variable label as a second line (toggle, like Stata's "Show variable labels in column headers"); type tag (`byte`, `str12`, `strL`, `%td`) and a value-label marker; a 2 px missing bar split into `.` and `.a`–`.z` (Phase 4); sort glyph and priority.

**Summary band** (Phase 4, optional row): sparkline or top labels and missing % per column; on by default for ≤ 200 columns.

**Columns sidebar** (Phase 4): name, label, type, format, value-label set, missing %, sparkline per variable. Search covers names, variable labels and value-label text. Name matching is exact-case by default, per Stata's case sensitivity; label and value-label text search is case-insensitive, a UI convenience over free text (the CLAUDE.md exception, documented at the call site). Hide/show, reorder, scroll-to, expand for profile, frequency table and properties (storage type, format, the full value-label table including missing-code labels, notes, characteristics).

**Toolbar and status line.** Values/Labels/Both control, Formats toggle, chips as today; the status line shows the cursor as `varname[_n]`, `N shown of M`, and pending work with Cancel.

**Find and go to** (Phase 5). Find matches displayed text in the current mode, in the worker. Go to accepts `varname[obs]`, `varname obs`, `obs` (an `_n`) or `#k` (a display position). Mapping an `_n` to a display position needs the inverse of the committed order: the worker builds it on first use per epoch (a 10M-entry `Int32Array`, 40 MB, one pass) and drops it when the epoch changes.

**strL viewer** (Phase 5). Double-click opens the value, fetched on demand from the strL thread: the whole value up to 1 MiB, and beyond that the first 1 MiB with a visible note "Showing the first 1 MiB of 3.4 MB" and a Copy that copies only what is shown, saying so.

## Budgets

These are hypotheses derived from the measurements, to be confirmed or reset in Phase 0 by measuring end to end in VS Code. "Blocked" is the host's longest event-loop stall during the operation.

Phase 0 extends the harness to: record peak RSS (`process.resourceUsage().maxRSS` per process, and per thread where Node reports it); serialize every posted message (`JSON.stringify`) inside the fake webview so its cost lands in "blocked"; run repeated viewport, copy, restore and scroll-during-scan scenarios; run a subset inside the VS Code extension host through `@vscode/test-electron`; and measure cold reads on the Linux CI runner after dropping the page cache (`sync; echo 3 | sudo tee /proc/sys/vm/drop_caches`), which the macOS sandbox here does not allow. Cold-read numbers therefore come from Linux only, and every table that cites one says so.

| Measure | Fixture | Today | Evidence | Budget |
|---|---|---|---|---|
| Host blocked during sort, filter, histogram, profile, copy, find, restore, scrolling | both | 0.3–29 s; unbounded | worker spike; compose 11–17 ms moves to the worker | < 50 ms |
| Open → first tile reply (host, including row-reader startup) | narrow / wide | 3.3 / 634 ms | thread spawn + load + open + 32-column tile: 11.6–12.7 ms | < 20 / < 50 ms |
| Open → first rows painted (VS Code-hosted, measured in Phase 0) | narrow / wide | 178–320 / 645–646 ms; host blocked 4 / 534–538 ms during the open | wide at 10% scale: the first page took 168 ms to reach the webview (posted at 177 ms, received at 345 ms) | < 250 / < 300 ms |
| Peak RSS through first tile | wide | ≥ 940 MiB | 1.0, no strL index at first tile | < 300 MiB |
| Sorted 32-column tile, warm / cold | wide | 10.7 ms (all columns, warm) | 2.7 ms warm | p95 < 8 ms warm; cold reported, off host |
| Tile payload, 32 columns | wide | 5.28 MB (page) | 14 KB | < 64 KB |
| Numeric sort, 10M | narrow | 3,487 ms | 394 ms | < 1 s |
| String sort, 10M, ≤ 100k distinct | narrow | 14,672 ms | 1,709 ms | < 2 s; target < 1.2 s with D1 (0.6's 537 ms read + 675 ms compute is the evidence) |
| Labelled sort by label | narrow | 2,938 ms | 546 ms | < 700 ms |
| Numeric filter | narrow | 477 ms | 121 ms | < 300 ms |
| String filter | narrow | 808 ms (blocking) | 1,540 ms (off host) | off host always; < 1 s is a D1 target, not derived |
| Regex cancel → step worker gone, queued compute started | wide, strL | unbounded | — | < 250 ms |
| Cooperative cancel latency (filter, composition, range read) | both | — | 65,536-element checks | < 50 ms |
| Histogram / one-column profile | narrow | 524 ms | 120 ms | < 400 ms |
| Profile, 20 visible columns | wide | — | 8 columns: 148 ms read | < 1.5 s |
| Copy column, host blocked | narrow | 2,148 ms (70.6 MB) | — | < 100 ms is a hypothesis: the 70.6 MB string's transfer from the worker and `clipboard.writeText` are measured in the VS Code-hosted subset in Phase 0 before it is fixed |
| Peak RSS, strL filter and a concurrent strL copy (host + threads; three strL indexes without D3, range scans) | wide | ≥ 1,476 MiB (RSS after, filter alone) | index +280 MiB each; whole-column read +624 MiB is avoided by range scans | < 1.3 GiB without D3 (< 1 GiB without a concurrent copy), re-set in Phase 3 |
| Peak RSS, numeric sort (host + threads) | narrow / wide | ≥ 961 / ≥ 1,817 MiB | spike 477 / 95 MiB, one thread | < 1 GiB / < 600 MiB, re-set in Phase 3 from a two-thread measurement |

The string-filter row is where 1.0 is slower than today in wall time (1.5 s vs 0.8 s) while no longer blocking. From Phase 1b (when the worker's string scans move from 0.6 to 1.0; in 1a they still use 0.6, so no wall-time change) until D1 or Phase 3's dictionary, a string filter on 10M short strings takes about twice as long but leaves the editor responsive; the Phase 1b PR and the docs say so. Phase 3 reports it; if D1 is not available, the worker builds the dictionary itself for low-cardinality columns and the budget is re-measured.

## Phasing

One PR per phase (Phase 1 is two PRs, 1a and 1b), each with tests, benchmark numbers in the PR body, and `docs/data-browser.md` updated in the same PR.

| Phase | Ships | Needs from dta-parser | If unavailable |
|---|---|---|---|
| 0 Measurement | harness under `bun run bench:data-browser`; peak RSS, serialization, repeated and concurrent scenarios (scroll, scroll during a sort, restore); VS Code-hosted open-to-paint suite (`bun run test:perf` in `client`); cold reads in a report-only CI job; webview timing marks behind `sight.dataBrowser.debugTiming`; display-truth and missing-identity batteries (gaps pinned to today's output, so a fix fails them on purpose). The runtime survey for `engines.vscode` needs a 1.x build, so it runs at the start of Phase 1b | nothing | — |
| 1a Off the host | scan worker and step workers (separate transform and action pools; strL-reading steps in step workers) running today's `sort.ts`, `filter.ts`, `histograms.ts` and copy on dta-parser 0.6's `read_columns` (which returns the `RowCell[]` they already take, and supports an `AbortSignal` for range reads); filter loops and composition gain 65,536-element checks; comparator sorts and regex masks in step workers; requested/committed compute with steps and live outputs; `compute_seq`, `order_epoch`, `stale` replies and tracker `clear`; job classes; deadline. Row reads stay on the host as today. 0.6 opens by path only, so vview temp files are kept until the panel closes on every platform (today's Windows behavior) and step workers can open them later; a panel unlinks only its own temp file when it closes; the age-based startup sweep (`prune_stale_browse_files`, 24 h, `signal-watcher.ts:126`) is unchanged and is not run on close, and each open panel keeps a lease file beside its temp file (`<uuid>.lease`) and refreshes the lease's mtime once an hour and before every step-worker spawn (extensions cannot observe system resume, so the spawn is the reliable trigger). The sweep skips any temp file whose lease is younger than 24 h, so another window never takes a file that is still open, and the data file's own mtime is never touched. If a refresh finds the temp file gone, the panel shows "The temporary copy of this dataset was removed; reopen it from Stata" at once. The lease is matched to its temp file by the uuid in both names (`<uuid>.dta`, `<uuid>.lease`); refreshes are throttled to once a minute and run asynchronously; an error other than ENOENT is logged and retried. The sweep (`is_browse_temp_filename` and `prune_stale_browse_files`, `signal-watcher.ts:~117-155`) learns the `.lease` suffix: a temp file with a lease is judged by the lease's mtime, one without a lease (older Sight, or a crash before the lease was written) by its own mtime as today, and a lease whose temp file is gone, or that is older than 24 h, is deleted. An older Sight in another window ignores leases and can still sweep an open 1a temp file during the rollout; that is an accepted gap, like sleep over 24 h. A temp file outlives a crashed host until a sweep after 24 h; a machine asleep for over 24 h with a panel open can still lose its 1a temp file to another window's startup sweep, which fails later steps with a message (an accepted gap until 1b). Step workers check inode, size and mtime against the host's `fstat` at open when they open by path (the data file is never modified by Sight; leases protect it from the sweep). 1a's PR reports peak RSS for host + workers, with the budget "no worse than today" (≥ 961 MiB narrow sort, ≥ 1,817 MiB wide sort; for a wide strL filter, whose step worker loads 0.6's whole strL section while the host keeps its own from page reads, ≤ 2.5 GiB, and ≤ 3.2 GiB with a concurrent strL copy; an accepted regression until 1b), including pinned-copy orders (40 MB each for 10M rows) | none | — |
| 1b Reader and wire | 1.x reader behind `DtaSource` on a borrowed descriptor (unlink-after-open restored); today's sort and filter take typed columns directly (`build_sort_column` and `filter.ts`'s `to_numbers`/`to_strings` read `values`/`missing` instead of `RowCell[]`; no inflation back to cells), algorithms otherwise unchanged until Phase 3; row reader and strL threads; host does no data reads after open; tiles, `cells` patches; label sets once in metadata; webview formatting; file-change detection; raised `engines.vscode`; date masks, `%th`, `%tC`, `%g` width fixed as a consequence | 1.x published with D2 | 1b waits; 1a has already removed the host stalls. 0.11.2 is not a substitute (no borrowed descriptor, no typed missing codes, 0.x formatting, no bounded strL reads) |
| 2 Truthful display | `_n` gutter; alignment; `###` rule; Values/Labels/Both with label colour; labelled-missing styling; skeletons; strL previews; missing partition order (rules 1–3) in the worker's sort; header label toggle and type tag; batteries un-skipped | D5 optional | three `formatValue` deviations stay documented |
| 3 Speed at scale | radix and rank sort (cooperative, so sorts leave the step workers); evictable sort-key and mask caches; per-distinct string memo; dictionary strings; strL index sharing | D1, D3, D6 optional | budgets marked in the table above apply |
| 4 Column understanding | profiles and scheduler; missing bars; summary band; Columns sidebar with label search and properties; frequency tables; per-code missing selection with v1→v2 migration | — | — |
| 5 Navigation | find; go to with inverse map; strL viewer; pinned columns; comparative evaluation | — | — |

Display correctness (Phase 2) follows Phase 1b because its formatting fixes and `_n` come from 1b's reader and wire format. The host-blocking problem the measurements call first is solved in Phase 1a, which needs no dta-parser release: every full-column operation leaves the host there. 1b moves the remaining data reads (tiles, strL) off the host. Phase 3 makes the work fast; it does not change where it runs.

## Testing

- **Missing identity**: all 27 codes pairwise distinct, and distinct from the strings `"."` and `".a"`, through the wire, display in each mode, sort, filter, profile counts and copy (after table-viewer's `stata-missing-comparison.test.ts`).
- **Display truth battery**: storage type × format × value × mode → Stata's expected text, including date masks, `%g`, `%-` alignment, labelled missings, unlabelled codes, empty labels, empty strings, multibyte strings around the truncation limit, oversized label sets.
- **Sort**: fast-check properties against the reference comparator (rules 1–3), all storage types, both directions, multi-key, label modes; stability.
- **Protocol interleavings**: scroll during a pending sort (no stranded pending tiles); stale reply after announcement; copy and go-to across an epoch change; filter-then-sort before the filter finishes (both chips resolve, sorted survivors); reload during a compute; restore Skip and settle with and without order change; cancel during a 1.0 strL index build and during a range read (both in step workers or within 50 ms); finite slow regex then sort (mask computed once, sort over survivors); catastrophic regex then sort then Cancel; scroll while the strL index builds; `cells` patch after an epoch change or eviction; stale on completion (read started at E, finished after E+1); copy pinned across a commit; copy surviving a regex Cancel; a 1a step started after a lease refresh succeeds; the sweep skips a temp file with a fresh lease; a lease older than 24 h (sleep) is deleted with its temp file as stated, and the panel reports the loss at its next refresh; a refresh recreates a lease the sweep deleted while the temp file is still present; a strL filter preempting a strL profile; a strL copy and a strL filter running together (the copy completes, the filter is not delayed by it, peak RSS within the strL row); two copies plus a retained regex while a sort is requested (the sort still gets a transform slot); Cancel this filter vs Cancel all; a cancelled strL filter in 1a (its step worker is terminated during `_ensure_gso`); a thread stuck in a read at dispose (bounded wait); a long non-regex sort cancelled (Phase 1 step worker, then Phase 3 cooperative); a profile preempted by a sort and resumed; strL patch arriving before its tile, after eviction, and for a replaced tile at the same coordinates; strL timeout; more than 16 active filters; flipping a sort's direction reusing its key; restore superseded by a user sort; in-place modification and atomic replacement of an open file; worker crash re-seed; refresh and dispose awaiting thread exit before closing the descriptor; Windows delete-after-close.
- **Migration**: v1 filter states for every predicate and column kind restore with unchanged results.
- **Benchmarks** in each PR body, before and after.

## Acceptance

Every budget row holds (or was reset in Phase 0 with the measurement that reset it, recorded here); the batteries pass; the harness reports no host stall > 50 ms during any full-column operation on either fixture (from 1a) or any page read (from 1b; in 1a the host still reads pages, as today), in Node and in the VS Code-hosted subset; a catastrophic regex is cancellable; `docs/data-browser.md` describes shipped behavior.

The Phase 5 PR compares Sight with every viewer in the prior-art survey (Stata's Data Editor, Positron, Data Wrangler, RStudio, table-viewer, Raven's viewer where it can open the data) on the four goal axes, using the fixtures plus a real survey file, and reports gaps as well as wins. Sight claims to be better only on the axes and against the tools where that comparison shows it.

## Open questions

1. Publishing dta-parser 1.x with D2 (Phase 1b's only hard dependency) and which of D1–D6 to take.
2. Raising `engines.vscode` to the version Phase 0 finds (older editors keep the last compatible release).
3. Should "Stata order" become the default string sort, and should a descending sort put missing first as `gsort -x` does? This plan keeps today's documented behavior and adds Stata order as a choice.

## Review history carried over from Raven

- **Viewport reads blocked by long sorts (r3).** A separate, stateless row reader thread that never waits on the scan worker or the strL index build.
- **Two-phase commit, adoption, unbounded generations (r5, r7–r12).** The row reader holds no order, so there is nothing to prepare or adopt; the host commits synchronously and tags everything with `order_epoch`; stale replies are defined and bounded.
- **Cancelled work leaking into the next compute (r10).** Requested vs committed state, with caches as the only carry-over.
- **Shared mutable state, buffer lifetime (r4, r9).** Results are transferred clones; the only shared memory is the cancel flag.
- **Termination and restart (r1, r2).** Terminate only work the user no longer wants, plus a deadline; re-seed from the host's committed specs.
- **Estimates presented as exact (r1, r2).** ≈ markers.
- **Claims without measurements.** Budgets are hypotheses until Phase 0 measures them end to end.

## Changes in revision 2

Sonnet (S) and Terra (T), first round; every factual claim was checked against the code before revising.

- S1, T2, S13: one counter did three jobs, stale replies stranded pending tiles (`row-request-tracker.ts`, `use-row-loader.ts:301`, `:431`), reload dropped computes. → `compute_seq` for results, `order_epoch` bumped only by an order-changing commit; epochs on every announcement and order-dependent request; defined stale reply and once-only retry; reload no longer cancels.
- S2: a newer sort cancelling a pending filter lost intent. → One compute of the full requested state; caches carry completed pieces; a regex in the requested state is never terminated.
- S3, T1, T4: strL fallback ran on the busy worker; the index arrived in Phase 3 though Phase 1 owned the first-tile budget; 1.0 builds the index on any strL read. → Row reader thread in Phase 1; first tile without strL columns, `{p: 1}` cells, index built in the reader thread; D3 optional and specified (layout, size).
- S4, T9: phase dependencies misstated; 0.11 and "worker keeps 0.x" fallbacks unsound (no borrowed descriptor in 0.x, `node.d.ts:39`). → Dependency table per phase; 1.0 publication is the one hard gate; D4 fallback is vendoring `format.ts`.
- S5: `engines.vscode ^1.75.0` vs dta-parser's Node ≥ 20; worker bundling. → Runtime section; Phase 0 survey; separate CommonJS entries; smoke test.
- S6, T8: warm-only reads on the host thread. → No file I/O on the host; cold reads measured in CI; budgets are hypotheses.
- S7, T3: host composition unbounded; serialization unmeasured; RSS after not peak; one-thread spike. → Composition in the worker (measured 11–17 ms on the host, now O(1) swap); serialization, peak RSS and two-thread measurements added to Phase 0; budgets re-derived (string sort/filter targets marked as targets).
- S8: no `_n` on the wire, no inverse map. → `obs` in tiles; inverse map in the worker per epoch, 40 MB for 10M.
- S9, T5: formatting contract, truncation units, oversized label sets. → Discriminated `WireCell`, byte-length truncation at UTF-8 boundaries, per-cell labels for oversized sets, worker-paged search and properties, memoized formatting, `MISSING` from D4.
- S10, T6: migration broke `isEmpty`/`isNotEmpty` and strings. → Migration by predicate and column kind, `version: 2`, downgrade behavior stated.
- S11, T7: missing vs label order undefined. → Rules 1–3 and a reference comparator; "not Stata's order" stated.
- S12: file rewritten while open. → `fstat` check and Reload.
- T10: comparison covered three tools. → All six, on all four axes, gaps reported.

## Changes in revision 3

Second round; claims checked against the code (`reader.rs:216-218`, `:394-410`, `:422`; `browser-panel.ts:408`, `:1751`; `use-row-loader.ts:449`) before revising.

- S1, T5: Phases 1–2 still sorted and filtered on the host. → The scan worker, with today's algorithms, moves into Phase 1; Phase 3 replaces algorithms only. The interim string-filter wall-time cost is stated.
- S2, T3: the single row reader serialized on the strL index build; the fill message was undefined. → The row reader never reads strL columns; a separate strL thread builds the index and serves bounded previews; `cells` patches with epoch, eviction and error rules; RSS budget for a strL filter.
- S3, T1: cancellation contradicted itself for a retained regex. → Computes are steps with cached outputs; only a step that is no longer needed is signalled; a still-needed step finishes and the queued compute reuses it; Cancel on a catastrophic retained regex terminates; tests for both.
- S4: re-seed recomputed the committed order. → The host re-seeds with a copy of its order.
- S5, T2: reads completing after an epoch change; retrying actions. → Completion-time epoch check, `stale` by `request_id`, no automatic retry for actions, accepted copies pinned to their epoch.
- S6: first-tile budget omitted thread startup. → Measured: 11.6–12.7 ms including spawn, load, open and a tile.
- S7: engine bump strands users. → Stated: older editors keep the last compatible release; wasm loads in Node, outside the webview CSP.
- S8: copy budget assumed cheap transfer and clipboard writes. → Marked a hypothesis until measured in VS Code.
- S9, S10: interim string-filter slowdown and Linux-only cold reads stated where they apply.
- T4: D2 was optional although unbounded strL reads can allocate up to 4 GiB. → D2 is a hard Phase 1 dependency and reports source byte length.
- T6: file-change detection. → Snapshot-of-inode consistency model; watcher plus `stat`/`fstat` comparison; per-tile and per-range `fstat` checks for in-place changes.

## Changes in revision 4

Third round; claims checked against the code (`sort.ts:139` has no check point; `browser-panel.ts:873`) before revising.

- S1, T4: job classes on the shared worker undefined; termination killed accepted copies; eviction could drop live step outputs. → Job classes with cooperative preemption; step workers for non-cooperative steps and copies; live outputs never evicted, separate evictable caches; pinned order memory counted.
- S2: Phase 1 too large and gated on a release. → Split into 1a (off the host on 0.6, no dependency) and 1b (1.x reader, threads, wire).
- T3: today's sort and filter cannot be cancelled cooperatively. → Filter loops and composition get checks in 1a; comparator sorts and regex masks run in step workers until Phase 3's radix sort.
- T1, S4(r3): "snapshot" overstated. → Best-effort detection stated with its limits; checks after reads and before publication or commit; invalidation; tests that mutate during the last read and before commit; ENOENT.
- T2, S5(r3), S6(r3): strL patch ordering, binding, queueing, timeouts, id space. → Host posts patches only after their tile; patches bound to `tile_request_id`; newest-first queue of 8 with dequeue-time epoch checks and `cellsDropped`; 30 s timeout to `{e: 1}`; patches never touch the request tracker.
- S7(r3): stuck regex poisoned the worker and the deadline's effect was undefined. → Regex in a step worker; deadline reverts the requested state with a message.
- S8(r3): cache key direction. → Keys independent of direction; test.
- S9(r3): strL filter budget inconsistent. → Range scans; budget < 1 GiB.
- S10(r3): superseded restore. → `restoreSettled` posted at supersession.
- S3(r3): engines. → Phase 0 tests Node 16/18; `@types/vscode` bumped with `engines`; forks mapped.
- T5: contradictions. → Live outputs in Phase 1, evictable caches in Phase 3; `{e: 1}` in the union; strL viewer from the strL thread.

## Changes in revision 5

Fourth round. Sonnet agreed (no blocking objections); its suggestions are folded in. Terra's objections were checked against the code (`_ensure_gso` in dta-parser 0.6, `dist/esm/node.js:2653`, is synchronous and not abortable) before revising.

- T1: in 1a, a strL read is non-cooperative (0.6 loads the whole strL section synchronously). → Every 1a step that reads a strL column runs in a terminable step worker.
- T2, S5: two shared step-worker slots could be taken by copies or a regex and starve a sort. → Separate transform (2) and action (2) pools; copies never take transform slots and are never preempted.
- T3: "Cancel" meant two things. → Cancel this filter (removes one entry, keeps queued intent) and Cancel all (reverts to committed), with tests.
- T4: strL viewer source and truncation. → strL thread, 1 MiB, visible note.
- S1: unbounded wait for thread exit. → 5 s bound; leaked descriptor logged; refresh uses a new descriptor.
- S2: 1a keeps temp files. → Sweep extended to panel close; accepted until 1b.
- S3: 1a memory. → Peak RSS reported; "no worse than today" budget.
- S4: resuming actions after an order change. → Cancelled and re-issued under the new epoch.
- S6: 1a step workers open by path. → Size and mtime check at open.
- S7: migration rollback. → Write v1 and v2 for one release.

## Changes in revision 6

Fifth round. Sonnet agreed with revision 5 (suggestions only); Terra's remaining objection was checked against `reader.rs:216-218` before revising.

- T1 (r5): in 1b strL scans moved to the cooperative scan worker, but 1.0 builds its strL index synchronously. → The scan worker never reads strL columns in any phase; strL steps run in terminable step workers, one at a time; tests cancel during the index build and during a range read.
- S2 (r5): a 1M-row range on wide exceeds the 50 ms check interval. → Ranges sized by bytes (≤ 64 MiB, ~3 ms warm); cold latency measured in Phase 0.
- T2 (r5): sweeping on close could unlink another window's open file. → No sweep on close; a panel unlinks only its own file; open panels refresh a lease file (see the sixth-round notes).
- S1, S6 (r5): 1a strL and pinned-copy memory. → One strL step at a time; explicit 1a strL budget (≤ 2.5 GiB, accepted until 1b); pinned orders counted.
- S3 (r5): transform-pool guarantee overstated. → Restated as copies vs transforms only.
- S4 (r5): 1b–3 algorithm seam. → In 1b today's algorithms read typed columns directly.
- S5 (r5): acceptance vs 1a page reads. → Page-read stall criterion applies from 1b.

## Changes after the sixth round (folded into revision 6)

- S1 (r6), T1 (r6), S1–S2 (confirmation): refreshing the temp file's mtime contradicted the mtime checks in step workers, the host and the scan worker. → The data file is never touched; a separate `<uuid>.lease` file is refreshed and the sweep keys on it; all threads use one rule (inode, size, mtime from the host's `fstat` at open); the path watcher applies only to directly opened files; a lost temp file is reported at refresh; test starts a step after a lease refresh.
- S2 (r6): no arbiter for the single strL slot. → One strL slot per panel across classes; higher class terminates and requeues lower; find and profiles over strL in step workers.
- S3–S5 (r6): repeat index cost without D3, cold ranges, sleep. → Stated as accepted; adaptive range shrinking (with its limit stated); refresh before every step spawn; sleep gap stated.
- T1 (confirmation): one strL slot conflicted with the copy guarantees. → A separate strL slot in the action pool; both guarantees hold; two strL states counted.
- Confirmation suggestions (both reviewers): lease matching, throttling, error handling and sweep rules; mixed-version and sleep gaps stated; "Waiting for a strL scan…" message; anti-livelock rule.

## Revision history

- Revision 1 (2026-10-30): first draft.
- Revision 2 (2026-10-30): first review round (above).
- Revision 3 (2026-10-30): second review round (above).
- Revision 4 (2026-10-30): third review round (above).
- Revision 5 (2026-10-30): fourth review round (above).
- Revision 6 (2026-10-30): fifth review round and confirmation passes (above); agreed by both reviewers.
