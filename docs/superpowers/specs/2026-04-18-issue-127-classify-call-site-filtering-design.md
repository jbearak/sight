# Issue #127 — Call-site filtering in find-references classifier

**Status:** design approved, implementation pending
**Date:** 2026-04-18
**GitHub issue:** [#127](https://github.com/jbearak/sight/issues/127)
**Scope:** narrow — fix `ReferencesProvider.classify_word_symbol` only; open a follow-up issue for the broader architectural pattern.

## Problem

`src/providers/references.ts` classifies a `WORD` token as a program, scalar, or matrix whenever `workspace_indexer.find_symbol_definitions(word, kind)` returns any hit whose source URI is in `workspace_indexer.get_related_uris(document.uri)` — i.e., any file reachable through the dependency graph, regardless of whether the cursor has passed the `do`/`include` that would bring that file into scope.

Example:

```stata
shared_prog
do "defs.do"
```

At cursor position line 0, `defs.do` has not run yet, so `shared_prog` is not a program in scope. Today the classifier returns `{ type: 'program' }` anyway, because `defs.do` contributes a matching definition through the dependency graph.

The practical user-visible wrongness today is narrow: find-references still routes the search by kind and pools matches across related files, which is usually what the user wants. The classifier's only genuinely wrong behavior is when two different programs in *unrelated branches* of the dependency graph share a name — find-refs then pools matches from both.

The same underlying defect has bigger user impact for go-to-definition (jumps to wrong def) and diagnostics (fails to suppress / misclassifies warnings). Those belong to the follow-up issue (see below).

## Goal

Make `classify_word_symbol` respect the same "visible at cursor position" rule that completion and hover already honor:

- Backward-directive chain (`done-by` / `included-by`, auto or explicit) is always in scope inside the current file.
- Forward calls (`do` / `run` / `include` in the current file, and transitively through those) are in scope only when `call_site.call_line < cursor.line`.
- Variables remain workspace-wide (dataset columns are legitimately shared across unrelated modules).

## Non-goals

Left for the follow-up issue, not addressed by this change:

- `find_definitions` in `references.ts` still uses `get_related_uris` without call-site filtering (used by the `includeDeclaration` path).
- `definition.ts::resolve_non_macro_symbols` never consults `forward_call_symbols` at all; it short-circuits to `workspace_indexer.find_symbol_definitions`, which has no cursor-ordering filter.
- Diagnostics audit for the same pattern.
- Extracting a shared helper to consolidate the ≈8 duplicated instances of the filter (see the audit in the follow-up issue section for the exact count).

## Architecture

Inject `ScopeResolver` into `ReferencesProvider` (optional, backward-compatible). When present, `classify_word_symbol` resolves the document's `ResolvedScope` and consults two sources:

1. **Backward chain** — `resolved_scope.symbols` already merges the current file with every parent reachable via backward directives. These are in scope at any cursor position inside the current file.
2. **Forward calls before cursor** — `resolved_scope.forward_call_symbols: ForwardCallSite[]` filtered to `site.call_line < cursor.line`. Each site's `symbols.programs` / `.scalars` / `.matrices` is then checked. Transitive nested call sites already carry the parent's call line, so the filter is correct without a recursive walk.

Variables stay on their current path: check `resolved_scope.symbols.variables` first, fall back to the workspace-wide `workspace_indexer.find_symbol_definitions(word, 'variable')` (no related-URI filter).

**Fallback when `scope_resolver` is absent:** preserve the current body of `classify_word_symbol` verbatim. Production always wires `scope_resolver` (`src/server-factory.ts:862`), so the fallback is test-only; new tests for the fix explicitly wire `scope_resolver`.

**Async cascade:** `classify_word_symbol` → `identify_symbol_at_position` → `get_references` / `get_macro_references_only`. All three callers are already `async`; the cascade is trivial `await` propagation.

**Caching:** `ScopeResolver.resolve` is memoized on `(uri, content_hash, config)`. Repeat find-refs requests on the same buffer hit the cache — no extra I/O.

## Concrete changes

### `src/providers/references.ts`

- Add private field `scope_resolver?: ScopeResolver` and a constructor parameter accepting it. Zero-arg construction preserved.
- `classify_word_symbol` becomes `async`. Its existing `range: Range` parameter already carries `range.start.line`, which is the cursor line — no new parameter needed. Returns `Promise<IdentifiedSymbol | null>`.
- When `scope_resolver` is present:
  - Keep the macro-declaration pre-check (lines 498–505) sync, against `document.symbols`.
  - Resolve the scope. Check `resolved_scope.symbols.programs.has(word)` → scalars → matrices → variables.
  - If no match on `resolved_scope.symbols`, iterate `resolved_scope.forward_call_symbols?.filter(s => s.call_line < cursor_line)`; check each site's `symbols.programs` / `.scalars` / `.matrices`.
  - Variables get the workspace-wide fallback (`has_cross_file_any('variable')`) if the resolved-scope variable lookup misses.
- When `scope_resolver` is absent: execute the current body of `classify_word_symbol` unchanged.
- `identify_symbol_at_position` becomes `async`; the WORD branch `await`s `classify_word_symbol`.
- `get_references` and `get_macro_references_only` add `await` where they call `identify_symbol_at_position`.
- `get_references` gains an optional `cross_file_config?: Partial<ScopeResolverConfig>` parameter, mirroring `DefinitionProvider.get_definition`.

### `src/server-handlers.ts`

- `create_references_handler` calls `deps.get_document_settings(uri)` and builds a partial `ScopeResolverConfig` (`assume_call_site`, `backward_dependencies`, `max_forward_depth`) exactly the way `create_definition_handler` already does at lines 463–476, then passes that object to `get_references`.

### `src/server-factory.ts`

- Reorder initialization so `scope_resolver` is created before `references_provider`, then construct `references_provider = new ReferencesProvider(scope_resolver)`. Constructor injection is preferred over a late setter because `ReferencesProvider` has no other delayed-wiring needs and it avoids a window where the provider exists but the dependency is missing.

### No changes to

`ScopeResolver`, `ForwardScopeResolver`, `WorkspaceIndexer`, `DependencyGraph`, `collect_references`'s workspace scan, `find_definitions`, or the include-declaration logic. The issue explicitly says pooling refs across related files after classification is the desired behavior.

## Test plan

New integration test file `tests/integration/find-references-call-site-scope.test.ts`. Integration-style because the fix depends on a fully wired pipeline (`DocumentStore` + `WorkspaceIndexer` + `DependencyGraph` + `ScopeResolver` + `ForwardScopeResolver`).

A local setup helper wires the pipeline the same way `server-factory.ts` does: file-reading callbacks that prefer open-buffer content over disk, dependency graph attached to the indexer, forward scope resolver attached to the scope resolver.

Scenarios:

1. **Regression — forward call before definition.** `main.do`: `shared_prog\ndo "defs.do"`. `defs.do` defines `shared_prog`. Cursor on line 0 of main. Assert the returned locations do not include `defs.do` refs (classifier did not return program).
2. **Positive — cursor after forward call.** Same files, plus a second `shared_prog` on line 2 of main. Cursor on line 2. Assert `defs.do` refs are included.
3. **Backward directive — always in scope.** `main.do` defines `shared_prog` then does `child.do`. `child.do`'s header has `@lsp-done-by: "main.do"`; `child.do` references `shared_prog` on a non-line-0 row. Cursor on the child reference. Assert refs across the chain are pooled.
4. **Unrelated branches with same-named programs.** Root `main.do` does `branch_a.do` then `branch_b.do`. Both branches define `common_helper`. Cursor on `common_helper` written before the `do "branch_a.do"` line in main. Assert no program refs pooled (nothing is in scope yet).
5. **Transitive forward call.** `main.do` does `mid.do` at line 5; `mid.do` does `leaf.do` at line 3; `leaf.do` defines `deep_prog`. Cursor in `main.do` at line 10 references `deep_prog` — assert refs from `leaf.do` pooled. Cursor at line 2 — assert not pooled.
6. **Scope-resolver-absent fallback.** `new ReferencesProvider()` with no scope resolver. One case pins the pre-fix behavior so test-only setups don't regress.

Each scenario asserts both that the expected refs are present and that unexpected cross-file refs are absent, so "classifier said program" vs "classifier said nothing" is distinguishable from the `Location[]` return.

Not included (declined during brainstorming):
- Unit test for the private `classify_word_symbol` directly.
- Property test — the `forward_call_symbols` filtering invariant is already property-tested elsewhere.
- Benchmark — `scope_resolver.resolve` is cached; no expected perf delta.

## Follow-up issue

Opened as a separate GitHub issue at the end of this work, titled roughly _"Unify 'symbols visible at cursor position' across providers (audit + plan)"_.

Contents:

**Problem statement.** The rule "symbols from a forward call are visible only after the call line; backward-directive parents are always visible" is implemented ad-hoc and inconsistently across providers. `ForwardScopeResolver.get_symbols_at_line` already encodes this rule but is not used by any provider.

**Audit of current state** (as of the commit that lands #127's narrow fix):

- `completion.ts`: filters `forward_call_symbols` by `call_site.call_line < position.line` in 5 places (approx lines 74 — inside a file-local `get_visible_forward_call_sites` helper — and 1148, 1755, 2068, 2329 as inline checks that don't use the helper).
- `hover.ts`: same filter, 1 place (approx line 486).
- `diagnostics.ts`: `call_site.call_line < diag_line`, 1 place (approx line 310).
- `definition.ts::resolve_non_macro_symbols`: consults `resolved_scope.symbols` only — never `forward_call_symbols`. WORD tokens referring to a program defined in a forward-called child cannot resolve via scope-resolver; they fall through to `workspace_indexer.find_symbol_definitions`, which has no cursor-ordering filter and can jump to the wrong definition across unrelated branches. This is the "bigger user impact" variant the #127 report flagged.
- `references.ts` post-fix: `classify_word_symbol` uses the filter correctly; `find_definitions` (used for `includeDeclaration`) still uses `get_related_uris` without call-site filtering.
- `ForwardScopeResolver.get_symbols_at_line`: exists, tested, not used by any provider.

**Gaps made explicit:**

1. `definition.ts` has the most user-visible version of this bug.
2. `references.ts::find_definitions` is the leftover tail of #127's intentionally narrow scope.
3. The filter is duplicated across ≈8 sites (5 in `completion.ts` — one helper plus four inline; 1 in `hover.ts`; 1 in `diagnostics.ts`; 1 new in `references.ts` after the #127 narrow fix). A shared helper or view object would remove the drift surface.

**Out of scope for the follow-up issue:** solution design. A future brainstorm decides whether to consolidate via a helper function, a `ResolvedScopeView` wrapper, or by adopting `ForwardScopeResolver.get_symbols_at_line` in-place.
