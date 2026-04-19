# Issue #129 — Unify "symbols visible at cursor position" across providers

**Status:** implemented; semantics revised post-landing — see "2026-04-19 addendum" below
**Date:** 2026-04-18 (original design); 2026-04-19 (addendum)
**GitHub issue:** [#129](https://github.com/jbearak/sight/issues/129)
**Scope:** full — fix the two latent bugs identified in #129's audit, consolidate the ≈8 duplicated filter sites behind shared pure helpers, and retire the legacy `forward_scope` provider parameter.

## 2026-04-19 addendum — find-references no longer uses a cursor-line filter

After #129 landed, a user report exposed a gap: find-references on a local macro declared in file A where A has an `include` relationship with file B (either A is `included-by` B, or A `include`s B) returned zero results. The declaration is in scope at the cursor, and the reference site is in the sibling file, but the sibling's URI was excluded by `collect_visible_reference_uris`'s `call_line < cursor_line` filter.

The underlying misconception: the cursor line was being used for two distinct jobs — *picking* the active symbol instance (correct) and *filtering* reference sites (incorrect). Once the active instance is chosen, every file that could reference *that definition* is a legitimate hit, regardless of call-site order relative to the cursor.

### Revised semantics (now in effect)

`collect_visible_reference_uris`:

- The cursor line resolves ambiguity among same-name instances via `get_visible_symbols_at`. That is its *only* role.
- Every forward call from the current file is walked (not just those with `call_line < cursor_line`).
- A forward-called file is included when the active instance is visible at its call (either already defined in the current file's pre-call state, or defined by the site itself), *and* the site does not redeclare the name with a different identity. Redeclaring sites are excluded because their in-file references become ambiguous — some may hit the active instance pre-redeclaration, others the shadow post-redeclaration.
- Chain-entry URIs are added when the parent's post-call state sees the active instance. For `included-by`, that includes the case where the active symbol is declared in the current file itself and reaches back into the parent via include. The pre-fix `entry_visible_symbols` check only modeled the parent's pre-call state, missing this direction.

### What changed in the shipped code vs. the original spec

- The line in the forward-call loop is now `for (const my_site of scope.forward_call_symbols ?? [])` — no cursor-line filter. A separate guard drops sites that redeclare the name with a different identity.
- The chain-entry check gained an `active_symbol_identity === current_uri` shortcut so parents that reach back into the current file via `included-by` (or `done-by` for non-locals) are added even when the parent's own symbol table does not yet list the symbol.

### What the original spec got right and kept

- The unification — one shared helper, import sites collapsed across `completion.ts`, `hover.ts`, `diagnostics.ts`, `definition.ts`, `references.ts`.
- The `get_visible_symbols_at` / `get_visible_forward_call_sites` semantics — both still use strict `<` against `cursor_line`, because those functions answer "what is visible at the cursor," which is exactly the right question for *picking* a symbol.
- `definition.ts::resolve_non_macro_symbols` — go-to-def still uses strict cursor-line visibility (a `do "defs.do"` after the cursor should not resolve the cursor's token).
- Retirement of the `forward_scope` parameter plumbing.

### What to update when reading the historical design below

Two parts of the original design are superseded:

1. **`find_definitions` behavior after fix** (in "Concrete changes / `src/providers/references.ts`") — the bullet *"declarations in not-yet-reached forward-called files are dropped from `includeDeclaration`"* no longer holds. The current rule is the identity-based one described above.
2. **Test plan** — the unit test expectation *"Keeps the strict `<` boundary for current-file forward calls"* under `collect_visible_reference_uris`, and the integration-test scenario *"Program declared in not-yet-reached forward-called file: `find-references` does not include that location"* are both obsolete. The first has been flipped in `tests/unit/scope-resolver/visible-symbols.test.ts`; the second expectation in `tests/integration/find-references-declaration-scope.test.ts` still passes only because the test's forward-called file *redeclares* `shared_prog` (different identity), not because of the cursor-line filter.

The `get_visible_symbols_at` / `get_visible_forward_call_sites` sections of the original design are unchanged and remain accurate.

Primary commit: `2f56e0e` ("Find references to locals across include boundaries").

---

## Original design (2026-04-18)

## Problem

Issue #129's audit enumerates a rule — "symbols from a forward call are visible only after the call line; backward-directive parents are always visible" — that is implemented ad-hoc across providers. Current state:

- **`completion.ts`** applies the filter in 8 places: one file-local helper `get_visible_forward_call_sites` (lines 63–76) used by four `resolved_scope` paths (1182, 1803, 2173, 2364), plus four inline `call_site.call_line < cursor_line` blocks on a legacy `forward_scope` fallback path (1144–1176, 1751–1801, 2064–2171, 2325–2362).
- **`hover.ts`** has its own private method `get_visible_forward_call_sites` (475–488) used at six sites.
- **`diagnostics.ts`** inlines the same filter at 309–315.
- **`references.ts::classify_word_symbol`** (post-#127) applies the filter correctly at 564–567.
- **`ForwardScopeResolver.get_symbols_at_line`** (forward-scope-resolver/index.ts:425–448) already merges base + visible-forward-call symbols into a single `SymbolTable`. It is tested (`tests/property/forward-scope-resolution.prop.test.ts`) and unused by any provider.

Two latent defects sit underneath the duplication:

1. **`definition.ts::resolve_non_macro_symbols`** (321–375) consults `resolved_scope.symbols` but never `resolved_scope.forward_call_symbols`. A `WORD` token naming a program/scalar/matrix/variable that is defined in a visible forward-called file does not resolve through the scope resolver. It falls through to `workspace_indexer.find_symbol_definitions`, which has no cursor-ordering filter and can jump to a definition in an unrelated branch. This is the "bigger user impact" variant #127 flagged.
2. **`references.ts::find_definitions`** (166–240) pools declarations from `workspace_indexer.find_symbol_definitions` restricted to `get_related_uris(document.uri)` — the full dep-graph, with no call-site filter. For non-variable kinds, redeclarations in not-yet-reached forward-called files are pooled into the `includeDeclaration` list.

The duplication has its own cost: any refinement to the rule (e.g., handling edge cases around `#delimit;` statement ordering, or tightening the `<` comparison) must land in ≈8 places or risk drift between providers.

## Goals

- One canonical, tested place where the "visible at cursor" question is answered. All providers consult it.
- `definition.ts::resolve_non_macro_symbols` returns the correct in-scope location for programs / scalars / matrices / variables defined in visible forward-called files.
- `find_definitions` restricts non-variable declaration pooling to files that are in-scope at the cursor. Variables stay workspace-wide (dataset-column semantics, matching the three-tier scoping documented in `docs/find-references.md` and `CLAUDE.md`).
- The runtime-dead legacy `forward_scope: ForwardResolvedScope` parameter is gone from provider method signatures.

## Non-goals

- Changes to `ScopeResolver`'s caching or resolution algorithm.
- Changes to completion ranking semantics, or the `effective_type === 'include'` rule for local macros in hover/diagnostics.
- Changes to `collect_references` (the references scanner) or the three-tier model in general.
- Retiring the `ForwardResolvedScope` type itself — it stays as the return type of `ForwardScopeResolver.resolve`. Only the provider-level `forward_scope` parameter goes.
- Issue #128's open docs work.

## Architecture

### New primitives

A new module, `src/scope-resolver/visible-symbols.ts`, re-exported through `src/scope-resolver/index.ts`. Three pure, synchronous functions, each accepting `undefined` gracefully so test-only paths don't need to construct a scope:

```ts
import type { ResolvedScope, ForwardCallSite, SymbolTable } from '../types';
import { merge_symbol_tables } from '../analyzer';

/**
 * SymbolTable of all symbols in scope at `cursor_line`. Equivalent to
 *   resolved_scope.symbols
 *   ∪ { call_site.symbols : call_site ∈ resolved_scope.forward_call_symbols,
 *                           call_site.call_line < cursor_line }
 * with `merge_symbol_tables` overlay semantics (lattermost wins on name
 * collisions; preserves scope-resolver precedence).
 *
 * Returns an empty SymbolTable when `scope` is undefined.
 */
export function get_visible_symbols_at(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): SymbolTable;

/**
 * Forward-call sites visible at `cursor_line` (site.call_line < cursor_line),
 * preserving array order so ranking-sensitive callers keep current behavior.
 *
 * Returns `[]` when `scope` is undefined.
 */
export function get_visible_forward_call_sites(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): ForwardCallSite[];

/**
 * URIs that should participate in find-references for the given symbol kind.
 * Includes backward-chain files, retained parent forward callees, and
 * current-file visible forward callees. Local macros remain include-only
 * across both backward and forward edges.
 *
 * Returns `{ current_uri }` when `scope` is undefined.
 */
export function collect_visible_reference_uris(
    scope: ResolvedScope | undefined,
    cursor_line: number,
    current_uri: string,
    symbol_type: 'local_macro' | 'global_macro' | 'program' | 'scalar' | 'matrix',
): Set<string>;
```

Returning `SymbolTable` means consumers keep using `.programs.get(name)` / `.variables.get(name)` — zero new query vocabulary. The underlying merge logic is already implemented and tested in `ForwardScopeResolver.get_symbols_at_line`; the latter becomes a thin delegation to `get_visible_symbols_at` so there is exactly one source of truth. Its existing property test (`tests/property/forward-scope-resolution.prop.test.ts:172,176`) continues to cover that path.

### Strict vs. non-strict inequality

All existing sites use `call_site.call_line < cursor_line` (never `≤`). A symbol defined on the same line as the `do` is not yet in scope at the `do` line itself. The new helpers preserve strict `<`.

## Concrete changes

### `src/scope-resolver/visible-symbols.ts` (new)

Contains the three helpers above. `get_visible_symbols_at` is implemented by copying the loop body of `ForwardScopeResolver.get_symbols_at_line`; `get_visible_forward_call_sites` is a one-line filter; `collect_visible_reference_uris` walks `scope.chain`, retained parent `forward_call_sites`, and current visible forward sites with an include-only branch for local macros.

### `src/scope-resolver/index.ts`

Re-export the three new helpers so providers can import them alongside `ScopeResolver`.

### `src/forward-scope-resolver/index.ts`

`get_symbols_at_line` (lines 425–448) stays unchanged. Keeping two independent implementations of the same rule — the instance method here and the pure `get_visible_symbols_at` in the new module — gives the property test below a non-trivial invariant to check: it can compare the two outputs on arbitrary inputs and fail if they drift. Folding one into the other would turn that property test into a tautology.

### `src/providers/definition.ts`

`resolve_non_macro_symbols` (321–375) uses the merged view. Priority order unchanged (variable → program → scalar → matrix), matching the existing WORD-priority for go-to-def.

```ts
if (scope_resolver) {
    const resolve_config = build_scope_resolver_config(cross_file_config);
    const resolved_scope = await scope_resolver.resolve(
        document.uri, document.content, resolve_config, cancellation_token);
    const visible = get_visible_symbols_at(resolved_scope, position.line);

    const variable = visible.variables.get(word);
    if (variable) return { uri: variable.location.uri, range: variable.location.range };

    const program = visible.programs.get(word);
    if (program) return { uri: program.location.uri, range: program.location.range };

    const scalar = visible.scalars.get(word);
    if (scalar) return { uri: scalar.location.uri, range: scalar.location.range };

    const matrix = visible.matrices.get(word);
    if (matrix) return { uri: matrix.location.uri, range: matrix.location.range };
}
// Fall through to document.symbols (test-only fallback) and workspace_indexer,
// unchanged from today.
```

Consequences:

- Programs/scalars/matrices defined in a visible forward-called file now resolve to that file (the headline bug from the issue).
- Variables defined in a visible forward-called file resolve in-scope before falling through to the workspace multi-def picker — captures the "if there is a def in scope, that is the def that's relevant for go-to-def" rule.
- Variables with no in-scope def continue to fall through to `workspace_indexer.find_symbol_definitions(word, 'variable')` and return a `Location[]`. Workspace-wide variable semantics preserved where no in-scope def exists.

The rest of `resolve_non_macro_symbols` (document-symbols fallback at 377–408, workspace-indexer fallback at 411–430, workspace-symbols fallback at 434–465) is unchanged. These paths only execute when `scope_resolver` is absent (test-only) or when the in-scope check misses.

### `src/providers/references.ts`

**`classify_word_symbol`** (540–607): replace the inline `if (my_site.call_line >= cursor_line) continue;` loop with `for (const my_site of get_visible_forward_call_sites(resolved_scope, cursor_line))`. Semantics identical; cleanup only. The workspace-wide variable fallback at 594–604 is unchanged.

**`find_definitions`** (166–240): accepts two new parameters — `resolved_scope: ResolvedScope | undefined` and `cursor_line: number` — threaded through from `get_references`. The workspace-indexer block at 216–237 replaces `get_related_uris` with `collect_visible_reference_uris` for non-variable kinds:

```ts
if (workspace_indexer) {
    const ws_type = symbol_type === 'local_macro' ? 'local' :
                    symbol_type === 'global_macro' ? 'global' : symbol_type;
    // Variables are dataset columns — pooled workspace-wide across unrelated
    // modules (see docs/find-references.md). Non-variable kinds are
    // restricted to files visible at the cursor.
    const restrict_to_visible = symbol_type !== 'variable';
    const the_visible_uris = restrict_to_visible
        ? collect_visible_reference_uris(
            resolved_scope, cursor_line, document.uri, symbol_type)
        : null;
    for (const my_def of workspace_indexer.find_symbol_definitions(symbol_name, ws_type)) {
        if (my_def.sourceUri === document.uri) continue;
        if (the_visible_uris && !the_visible_uris.has(my_def.sourceUri)) continue;
        push({ uri: my_def.location.uri, range: my_def.location.range });
    }
}
```

Behavior after fix:

- For programs / scalars / matrices / local-macro / global-macro, declarations in not-yet-reached forward-called files are dropped from `includeDeclaration`.
- Files reachable only through a backward parent's earlier forward calls remain visible to find-references because each `ScopeChainEntry` retains its filtered `forward_call_sites`.
- Variable declarations continue to pool workspace-wide, matching find-references' variable semantics. Not restricted by `the_visible_uris`.

**`get_references`**: gains access to `cursor_line` via the existing `position.line` already in scope and threads it, along with the `resolved_scope` it already resolves for `classify_word_symbol`, into `find_definitions`.

### `src/providers/completion.ts`

- Delete the file-local `get_visible_forward_call_sites` (63–76). Replace with `import { get_visible_forward_call_sites } from '../scope-resolver';`.
- Delete `forward_scope?: ForwardResolvedScope` from all five method signatures (865, 1080, 1597, 1912, 2285).
- Delete the four corresponding inline legacy blocks at 1144–1176, 1751–1801, 2064–2171, 2325–2362 (the `if (forward_scope) { … for (const call_site of forward_scope.call_sites) { if (call_site.call_line < cursor_line) …` fallbacks).
- The helper-using blocks at 1182, 1803, 2173, 2364 remain and become the sole forward-call path.
- Ranking logic is unchanged — it correctly needs per-site `effective_type` / `parent_uri`.

### `src/providers/hover.ts`

- Delete the private method `get_visible_forward_call_sites` (475–488). Replace call-site calls `this.get_visible_forward_call_sites(resolved_scope, position)` at 531, 623, 705, 792, 1351, 1452 with the shared `get_visible_forward_call_sites(resolved_scope, position.line)` imported from `../scope-resolver`.
- The `effective_type === 'include'` branches that handle local-macro visibility are unchanged.

### `src/providers/diagnostics.ts`

- Delete `forward_scope?: ForwardResolvedScope` from `get_diagnostics` / `convert_all` signatures (105, 151).
- Simplify line 301 from `const forward_call_sites = resolved_scope?.forward_call_symbols ?? forward_scope?.call_sites;` to `const forward_call_sites = resolved_scope?.forward_call_symbols ?? [];` (retained only for the code's null-check flow; the loop below swaps to the helper).
- Rewrite the loop at 309–315 using the shared helper:
  ```ts
  for (const call_site of get_visible_forward_call_sites(resolved_scope, diag_line)) {
      if (this.is_symbol_in_forward_call(
              symbol_name, call_site.symbols, my_diagnostic.code, call_site.effective_type)) {
          found_in_forward_call = true;
          break;
      }
  }
  ```
- Keep `is_symbol_in_forward_call` (891+) — it's a per-site predicate that uses `effective_type`, not a generic "is in scope" check.

### `src/server-handlers.ts`

- Remove the `let forward_scope = undefined; if (!deps.scope_resolver && deps.forward_scope_resolver && …) forward_scope = await deps.forward_scope_resolver.resolve(…)` block around line 327.
- Remove the `forward_scope,` argument at 363 (passed to completion/diagnostics).
- `create_references_handler` threads `cursor_line` from the request position into `get_references` (needed by `find_definitions` now).
- `deps.forward_scope_resolver` itself stays wired — it is still used internally by `ScopeResolver` and disposed at line 687.

## Test plan

### New unit tests — `tests/unit/scope-resolver/visible-symbols.test.ts`

- `get_visible_symbols_at`:
  - Undefined scope returns an empty `SymbolTable` (all six Maps empty).
  - Empty `forward_call_symbols` returns a copy of `scope.symbols`.
  - One forward site with `call_line < cursor_line` contributes; same site with `call_line >= cursor_line` does not.
  - `call_line === cursor_line` is excluded (strict `<`).
  - Two sites defining the same name: lattermost wins (matches merge_symbol_tables overlay semantics).
- `get_visible_forward_call_sites`:
  - Undefined scope returns `[]`.
  - Preserves array order.
  - Strict `<` boundary.
- `collect_visible_reference_uris`:
  - Contains `current_uri` even when `scope` is undefined.
  - For non-local kinds, includes every `chain[*].uri`, every retained parent `forward_call_sites[*].callee_uri`, and every current-file visible `callee_uri`.
  - For `local_macro`, includes only `included-by` chain entries and only call sites with `effective_type === 'include'`.
  - Keeps the strict `<` boundary for current-file forward calls.

### New property test — `tests/property/visible-symbols.prop.test.ts`

- For arbitrary `(ResolvedScope, line)`: `get_visible_symbols_at(scope, line)` equals `ForwardScopeResolver.get_symbols_at_line(scope.symbols, scope.forward_call_symbols ?? [], line)` (semantic equivalence). Locks the two implementations together so they cannot drift.

### New integration test — `tests/integration/definition-call-site-scope.test.ts`

Mirrors the structure of `tests/integration/find-references-call-site-scope.test.ts` from #127. Uses the same pipeline-wiring helper so `DocumentStore + WorkspaceIndexer + DependencyGraph + ScopeResolver + ForwardScopeResolver` behave as in production.

Scenarios:

1. **Regression — program defined in forward-called file.** `main.do`: `shared_prog\ndo "defs.do"`. `defs.do` defines `shared_prog`. Cursor on line 0. Assert result is null (pre-fix: would have jumped to `defs.do` via workspace fallback).
2. **Positive — cursor after the `do`.** Same files, cursor on line 2 (after the `do`). Assert result is the location in `defs.do`.
3. **Variable in-scope preference.** A variable defined only in a visible forward-called file. Cursor after the `do`. Assert result is the single in-scope location — *not* the workspace `Location[]` fallback.
4. **Variable workspace fallback.** A variable with no in-scope def, defined in an unrelated workspace file. Assert result is the workspace `Location[]`.
5. **Unrelated branches with same-named program.** `main.do` does `branch_a.do` then `branch_b.do`. Both define `shared_prog`. Cursor after the `do "branch_a.do"` only → resolves to `branch_a.do` alone (not pooled with `branch_b.do`).
6. **Transitive forward call.** `main.do` does `mid.do` at line 5; `mid.do` does `leaf.do` at line 3; `leaf.do` defines `deep_prog`. Cursor at line 10 in `main.do` → resolves to `leaf.do`. Cursor at line 2 → returns `null` (not yet in scope, and no workspace fallback because no other file in the workspace defines `deep_prog`).

### New integration test — `tests/integration/find-references-declaration-scope.test.ts`

Scenarios:

1. Program declared in not-yet-reached forward-called file: `find-references` with `includeDeclaration: true` does not include that location.
2. Program declared in a visible forward-called file: `find-references` includes that declaration.
3. Variable declarations pool workspace-wide regardless of cursor: a variable defined in an unrelated workspace file appears in declarations (keeps the workspace-scoping guarantee explicit as a test).
4. Variable declaration in a visible forward-called file: appears in declarations (not excluded by any filter).

### Retirement migrations — existing tests

Three files that construct `ForwardResolvedScope` directly need migration:

- **`tests/unit/diagnostics-provider.test.ts`** (798, 817, 835, 853): four scenarios migrated to wire a `ScopeResolver` and assemble a `ResolvedScope` with `forward_call_symbols` populated. A small test helper in `tests/unit/helpers/` that builds a minimal `ResolvedScope` from a `ForwardCallSite[]` keeps the migration concise.
- **`tests/unit/unify-forward-call-feeds.test.ts`** (122, 210, 275): three scenarios, same migration.
- **`tests/property/unify-forward-call-feeds.prop.test.ts`** (148, 238): two generators, same migration. The property shape — "warnings suppressed when the symbol is defined in a visible forward-call" — is unchanged; only the entry point moves to the canonical path.

### Updated expectations — existing tests

No semantic changes are expected in hover / completion / diagnostics provider unit tests (the helper swap is structural). Any snapshot or assertion drift indicates a real semantic regression and must be investigated before the PR lands.

## Implementation ordering

A single PR, sequenced so each commit isolates one concern. Every commit must pass `bun run test` and `bun run typecheck`.

1. **Add primitives + their unit and property tests.** `src/scope-resolver/visible-symbols.ts` and tests in isolation — nothing else touches it yet. Export through `src/scope-resolver/index.ts`.
2. **Migrate `hover.ts`.** Six mechanical call-site swaps; private helper method deleted. Existing hover tests pass unchanged.
3. **Migrate `completion.ts` + retire legacy parameter.** Delete `forward_scope` from five signatures, delete four inline fallback blocks, swap the file-local helper for the shared import. Existing completion tests pass unchanged.
4. **Migrate `diagnostics.ts` + retire legacy parameter.** Same pattern. Migrate the three `forward_scope`-using test files in this commit (`tests/unit/diagnostics-provider.test.ts`, `tests/unit/unify-forward-call-feeds.test.ts`, `tests/property/unify-forward-call-feeds.prop.test.ts`).
5. **Fix `definition.ts::resolve_non_macro_symbols`.** Add `tests/integration/definition-call-site-scope.test.ts` in the same commit (TDD: failing first, then the fix).
6. **Fix `references.ts::find_definitions`.** Add `tests/integration/find-references-declaration-scope.test.ts` in the same commit (same TDD rhythm).
7. **Cleanup `references.ts::classify_word_symbol`.** Mechanical helper swap; no behavior change.
8. **Remove `forward_scope` plumbing from `server-handlers.ts`.** Final cleanup — after all providers are migrated.

## Risks

- **Performance.** `get_visible_symbols_at` allocates six new Maps per call. Typical request path hits it once; `ScopeResolver.resolve` memoization means the underlying `ResolvedScope` is reused across requests on the same buffer. No measured perf concern expected; no benchmark planned.
- **Silent semantic drift on migration.** The "unify-forward-call-feeds" tests were specifically designed to pin feed-level behavior. After migration they verify the same invariants through the canonical path — if they pass, confidence is high that no semantic regression occurred. If they fail, investigate before landing.
- **Variable scope regression.** The variable-stays-workspace-wide rule lives in exactly one place today (`find_definitions`'s `restrict_to_related = symbol_type !== 'variable'` at line 225) and will live in exactly one place after (the renamed `restrict_to_visible = symbol_type !== 'variable'`). The new integration test explicitly asserts this semantic so a future refactor cannot silently regress it.

## Related

- Blocker (closed): #127 (narrow fix, spec: `docs/superpowers/specs/2026-04-18-issue-127-classify-call-site-filtering-design.md`).
- Docs issue (open, unrelated): #128.
