# Scope-aware completion

**Status:** design
**Date:** 2026-04-19
**Scope:** Stop workspace local macros from leaking into Global-Mode completions, and mark out-of-scope workspace globals/programs/scalars/matrices distinctly so completions never silently suggest a symbol whose acceptance would trigger an undefined-symbol diagnostic.

## Problem

Opening `examples/demo/demo_completions.do` — a file with no cross-file directives and no auto-discovered parents — and typing ``di "`c`` returns completion items for local macros defined in unrelated workspace files (e.g., ``` ``custom_arg'`` ```, ``` ``cwd'`` ```, ``` ``country_name'`` ``` from `tests/fixtures/...`). Accepting any of them would insert an out-of-scope reference and the LSP would immediately emit an undefined-macro diagnostic.

Two defects are tangled together:

1. **Spec violation (local macros).** `CLAUDE.md` explicitly states, for Global Mode: *"Local macros are only visible from the current file."* In practice, `completion.ts:930–942` routes through `get_merged_symbols` → `build_merged_map` → `merge_symbol_tables` (`src/analyzer/index.ts:2974`), which unions every category including `localMacros`. So workspace local macros leak into file-scope completions.

2. **UX gap (globals/programs/scalars/matrices).** Even for symbol categories that *are* intended to be workspace-visible, a completion whose acceptance would trigger a diagnostic is presented identically to an in-scope completion. The user has no signal that picking it will produce a red squiggle.

Variables (dataset columns like `id`, `year`) are the documented exception: they are legitimately shared across unrelated analyses and should remain workspace-wide.

## Goals

- Local macros are never offered from workspace-indexed files in completion; only the current file (plus anything brought in through a resolved scope chain) contributes them.
- Global macros, programs, scalars, and matrices continue to be discoverable workspace-wide, but out-of-scope entries are visually distinct and ranked below every in-scope entry.
- Variable completion behavior is unchanged.
- No changes to diagnostics, go-to-definition, find-references, or the workspace-symbol panel. Those remain workspace-wide.

## Non-goals

- Auto-inserting `@lsp-do` / `@lsp-include` directives when the user accepts an out-of-scope entry. The resulting diagnostic is the user's cue; linking is a manual follow-up.
- A user-facing setting to opt back into the old behavior.
- Any change to the analyzer, scope resolver, or indexer.

## Target behavior

| Category | In scope | Out of scope (workspace) |
|---|---|---|
| Local macros | shown | **not shown** |
| Global macros, programs, scalars, matrices | shown at normal rank | shown, ranked last, `detail = "<kind> (out of scope — from <relative path>)"` |
| Variables | shown (workspace-wide, unchanged) | n/a |

"In scope" resolves as:

- **Resolved-Scope Mode** (file has directives or auto-discovered parents): the symbols returned by `get_visible_symbols_at(resolved_scope, position.line)`. That is, current file + scope-chain entries, call-site-filtered. No change to how this bag is computed today.
- **Global Mode** (no directives, no auto-parents): current file only.

For **local macros** specifically, scope is further narrowed by position within the current file: a local defined on a line strictly after the cursor is not in scope at the cursor. A Stata local is only visible on lines after its definition, so a completion offered from below the cursor would trigger an undefined-macro diagnostic if accepted. This position filter applies only to locals sourced from the current document; locals inherited from a parent file through an `include` chain are already call-site-filtered upstream by the scope resolver.

On accept of an out-of-scope entry, only the name is inserted (plus the existing closing-delimiter rules for `` `' `` / `${...}`). No `additionalTextEdits`, no command callback. The undefined-symbol diagnostic that follows is the intended UX signal.

## Design

All changes live in `src/providers/completion.ts`. No analyzer, scope-resolver, or indexer changes.

### Partition step

Introduce a private helper:

```ts
private partition_symbols_for_completion(
    document: DocumentState,
    workspace_symbols: SymbolTable | undefined,
    resolved_scope: ResolvedScope | undefined,
    in_scope_for_today: SymbolTable,
): { in_scope: SymbolTable; out_of_scope: SymbolTable }
```

- `in_scope` is exactly the `symbols_for_completion` produced by the existing branch logic at `completion.ts:902–948`. The shape of that computation is preserved, so every in-scope ranking, annotation, and deduplication behavior is unchanged.
- `out_of_scope` is built from `workspace_symbols` by:
  1. Dropping the current document's URI.
  2. Dropping every `(name, kind)` pair already present in `in_scope`. Same-name collisions resolve in favor of in-scope — the user sees the in-scope copy, not the out-of-scope duplicate.
  3. Forcing `localMacros` and `variables` to empty `Map`s. Locals are hidden entirely; variables keep their existing workspace-wide path through `get_variable_completions`, which reads `workspace_symbols` directly — the out-of-scope bag is not used for variables.

When `workspace_symbols` is undefined (tests, minimal setups), `out_of_scope` is an empty `SymbolTable` and behavior matches today's document-only path.

### Global-Mode local-macro leak fix

In the no-directives, no-auto-parents branch (`completion.ts:930–942`), the merged workspace bag is still useful for globals/programs/scalars/matrices and for variable completion, but it must not contribute `localMacros`. Two options, both acceptable:

- **(A)** After computing `merged_workspace_symbols`, overwrite `localMacros` with `document.symbols.localMacros` before it becomes `symbols_for_completion`.
- **(B)** Build `in_scope` separately for local macros (document only) and rely on the partition step's rule 3 to keep out-of-scope clean.

Implementation will use (A) for minimal diff.

### Completion producers

Three producers gain an `out_of_scope: SymbolTable` argument: `get_macro_completions` (handles locals and globals), `get_program_completions`, and `get_variable_completions` (which currently also loops over scalars and matrices at `completion.ts:1788–1866`). Within `get_variable_completions`, the variable loop is unchanged — it keeps reading workspace variables from the in-scope bag — and only the scalar and matrix loops read from `out_of_scope` for their out-of-scope pass.

Each producer:

- Iterates `in_scope` as today, producing items exactly as today.
- `get_macro_completions` with `scope === 'local'` **skips** the out-of-scope pass unconditionally.
- The variable loop in `get_variable_completions` **skips** the out-of-scope pass unconditionally (variables stay workspace-wide via the existing merged symbols path).
- For all other cases (global macros, programs, scalars, matrices), iterates the relevant map in `out_of_scope`, producing items with:
  - `label`: symbol name (unchanged).
  - `kind`: same `CompletionItemKind` as in-scope items for that category.
  - `detail`: `"<kind> (out of scope — from <relative path>)"`. The path is the symbol's `sourceUri` relativized against the workspace root if the provider has it, otherwise the file basename.
  - `documentation`: unchanged from the in-scope shape (value previews for macros, signatures for programs if present).
  - `textEdit.newText`: the name plus the existing closing-delimiter logic from `has_closing_delimiter`. No extra edits.
  - `sortText`: computed with a new ranking factor (see below).

### Ranking

`CompletionRankingFactors.directive_type` gains an `'out-of-scope'` value. `compute_ranking_key` composes `sortText` in this lexicographic order: `scope_depth` (primary key), `directive_type` (secondary), `symbol_type` (tertiary), then `parent_uri` and alphabetical `name` as final tie-breakers. The `'out-of-scope'` bucket is placed strictly after every existing `directive_type` bucket (i.e., after `'current'`, `'included-by'`, and `'done-by'`) within a given `scope_depth`. Effect:

- An in-scope global always sorts before an out-of-scope global — the `directive_type` secondary key (0 vs 3) separates them before `symbol_type` is consulted.
- An out-of-scope program never outranks an in-scope entry *of a different category* at the same `scope_depth` either, again because `directive_type` is the higher-order key: an in-scope local-macro (directive_type = 0) beats an out-of-scope program (directive_type = 3) even though the program's `symbol_type` bucket would otherwise precede the local's. Out-of-scope is last only within the `directive_type` position of a given `scope_depth`; `symbol_type` still orders entries inside the same bucket.
- `parent_uri` and alphabetical order continue to apply as later tie-breakers within the out-of-scope bucket — two out-of-scope globals from the same file sort alphabetically; across files, the existing `parent_uri` tie-break applies.

### Variable completion

Unchanged. `get_variable_completions` continues to read `workspace_symbols` directly, as documented in `CLAUDE.md`'s three-tier scoping model.

### Backtick trigger

The branch at `completion.ts:966–993` that fires on the `\`` trigger character and synthesizes a local-macro context passes through `get_macro_completions` with `scope='local'`. Per the rule above, it receives no out-of-scope entries. The existing quote-snippet additions are untouched.

### Program arguments

The in-program block at `completion.ts:1668` that injects program arguments is unchanged — program args are always in-scope by definition.

## Edge cases

- **Directive in place, call site filters a symbol out.** That symbol is already in `resolved_scope.out_of_scope_symbols` for the `after_call_site` / `inheritance_excludes_locals` reasons. Those entries are *not* promoted into the new out-of-scope bucket; the existing behavior (they simply don't appear in completion) is preserved. The new out-of-scope bucket is strictly for workspace symbols outside the resolved chain.
- **Forward-call symbols.** Already merged into `in_scope` via `visible_forward_overlay` before the partition runs. The partition's "drop duplicates" rule ensures they don't also appear as out-of-scope.
- **Same name, different kind, across files.** Partition compares `(name, kind)` pairs so a workspace `program foo` does not get filtered by an in-scope `global foo`.
- **Workspace indexer disabled.** `workspace_symbols` is undefined → `out_of_scope` is empty → only in-scope items appear, matching today's minimal-setup behavior.
- **Empty prefix (user opens completion with no characters typed).** Out-of-scope entries still appear but rank last, so they don't crowd in-scope items at the top of the list.

## Testing

Unit tests (`tests/unit/providers/`):

- Fresh file, no directives, workspace defines `local foo` in an unrelated file → `\`f` does not include `foo`.
- Fresh file, no directives, workspace defines `global foo_cfg` in an unrelated file → `$f` includes `foo_cfg`, ranked after every in-scope entry, with `detail` containing `(out of scope — from `.
- Fresh file with `do "helper.do"` where `helper.do` defines `global foo_cfg` → `$f` includes `foo_cfg` with normal in-scope detail (no out-of-scope label).
- Same-shape test for a workspace program name and for a workspace scalar.
- Workspace indexer absent → no out-of-scope entries appear.
- Program-argument injection still wins over any same-named out-of-scope entry.

Integration test (`tests/integration/`):

- Fixture mirroring `examples/demo/` layout: open `demo_completions.do`, type `di "\`c`, assert `color` is the only local-macro suggestion and that no fixtures from sibling directories leak in.

Regression:

- All existing completion tests pass unchanged. The in-scope code path is preserved byte-for-byte aside from the new `out_of_scope` argument threading.

## Rollout

No configuration flag. The behavior change is uniformly safer (nothing previously in-scope becomes hidden), so no opt-out is needed.
