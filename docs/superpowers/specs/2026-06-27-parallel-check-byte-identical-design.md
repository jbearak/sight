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
- The two shared mutations that `open()` triggers —
  `ScopeResolver.sync_backward_directive_dependencies` and (via the
  `on_backward_directives_parsed` callback) `WorkspaceIndexer.set_buffer_directives`
  — are content-idempotent (each writes the same URI→directives derived from
  the same on-disk bytes) and feed only **cache invalidation** and
  **find-references** (`get_related_uris`), neither of which participates in
  `check` diagnostics.
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

- Extract the `DocumentStore` wiring from `build_check_context` into a helper
  `wire_check_document_store(store, deps)` where
  `deps = { workspace_root, scope_resolver, workspace_indexer, config }`. It
  sets workspace roots, the scope resolver, the scope-resolver config
  (`scope_resolver_config_for(config)`), and the `on_backward_directives_parsed`
  callback (→ `workspace_indexer.set_buffer_directives`). This is exactly the
  wiring `build_check_context` does today, factored for reuse.
- `build_check_context` keeps creating and wiring a `document_store` on
  `CheckContext` via this helper (preserves the existing field and the
  `context.document_store.dispose()` lifecycle that several tests rely on).
- `collect_check_diagnostics` creates **one wired store per worker** (not the
  shared `context.document_store`), uses it for that worker's targets, and
  disposes it when the worker finishes. With `worker_count =
  min(max_parallel, targets.length)`, that is at most `max_parallel` stores,
  each holding ≤1 live document.
- The shared `context.document_store` is left intact for lifecycle/back-compat;
  it simply isn't used as the analysis store anymore. (We keep it rather than
  remove it to avoid churning ~5 test call sites that dispose it.)

This is low-risk: a `DocumentStore` is a handful of `Map`s; per-worker creation
cost is negligible next to lex/parse/analyze.

### 2. Injectable parallelism + regression test

- Add an optional `max_parallel?: number` parameter to
  `collect_check_diagnostics` (default `CHECK_MAX_PARALLEL`). `run_check_with_cwd`
  is unchanged (uses the default). This lets a test drive the *same context*
  at parallelism 1 (sequential) and 4 (parallel) — a faithful sequential-vs-
  parallel comparison rather than an approximation.
- New integration test `tests/integration/cli-check-parallel-determinism.test.ts`:
  build one workspace exercising every open-document-sensitive path, then assert
  the rendered output (JSON, the canonical serialization) is **byte-identical**
  across `max_parallel ∈ {1, 2, 4}`, and that ordering is stable. Workspace
  covers:
  - cross-file `do` chain with a global defined in the parent used in a child
    (auto backward discovery / `done-by` inheritance);
  - `include` chain inheriting a local macro;
  - `@lsp-cd` working-directory inheritance from a parent to a child whose
    diagnostics depend on the resolved WD;
  - two unrelated modules that both define the same global name and the same
    program name (conflicting-precedence hazard — the case most likely to
    diverge if open-doc state leaked across targets);
  - enough targets (> 4) that all worker slots are active and at least one
    worker processes multiple targets.
- Add a focused unit/integration assertion that a worker's store never holds
  more than one document (the isolation invariant) — implemented by checking
  that `collect_check_diagnostics` output matches the per-target **isolated**
  baseline (fresh context per target), which can only hold one document.

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

## Risks and mitigations

- **Per-worker store changes lifecycle expectations.** Mitigation: keep
  `context.document_store` and its `dispose()`; per-worker stores are disposed
  inside `collect_check_diagnostics`. Existing tests keep passing.
- **Replaced-primitive contract drift** (per CLAUDE.md review guidance): the
  only behavioral primitive being swapped is "shared store" → "per-worker
  store." Enumerated contract that must survive: (a) cross-file resolution still
  reads parents from disk (unchanged — same shared resolver); (b) WD inheritance
  still works (the per-worker store is wired with the same scope resolver +
  config); (c) `set_buffer_directives` still fires (callback preserved); (d)
  size/index-limit/read-error per-target diagnostics unchanged (logic moved
  verbatim); (e) output order unchanged (slot-by-index preserved).
- **Determinism of `DiagnosticsProvider.filtered_cache`** (shared, keyed by
  `uri:version:config_hash`): per-worker stores all use `version = 1` and
  distinct URIs per target, so no cross-target cache collision; the cache stays
  correct.

## Verification plan

- New parallel-determinism test passes at `max_parallel ∈ {1,2,4}`.
- Full suite green: `bun run test` (typecheck + tests).
- `bun run lint` clean (not in CI — run manually per CLAUDE.md).
- Two consecutive clean `codex` reviews and `/code-review` passes before PR.
