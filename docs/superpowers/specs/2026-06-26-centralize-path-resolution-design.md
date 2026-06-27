# Centralize remaining path resolution (#220) + indexer inherited WD (#218)

Date: 2026-06-26
Branch: `issue220`
Closes: #220, #218

## 1. Problem

PR #216 introduced one shared, case-aware static-path resolver in
`src/utils/file-path-utils.ts`:

- `resolve_path_rich(resolved_fs_path, opts)` — walks from the containing
  workspace root, matching each component against directory listings
  (never trusting `existsSync` for casing). Returns
  `exact | case_only | ambiguous | missing`. Owns the `.do` fallback.
- `resolve_forward_call_rich(raw_path, caller_dir, working_directory, opts)`
  — builds the ordered candidate chain (WD-join → script-relative →
  workspace-root-relative) and runs each through `resolve_path_rich`,
  stopping on the first `exact`/`case_only` and never falling through an
  `ambiguous`.

The dependency graph, forward-scope resolver, scope-resolver reverse-dep
keys, and go-to-definition already route through these. But **two more full
path-resolution implementations remain**, plus **dead helpers**:

1. **Analyzer** (`src/analyzer/index.ts`): `resolve_forward_call_path`
   (~:1213) + `resolve_with_do_fallback` (~:1259) — a third independent
   WD → script-relative → workspace-root tiering, `existsSync`-based, **not
   case-aware**. Produces `ForwardCall.path`.
2. **Directive parser** (`src/directive-parser/index.ts`): `resolve_path`
   (~:483, pure join) + `resolve_path_with_fallback` (~:510, join +
   `existsSync` + `.do`). `resolve_path_with_fallback` sets `Directive.path`
   (backward directives, ~:181) and `ForwardCallDirective.path` (forward
   directives, ~:341) at parse time. **Not case-aware.**
3. **Dead helpers**:
   - `resolvePathWithDoFallback` (`src/utils/file-path-utils.ts` :68) — zero
     references anywhere (exported util; removing is a tiny public-API
     change).
   - Analyzer private `resolve_path_with_fallback` (:1281, `@deprecated`) —
     zero references.

The divergence between the analyzer's case-unaware `existsSync` resolution
and the case-aware shared resolver is the documented root cause of #216's
hardest review rounds, and is mechanically related to #218 (indexer /
`discover_working_directory` inherited-WD divergence bypassing case handling).

### Why the resolved `path` fields are now redundant for forward calls

Every authoritative forward-call consumer **already re-resolves from
`raw_path` + caller dir + working_directory**, ignoring the producer's
pre-joined `path`:

- `DependencyGraph.update_caller` (`dependency-graph/index.ts` ~:111) calls
  `resolve_forward_call_rich(my_call.raw_path, my_caller_dir, my_call.working_directory, …)`.
- `ScopeResolver.resolve_callee_uri` (`scope-resolver/index.ts` ~:2636) does
  the same.
- `ForwardScopeResolver` (`forward-scope-resolver/index.ts` ~:315) re-resolves
  via `resolve_call_path` (rich).

`ForwardCall.path` survives only as:
- a **static-call gate**: `c.is_static && c.path` (4 sites);
- a **roots-empty fallback URI** (`dependency-graph/index.ts` :135;
  `scope-resolver/index.ts` :2657);
- a **diagnostic basename** (`forward-scope-resolver/index.ts` :297);
- a **debug log string** (`server-factory.ts` :1008).

For a static call, the analyzer always computes a non-empty `path`, and only
leaves it empty when `has_macro` (which sets `is_static = false`). So the gate
`is_static && path` is **equivalent to `is_static`**.

### Backward `Directive.path`

The main backward-resolution path already routes through the case-aware
chokepoint `compute_directive_real_path` (`scope-resolver/index.ts` ~:650,
used at ~:1480), which joins via `directive_parser.resolve_path` (pure join,
no `.do`) then calls `resolve_path_rich`. The surviving **direct** reads of
`Directive.path` are:

- `normalize_directives` :600 — group key `URI.file(directive.path)`; relies
  on the `.do`-resolved value so `"parent"` and `"parent.do"` group together.
- `discover_working_directory` :1321 — parent URI + a manual `.do` fallback
  (:1347). **This is the case-handling bypass tied to #218.**
- `WorkspaceIndexer.get_related_uris` :185, :229 — parent traversal for
  find-references scoping; relies on the `.do`-resolved value.
- deterministic sort key :1841.
- parent-basename diagnostic remap :2439.
- `compute_directive_real_path`'s own `ambiguous`/`missing` fallback returns
  `real_path: directive.path` (:698).

Because `get_related_uris` and `normalize_directives` key parents by the
existence/`.do`-resolved `Directive.path`, that value must be **preserved**;
only the `.do`-fallback *implementation* and the `discover_working_directory`
case bypass are in scope (see §3.2).

## 2. Goal

A single chokepoint for **authoritative** static `do`/`run`/`include` +
directive path resolution. The analyzer's case-unaware 3-tier
(WD → script → workspace-root) resolver is removed entirely; the only
multi-tier resolution left is the shared `resolve_forward_call_rich` /
`resolve_path_rich`. The producers stop computing an authoritative resolved
forward-call path; forward consumers resolve uniformly from `raw_path` +
caller dir, and backward consumers' authoritative resolution goes through the
case-aware `compute_directive_real_path`. (The directive parser retains a
minimal 1-tier `join + .do + existsSync` to populate `Directive.path` as a
parse-time hint — see §3.2 for why it is kept rather than consolidated.) And
the indexer stamps the same `working_directory` an opened document would, so
dependency-graph callee keys are identical across the indexed and open paths
(#218).

## 3. Design

### 3.1 Forward calls — drop the resolved `path` field

**Type change.** Remove `path` from `ForwardCall` and from
`ForwardCallDirective` (`src/types/index.ts`). Keep `raw_path`, `caller_uri`,
`working_directory`, `is_static` — the inputs every consumer already uses to
replay the join. `ForwardCallDirective.path` (`d.path`) is read **only** by
the three `ForwardCallDirective` → `ForwardCall` mappers below; once they stop
copying it, the field has no other consumer (verified: no other `d.path` read
in `src/`).

**Producers.**
- Analyzer `detect_forward_call`: stop computing `resolved_path`. Push the
  call with `raw_path` + context, no `path`. Delete `resolve_forward_call_path`
  and `resolve_with_do_fallback`. The analyzer's `workspace_root` config field
  becomes unused (only the deleted resolver read it) — drop it from the
  analyzer config and its call sites (indexer :519, document-store). Keep
  `working_directory` (still stamped as resolution context).
- Directive parser `parse_forward_call_directives`: stop setting `path` on
  `ForwardCallDirective` (drop the `resolve_path_with_fallback` call at :341).

**The three mappers** from `ForwardCallDirective` → `ForwardCall` all drop the
`path` field from the mapped object:
  - `document-store.ts` :795–:805,
  - `scope-resolver/index.ts` :1967–:1977 (`parse_content` — **easy to miss**;
    Codex flagged it),
  - `indexer/index.ts` :571–:581.

**Consumers (migrate each off `.path`).**
- Gates `c.is_static && c.path` → `c.is_static`
  (`dependency-graph/index.ts` :100; `forward-scope-resolver/index.ts` :270,
  :812; `scope-resolver/index.ts` :2759, :3201; `server-factory.ts` :1008).
  This is a safe equivalence: the analyzer computes a non-empty `path` for
  every static call and leaves it empty only when `has_macro` (which sets
  `is_static = false`); directive-mapped calls always set `is_static = true`.
  So `is_static && path` ≡ `is_static` for **today's** producers — and after
  this change `path` no longer exists, so the gate must be `is_static` anyway.
- Roots-empty fallback URIs (`dependency-graph/index.ts` :135;
  `scope-resolver/index.ts` :2657): replace the read of `my_call.path` with a
  `resolve_forward_call_rich(raw_path, caller_dir, working_directory, {})`
  call (no `workspace_roots`). Key off the outcome **with kind-narrowing**
  (`PathCaseOutcome` is a discriminated union; `path` exists only on
  `exact`/`case_only`, `requested` only on the others):
  ```ts
  const uri_path = (o.kind === 'exact' || o.kind === 'case_only')
      ? o.path : o.requested;
  ```
  **Behavioral note (not a strict equivalence).** This roots-empty branch is
  the early-startup path before `workspace_roots` are populated. The old code
  keyed by `my_call.path`, which — when produced by the analyzer with a
  `config.workspace_root` set (indexer :511–:519) — could carry a
  workspace-root-tier resolution. The no-roots replay omits the workspace-root
  candidate (`resolve_forward_call_rich` only adds it when
  `workspace_roots?.length`, `file-path-utils.ts` :643). So in the rare case
  where roots are unset on the consumer but the analyzer had a root, the keyed
  URI can differ. This is a transient early-startup edge: once roots populate,
  the roots-set branch re-resolves and the edge corrects (the dep graph
  re-keys on the next `update_caller`). Acceptable; call it out in the PR.
- Diagnostic basename (`forward-scope-resolver/index.ts` :297): use
  `path.basename(my_call.raw_path)`. The diagnostic is the
  max-depth-exceeded source label (informational only). Minor observable
  change: for an extensionless call that resolves via `.do` fallback, the
  label becomes `foo` instead of `foo.do`. Low impact; note it.
- Debug log (`server-factory.ts` :1012): log `my_call.raw_path`.

**Delete** dead `resolvePathWithDoFallback` (`file-path-utils.ts` :68) and the
`@deprecated` analyzer `resolve_path_with_fallback` (:1281).

### 3.2 Backward directives — consolidate `.do`, migrate the case bypass

**Do NOT change what `Directive.path` contains.** Multiple consumers key
parents by the existence/`.do`-resolved `Directive.path` and would regress if
it became a pure join (Codex-confirmed):
- `WorkspaceIndexer.get_related_uris` reads `URI.file(my_directive.path)` at
  `indexer/index.ts` :185 and :229 for parent/child traversal (find-references
  scoping). A pure-join `Directive.path` would point an extensionless
  `@lsp-done-by: "parent"` at `/parent` instead of `/parent.do`, silently
  breaking related-file discovery.
- `normalize_directives` (`scope-resolver/index.ts` :600) groups directives by
  `URI.file(directive.path)`. Today `@lsp-done-by: "parent"` and
  `@lsp-included-by: "parent.do"` group together because both resolve to
  `parent.do` (so included-by wins). A pure join would split them and skip the
  conflict normalization.

So `Directive.path` stays the join + existence + `.do` value, produced by the
existing `resolve_path_with_fallback`. The authoritative, case-aware backward
resolution is **already** centralized in `compute_directive_real_path` (which
joins via `resolve_path` then calls `resolve_path_rich`); `Directive.path` is a
cheap parse-time pre-resolution that a few consumers key by. The #220 win on
the directive side is therefore:

1. **Keep `resolve_path_with_fallback` as-is (do NOT consolidate it through
   `resolve_path_rich`).** The two `.do`-fallback contracts differ:
   `resolve_path_with_fallback` (`directive-parser/index.ts` :522) appends
   `.do` to any path **not ending in `.do`** (so `parent.ado` →
   `parent.ado.do`), whereas `resolve_path_rich` (`file-path-utils.ts` :269)
   appends `.do` only when the final component has **no extension at all**.
   Delegating would silently change `Directive.path` for extensioned non-`.do`
   paths and perturb `normalize_directives` / `get_related_uris` keying. Not
   worth the risk. The directive parser keeps its small 1-tier join+`.do`
   helper; it is not the multi-tier duplication #220 targets (that is the
   analyzer's 3-tier resolver, removed in §3.1). After 3.1 drops the
   forward-directive call at :341, `resolve_path_with_fallback`'s only caller
   is the backward-directive parse (:181) — it stays. Keep `resolve_path`
   (pure join — the chokepoint's join step, used by
   `compute_directive_real_path`).

2. **Migrate the case bypass in `discover_working_directory`** (the concrete
   #218-adjacent fix). At `scope-resolver/index.ts` :1321 it derives the parent
   URI as `URI.file(my_directive.path)` and then does a manual `.do` fallback
   (:1347–:1363) — bypassing the case-aware resolver that the main
   `follow_directives` path uses (:1480 via `compute_directive_real_path`).
   Change it to resolve the parent through
   `compute_directive_real_path(my_directive, current_uri)`: skip the directive
   on `ambiguous`; use the real-cased path for the parent URI; drop the manual
   `.do` fallback (the rich resolver's `try_do_fallback` owns it). Inherited-WD
   parent lookup now matches the main backward path exactly.

**Left unchanged** (NOT in scope — they read `Directive.path` and behave
correctly with its existing semantics): `normalize_directives` grouping (:600),
the deterministic sort key (:1841), the parent-basename diagnostic remap
(:2439, and note `my_parent_uri` is *not* in scope in
`remap_diagnostics_to_active_file` — it only receives `directives`, so a "use
the resolved URI" substitution there would need new plumbing for no real gain),
and `get_related_uris` (:185, :229). Their case-keying behavior is identical to
today; #220 does not require changing it, and doing so risks find-references
scoping regressions out of proportion to the goal.

> Deliberate asymmetry: forward calls **drop** `path` (every consumer already
> re-resolves from `raw_path`); backward directives **keep** `path` (multiple
> consumers legitimately key parents by the existence/`.do`-resolved value).
> The directive-side win is consolidating the `.do` owner and removing the one
> case-handling bypass, not removing the field.

### 3.3 #218 — indexer inherited working directory (inline lightweight walk)

Today the indexer stamps only a file's **own** `@lsp-cd`/`@lsp-wd` WD
(`indexer/index.ts` :538), deliberately skipping inherited WD. DocumentStore
inherits WD from backward-directive parents, so a WD-dependent file gets a
different `working_directory` — and thus different dependency-graph callee
keys — when indexed vs opened.

**Why not a post-scan re-stamp pass.** Codex flagged two blockers for the
post-scan approach: (1) the indexer **discards** `all_forward_calls` after
`dependency_graph.update_caller` (`indexer/index.ts` :590); `symbol_index`
stores only `{ symbols, directives }` (:68), so a re-stamp pass would need new
per-file `ForwardCall[]` storage or a reparse. (2) `mark_scan_complete()` is
called when indexing finishes (:299) and `server-factory.ts` :727 revalidates
open docs immediately after `is_scan_complete()`, so a pass running "after the
scan" without reordering `mark_scan_complete` would let open-doc resolution
observe stale pre-restamp keys.

**Chosen approach: resolve inherited WD inline, before stamping.** The key
realization (verified): `ScopeResolver` owns its **own** `file_cache`
(`scope-resolver/index.ts` :173, :195) and `discover_working_directory` reads
parent files via `get_parsed_file` (:1331) from that cache / disk — it does
**not** read the indexer's `symbol_index` nor call back into `index_file` /
`index_do_file`. So the walk is *not* re-entrant with the index loop, and it is
order-independent (parents are read from disk, not from the partially-built
index).

Plan:
1. Expose `resolve_inherited_working_directory(backward_directives, child_uri,
   config)` on `ScopeResolver` that wraps the existing
   `discover_working_directory` walk (reuse, not a fourth copy — keeps #220's
   de-duplication spirit). Note: this walk is **not symbol-free** —
   `get_parsed_file` runs the analyzer to parse each parent — but it is
   non-re-entrant w.r.t. the indexer and does no *full scope resolution*
   (no symbol-table merging, no forward-call resolution). The cost is one
   parse per distinct parent file, memoized in `file_cache`. Give the indexer
   a `ScopeResolver` handle (constructor/setter; no construction cycle —
   `get_reachable_symbols` already takes one per-call, the indexer simply
   doesn't store it yet).
2. In `index_do_file`, compute the effective WD as `own_wd ?? inherited_wd`
   **before** the analyzer-call stamping (:538–:554) and the
   `dependency_graph.update_caller` (:590). Only invoke the inherited walk when
   the file has backward directives and no own WD directive
   (`discover_working_directory` is otherwise skipped — bounded cost; backward
   directives are rare and the WD cache memoizes shared parents).

This sidesteps both prior blockers: no new forward-call storage and no
re-stamp (WD is correct at first stamp), and no `mark_scan_complete` reordering
(it all happens inside the normal per-file path, before the graph update).

**Re-entrancy guard (must verify in implementation).** Confirm with a test
that calling `resolve_inherited_working_directory` from inside `index_do_file`
does not transitively re-enter the indexer (it must touch only
`ScopeResolver.file_cache` / disk). If a hidden coupling surfaces, fall back to
issue option (c): keep the indexer edge best-effort (own-WD only) and rely on
DocumentStore correcting it on open — documented, not silently divergent.

**Scope note.** `index_file` (:454) backs both the initial workspace scan and
the incremental update queue (:743), so the inline walk runs on **both** paths.
That is intended and desirable: every indexer-produced edge for a WD-dependent
file gets the correct inherited-WD key, not just initial-scan ones. The
open-document path is unchanged — DocumentStore stays authoritative for open
files; the walk only fills the previously-`undefined` inherited WD during
indexing.

## 4. Out of scope / non-goals

- `src/utils/findalias-resolver.ts` (Stata `findfile`/adopath) and
  `src/utils/stata-install-paths.ts` (install detection) — different domains.
- Directory-*discovery* walks (indexer scan, `cli/source-files`, completion)
  — that was #219, merged.
- **Symlink canonicalization** of forward-call edge keys. #219 left open that
  a `do`/`include` through a symlink path keys its dep-graph edge by the alias
  path `resolve_forward_call_rich` returns (it follows the symlink only to
  classify). This is a **consider-not-must**: address only if the
  centralization makes it a trivial, well-contained addition; otherwise leave
  it for a dedicated change so it gets its own test. Default: leave out.

## 5. Risks & verification

- **Replaced-primitive contract (case-awareness).** `existsSync` is
  case-insensitive on macOS/Windows; `resolve_path_rich` is case-aware. The
  roots-empty fallback (3.1) preserves plain-existence semantics by calling
  `resolve_forward_call_rich` with no `workspace_roots` — but is **not** a
  strict equivalence: it omits the workspace-root candidate the old analyzer
  `path` may have carried (see §3.1). Acceptable as a transient early-startup
  edge; document in the PR. Verify no consumer silently changes casing where
  it previously didn't.
- **Sweep the whole pattern.** The `is_static && path` gate appears at ≥6
  sites; migrate all, not just one. After removing `ForwardCall.path`, grep
  `\.path` across `src/` to confirm no stale read of a forward-call path
  survives.
- **Test churn.** ~56 `is_static:`-bearing `ForwardCall`/`ForwardCallDirective`
  literals across ~25 test files construct `path`. Removing the field requires
  dropping `path` from those literals (mechanical) and updating any assertion
  that reads `.path` on a forward call.
- **#218 re-entrancy.** Confirm the inline inherited-WD walk (§3.3) touches
  only `ScopeResolver.file_cache` / disk and never re-enters `index_do_file`;
  run a focused test that a WD-dependent, indexed-but-not-open child gets the
  same callee key as when opened. If a hidden coupling surfaces, fall back to
  issue option (c) (best-effort indexer edge, documented).
- **Gates.** `bun run test` (typecheck + full suite) and `bun run lint` clean.
  Reflow new comments to ≤72 chars, code to ≤80. snake_case + `my_`/`the_`
  prefixes for new locals.

## 6. Process

1. Codex adversarial review of this spec; incorporate findings.
2. Implement (lean on existing coverage; TDD for the #218 pass and any new
   behavior).
3. Converge: Codex adversarial review + `/code-review high` until BOTH come
   back clean twice consecutively. Then open the PR (`Closes #220`,
   `Closes #218`).
