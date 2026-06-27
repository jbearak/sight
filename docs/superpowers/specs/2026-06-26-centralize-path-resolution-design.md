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

- `normalize_directives` :600 — group key `URI.file(directive.path)`.
- `discover_working_directory` :1321 — parent URI + a manual `.do` fallback
  (:1347). **This is the case-handling bypass tied to #218.**
- deterministic sort key :1841.
- parent-basename diagnostic remap :2439.
- `compute_directive_real_path`'s own `ambiguous`/`missing` fallback returns
  `real_path: directive.path` (:698).

## 2. Goal

A single chokepoint for static `do`/`run`/`include` + directive path
resolution. No `existsSync`-based, case-unaware tiering anywhere outside
`file-path-utils.ts`. The producers stop computing an authoritative resolved
path; consumers resolve uniformly from `raw_path` + caller dir (forward) or
through `compute_directive_real_path` (backward). And the indexer stamps the
same `working_directory` an opened document would, so dependency-graph callee
keys are identical across the indexed and open paths (#218).

## 3. Design

### 3.1 Forward calls — drop the resolved `path` field

**Type change.** Remove `path` from `ForwardCall` and from
`ForwardCallDirective` (`src/types/index.ts`). Keep `raw_path`, `caller_uri`,
`working_directory`, `is_static` — the inputs every consumer already uses to
replay the join.

**Producers.**
- Analyzer `detect_forward_call`: stop computing `resolved_path`. Push the
  call with `raw_path` + context, no `path`. Delete `resolve_forward_call_path`
  and `resolve_with_do_fallback`. The analyzer's `workspace_root` config field
  becomes unused (only the deleted resolver read it) — drop it from the
  analyzer config and its call sites (indexer :519, document-store). Keep
  `working_directory` (still stamped as resolution context).
- Directive parser `parse_forward_call_directives`: stop setting `path` on
  `ForwardCallDirective` (drop the `resolve_path_with_fallback` call at :341).
- `document-store.ts` (:795) and `indexer/index.ts` (:571) mappers from
  `ForwardCallDirective` → `ForwardCall`: drop the `path` field from the
  mapped object.

**Consumers (migrate each off `.path`).**
- Gates `c.is_static && c.path` → `c.is_static`
  (`dependency-graph/index.ts` :100; `forward-scope-resolver/index.ts` :270,
  :812; `scope-resolver/index.ts` :2759, :3201; `server-factory.ts` :1008).
- Roots-empty fallback URIs (`dependency-graph/index.ts` :135;
  `scope-resolver/index.ts` :2657): derive the URI by calling
  `resolve_forward_call_rich(raw_path, caller_dir, working_directory, {})`
  with **no** `workspace_roots`. With no roots, `resolve_path_rich` uses
  plain-existence semantics (no case handling) — i.e. exactly the behavior the
  old `existsSync` join produced — and returns `exact`/`missing`; key by
  `outcome.path ?? outcome.requested`. This unifies the roots-empty branch
  with the roots-set branch (same helper, same candidate order) instead of
  reading a separately-computed `path`.
- Diagnostic basename (`forward-scope-resolver/index.ts` :297): use
  `path.basename(my_call.raw_path)`. The diagnostic is the max-depth-exceeded
  source label; `raw_path`'s last component is the file name in all
  non-`.do`-fallback cases, and the label is informational only.
- Debug log (`server-factory.ts` :1012): log `my_call.raw_path`.

**Delete** dead `resolvePathWithDoFallback` (`file-path-utils.ts` :68) and the
`@deprecated` analyzer `resolve_path_with_fallback` (:1281).

### 3.2 Backward directives — single case-aware authority

Keep `Directive.path`, but make it the **pure join** (no `existsSync`, no
`.do`) and ensure no consumer treats it as the authoritative on-disk path.

- Directive parser backward-directive parse (:181): set `path` via
  `resolve_path` (pure join) instead of `resolve_path_with_fallback`. The
  `.do` fallback and case resolution are owned by `resolve_path_rich` via
  `compute_directive_real_path`.
- After 3.1 + this change, `directive_parser.resolve_path_with_fallback` has
  no callers → **delete it**. Keep `resolve_path` (the chokepoint's join
  step).
- `discover_working_directory` (:1315–:1421): resolve the parent URI through
  `compute_directive_real_path(my_directive, current_uri)` instead of
  `URI.file(my_directive.path)`. Skip the directive on `ambiguous`. Drop the
  now-redundant manual `.do` fallback (:1347–:1363) — the rich resolver's
  `try_do_fallback` handles it. This is the concrete #218-adjacent case fix:
  inherited-WD parent lookup now goes through the case-aware resolver, same as
  the main `follow_directives` path.
- `compute_directive_real_path` `ambiguous`/`missing` fallback (:698):
  `directive.path` is now the pure join — still a correct "as-typed joined
  path" for error reporting. No change needed beyond the producer change.
- Sort key (:1841) and parent-basename remap (:2439): switch from
  `directive.path` to the real-cased value already in scope at those sites
  (`my_parent_uri` / its basename) so keying and diagnostic remap agree with
  the resolved URI. `normalize_directives` :600 grouping likewise keys by the
  pure-join URI; this is internal grouping and stays deterministic.

> Note the deliberate asymmetry: forward calls **drop** `path` (every
> consumer already re-resolves from `raw_path`); backward directives **keep**
> `path` as the pure join (it is the chokepoint's join input and its
> error-reporting fallback). Removing `Directive.path` would be churn for no
> behavioral gain since the case-aware real path is computed on demand.

### 3.3 #218 — indexer inherited working directory (post-scan re-stamp)

Today the indexer stamps only a file's **own** `@lsp-cd`/`@lsp-wd` WD
(`indexer/index.ts` :538), deliberately skipping inherited WD to avoid
re-entrant recursion (ScopeResolver is invoked *by* the indexer). DocumentStore
inherits WD from backward-directive parents, so a WD-dependent file gets a
different `working_directory` — and thus different dependency-graph callee
keys — when indexed vs opened.

**Chosen approach: post-scan second pass (issue option b).** It is
unambiguously re-entrancy-safe (runs *after* the bulk scan, when every file is
already indexed, so no ordering hazard and no recursion into the index loop)
and it genuinely makes indexed WD == open WD (closes #218 rather than merely
documenting the gap).

After `index_workspace` completes:
1. Enumerate indexed files that (a) have backward directives
   (`done-by`/`included-by`) and (b) have **no own** WD directive.
2. For each, resolve the inherited WD. Two implementation options, to be
   settled in the plan after verifying re-entrancy:
   - **(b1)** Expose a lightweight, symbol-free inherited-WD walk on
     `ScopeResolver` (the existing `discover_working_directory` reads parent
     WD directives via `get_parsed_file`, which uses the parse cache and does
     **not** call back into the indexer). Calling it post-scan is safe.
   - **(b2)** Reuse `get_reachable_symbols`-style full `ScopeResolver.resolve`
     and read `inherited_working_directory` off the result.
   Prefer (b1): minimal, no symbol resolution, mirrors DocumentStore's WD
   source exactly.
3. If the resolved inherited WD differs from what was stamped, re-stamp the
   file's `ForwardCall.working_directory` and re-run
   `dependency_graph.update_caller(file_uri, calls)` so callee keys match the
   open-document path.

**Scope guard.** The second pass covers the bulk initial scan. Incremental
single-file re-index (on change) and the open-document path are unchanged —
DocumentStore remains authoritative for open files. The plan must verify the
pass does not perturb the `scan_complete` gating or fire spurious
`on_graph_change` callbacks (only re-stamp + update when the WD actually
differs).

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
  roots-empty fallback (3.1) intentionally preserves plain-existence semantics
  by calling `resolve_forward_call_rich` with no `workspace_roots`, matching
  the old behavior exactly for that branch. Verify no consumer silently
  changes casing where it previously didn't.
- **Sweep the whole pattern.** The `is_static && path` gate appears at ≥6
  sites; migrate all, not just one. After removing `ForwardCall.path`, grep
  `\.path` across `src/` to confirm no stale read of a forward-call path
  survives.
- **Test churn.** ~56 `is_static:`-bearing `ForwardCall`/`ForwardCallDirective`
  literals across ~25 test files construct `path`. Removing the field requires
  dropping `path` from those literals (mechanical) and updating any assertion
  that reads `.path` on a forward call.
- **#218 re-entrancy.** Confirm the chosen inherited-WD lookup (b1/b2) does not
  re-enter the indexer during or after the scan; run a focused test that a
  WD-dependent, indexed-but-not-open child gets the same callee key as when
  opened.
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
