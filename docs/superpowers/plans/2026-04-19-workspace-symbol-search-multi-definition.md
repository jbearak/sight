# Workspace Symbol Search Multi-Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VS Code's Cmd-T "Go to Symbol in Workspace" return one entry per (name, file, symbol-type) triple — so a variable like `cm_birth` defined in 15 files shows 15 distinct Cmd-T results — instead of collapsing all definitions of the same name into a single last-wins entry.

**Architecture:** Add a new indexer method `find_all_symbol_definitions(query)` that iterates the per-file `symbol_index` (which already preserves all definitions) and emits one match per (name, file, type) triple. Introduce a tiny `WorkspaceSymbolSource` interface so the provider can accept either the real indexer or a test stub. The provider's `get_workspace_symbols` stops consuming a merged `SymbolTable` and instead delegates to the source interface, then overlays fresh symbols from open documents across all six symbol types (programs, globals, locals, variables, scalars, matrices).

**Tech Stack:** TypeScript, Bun (runtime + test runner), `vscode-languageserver` types.

**Source spec:** `docs/superpowers/specs/2026-04-19-workspace-symbol-search-multi-definition-design.md`.

---

## File Structure

**Created:**
- `tests/unit/indexer/find-all-symbol-definitions.test.ts` — unit tests for the new indexer method.
- `tests/integration/workspace-symbol-multi-definition.test.ts` — end-to-end test through `workspace/symbol`.

**Modified:**
- `src/types/index.ts` — add `WorkspaceSymbolKind`, `WorkspaceSymbolMatch`, `WorkspaceSymbolSource` types.
- `src/indexer/index.ts` — add `find_all_symbol_definitions(query)` method on `WorkspaceIndexer`.
- `src/providers/symbols.ts` — change `get_workspace_symbols`'s third parameter to `WorkspaceSymbolSource | undefined`; rewrite body to iterate matches from the source and overlay all six open-document symbol types.
- `src/server-handlers.ts` — pass `deps.workspace_indexer` instead of `deps.workspace_indexer.get_all_symbols()` to the provider.
- `tests/unit/symbols.test.ts` — update `Workspace Index Symbol Types` block to build `WorkspaceSymbolSource` stubs instead of `SymbolTable`s, and add new tests for multi-definition behavior and cross-type overlay.

No other files are affected — completion, hover, diagnostics, analyzer, scope resolvers keep their merged-view path via `get_all_symbols()`, which is untouched.

---

## Task 1: Add new types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add new types at an appropriate location near other workspace/indexer-facing types**

Open `src/types/index.ts` and add these exports. Keep them grouped together; near existing workspace-index types (e.g., `IndexerMetrics`, `SymbolTable`) is fine. Import `Range` from `vscode-languageserver-textdocument` if it's not already imported in this file; otherwise reuse the existing import.

```typescript
/**
 * One concrete definition of a workspace symbol, tied to a specific file.
 * Used by workspace-symbol search so multiple definitions of the same name
 * across files each get their own entry.
 */
export type WorkspaceSymbolKind =
    | 'program'
    | 'global_macro'
    | 'local_macro'
    | 'variable'
    | 'scalar'
    | 'matrix';

export interface WorkspaceSymbolMatch {
    name: string;              // raw name — no backtick/apostrophe decoration
    kind: WorkspaceSymbolKind;
    uri: string;
    range: Range;
}

/**
 * Minimal interface a workspace-symbol search source must satisfy.
 * The real `WorkspaceIndexer` implements this; tests can supply a stub.
 */
export interface WorkspaceSymbolSource {
    find_all_symbol_definitions(query: string): WorkspaceSymbolMatch[];
}
```

- [ ] **Step 2: Run typecheck to verify the new types compile**

Run: `bun run typecheck`
Expected: PASS (these are additions; nothing should break yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add WorkspaceSymbolMatch and WorkspaceSymbolSource types"
```

---

## Task 2: Indexer — failing test for `find_all_symbol_definitions`

**Files:**
- Create: `tests/unit/indexer/find-all-symbol-definitions.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

Note: we can't easily construct a fully-populated `WorkspaceIndexer` without files on disk, but we can drive it via its public indexing API. The indexer's `index_file` / `index_workspace` APIs read files. For unit tests, prefer constructing an indexer instance and directly seeding the private `symbol_index` via a test-friendly helper if one exists — otherwise, fall back to writing tmpdir files and invoking the indexer's workspace-scan API. Inspect `src/indexer/index.ts` to pick the right entry point. The pattern below assumes a `new WorkspaceIndexer()` with an `index_file(uri, content)` or equivalent method; adjust to the actual API.

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { WorkspaceIndexer } from '../../../src/indexer';

describe('WorkspaceIndexer.find_all_symbol_definitions', () => {
    let the_indexer: WorkspaceIndexer;

    beforeEach(() => {
        the_indexer = new WorkspaceIndexer();
    });

    function index_source(uri: string, content: string) {
        // Use whatever in-memory indexing entry the indexer exposes.
        // If no direct API exists, seed the index via a test helper or
        // write to tmpdir + call the workspace scan API.
        (the_indexer as any).index_document(uri, content);
    }

    it('returns one match per file when same variable name appears in multiple files', () => {
        index_source('file:///ws/a.do', 'gen cm_birth = 1');
        index_source('file:///ws/b.do', 'gen cm_birth = 2');
        index_source('file:///ws/c.do', 'gen cm_birth = 3');

        const the_matches = the_indexer.find_all_symbol_definitions('cm_birth');
        const the_uris = the_matches
            .filter(m => m.name === 'cm_birth' && m.kind === 'variable')
            .map(m => m.uri)
            .sort();

        expect(the_uris).toEqual([
            'file:///ws/a.do',
            'file:///ws/b.do',
            'file:///ws/c.do',
        ]);
    });

    it('matches by case-insensitive substring', () => {
        index_source('file:///ws/a.do', 'gen cm_birth = 1');
        index_source('file:///ws/b.do', 'gen cm_birth_lag = 2');

        const the_matches = the_indexer.find_all_symbol_definitions('BIRTH');
        const the_names = the_matches
            .filter(m => m.kind === 'variable')
            .map(m => m.name)
            .sort();

        expect(the_names).toEqual(['cm_birth', 'cm_birth_lag']);
    });

    it('returns distinct entries when same name appears as different symbol types in one file', () => {
        index_source(
            'file:///ws/a.do',
            [
                'scalar x = 1',
                'gen x = 2',
            ].join('\n')
        );

        const the_matches = the_indexer.find_all_symbol_definitions('x');
        const the_kinds = the_matches
            .filter(m => m.name === 'x' && m.uri === 'file:///ws/a.do')
            .map(m => m.kind)
            .sort();

        expect(the_kinds).toContain('variable');
        expect(the_kinds).toContain('scalar');
    });

    it('returns empty array when no names match', () => {
        index_source('file:///ws/a.do', 'gen cm_birth = 1');

        const the_matches = the_indexer.find_all_symbol_definitions('zzz_no_match');

        expect(the_matches).toEqual([]);
    });

    it('includes local macros', () => {
        index_source('file:///ws/a.do', 'local my_local = 1');
        index_source('file:///ws/b.do', 'local my_local = 2');

        const the_matches = the_indexer.find_all_symbol_definitions('my_local');
        const the_local_matches = the_matches.filter(
            m => m.kind === 'local_macro' && m.name === 'my_local'
        );

        expect(the_local_matches.length).toBe(2);
        expect(the_local_matches.map(m => m.uri).sort()).toEqual([
            'file:///ws/a.do',
            'file:///ws/b.do',
        ]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/indexer/find-all-symbol-definitions.test.ts`
Expected: FAIL with `the_indexer.find_all_symbol_definitions is not a function` (or similar — the method doesn't exist yet). If it fails earlier because `(the_indexer as any).index_document` doesn't exist, inspect the indexer's public API and substitute the correct entry point (e.g., `index_file`, or whatever reads an in-memory buffer). Do not fake the indexer — it must really index.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/indexer/find-all-symbol-definitions.test.ts
git commit -m "Add failing tests for find_all_symbol_definitions"
```

---

## Task 3: Indexer — implement `find_all_symbol_definitions`

**Files:**
- Modify: `src/indexer/index.ts`

- [ ] **Step 1: Add the method near `find_symbol_definitions`**

Open `src/indexer/index.ts`. Just below the existing `find_symbol_definitions` method (around line 777), add:

```typescript
/**
 * Find every symbol definition in the workspace whose name matches the
 * (case-insensitive substring) query. Unlike `find_symbol_definitions`,
 * which requires an exact name and returns symbols of unspecified
 * provenance, this method emits one entry per (file, symbol-type) triple
 * — so a variable defined in 15 files produces 15 matches.
 *
 * Used by the LSP `workspace/symbol` handler (Cmd-T in VS Code).
 */
find_all_symbol_definitions(query: string): WorkspaceSymbolMatch[] {
    const the_matches: WorkspaceSymbolMatch[] = [];
    const lower_query = query.toLowerCase();

    for (const [file_uri, entry] of this.symbol_index.entries()) {
        const my_symbols = entry.symbols;

        for (const [name, program] of my_symbols.programs) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'program',
                    uri: file_uri,
                    range: program.location.range,
                });
            }
        }

        for (const [name, macro] of my_symbols.globalMacros) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'global_macro',
                    uri: file_uri,
                    range: macro.location.range,
                });
            }
        }

        for (const [name, macro] of my_symbols.localMacros) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'local_macro',
                    uri: file_uri,
                    range: macro.location.range,
                });
            }
        }

        for (const [name, variable] of my_symbols.variables) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'variable',
                    uri: file_uri,
                    range: variable.location.range,
                });
            }
        }

        for (const [name, scalar] of my_symbols.scalars) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'scalar',
                    uri: file_uri,
                    range: scalar.location.range,
                });
            }
        }

        for (const [name, matrix] of my_symbols.matrices) {
            if (name.toLowerCase().includes(lower_query)) {
                the_matches.push({
                    name,
                    kind: 'matrix',
                    uri: file_uri,
                    range: matrix.location.range,
                });
            }
        }
    }

    return the_matches;
}
```

Ensure `WorkspaceSymbolMatch` is imported at the top of the file. Add to the existing `import { … } from '../types';` block.

- [ ] **Step 2: Run the Task 2 tests and verify they pass**

Run: `bun test tests/unit/indexer/find-all-symbol-definitions.test.ts`
Expected: PASS (all 5 test cases green).

If any test fails because the indexer's public indexing API differs from what Task 2 assumed, fix the test to call the real API (do not modify the indexer's entry points just to match the test).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/indexer/index.ts
git commit -m "Implement WorkspaceIndexer.find_all_symbol_definitions"
```

---

## Task 4: Provider — failing tests for multi-definition + cross-type overlay

**Files:**
- Modify: `tests/unit/symbols.test.ts`

- [ ] **Step 1: Add new tests inside the existing `Workspace Index Symbol Types` describe block (or a new sibling block)**

At the end of `tests/unit/symbols.test.ts`, add:

```typescript
import type {
    WorkspaceSymbolMatch,
    WorkspaceSymbolSource,
} from '../../src/types';

function build_source(matches: WorkspaceSymbolMatch[]): WorkspaceSymbolSource {
    return {
        find_all_symbol_definitions: (query: string) => {
            const lower = query.toLowerCase();
            return matches.filter(m => m.name.toLowerCase().includes(lower));
        },
    };
}

describe('Workspace Symbol Search — multi-definition', () => {
    let symbol_provider: SymbolProvider;

    beforeEach(() => {
        symbol_provider = new SymbolProvider();
    });

    it('returns one SymbolInformation per file when a variable is defined in many files', () => {
        const the_source = build_source([
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/nsfg/a.do',
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/dhs/b.do',
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/mics/c.do',
                range: { start: { line: 3, character: 0 }, end: { line: 3, character: 8 } },
            },
        ]);

        const my_symbols = symbol_provider.get_workspace_symbols(
            'cm_birth',
            [],
            the_source
        );

        const the_uris = my_symbols.map(s => s.location.uri).sort();
        expect(the_uris).toEqual([
            'file:///ws/dhs/b.do',
            'file:///ws/mics/c.do',
            'file:///ws/nsfg/a.do',
        ]);
        for (const sym of my_symbols) {
            expect(sym.name).toBe('cm_birth');
            expect(sym.containerName).toBe('Variable');
            expect(sym.kind).toBe(SymbolKind.Field);
        }
    });

    it('suppresses source entries for URIs that are open documents, and overlays fresh symbols', () => {
        const the_open_uri = 'file:///ws/open.do';
        const the_source = build_source([
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: the_open_uri,
                range: { start: { line: 99, character: 0 }, end: { line: 99, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/dhs/b.do',
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
            },
        ]);

        const the_fresh_document: any = {
            uri: the_open_uri,
            ast: null,
            symbols: {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    [
                        'cm_birth',
                        {
                            name: 'cm_birth',
                            sourceUri: the_open_uri,
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 5, character: 0 },
                                    end: { line: 5, character: 8 },
                                },
                            },
                        },
                    ],
                ]),
                scalars: new Map(),
                matrices: new Map(),
            },
        };

        const my_symbols = symbol_provider.get_workspace_symbols(
            'cm_birth',
            [the_fresh_document],
            the_source
        );

        const the_open_entries = my_symbols.filter(s => s.location.uri === the_open_uri);
        expect(the_open_entries.length).toBe(1);
        expect(the_open_entries[0].location.range.start.line).toBe(5);

        const the_other_entries = my_symbols.filter(s => s.location.uri !== the_open_uri);
        expect(the_other_entries.length).toBe(1);
        expect(the_other_entries[0].location.uri).toBe('file:///ws/dhs/b.do');
    });

    it('overlays open-document programs, globals, scalars, and matrices (not just locals and variables)', () => {
        const the_open_uri = 'file:///ws/open.do';
        const the_source = build_source([]);

        const the_fresh_document: any = {
            uri: the_open_uri,
            ast: null,
            symbols: {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: the_open_uri,
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 1, character: 0 },
                                    end: { line: 1, character: 7 },
                                },
                            },
                        },
                    ],
                ]),
                localMacros: new Map(),
                globalMacros: new Map([
                    [
                        'my_glob',
                        {
                            name: 'my_glob',
                            sourceUri: the_open_uri,
                            scope: 'global',
                            value: '',
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 2, character: 0 },
                                    end: { line: 2, character: 7 },
                                },
                            },
                        },
                    ],
                ]),
                variables: new Map(),
                scalars: new Map([
                    [
                        'my_scalar',
                        {
                            name: 'my_scalar',
                            sourceUri: the_open_uri,
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 3, character: 0 },
                                    end: { line: 3, character: 9 },
                                },
                            },
                        },
                    ],
                ]),
                matrices: new Map([
                    [
                        'my_mat',
                        {
                            name: 'my_mat',
                            sourceUri: the_open_uri,
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 4, character: 0 },
                                    end: { line: 4, character: 6 },
                                },
                            },
                        },
                    ],
                ]),
            },
        };

        const the_queries = ['my_prog', 'my_glob', 'my_scalar', 'my_mat'];
        for (const q of the_queries) {
            const my_symbols = symbol_provider.get_workspace_symbols(
                q,
                [the_fresh_document],
                the_source
            );
            expect(my_symbols.some(s => s.location.uri === the_open_uri)).toBe(true);
        }
    });
});
```

- [ ] **Step 2: Update existing `Workspace Index Symbol Types` tests to use `WorkspaceSymbolSource`**

The existing tests in this describe block currently pass a `SymbolTable` as the third argument to `get_workspace_symbols`. After Task 5 the third argument will be a `WorkspaceSymbolSource`. Pre-adapt them now so Task 5 doesn't mix concerns.

Replace the local `create_workspace_symbols(...)` helper with a builder that returns a `WorkspaceSymbolSource`. For each existing test:

1. Keep the existing `SymbolTable` literal (useful to read).
2. Translate it to an array of `WorkspaceSymbolMatch` and wrap it in a `WorkspaceSymbolSource` stub.
3. Pass that stub as the third argument.

Example translation for the existing "should include variables from workspace_symbols in results" test:

```typescript
const the_source = build_source([
    {
        name: 'myvar',
        kind: 'variable',
        uri: 'file:///workspace/data.do',
        range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 10 },
        },
    },
]);

const my_symbols = symbol_provider.get_workspace_symbols('myvar', [], the_source);
```

Do the same for the scalars, matrices, and local-macro tests in the same block. The assertions (`kind`, `containerName`, `location.uri`) stay identical. Remove the old `create_workspace_symbols` helper once it has no callers.

- [ ] **Step 3: Run the updated tests to verify they fail**

Run: `bun test tests/unit/symbols.test.ts`
Expected: FAIL — `get_workspace_symbols` still expects a `SymbolTable`, so either TypeScript complains or runtime behavior is wrong. This confirms the tests are pointed at the new contract.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/symbols.test.ts
git commit -m "Add failing tests for multi-definition workspace symbol search"
```

---

## Task 5: Provider — implement new behavior

**Files:**
- Modify: `src/providers/symbols.ts`

- [ ] **Step 1: Update the type import block**

At the top of `src/providers/symbols.ts`, extend the type import from `../types`:

```typescript
import {
    SymbolTable,
    StataNode,
    EmbeddedLanguageBlockNode,
    WorkspaceSymbolMatch,
    WorkspaceSymbolSource,
} from '../types';
```

- [ ] **Step 2: Replace the body of `get_workspace_symbols`**

Replace the entire existing `get_workspace_symbols` method (currently around lines 662–835) with the following. The JSDoc may reuse the existing comment block; adjust the `@param` line to match the new signature.

```typescript
/**
 * Return workspace-wide symbols that match the query (case-insensitive
 * substring). Emits one SymbolInformation per (name, file, symbol-type)
 * triple so that the same name defined in many files surfaces as many
 * entries in VS Code's Cmd-T picker. Symbols from currently-open
 * documents come from those documents' fresh in-memory symbol tables so
 * unsaved edits are reflected immediately.
 */
get_workspace_symbols(
    query: string,
    all_documents: DocumentState[],
    workspace_source?: WorkspaceSymbolSource
): SymbolInformation[] {
    const symbols: SymbolInformation[] = [];
    const lower_query = query.toLowerCase();

    const the_open_document_uris = new Set(
        all_documents.map((my_document) => my_document.uri)
    );

    // 1. Matches from the workspace index (excluding anything for open URIs —
    //    those are re-emitted from fresh in-memory symbols in step 2).
    if (workspace_source) {
        const the_matches = workspace_source.find_all_symbol_definitions(query);
        for (const my_match of the_matches) {
            if (the_open_document_uris.has(my_match.uri)) continue;
            symbols.push(this.match_to_symbol_information(my_match));
        }
    }

    // 2. Fresh symbols from open documents — all six symbol types + embedded blocks.
    for (const document of all_documents) {
        for (const [name, program] of document.symbols.programs) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name,
                    kind: SymbolKind.Function,
                    location: { uri: program.sourceUri, range: program.location.range },
                    containerName: `Program in ${path.basename(document.uri)}`,
                });
            }
        }

        for (const [name, macro] of document.symbols.globalMacros) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name,
                    kind: SymbolKind.Variable,
                    location: { uri: macro.sourceUri, range: macro.location.range },
                    containerName: `Global Macro in ${path.basename(document.uri)}`,
                });
            }
        }

        for (const [name, macro] of document.symbols.localMacros) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name: `\`${name}'`,
                    kind: SymbolKind.Variable,
                    location: { uri: macro.sourceUri, range: macro.location.range },
                    containerName: `Local Macro in ${path.basename(document.uri)}`,
                });
            }
        }

        for (const [name, variable] of document.symbols.variables) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name,
                    kind: SymbolKind.Field,
                    location: { uri: variable.sourceUri, range: variable.location.range },
                    containerName: `Variable in ${path.basename(document.uri)}`,
                });
            }
        }

        for (const [name, scalar] of document.symbols.scalars) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name,
                    kind: SymbolKind.Variable,
                    location: { uri: scalar.sourceUri, range: scalar.location.range },
                    containerName: `Scalar in ${path.basename(document.uri)}`,
                });
            }
        }

        for (const [name, matrix] of document.symbols.matrices) {
            if (name.toLowerCase().includes(lower_query)) {
                symbols.push({
                    name,
                    kind: SymbolKind.Variable,
                    location: { uri: matrix.sourceUri, range: matrix.location.range },
                    containerName: `Matrix in ${path.basename(document.uri)}`,
                });
            }
        }

        // Embedded language blocks (unchanged behavior from pre-refactor)
        if (document.ast) {
            const the_embedded_blocks = this.extract_embedded_blocks(document.ast.nodes);
            for (const my_block of the_embedded_blocks) {
                const my_language_label =
                    my_block.language === 'mata' ? 'Mata Block' : 'Python Block';
                if (my_language_label.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_language_label,
                        kind: SymbolKind.Module,
                        location: { uri: document.uri, range: my_block.range },
                        containerName: `Embedded Language in ${path.basename(document.uri)}`,
                    });
                }
            }
        }
    }

    return symbols;
}

/**
 * Map a WorkspaceSymbolMatch to a VS Code SymbolInformation entry.
 */
private match_to_symbol_information(match: WorkspaceSymbolMatch): SymbolInformation {
    switch (match.kind) {
        case 'program':
            return {
                name: match.name,
                kind: SymbolKind.Function,
                location: { uri: match.uri, range: match.range },
                containerName: 'Program',
            };
        case 'global_macro':
            return {
                name: match.name,
                kind: SymbolKind.Variable,
                location: { uri: match.uri, range: match.range },
                containerName: 'Global Macro',
            };
        case 'local_macro':
            return {
                name: `\`${match.name}'`,
                kind: SymbolKind.Variable,
                location: { uri: match.uri, range: match.range },
                containerName: 'Local Macro',
            };
        case 'variable':
            return {
                name: match.name,
                kind: SymbolKind.Field,
                location: { uri: match.uri, range: match.range },
                containerName: 'Variable',
            };
        case 'scalar':
            return {
                name: match.name,
                kind: SymbolKind.Variable,
                location: { uri: match.uri, range: match.range },
                containerName: 'Scalar',
            };
        case 'matrix':
            return {
                name: match.name,
                kind: SymbolKind.Variable,
                location: { uri: match.uri, range: match.range },
                containerName: 'Matrix',
            };
    }
}
```

- [ ] **Step 3: Run the Task 4 tests — they should now pass**

Run: `bun test tests/unit/symbols.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS. Any TypeScript errors will most likely be in `src/server-handlers.ts` (still passing a `SymbolTable`) — that is fixed in Task 6. If only that file errors, proceed to Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/providers/symbols.ts
git commit -m "Route workspace symbols through WorkspaceSymbolSource"
```

---

## Task 6: Handler — pass indexer instead of merged SymbolTable

**Files:**
- Modify: `src/server-handlers.ts`

- [ ] **Step 1: Update `create_workspace_symbol_handler`**

Replace the body of `create_workspace_symbol_handler` (around lines 520–537) with:

```typescript
export function create_workspace_symbol_handler(
    deps: HandlerDependencies
): (params: WorkspaceSymbolParams) => WorkspaceSymbol[] {
    return (params: WorkspaceSymbolParams): WorkspaceSymbol[] => {
        if (!deps.symbol_provider) {
            return [];
        }
        const all_documents = deps.document_store.getAll();
        return deps.symbol_provider.get_workspace_symbols(
            params.query,
            all_documents,
            deps.workspace_indexer
        );
    };
}
```

`WorkspaceIndexer` implements `WorkspaceSymbolSource` structurally once Task 3 is merged, so no cast is needed. If TypeScript complains that `WorkspaceIndexer` is not assignable to `WorkspaceSymbolSource | undefined`, verify the method signature added in Task 3 matches exactly (same name, same argument/return types).

- [ ] **Step 2: Run the full typecheck**

Run: `bun run typecheck`
Expected: PASS with no errors.

- [ ] **Step 3: Run all unit tests**

Run: `bun test tests/unit/`
Expected: PASS. The previously-passing `Workspace Index Symbol Types` tests (updated in Task 4 Step 2) plus the new tests (Task 4 Step 1) should all be green. Other provider/indexer tests should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/server-handlers.ts
git commit -m "Pass workspace indexer through workspace/symbol handler"
```

---

## Task 7: Integration test — end-to-end `workspace/symbol` with many files

**Files:**
- Create: `tests/integration/workspace-symbol-multi-definition.test.ts`

- [ ] **Step 1: Inspect an existing integration test to copy its harness pattern**

Run: `bun run --silent 2>/dev/null; true` then open `tests/integration/cross-file-navigation.test.ts` (or any integration test that opens a `createConnection`-based in-memory LSP server and exchanges LSP messages). Note the helpers used for creating a tmpdir workspace, initializing the server, and firing LSP requests.

- [ ] **Step 2: Write the integration test**

```typescript
import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// Import whatever in-memory LSP harness other integration tests use.
// Replace the three imports below with the actual ones from
// tests/integration/cross-file-navigation.test.ts (or a shared helper).
import { start_test_server } from './helpers/test-server';

describe('workspace/symbol — multi-definition', () => {
    it('returns one result per file when the same variable is defined in many files', async () => {
        const the_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-ws-'));
        try {
            const the_files = ['nsfg.do', 'dhs.do', 'mics.do'];
            for (const my_file of the_files) {
                fs.writeFileSync(
                    path.join(the_dir, my_file),
                    'gen cm_birth = 1\n'
                );
            }

            const the_server = await start_test_server({ workspaceRoot: the_dir });
            try {
                const the_response = await the_server.sendRequest(
                    'workspace/symbol',
                    { query: 'cm_birth' }
                );

                const the_variable_uris = (the_response as Array<{
                    name: string;
                    containerName?: string;
                    location: { uri: string };
                }>)
                    .filter(s => s.name === 'cm_birth' && s.containerName === 'Variable')
                    .map(s => s.location.uri)
                    .map(u => path.basename(u))
                    .sort();

                expect(the_variable_uris).toEqual(['dhs.do', 'mics.do', 'nsfg.do']);
            } finally {
                await the_server.shutdown();
            }
        } finally {
            fs.rmSync(the_dir, { recursive: true, force: true });
        }
    });
});
```

If the repo does not already expose a `start_test_server` helper, adapt the setup from the existing integration-test pattern (e.g., constructing the server directly with the stdio transport from `src/server-factory.ts` and sending LSP messages through a `MessageConnection`). The specific helper choice is not critical — the only behavioral requirement is that after a real workspace scan, a `workspace/symbol` request for `cm_birth` returns three distinct `location.uri` values.

- [ ] **Step 3: Run the integration test**

Run: `bun test tests/integration/workspace-symbol-multi-definition.test.ts`
Expected: PASS.

If the test fails because the workspace scan does not pick up the files (e.g., size-limit config, extension filter), confirm that the harness sets up the workspace exactly like other passing integration tests (same config, same `.do` extension handling). Do not relax indexer filters just to make the test pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/workspace-symbol-multi-definition.test.ts
git commit -m "Add integration test for multi-definition workspace symbol search"
```

---

## Task 8: Full verification

**Files:**
- None — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: PASS — all unit, property, and integration tests green. This includes the existing tests for completion, hover, diagnostics, analyzer, and scope resolvers, which should be unaffected since `get_all_symbols()` was not changed.

If any unrelated test fails, investigate whether it incidentally depended on last-wins dedup in the workspace-symbol result set. The design explicitly does not preserve that behavior for Cmd-T — update the test to reflect the new contract.

- [ ] **Step 3: Manual verification in VS Code**

1. Launch the extension (`F5` in VS Code, or whatever the local dev launch target is) against `~/repos/sight` or another workspace that has `cm_birth` defined in many `.do` files.
2. Press `Cmd-T` and type `cm_birth`.
3. Confirm each defining file appears as its own entry (nsfg, dhs, mics, enadid, …). Open a couple; confirm each lands at the correct definition line.
4. Confirm that adding a new `gen foo_bar = 1` to a currently-open (unsaved) file makes `foo_bar` appear under Cmd-T immediately (overlay for open docs works).

- [ ] **Step 4: Commit any follow-up tweaks (if needed)**

If manual verification surfaces an issue, fix it with a focused commit. Otherwise no-op.

---

## Self-Review Notes

- **Spec coverage:** Every goal from the design spec is covered — new types (Task 1), new indexer method (Tasks 2–3), provider change (Tasks 4–5), handler change (Task 6), integration test (Task 7), full verification (Task 8).
- **Placeholders:** None — all code blocks are complete. Integration-test harness has a single "look at existing integration tests for the right helper" note, which is genuine contextual guidance rather than a TODO.
- **Type consistency:** `WorkspaceSymbolMatch`, `WorkspaceSymbolSource`, and the six `WorkspaceSymbolKind` tags match across the spec, types file, indexer method, provider helper, and test builders. Method name `find_all_symbol_definitions(query)` is identical everywhere. `SymbolKind` mappings (Function for program, Field for variable, Variable for globals/locals/scalars/matrices) match existing pre-refactor behavior so VS Code icons remain stable.
- **Scope check:** Focused on one coherent change — Cmd-T multi-definition. No unrelated refactoring.
