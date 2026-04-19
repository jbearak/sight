# Workspace Symbol Search — Surface All Definitions Per Name

**Status:** Draft — awaiting user review
**Date:** 2026-04-19
**Related code:** `src/providers/symbols.ts`, `src/indexer/index.ts`, `src/server-handlers.ts`

## Problem

VS Code's "Go to Symbol in Workspace" (Cmd-T) returns only **one** entry per symbol name, even when the same variable, program, global, scalar, matrix, or local macro is defined in many files across the workspace.

Example: `cm_birth` is defined as a variable in over a dozen `.do` files (e.g.
`nsfg/bh_vars/birth_union_status.do`,
`dhs/bh_vars/cm_birth.do`,
`mics/bh_vars/cm_birth.do`, …) but Cmd-T shows only one of them.

### Root cause

The workspace indexer stores symbols per file in
`symbol_index: Map<string, { symbols: SymbolTable; … }>` — all definitions are
preserved here.

However, the workspace-symbol handler flattens them:

- `src/server-handlers.ts::create_workspace_symbol_handler` calls
  `workspace_indexer.get_all_symbols()`, which merges every file's
  `SymbolTable` into one flat table via `merge_symbol_tables()`.
- `SymbolTable` keys each symbol type by **name only** (e.g.
  `Map<string, VariableSymbol>`). The merge uses
  `new Map([...base, ...overlay])`, so when two files define the same name,
  the later file overwrites the earlier one. Last-def-wins.
- `src/providers/symbols.ts::get_workspace_symbols` iterates this merged
  table, producing one result per unique name.

The per-file data exists in the indexer. Only the Cmd-T result-building step
discards it.

## Goals

1. Cmd-T returns **one result per (name, file, symbol-type)** triple whose name
   matches the query (case-insensitive substring — current behavior).
2. All six symbol types are affected uniformly: variables, programs, global
   macros, local macros, scalars, matrices.
3. Fresh in-memory edits in open documents are reflected immediately
   (additions, deletions, renames), matching today's behavior for a single
   definition.
4. No change to completion, hover, diagnostics, analyzer, or any other caller
   of `get_all_symbols()`. Those keep their merged view.

## Non-goals

- Changing `SymbolTable`'s shape (stays `Map<string, T>` keyed by name).
- Ranking results by relevance, scope proximity, or dep-graph reachability.
  Cmd-T is a "I know the name, take me somewhere" tool; VS Code re-sorts
  client-side by fuzzy-match score. Ranking can be layered on later.
- Cursor-aware filtering (hiding definitions outside the active file's scope).
  Intentionally out of scope — users search globally for a reason.
- Fixing any latent issue with `get_all_symbols()` itself. Only the Cmd-T path
  changes.

## Design

### New indexer API

Add on `WorkspaceIndexer` (`src/indexer/index.ts`):

```typescript
find_all_symbol_definitions(query: string): WorkspaceSymbolMatch[]
```

Behavior:

- Iterates `this.symbol_index` entries (one per indexed file).
- For each file, scans each of the six symbol-type maps:
  `programs`, `globalMacros`, `localMacros`, `variables`, `scalars`,
  `matrices`.
- For every `[name, symbol]` pair whose `name.toLowerCase()` contains
  `query.toLowerCase()`, emits a `WorkspaceSymbolMatch`.
- Returns matches in iteration order (insertion order of `symbol_index`, then
  symbol-type order, then name order). VS Code re-sorts client-side, so no
  explicit sort needed.

### New type

Added in `src/types/index.ts` (near other workspace-index types):

```typescript
export type WorkspaceSymbolKind =
    | 'program'
    | 'global_macro'
    | 'local_macro'
    | 'variable'
    | 'scalar'
    | 'matrix';

export interface WorkspaceSymbolMatch {
    name: string;                       // symbol name (no backtick/quote decoration)
    kind: WorkspaceSymbolKind;          // used by provider to map to LSP SymbolKind + containerName
    uri: string;                        // source file URI
    range: Range;                       // definition range within the file
}
```

The provider maps `kind` to LSP `SymbolKind` and `containerName`
("Program", "Global Macro", "Local Macro", "Variable", "Scalar", "Matrix")
and, for local macros, wraps the name in backticks/apostrophes as the current
code does.

### Provider change

In `src/providers/symbols.ts`, change the third argument of
`get_workspace_symbols` from `workspace_symbols?: SymbolTable` to
`workspace_indexer?: WorkspaceIndexer`:

```typescript
get_workspace_symbols(
    query: string,
    all_documents: DocumentState[],
    workspace_indexer?: WorkspaceIndexer
): SymbolInformation[]
```

Implementation:

1. Build `the_open_document_uris` from `all_documents` (unchanged).
2. If `workspace_indexer` is present, call
   `workspace_indexer.find_all_symbol_definitions(query)`. For each match
   whose `uri` is **not** in `the_open_document_uris`, map it to
   `SymbolInformation` using the existing kind/containerName table.
3. Iterate `all_documents` and emit `SymbolInformation` entries for each
   open document's fresh symbols across all six types (today only local
   macros and variables are overlaid — broaden to match).
4. Return the combined list.

### Handler change

In `src/server-handlers.ts::create_workspace_symbol_handler`, replace the
`get_all_symbols()` call with the indexer reference:

```typescript
return deps.symbol_provider.get_workspace_symbols(
    params.query,
    deps.document_store.getAll(),
    deps.workspace_indexer     // pass the indexer directly
);
```

No other call sites of `get_all_symbols()` change.

## Data flow

1. VS Code sends `workspace/symbol` with query `"cm_birth"`.
2. `create_workspace_symbol_handler` passes the query, open documents, and the
   indexer to `symbol_provider.get_workspace_symbols`.
3. Provider calls `indexer.find_all_symbol_definitions("cm_birth")`.
4. Indexer returns `N` matches — one per (file, symbol-type) triple whose
   name matches.
5. Provider filters out entries whose `uri` belongs to an open document
   (handled fresh in step 6) and maps the rest to `SymbolInformation`.
6. Provider overlays fresh symbols from each open document across all six
   symbol types.
7. Handler returns the combined list to VS Code.

## Edge cases

- **Same name, same file, multiple symbol types** (e.g., variable `x` and
  scalar `x` in one file): both emitted with distinct `SymbolKind`.
- **Same name, same file, same symbol type, multiple definitions**: the
  per-file `SymbolTable` already holds first-def-wins; only one entry is
  emitted per (file, type). No change to within-file semantics.
- **Empty query**: preserve today's behavior (empty substring matches every
  name, current implementation returns everything; no intentional change).
- **Open-document overlay** for types the existing overlay skips (programs,
  globals, scalars, matrices): broadened so that adding/renaming/deleting a
  program in an open file is reflected immediately in Cmd-T, consistent with
  how variables and local macros already behave.
- **No indexer**: if `workspace_indexer` is `undefined` (test scenarios), only
  the open-document overlay runs. Same as today's "no workspace_symbols"
  path.
- **Local macro decoration**: preserved — Cmd-T shows `` `cm_birth' ``
  for local macros, as today.

## Testing

### Unit tests — indexer
New file `tests/unit/indexer/find-all-symbol-definitions.test.ts`:
- Two files each defining `cm_birth` as a variable → 2 matches with correct
  URIs and ranges.
- Substring query `"birth"` matches `cm_birth`, `cm_birth_lag`,
  `flag_cm_birth` across multiple files → every (name, file, type) triple
  returned.
- Case-insensitive: query `"CM_BIRTH"` matches `cm_birth`.
- Same name, different types in one file → 2 matches with distinct kinds.
- Empty query → returns all symbols.
- No matches → empty array.
- Local macros included.

### Unit tests — provider
Extend `tests/unit/providers/symbols-workspace.test.ts` (or equivalent):
- `get_workspace_symbols` with an indexer containing the same variable name
  in 3 files returns 3 `SymbolInformation` entries, one per file, each with
  the right `location.uri` and `containerName: 'Variable'`.
- Open-document overlay: an open document with a freshly added variable
  appears in results; a stale indexer entry for the same URI is suppressed.
- Overlay now covers programs, globals, scalars, matrices in addition to
  variables and local macros.

### Integration test
New or extended `tests/integration/workspace-symbol.test.ts`:
- Index a tmpdir with three files each defining `cm_birth` as a variable.
- Send `workspace/symbol` with query `"cm_birth"`.
- Assert 3 `SymbolInformation` results with distinct URIs.

### Regression
Run existing workspace-symbol and symbol-provider suites to confirm no change
for single-definition cases and no effect on completion/hover.

### Manual verification
Open `~/repos/sight` (or a fertility-surveys-style workspace) in VS Code,
press Cmd-T, type `cm_birth`, confirm all defining files (nsfg, dhs, mics,
enadid, …) appear as distinct entries.

## Changes summary

1. `src/types/index.ts` — add `WorkspaceSymbolKind` and
   `WorkspaceSymbolMatch`.
2. `src/indexer/index.ts` — add `find_all_symbol_definitions(query)`.
3. `src/providers/symbols.ts` — change `get_workspace_symbols`'s third
   argument type to `WorkspaceIndexer`; delegate workspace lookup to the new
   indexer method; broaden open-document overlay to all six symbol types.
4. `src/server-handlers.ts` — pass `deps.workspace_indexer` through instead
   of `get_all_symbols()`.
5. New + extended tests per the Testing section.
