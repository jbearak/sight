# Design: Make parallel `sight check` diagnostics byte-identical to sequential runs

Issue: [#207](https://github.com/jbearak/sight/issues/207) — Raven port follow-up to
[jbearak/raven#485](https://github.com/jbearak/raven#485).

## Problem

`sight check` parallelizes target collection in `src/cli/check.ts`
(`collect_check_diagnostics`, `CHECK_MAX_PARALLEL = 4`) over a single shared
`DocumentStore`. Each worker calls `document_store.open(uri, ...)`, reads
diagnostics, then `close(uri)`. Because up to four workers run concurrently,
**multiple check targets can be open as documents at the same time**.

The hazard, ported from Raven: if open-document state ever outranks
indexed/disk state during scope resolution, dependency-edge discovery,
directive parsing, or working-directory inheritance, then a target analyzed
while sibling targets happen to be open could produce different diagnostics
than the same target analyzed alone — i.e. parallel output could diverge from
a sequential run (and from editor-startup semantics, where the file under
analysis is the one open document).

## Investigation: is the shared store unsafe today?

I built a probe (cross-file `do`/`include`, `@lsp-cd` working-directory
inheritance, and two unrelated modules that both define a global `G` plus a
`@lsp-included-by` local-macro hazard) and compared three execution modes over
the same workspace, rendering diagnostics to JSON for a byte comparison:

1. **isolated** — a fresh `CheckContext` per target (the true "only this file
   is open" baseline);
2. **shared-sequential** — one shared context, one target open at a time;
3. **parallel** — the current behavior, up to four targets open at once.

All three were **byte-identical**. This is expected from the CLI wiring:

- In `build_check_context`, the `ScopeResolver` uses its **default
  disk-backed `ContentProvider`** (`fs.promises.readFile` via `fsPath`). Unlike
  the LSP server, the CLI never injects an open-buffer-preferring content
  provider, so every parent/callee file is read from disk regardless of which
  targets are open.
- `workspace_symbols` is captured **once** (`get_all_symbols()`) before the
  parallel region and passed by value into every worker, so the global symbol
  view is a stable snapshot.
- The dependency graph is fully populated by `workspace_indexer.initialize(...)`
  before collection and is not mutated during it; its `version_counter` is
  stable, so `ScopeResolver`'s content-hash + graph-version cache keys are
  stable and deterministic.
- The shared mutations that `open()` triggers are content-idempotent and do
  not feed `check` diagnostics:
  - `ScopeResolver.sync_backward_directive_dependencies` and the
    `scope_resolver.resolve(...)` call made for working-directory inheritance
    populate the resolver's `file_cache` / `scope_cache` / reverse-dependency
    maps. These caches are keyed by content hash + dependency-graph version +
    config; during `check` no file changes and the graph version is stable, so
    every key is stable and every cached value is a pure function of on-disk
    bytes. Concurrent workers may race to fill the same key, but each entry is
    written as a whole object (no torn reads) and all writers compute the same
    value — so results are deterministic. (The empirical probe confirms this:
    shared-sequential, which reuses one resolver across targets, matched the
    fresh-context isolated baseline byte-for-byte.)
  - The `on_backward_directives_parsed` → `WorkspaceIndexer.set_buffer_directives`
    overlay feeds **only** `WorkspaceIndexer.get_related_uris`, which is
    consumed exclusively by the hover / definition / references providers
    (verified by grep). `check` runs diagnostics only and never calls
    `get_related_uris`, and `DiagnosticsProvider` does not reference the
    indexer at all. So the overlay is dead weight in `check`.
- Output ordering is already parallelism-independent: results are written into
  `the_slots[my_index]` by target index and flattened in order, and
  `collect_report_targets` sorts targets by `relative_path`.

**Conclusion:** today's shared store is safe for `check` diagnostics. The risk
is a *future* regression — e.g. someone gives the CLI an open-buffer-preferring
content provider (matching the LSP) or routes some symbol lookup through the
live document set. We want byte-identical output to hold *robustly*, not by
happenstance, and we want a test that fails loudly if that invariant breaks.

## Goals (acceptance criteria from the issue)

1. A regression test comparing sequential vs parallel `sight check` diagnostics
   over a workspace with cross-file `do`/`run`/`include`, open-document
   precedence hazards, and deterministic output ordering.
2. If shared-store semantics are unsafe, introduce per-target overlay/isolation
   so each worker analyzes exactly its target as open.
3. Output byte-identical and deterministically sorted between sequential and
   parallel collection.
4. Document the concurrency invariant near `collect_check_diagnostics`.
5. Coverage for directives / working-directory inheritance (the paths most
   sensitive to open-document state).

## API changes (explicit)

The implementation introduces exactly these surface changes in `src/cli/check.ts`;
no other modules change their public API.

1. `CheckContext` gains a field
   `create_document_store: () => DocumentStore`. It returns a fresh
   `DocumentStore` wired only to the shared **read-only** infrastructure (see
   §1 below). The existing `document_store: DocumentStore` field is **kept**
   (built once via this same factory) so the `context.document_store.dispose()`
   lifecycle used by existing tests is unaffected.
2. `collect_check_diagnostics` gains an optional trailing parameter
   `max_parallel: number = CHECK_MAX_PARALLEL`. `run_check_with_cwd` calls it
   without the argument (unchanged behavior). Tests pass `1`, `2`, `4`.
3. `build_check_context` **stops** calling
   `document_store.set_on_backward_directives_parsed(...)`. This is the only
   behavioral removal; it is a no-op for `check` output (the overlay it fed has
   no consumer in the diagnostics path — verified). The wiring that the factory
   *does* perform is: `set_workspace_roots`, `set_scope_resolver`,
   `set_scope_resolver_config`.

No new accessors are added to `WorkspaceIndexer`, `DocumentStore`, or
`ScopeResolver`. The isolation test observes behavior through existing public
methods (`DocumentStore.getAll()`, and a spy on the existing public
`WorkspaceIndexer.set_buffer_directives`) plus the new `create_document_store`
factory — so no production surface exists solely for tests.

## Approach

Two complementary changes — one structural guarantee, one test that guards it —
plus documentation.

### 1. Per-worker document isolation (structural guarantee)

Mirror Raven's "keep the global document set empty; give each worker a
one-document overlay." In Sight terms: **stop sharing one `DocumentStore`
across workers; give each worker its own store** wired to the same shared,
read-only infrastructure (`ScopeResolver`, `WorkspaceIndexer`,
`DependencyGraph`, `DiagnosticsProvider`, config).

- Each worker opens → analyzes → closes its current target in its **own**
  store. Because `close()` empties the store between targets, a worker's store
  holds **at most one document at any instant**, and **no store ever contains a
  sibling target**. The invariant "each target is analyzed as if it is the only
  open document" then holds *by construction* — even if a future change makes
  diagnostics consult the live document set.
- The shared infrastructure is read-only during collection (the index and
  dependency graph are already built; the resolver reads from disk), so sharing
  it across workers is safe and preserves cross-file resolution.

Implementation:

- Add a factory `create_document_store()` to `CheckContext` that builds a fresh
  `DocumentStore` wired to the shared infrastructure:
  - `set_workspace_roots([workspace_root])`,
  - `set_scope_resolver(scope_resolver)` (needed so WD inheritance resolves),
  - `set_scope_resolver_config(scope_resolver_config_for(config))`.
  - It deliberately does **not** wire the `on_backward_directives_parsed`
    callback. That callback exists to keep the LSP server's find-references view
    fresh against unsaved edits; `check` never calls `get_related_uris` and has
    no unsaved edits (buffer content always equals disk), so populating the
    shared `buffer_directives_overlay` is pure dead weight and a needless piece
    of cross-target shared state. Dropping it is verified safe: the overlay has
    no consumer in the `check` diagnostics path.
- `build_check_context` creates the shared infra and exposes
  `create_document_store`. It still creates one `document_store` on
  `CheckContext` (via the factory) to preserve the existing field and the
  `context.document_store.dispose()` lifecycle that several tests rely on. The
  one behavior change to this primary store is that it no longer registers the
  buffer-directive callback (see above) — a no-op for `check` output.
- `collect_check_diagnostics` creates **one store per worker** via the factory
  (not the shared `context.document_store`), uses it for that worker's targets,
  and disposes it when the worker finishes. With `worker_count =
  min(max_parallel, targets.length)`, that is at most `max_parallel` stores,
  each holding ≤1 live document (because each target is `close()`d in a
  `finally` before the worker pulls its next index).
- The shared `context.document_store` is left intact for lifecycle/back-compat;
  it simply isn't used as the analysis store anymore. (We keep it rather than
  remove it to avoid churning ~5 test call sites that dispose it.)

**Scope of the guarantee (deliberately narrow).** The structural invariant is:
*the `DocumentStore` used to analyze a target exposes only that target* — so any
consumer that reads the live document set (`getAll()` / `get(other_uri)`) sees a
single document, and the shared `buffer_directives_overlay` is never populated.
We do **not** isolate the `ScopeResolver` per worker: it is disk-backed and
therefore inherently open-document-agnostic, and per-worker resolvers would
discard the shared file/scope cache and re-read+re-parse every parent per worker
for no correctness gain (YAGNI). If a future change gives the CLI an
open-buffer-preferring content provider, that provider must be wired to a
per-worker store (not a global one) for this invariant to keep holding; the
regression test below is the backstop that fails loudly if that ever regresses.

This is low-risk: a `DocumentStore` is a handful of `Map`s; per-worker creation
cost is negligible next to lex/parse/analyze.

### 2. Injectable parallelism + regression test

- Add an optional `max_parallel?: number` parameter to
  `collect_check_diagnostics` (default `CHECK_MAX_PARALLEL`). `run_check_with_cwd`
  is unchanged (uses the default). This lets a test drive collection at
  parallelism 1 (sequential) and N (parallel).
- New integration test `tests/integration/cli-check-parallel-determinism.test.ts`:
  build one workspace exercising every open-document-sensitive path, then assert
  the rendered output (JSON — the canonical serialization) is **byte-identical**
  across `max_parallel ∈ {1, 2, 4}`. To prevent shared-cache priming from
  masking a divergence (a real risk flagged in review — `open()` fills the
  resolver caches), **build a fresh `CheckContext` for each `max_parallel`
  run** rather than reusing one context across modes. Also compute a per-target
  **isolated** baseline (a fresh context per single target) and assert every
  `max_parallel` run equals it — this is the strongest oracle, since the
  isolated run provably only ever has one document open.
  Workspace covers:
  - cross-file `do` chain with a global defined in the parent used in a child
    (auto backward discovery / `done-by` inheritance);
  - `include` chain inheriting a local macro;
  - explicit `@lsp-done-by` and `@lsp-included-by` directive-only relationships
    (the directive path that drives the buffer overlay), in addition to the
    auto-discovered `do`/`include` edges;
  - `@lsp-cd` working-directory inheritance from a parent to a child whose
    diagnostics depend on the resolved WD;
  - two unrelated modules that both define the same global name and the same
    program name (conflicting-precedence hazard — the case most likely to
    diverge if open-doc state leaked across targets);
  - enough targets (> 4) that all worker slots are active and at least one
    worker processes multiple targets.
- **Direct isolation assertion** (not just output equality), using only
  existing public methods plus the new factory:
  - Wrap `context.create_document_store` so the test captures every store it
    hands out, and monkey-patch each captured store's `open` to record
    `store.getAll().length` immediately after the real `open` resolves. After
    `collect_check_diagnostics` with `max_parallel = 4`, assert the recorded
    peak across **every** store is `≤ 1` (no store ever held a sibling target),
    while the number of distinct stores created is `> 1` (parallelism really
    happened).
  - Spy on the context's `workspace_indexer.set_buffer_directives` and assert it
    is **never called** during collection — proving the buffer overlay stays
    unpopulated (the dropped-callback guarantee), without needing a private
    accessor.
- A small test that passing duplicate explicit target paths produces the same
  output as passing the path once (dedupe behavior is unchanged).
- **Existing test migration.** `cli-check.test.ts`'s "processes report targets
  concurrently while preserving output order" currently mocks
  `context.document_store` and asserts `max_active_opens > 1` on that single
  shared mock. With per-worker stores there is no shared store to observe, so
  this test is updated to mock `context.create_document_store` (returning a
  fresh mock store per call). The mock tracks **global** concurrent opens across
  all stores (assert `> 1`, proving parallelism survived) and **per-store**
  concurrent opens (assert `≤ 1`, proving isolation). This is the same test,
  re-pointed at the new factory, and it doubles as the direct isolation
  assertion above.

### 3. Documentation

- A block comment above `collect_check_diagnostics` stating the invariant:
  *"Each target is analyzed in its own single-document `DocumentStore`, so a
  target's diagnostics never depend on which sibling targets are concurrently
  open. Cross-file resolution reads parents/callees from disk via the shared
  read-only ScopeResolver/index; output is ordered by target index and is
  therefore byte-identical and deterministic regardless of `max_parallel`. Do
  not route per-target analysis through a shared multi-document store or an
  open-buffer-preferring content provider without revisiting this invariant and
  the cli-check-parallel-determinism test."*
- Brief note in `CLAUDE.md`? No — keep it local to the code; the issue asks for
  documentation *near* `collect_check_diagnostics`.

## Out of scope / non-goals

- No change to LSP-server behavior or to how the editor prefers open buffers.
  This is CLI-only.
- No change to the dependency-graph/indexer model, scope-resolver caching, or
  the `buffer_directives_overlay` mechanism (those remain as-is; they are
  content-idempotent under `check`).
- Not raising or making `CHECK_MAX_PARALLEL` user-configurable (the param is
  internal, for tests). YAGNI.
- Not addressing issue #184's transactional-side-effect concern; orthogonal.
- **Indexer insertion-order nondeterminism is out of scope.** Review noted that
  `WorkspaceIndexer.initialize` reads directories via `readdir` (unsorted) and
  commits to `symbol_index` as a worker pool completes, so `get_all_symbols`
  insertion order can vary *run to run*. This does **not** cause
  parallel-vs-sequential divergence within a run — #207's actual subject —
  because `collect_check_diagnostics` captures `workspace_symbols` **once**
  before the parallel region and passes the same snapshot to every worker, and
  per CLAUDE.md workspace symbols do not suppress diagnostics or affect
  diagnostic ordering (output is ordered by target index). Any cross-run
  ordering effect would be a pre-existing determinism concern independent of
  parallelization; if it proves to affect rendered output it warrants its own
  issue.
- **Parse/analyze timeout divergence under CPU contention is out of scope.**
  `DocumentStore` wraps lex/parse/analyze in `with_parse_timeout`; under heavy
  parallel load a pathological file near the wall-clock threshold could time out
  where a sequential run would not, emitting a timeout diagnostic. This is an
  inherent property of any parallel executor and a safety valve for pathological
  input, not normal output; the regression test uses small files that never
  approach the timeout.

## Risks and mitigations

- **Per-worker store changes lifecycle expectations.** Mitigation: keep
  `context.document_store` and its `dispose()`; per-worker stores are disposed
  inside `collect_check_diagnostics`. Existing tests keep passing.
- **Replaced-primitive contract drift** (per CLAUDE.md review guidance): the
  only behavioral primitive being swapped is "shared store" → "per-worker
  store." Enumerated contract that must survive: (a) cross-file resolution still
  reads parents from disk (unchanged — same shared resolver); (b) WD inheritance
  still works (the per-worker store is wired with the same scope resolver +
  config); (c) `set_buffer_directives` deliberately no longer fires during
  `check` because `set_on_backward_directives_parsed` is intentionally not
  wired (its overlay has no `check` consumer — a dropped capability, reviewed,
  not a silent regression); (d) size/index-limit/read-error per-target
  diagnostics unchanged (logic moved verbatim); (e) output order unchanged
  (slot-by-index preserved).
- **Determinism of `DiagnosticsProvider.filtered_cache`** (shared, keyed by
  `uri:version:config_hash` — verified in `src/providers/diagnostics.ts`):
  per-worker stores all use `version = 1` and distinct URIs per target, so no
  cross-target cache collision; the cache stays correct. The provider also takes
  no reference to the document store or indexer, so it cannot observe sibling
  open state.

## Verification plan

- New parallel-determinism test passes at `max_parallel ∈ {1,2,4}`.
- Full suite green: `bun run test` (typecheck + tests).
- `bun run lint` clean (not in CI — run manually per CLAUDE.md).
- Two consecutive clean `codex` reviews and `/code-review` passes before PR.
