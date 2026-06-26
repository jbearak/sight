# Task 8 Report: Scope Resolver — Backward Directive Resolution + Real-Cased Keys

## Summary

Implemented case-only path resolution for backward header directives
(`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`) in `ScopeResolver`, plus
real-cased URI keying for reverse-dependency and file-parse-cache maps (M3).

## Files Changed

- `src/types/index.ts` — added `case_mismatch?: CrossFileCaseMismatchSeverity`
  to `ScopeResolverConfig.diagnostics`
- `src/scope-resolver/index.ts` — implementation (see below)
- `tests/unit/scope-resolver-backward-case-mismatch.test.ts` — 6 new tests
- `tests/unit/build-scope-resolver-config.test.ts` — updated snapshot to
  include `case_mismatch: 'auto'`

## Base-Join Approach

`compute_directive_real_path(directive, child_uri)`:

1. Extracts the containing directory from `child_uri` (the file with the
   directive, i.e. the child).
2. Calls `this.directive_parser.resolve_path(directive.raw_path, containing_dir)`
   — uses DirectiveParser's separator/UNC normalization but WITHOUT the `.do`
   fallback (the rich resolver owns that).
3. Feeds the joined absolute path into `resolve_path_rich(joined, {
   try_do_fallback: true, workspace_roots: ..., fs: this.resolve_fs })`.
4. Returns `{ real_path, outcome_kind, requested_path?, seed_dir? }`.

## Where Real-Cased Keys Are Routed (M3)

Three sites in `src/scope-resolver/index.ts`:

1. **`follow_directives` loop** (core fix): replaced
   `URI.file(my_directive.path)` with
   `URI.file(my_rich.real_path)` derived from `compute_directive_real_path`.
   `get_parsed_file` is now called with `my_real_fs_path` instead of
   `my_directive.path`. Auto-synthesised directives from the dep-graph already
   carry real-cased paths, so `resolve_path_rich` returns `exact` for them and
   no diagnostic is emitted.

2. **Top-level `resolve()` backward-dep registration** (lines ~994): replaced
   `URI.file(my_directive.path)` with `URI.file(my_real.real_path)` from
   `compute_directive_real_path`. This ensures `backward_directive_children` is
   keyed by the real-cased URI.

3. **`sync_backward_directive_dependencies`**: same fix as above for the
   DocumentStore-driven path.

## Exact Backward Message Wording

```
Directive path "${raw_rel}" does not match the file on disk "${real_rel}";
update the directive to match the file's casing.
```

Where `raw_rel` and `real_rel` are paths relative to the child file's
directory. No "Stata will", no "execute" — backward directives are LSP hints
only. The `kind: 'path_case_mismatch'` field enables structured routing in
`convert_directive_diagnostic` (task 4 wiring) and the `code:
StataDiagnosticCode.PATH_CASE_MISMATCH` field surfaces the code in
`sight check` output.

## `scope_resolver_config_for` Threading

Added `case_mismatch: config.cross_file?.diagnostics?.case_mismatch` to the
diagnostics block so the resolver honours the user's configured severity. The
`emit_backward_case_mismatch` helper respects `'off'` (suppress), explicit
severities, and treats `'auto'` as `'warning'` at emit time (the diagnostics
provider re-resolves via `host_is_case_sensitive` when
`case_mismatch_seed_dir` is set).

## Test Results

- **Typecheck**: 0 errors
- **Full suite**: 6062 pass, 5 skip, 0 fail (563 files, 397 912 expect() calls)
- **New tests** (`scope-resolver-backward-case-mismatch.test.ts`): 6/6 pass
  - (a1) wrong-cased `@lsp-done-by` → 1 path_case_mismatch, parent symbols in
    scope, no execution claim, shows raw + real path
  - (a2) wrong-cased `@lsp-included-by` → same assertions
  - (a3) correctly-cased directive → 0 path_case_mismatch
  - (b)  ambiguous (2 ci matches) → 0 path_case_mismatch
  - (c1) M3 key: real-cased URI registered, wrong-cased URI not registered
  - (c2) M3 invalidation: `invalidate_scope_cache(real_parent_uri)` increments
    `scope.invalidations` > 0

---

## Code-Review Follow-up (F3, F6, F7b)

### F3 — Forward-call reverse-dependency maps use real-cased keys

Added `resolve_callee_uri(my_call: ForwardCall): string` private helper in
`src/scope-resolver/index.ts` that mirrors `DependencyGraph.update_caller`:
1. `compute_forward_call_join(raw_path, path, working_directory)` → joined path
2. When `workspace_roots` are set: `resolve_path_rich(joined, {workspace_roots,
   fs})` → exact/case_only → `URI.file(outcome.path)`; ambiguous/missing →
   `URI.file(joined)`
3. When `workspace_roots` empty (early startup): `URI.file(my_call.path)`
   (no-change fallback, same as before)

Updated both `compute_call_edge_diff` (old/new grouping loops) and
`register_forward_call_relationships_from_cache` (callee_uri assignment) to call
`this.resolve_callee_uri(my_call)` instead of `URI.file(my_call.path).toString()`.

Added `compute_forward_call_join` and `get_workspace_root_for_path` to imports.

### F6 — Backward auto-severity pre-resolution removed

`emit_backward_case_mismatch` previously resolved `auto → 'warning'` and stamped
that on `DirectiveDiagnostic.severity`. For `path_case_mismatch` diagnostics,
`convert_directive_diagnostic` in `diagnostics.ts` ignores `.severity` entirely
and re-derives from the config setting + host probe. The pre-resolution was dead
and misleading. Fixed: removed the `if (auto) { effective_severity = 'warning' }
else { ... }` block; now unconditionally stamps `severity: 'warning'` with a
comment explaining it is a neutral placeholder only.

### F7b — compute_directive_real_path uses get_workspace_root_for_path

Replaced the inline deepest-containing-root loop (which used `'/'` normalization
instead of `path.sep`) with `get_workspace_root_for_path(this.workspace_roots,
my_outcome.path)`. The helper uses `path.sep` and `path.resolve` internally,
fixing the latent Windows bug. `get_workspace_root_for_path` imported alongside
the existing `get_workspace_root_for_uri`.

### New Tests (3 added to scope-resolver-forward-case-mismatch.test.ts)

- `(3.1)` `register_forward_call_relationships_from_cache`: case-only callee
  path registers under real-cased URI in `callee_to_callers`; wrong-cased URI
  absent. Verified via injected RichResolveFs + direct private-method call.
- `(3.2)` `update_reverse_dependencies`: same assertion for the open-document
  diff path. Verified via `get_callers_for_callee`.
- `(3.3)` End-to-end invalidation: scope cache entry for a caller whose
  `dependent_uris` includes the real-cased callee URI is evicted when
  `invalidate_scope_cache(real_callee_uri)` is called.

### Test results

59 pass / 0 fail across:
- `tests/unit/scope-resolver-backward-case-mismatch.test.ts`
- `tests/unit/scope-resolver-forward-case-mismatch.test.ts` (+3 new)
- `tests/unit/scope-resolver-cache.test.ts`
- `tests/integration/callee-change-caller-revalidation.test.ts`
- `tests/integration/callee-revalidation.test.ts`
- `tests/integration/cache-invalidation-symbol-resolution.test.ts`

`bun run typecheck` exits 0.

---

## CodeRabbit #216 Follow-up (Findings #4, #6, #9, #10)

### #6 — Backward directive registration skips `ambiguous` (3 sites)

Added `outcome_kind === 'ambiguous'` guard at all three consume sites in
`src/scope-resolver/index.ts`:

1. **Registration loop in `resolve()`** (~:986): `continue` before
   `register_backward_directive_dependency`.
2. **`follow_directives`** (~:1480): `continue` before computing
   `my_parent_uri`, cycle-check, WD discovery, and parent parse.
   `case_only` handling (emit diagnostic) is still reached for case-only
   paths; only `ambiguous` is skipped.
3. **`sync_backward_directive_dependencies`** (~:3065): `continue` before
   `register_backward_directive_dependency`.

Spec preserved: `exact` and `case_only` behavior unchanged; `missing`
behavior unchanged (pre-existing error path).

### #4 — `resolve_call_path_simple` returns `string | null`

Changed return type from `string` to `string | null`. Returns the real-cased
path for `exact`/`case_only`; returns `null` for `ambiguous` AND `missing`.

Updated caller `compute_effective_end_state_locals` to skip `get_callee_scope`
when `null` is returned (contributes nothing to end-state locals). This closes
the host-dependent masking gap: on a case-insensitive host `existsSync(requested)`
could succeed for an ambiguous path and read an arbitrary file.

Also updated `tests/unit/forward-scope-resolver-sort-order.test.ts`: the two
tests that mocked `resolve_call_path` (no longer the function called inside
`compute_effective_end_state_locals`) now mock `resolve_call_path_simple` with
the correct signature (`(raw: string): string | null => raw`).

### #9 — `@lsp-included-by` case-only test: assert parent connected

Added assertions to the existing test in
`tests/unit/scope-resolver-backward-case-mismatch.test.ts` (~:183):
- `parent_path` (previously declared but only compared textually in the message)
  is now used to check `result.chain` includes the parent entry.
- `result.symbols.localMacros.has('from_lib')` asserts the inherited local
  macro is visible.

### #10 — Ambiguous test: assert parent stays unresolved

Updated the ambiguous test (~:270) to trigger a true ambiguous outcome:
directive changed from `"helper.do"` (which matched exactly in the injected
listing, returning `exact`) to `"HELPER.do"` (no exact match → two CI matches
→ `ambiguous`). Added assertions:
- Neither `helper.do` nor `Helper.do` appears in `result.chain`.
- `result.symbols.globalMacros.has('a')` is `false`.

### Test Results

- **Focused suite** (4 case-mismatch test files): 33 pass, 0 fail
- **Full suite**: 6084 pass, 5 skip, 0 fail
- **Typecheck**: 0 errors

---

## Code-Review Follow-up (RD1, RD2)

### RD1 — Unify resolved-callee URI across diff path

**Problem**: `update_reverse_dependencies` violated the single-resolved-URI
invariant:
- OLD calls were re-resolved from the filesystem inside `compute_call_edge_diff`
  instead of using the stored `resolved_uri` from `last_forward_calls`. If the
  callee had been deleted or renamed, the re-resolve would produce the wrong-cased
  or unresolved URI, leaving a stale entry in the maps.
- NEW calls were resolved twice: once inside `compute_call_edge_diff` and once
  again when building `new_stored` for `last_forward_calls`.

**Fix** (`src/scope-resolver/index.ts`):

1. Changed `compute_call_edge_diff` signature to accept
   `Array<{call: ForwardCall; resolved_uri: string}>` for BOTH old and new
   entries (pre-resolved pairs). It no longer calls `resolve_callee_uri`
   internally.
2. In `update_reverse_dependencies`: precompute `new_stored` ONCE (calling
   `resolve_callee_uri` once per new call) BEFORE diffing; pass `old_stored`
   (from `last_forward_calls`) and `new_stored` to `compute_call_edge_diff`.
3. The same `new_stored` is written to `last_forward_calls` after diffing.
4. Map mutations (`caller_to_callees`, `callee_to_callers`) use URIs already
   present in the diff output — which came from the pre-resolved pairs — so the
   invariant is maintained end-to-end.

### RD2 — Style nit: `flipped_path` → `my_flipped_path`

**Fix** (`src/utils/file-path-utils.ts`, `check_case_sensitivity` function):
Renamed the loop-scoped variable `flipped_path` to `my_flipped_path` per
CLAUDE.md style rule (loop-scoped variables use `my_` prefix). No sibling
violations existed.

### New Test (RD1)

Added to `tests/unit/scope-resolver-forward-case-mismatch.test.ts` (describe
block `(3) M3`):

**"removing a case-only forward call via update_reverse_dependencies cleans up
maps using stored resolved URI (no re-resolve of old call)"**:
1. Registers a case-only forward call (`helpers/clean` → real `helpers/Clean.do`)
   via `update_reverse_dependencies` while the callee file exists.
2. Removes the callee from the injected FS (simulating deletion).
3. Calls `update_reverse_dependencies` with empty `new_forward_calls`.
4. Asserts that `callee_to_callers`, `caller_to_callees`, and `last_forward_calls`
   are all fully cleaned up with no stale entries under either the real-cased or
   wrong-cased URI.

### Test Results

- **Specified test suite**: 96 pass, 0 fail
- **Typecheck**: 0 errors
- **Full suite**: 6078 pass, 5 skip, 0 fail (563 files, 397 981 expect() calls)
- **Commit**: `1a3280a fix(scope-resolver): unify resolved-callee URI across diff path (maps + last_forward_calls) (#205)`
