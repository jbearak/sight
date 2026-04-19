# Issue #132 — Sibling forward calls + position-aware redeclares for find-references

**Status:** design
**Date:** 2026-04-19
**GitHub issue:** [#132](https://github.com/jbearak/sight/issues/132)
**Scope:** fix the sibling-forward-call gap in `collect_visible_reference_uris` (issue #132 proper) and, while the data model is open, refine the identity-redeclares guard from whole-file exclusion to position-aware filtering for the narrow case where a redeclaring callee inherits the active symbol before its own redeclaration.

## Problem

Find-references is a two-step operation by design:

1. Use the cursor position to pick the active symbol instance among same-named instances visible at that position.
2. Starting from the active definition, expand outward to every file that could reference that definition.

The 2026-04-19 addendum on issue #129 made step 2 cursor-line-independent for current-file forward calls: `collect_visible_reference_uris` now walks every `scope.forward_call_symbols` site, not just those before the cursor. But the analogous filter at the **chain-entry** level was left in place. `ScopeResolver.resolve_parent_forward_calls` pre-filters a parent's forward calls to those strictly before the child's call site via `filter_calls_before_line` (src/scope-resolver/index.ts:977), and that filtered list becomes `ScopeChainEntry.forward_call_sites`.

That pre-filter is correct for scope-resolution merging (it determines what symbols the parent contributes to the child at the moment the child is called). It is wrong for find-references: sibling forward calls that occur **after** the child's call site can still reference the active symbol at runtime, because their caller's accumulated post-child state carries the symbol forward.

Concrete example from the issue:

```
caller.do:
  include callee.do        ← line 0
  include other.do         ← line 1

callee.do:
  local fruit = "apple"    ← cursor here

other.do:
  display "`fruit'"         ← runtime references callee.do's fruit, via caller's post-include state
```

With the cursor on `fruit` in `callee.do`, find-references does not return `other.do` because `caller.do`'s chain entry (from `callee.do`'s perspective) has `forward_call_sites = []` — the only parent call is `include callee.do` itself (line 0 = child's call site line, strictly-before filter drops it), and `include other.do` is filtered out as "after the child's call site."

A secondary defect lives underneath: even when `collect_visible_reference_uris` considers a sibling site, its `site_redeclares_with_different_identity` guard excludes the **entire** callee file from references whenever the callee defines the same name with a different identity. That is conservative by design (see the 2026-04-19 addendum: "some may hit the active instance pre-redeclaration, others the shadow post-redeclaration. Conservatively, we don't pool such files"), but it over-excludes in the common case where a file inherits the active symbol first and only later shadows it. Pre-redeclaration references in such a file are unambiguously to the active symbol.

## Goals

- Sibling forward calls from any chain-entry parent, at any depth, are walked during find-references expansion, subject to the existing per-kind propagation rules (`included-by` / `include` for locals; either `done-by` / `included-by` for non-variable non-local kinds).
- The identity-redeclares guard gains a position-aware variant: a redeclaring callee that inherits the active symbol before its own redeclaration contributes its pre-redeclaration references (and only those) to the result; its redeclaration is never treated as a declaration of the active symbol.
- Both `backward_dependencies: 'explicit'` and `backward_dependencies: 'auto'` (the default) produce identical find-references results for these scenarios.

## Non-goals

- No change to `get_visible_symbols_at` or `get_visible_forward_call_sites`. Both still use strict `<` cursor-line comparison, because their job is "pick the active instance" (step 1 above).
- No change to `definition.ts::resolve_non_macro_symbols`. Go-to-definition continues to use the strict cursor-line filter.
- No change to the three-tier find-references scoping model (`docs/find-references.md`). Variables stay workspace-wide.
- No change to `ScopeChainEntry.symbols` semantics — it continues to represent "parent's own symbols plus pre-site forward-call symbols."
- No change to `ForwardScopeResolver`'s API. The unfiltered walk is achieved by removing `ScopeResolver`'s pre-filter call, not by modifying the forward resolver.
- No change to workspace-wide declaration pooling for variables in `find_definitions`.

## Architecture

### Data-model change

Add one optional field to `ScopeChainEntry`:

```ts
// src/types/index.ts
export interface ScopeChainEntry {
  uri: string;
  directive_type: 'done-by' | 'included-by';
  call_site_line: number;
  symbols: SymbolTable;
  // Existing. Parent's forward calls strictly before call_site_line, merged
  // into `symbols` above. Used by scope resolution.
  forward_call_sites?: ForwardCallSite[];
  // New. Parent's forward calls across the entire parent file, in line order.
  // Used only by find-references (collect_visible_reference_uris) to detect
  // sibling/post-site reachability. Never merged into `symbols`.
  all_forward_call_sites?: ForwardCallSite[];
  depth: number;
  directive_order: number;
  sort_key: string;
}
```

### Return-type change on `collect_visible_reference_uris`

The helper returns a `Map` carrying an optional per-URI line cutoff:

```ts
// src/scope-resolver/visible-symbols.ts
export interface ReferenceScanRange {
  // undefined → scan the entire file.
  // number    → include only token matches whose line <= scan_through_line.
  scan_through_line?: number;
}

export function collect_visible_reference_uris(
    scope: ResolvedScope | undefined,
    cursor_line: number,
    current_uri: string,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
): Map<string, ReferenceScanRange>;
```

Callers that only need URI membership keep using `.has(uri)` (Map supports it). Callers that need the cutoff read `the_map.get(uri)?.scan_through_line`.

### Refined inclusion rule per site

For any site (chain-entry forward call or current-file forward call) under consideration in `collect_visible_reference_uris`:

1. **Defines active.** If the site defines the active symbol (identity match on this site's symbol table entry) → include `site.callee_uri` with `{ scan_through_line: undefined }`.
2. **Inherits then redeclares.** If the site redeclares the same name with a different identity **and** the symbol was visible in the accumulated pre-site state (`symbol_visible_before_site` is true) **and** the redeclaration is same-file (site's symbol entry has `location.uri === site.callee_uri`) → include `site.callee_uri` with `{ scan_through_line: redeclaration_line }`, where `redeclaration_line = site.symbols.<kind>.get(name)!.location.range.start.line`. Pre-redeclaration references in the callee are unambiguously to the active symbol; references on the redeclaration line itself (e.g., `local fruit = "\`fruit'"`) are also to the pre-shadow value because the Stata scan only matches `MACRO_REF_LOCAL` / `MACRO_REF_GLOBAL` / `WORD` tokens, not declaration tokens.
3. **Transitive redeclaration.** If the site redeclares with a different identity **and** the redeclaration is not same-file (the shadowing symbol was declared elsewhere and surfaces via this site) → fall back to today's conservative whole-file exclusion. Do not add the URI. Refining transitive cases is out of scope here.
4. **Inherits only.** If `symbol_visible_before_site` is true and the site does not redeclare → include `site.callee_uri` with `{ scan_through_line: undefined }`.
5. **Neither defines nor inherits.** Do not add.

Per-kind propagation rules (`can_reference_chain_entry`, `can_reference_forward_site` — locals only across `included-by` / `include`) continue to gate cases 1–4.

The chain-entry's own URI (added via `chain_entry_references_active`) stays included-full (no cutoff). It represents the parent file itself, not a redeclaring callee.

Cases 1, 4, and 5 preserve today's semantics exactly. Case 2 is the position-aware refinement; today it falls through to case 5 (excluded). Case 3 preserves today's conservative behavior explicitly.

### Unfiltered forward-call resolution

`ScopeResolver.resolve_parent_forward_calls` (src/scope-resolver/index.ts:956) currently runs `filter_calls_before_line` on `parent_forward_calls` before invoking `ForwardScopeResolver.resolve`. The refactor:

1. Drop the `filter_calls_before_line` pre-filter.
2. Invoke `ForwardScopeResolver.resolve` on the full `parent_forward_calls` list. Its output's `call_sites` field is the unfiltered list.
3. Derive the pre-site subset for scope-resolution merging:
   ```ts
   const pre_site_sites = forward_result.call_sites
       .filter(my_site => my_site.call_line < call_site_line);
   let pre_site_symbols = create_empty_symbol_table();
   for (const my_site of pre_site_sites) {
       pre_site_symbols = merge_symbol_tables(pre_site_symbols, my_site.symbols);
   }
   ```
   `pre_site_symbols` replaces the existing `forward_result.symbols` in the return value.
4. Return both views: `{ symbols: pre_site_symbols, call_sites: pre_site_sites, all_call_sites: forward_result.call_sites, diagnostics }`.

`follow_directives` (src/scope-resolver/index.ts:1544) populates `all_forward_call_sites` from `forward_result.all_call_sites` alongside the existing `forward_call_sites`.

The one-cost-per-parent concern: forward resolution already runs once per parent chain entry today. The refactor still runs it once; the filter moves from input to output. The callees that were previously skipped (post-site) now get parsed and resolved. For typical workspaces this is a small number of additional parse/resolve calls, all memoized by `ForwardScopeResolver`'s caches and `ScopeResolver`'s `file_parse_cache`.

### Self-edge consideration

A parent's forward calls include the edge that invoked the current file (e.g., caller.do's `include callee.do` when the cursor is in callee.do). With the unfiltered list, that site appears in `all_forward_call_sites` too. It is harmless:

- `collect_visible_reference_uris` seeds the result with `current_uri`, so re-adding it via the site loop is idempotent (Map key).
- The cycle-detection in `ForwardScopeResolver` (via the `recursion_stack` derived from `visited`) already prevents infinite recursion when a forward call would re-enter a file currently being resolved. Pre-existing behavior.

### Transitive coverage

`follow_directives` recurses to build the chain. Each recursive level populates its own `all_forward_call_sites`. The outer `for (const my_entry of scope.chain)` loop in `collect_visible_reference_uris` walks every level, so sibling forward calls at the grandparent (and above) are reached without any additional code. Per-kind propagation rules gate each level independently.

### Auto vs. explicit parity

Auto backward discovery synthesizes `done-by` / `included-by` directives from `DependencyGraph.get_parents()` when a child file has no explicit directives. The synthesized directives feed into the same `follow_directives` → `resolve_parent_forward_calls` path used by explicit directives. Because this design's changes live entirely inside that path, both modes produce identical chain entries (modulo the directive source in diagnostics), and therefore identical find-references results. The test plan locks this invariant down explicitly.

This parity now depends on the Issue #134 resolver fix: effective auto parents
must be synthesized recursively at every backward-resolution level, not just at
the root `resolve()` call. With that fix in place, the transitive scenarios
below can use the same topology in both modes.

## Concrete changes

### `src/types/index.ts`

Add `all_forward_call_sites?: ForwardCallSite[]` to `ScopeChainEntry` with the doc comment shown above. Export `ReferenceScanRange` interface (for the helper return type).

### `src/scope-resolver/index.ts`

- `resolve_parent_forward_calls` (956–1039): drop `filter_calls_before_line`, resolve the full list, derive pre-site subset + merged pre-site symbols, return `all_call_sites` alongside existing fields.
- `follow_directives` (1544–1555): populate `all_forward_call_sites` on the pushed chain entry.
- No other changes.

### `src/scope-resolver/visible-symbols.ts`

- Export `ReferenceScanRange` interface.
- Change `collect_visible_reference_uris` return type from `Set<string>` to `Map<string, ReferenceScanRange>`.
- Refactor the per-site inclusion logic into a shared internal helper implementing the five-case rule (sites from chain entries and from the current file use identical logic).
- Iterate `my_entry.all_forward_call_sites ?? my_entry.forward_call_sites ?? []` in the chain-entry loop.
- In both loops, call the shared helper; it returns `{ include: boolean, scan_through_line?: number }` and the loop body writes into the result map.
- Preserve idempotent Map writes: if a URI is already present with `scan_through_line: undefined`, keep it; if it's already present with a number and a new write would tighten the cutoff, take the smaller cutoff; if a new write would widen it to `undefined`, take the `undefined` (full scan wins).

### `src/providers/references.ts`

- `find_definitions` (170–269): `the_allowed_uris` changes type from `Set<string> | null` to `Map<string, ReferenceScanRange> | null`. `the_allowed_uris.has(my_def.sourceUri)` continues to gate inclusion. For non-variable kinds, additionally skip any workspace declaration whose `my_def.location.range.start.line === the_allowed_uris.get(my_def.sourceUri)?.scan_through_line` — that's the redeclaration itself (different identity), not a declaration of the active symbol.
- `collect_references` (754–900): `the_related` becomes `Map<string, ReferenceScanRange>`. URI-membership gating uses `.has()` unchanged. After `scan_tokens_for_references` returns matches for a URI, filter matches whose `range.start.line > scan_through_line` when set. For the `restrict_to_related` path, pass the map's keyset as `related_uris` into `apply_include_declaration` / `sort_locations` (those APIs want a `Set<string>`).
- `apply_include_declaration` (360–393) and `sort_locations` (415–433): signatures unchanged; callers pass `new Set(the_related.keys())` or — cleaner — we extend one of them to accept `Map<string, ReferenceScanRange>` directly and extract keys internally. Pick whichever diff is smaller during implementation.
- `classify_word_symbol` (544–700): no changes. Its call to `get_visible_forward_call_sites` is cursor-line-filtered and separate from the find-references path.

### Other providers

No changes. `completion.ts`, `hover.ts`, `diagnostics.ts`, `definition.ts` consume `forward_call_symbols` (current-file) and `get_visible_symbols_at` / `get_visible_forward_call_sites`, none of which shift.

### `src/server-handlers.ts`

No changes.

## Test plan

### Directive-mode parameterization

Every integration scenario runs in two modes via `describe.each(['explicit', 'auto'])` or an equivalent shared-helper pattern:

- **Explicit:** fixture files carry `@lsp-included-by` / `@lsp-done-by` / `@lsp-do` / `@lsp-run` / `@lsp-include` directives as appropriate.
- **Auto:** no directives. `cross_file.backward_dependencies: 'auto'` (default) drives parent discovery from `do` / `run` / `include` statements in the caller.

Both modes must produce identical reference results. The pipeline wiring (`DocumentStore + WorkspaceIndexer + DependencyGraph + ScopeResolver + ForwardScopeResolver`) is identical across modes; only fixture content varies.

### New integration test — `tests/integration/find-references-sibling-forward-calls.test.ts`

9 scenarios × 2 modes = 18 cases.

**Scenario 1 — Direct sibling, local across `include` chain.** `caller.do`: `include callee.do` then `include other.do`. `callee.do` defines `local fruit`. `other.do` references `` `fruit' ``. Cursor on `fruit`'s declaration in `callee.do`. Expect `other.do`'s reference in the result.

**Scenario 2 — Direct sibling, program across `do` chain.** `caller.do`: `do "defs.do"` then `do "consumer.do"`. `defs.do` defines `program shared_prog`. `consumer.do` invokes `shared_prog`. Cursor on `shared_prog`'s definition. Expect `consumer.do`'s reference in the result.

**Scenario 3 — Direct sibling, global across mixed chain.** `caller.do`: `include a.do` then `do "b.do"`. `a.do` defines `global shared_path`. `b.do` references `$shared_path`. Cursor on the global's definition. Expect `b.do`'s reference in the result.

**Scenario 4 — Transitive, local up include-chain then sibling.** `grandparent.do`: `include parent.do` then `include uncle.do`. `parent.do`: `include child.do`. `child.do` defines `local fruit`. `uncle.do` references `` `fruit' ``. Cursor on `fruit`'s declaration. Expect `uncle.do` in the result.

**Scenario 5 — Transitive broken by `done-by` boundary (locals).** Same topology as Scenario 4, but `grandparent → parent` is `do`, not `include`. Locals do not propagate through `do`; `uncle.do` must NOT be in the result.

**Scenario 6 — Transitive OK for non-locals through `done-by` boundary (programs).** Same topology as Scenario 5 (with `do` at grandparent→parent), but target symbol is `program shared_prog`. Expect `uncle.do` in the result.

**Scenario 7a — Whole-file exclusion when redeclaring sibling does not inherit.** `current.do`: `do "earlier.do"` then `do "later.do"`. Both files independently define `program shared_prog` (different identities). Cursor on a reference to `shared_prog` in `current.do` (active = `later.do`). `earlier.do` does not inherit `later.do`'s symbol; its pre-redeclaration references cannot target the active symbol. Expect `earlier.do` NOT in the result.

**Scenario 7b — Position-aware filtering when redeclaring sibling inherits then redeclares.** `caller.do`: `include first.do` then `include second.do`. `first.do` defines `local fruit "apple"`. `second.do` body:
```
display "`fruit' one"
local fruit "orange"
display "`fruit' two"
```
Cursor on `fruit`'s declaration in `first.do`. Expect: `second.do`'s line-0 display IS in the result (pre-redeclaration reference to the active `fruit`); `second.do`'s line-2 display is NOT (post-redeclaration reference to the shadow); `second.do`'s `local fruit` declaration is NOT in `includeDeclaration` output (different identity).

**Scenario 8 — `includeDeclaration: true` composes correctly.** Repeat Scenario 1 with `includeDeclaration: true`. Expect the declaration's range in `callee.do` appears exactly once, `other.do`'s reference is still present, and no duplicates.

**Scenario 9 — Variables stay workspace-wide.** Repeat Scenario 2 with target symbol as a variable (e.g., `analysis_sample`) instead of a program. Variables are exempt from the sibling-forward-call logic. Expect `consumer.do`'s reference IS in the result regardless of directive mode — this is already the case, but the doubled test ensures no accidental routing through the new path.

### Unit tests — `tests/unit/scope-resolver/visible-symbols.test.ts`

Single-mode (directive-mode doubling does not apply at the unit level since `ResolvedScope` is constructed directly). New cases:

- Chain entry with `all_forward_call_sites` containing pre-site and post-site calls; active symbol defined in the pre-site. Expect both callee URIs appear in the result map with `scan_through_line: undefined`.
- Chain entry with `all_forward_call_sites` undefined but `forward_call_sites` populated. Expect fallback path returns the same URIs as today.
- Chain entry, post-site call redeclares with a different identity, active NOT visible before the post-site call. Expect callee URI excluded.
- Chain entry, post-site call redeclares with a different identity, active IS visible before the post-site call (same-file redeclaration). Expect callee URI included with `scan_through_line` equal to the symbol's redeclaration line.
- Chain entry, post-site call redeclares with a different identity surfaced transitively (`location.uri !== callee_uri`). Expect callee URI excluded (conservative fallback).
- Chain entry with a `done-by` directive and a post-site call carrying a local. Expect the local case excludes the callee URI; the program case includes it.
- Return-type assertion: result is a `Map`, not a `Set`.

Existing unit tests (lines 284–595) retain their `.has(uri)` / `.size` assertions against the Map — no changes needed.

### Property-test additions

None. Existing property tests (`forward-scope-resolution.prop.test.ts`, `scope-resolver.prop.test.ts`) are unaffected; this fix operates on a chain-entry field and a helper-return type those tests do not exercise.

### Existing tests — expected outcomes

- `tests/integration/find-references-include-locals.test.ts` — passes unchanged.
- `tests/integration/find-references-call-site-scope.test.ts`, `find-references-declaration-scope.test.ts`, `find-references-definition-site.test.ts`, `find-references-stale-index.test.ts` — pass unchanged.
- `tests/unit/scope-resolver/visible-symbols.test.ts` — existing cases pass against the Map return type.
- All property tests pass unchanged.

Any drift is a real regression and must be investigated before landing.

## Implementation ordering

Single PR, sequenced per-commit. Every commit must pass `bun run test` and `bun run typecheck`.

1. **Type-level scaffolding.** Add `all_forward_call_sites?: ForwardCallSite[]` to `ScopeChainEntry`. Add `ReferenceScanRange` interface in `visible-symbols.ts`. Change `collect_visible_reference_uris`'s return type from `Set<string>` to `Map<string, ReferenceScanRange>`, but keep producing the same URIs as today (every entry `{ scan_through_line: undefined }`). Update consumers in `references.ts` to use `.has()` on the Map and to pass `new Set(map.keys())` where a `Set<string>` is still expected (ranking/sorting helpers). All existing tests pass; behavior unchanged.
2. **`ScopeResolver` plumbing.** Refactor `resolve_parent_forward_calls` to resolve unfiltered + derive pre-site subset; populate `all_forward_call_sites` in `follow_directives`. No consumer changes yet.
3. **Consumer flip + redeclares guard copy.** In `collect_visible_reference_uris`, iterate `all_forward_call_sites ?? forward_call_sites ?? []` in the chain-entry loop; copy the identity-redeclares guard (whole-file exclusion only) to the chain-entry body. Add scenarios 1–6, 7a, 8, 9 (both modes) to the integration test. Scenario 7b's "include `second.do`'s line-0 display" assertion still fails at this point — that's expected; it unlocks in commit 4.
4. **Position-aware redeclares refinement.** Extend the per-site rule: case 2 (visible-before + redeclare-different-identity + same-file) now emits `scan_through_line` instead of excluding the URI. Wire `scan_through_line` through `collect_references`'s scan loop and `find_definitions`'s declaration pool. Add scenario 7b (both modes) and the corresponding unit tests. Scenario 7a continues to pass (different code path).
5. **Unit-test additions.** Land alongside commits 3 and 4 as appropriate.

## Risks

- **Performance.** `resolve_parent_forward_calls` resolves strictly more calls per invocation (post-site siblings too). Memoization in `ForwardScopeResolver` and `ScopeResolver`'s `file_parse_cache` bounds the marginal cost to one parse + resolve per newly-visited callee. No measured perf concern expected; no benchmark planned.
- **Transitive-redeclare edge.** Case 3 in the refined rule (transitive shadowing through a non-same-file redeclaration) preserves today's conservative exclusion. A future issue may refine this further; it is out of scope here.
- **Same-line redeclare subtlety.** The `scan_through_line` comparison uses `<=` (match included when line ≤ cutoff). A reference on the redeclaration line itself (e.g., the RHS of `local fruit = "\`fruit'"`) is correctly included: Stata's last-assignment semantics mean the RHS sees the pre-shadow value, and the token scanner does not match declaration tokens on the LHS.
- **Auto/explicit parity.** The doubled integration tests lock the invariant explicitly. Future changes to auto backward discovery must preserve this parity or the sibling-forward-calls test will catch the regression.

## Related

- Predecessor: #129 (spec: `docs/superpowers/specs/2026-04-18-issue-129-unify-visible-at-cursor-design.md`), specifically the 2026-04-19 addendum.
- Predecessor: #127 (closed).
