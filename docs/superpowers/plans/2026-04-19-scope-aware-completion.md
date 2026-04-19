# Scope-aware completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop workspace local macros from leaking into Global-Mode completions, and mark out-of-scope workspace globals/programs/scalars/matrices distinctly so completions never silently suggest a symbol whose acceptance would trigger an undefined-symbol diagnostic.

**Architecture:** All changes live in `src/providers/completion.ts` and `src/types/index.ts`. A new `'out-of-scope'` ranking tier sorts below every existing in-scope tier. Completion producers receive a second `out_of_scope: SymbolTable` argument and, except for local macros and variables, emit extra completion items tagged `(out of scope — from <path>)`. The Global-Mode merged-symbols path is adjusted so workspace `localMacros` never enter the in-scope bag.

**Tech Stack:** TypeScript, Bun test runner (`bun test`, `bun run typecheck`), `vscode-languageserver` types.

**Spec:** `docs/superpowers/specs/2026-04-19-scope-aware-completion-design.md`

---

## File Structure

- `src/types/index.ts` — extend `CompletionRankingFactors.directive_type` union with `'out-of-scope'`.
- `src/providers/completion.ts` — all behavior changes:
  - `compute_ranking_key` — new priority tier for `'out-of-scope'`.
  - `build_merged_map` — force Global-Mode `localMacros` to current-document only.
  - New private `partition_symbols_for_completion` helper.
  - `get_completions` — build `out_of_scope` once and pass it through.
  - `get_macro_completions`, `get_program_completions`, `get_variable_completions` — accept `out_of_scope` and emit extra items for globals/programs/scalars/matrices.
- `tests/unit/completion.test.ts` — unit tests for each new behavior.
- `tests/integration/scope-aware-completion.test.ts` — integration test mirroring `examples/demo/`.

---

## Task 1: Fix Global-Mode local-macro leak

**Why first:** This is a pure bug fix. It can land standalone with a test and no dependency on the ranking changes. It narrows the scope of later tasks.

**Files:**
- Modify: `src/providers/completion.ts:757-772` (`build_merged_map`)
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('Workspace Symbol Filtering', ...)` block at `tests/unit/completion.test.ts:1142`:

```typescript
it('should not surface workspace local macros when no directives or auto-parents apply', async () => {
    const uri = 'file:///test.do';
    const doc = create_test_document('display `', { localMacros: new Map() });
    doc.uri = uri;

    const workspace_symbols: SymbolTable = {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };

    // Local macro from an unrelated workspace file
    workspace_symbols.localMacros.set('cwd', {
        name: 'cwd',
        scope: 'local',
        location: {
            uri: 'file:///other.do',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        },
        sourceUri: 'file:///other.do',
        containingScope: 'dofile',
        definition_line: 0,
    } as MacroSymbol);

    const completions = await provider.get_completions(
        doc,
        { line: 0, character: 9 },
        '`',
        undefined,
        workspace_symbols
    );

    const labels = completions.map(c => c.label);
    expect(labels).not.toContain('cwd');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/unit/completion.test.ts -t "should not surface workspace local macros"`

Expected: FAIL. The output should show `cwd` appearing among the returned labels.

- [ ] **Step 3: Implement the fix**

Edit `src/providers/completion.ts:757-772`. Replace the existing `build_merged_map` body with:

```typescript
    private build_merged_map(
        workspace_symbols: SymbolTable,
        document_symbols: SymbolTable,
        document_uri: string,
        document_version: number
    ): SymbolTable {
        // Filter workspace symbols to exclude stale ones from current document
        const filtered_workspace = this.get_filtered_workspace_symbols(
            workspace_symbols,
            document_uri,
            document_version
        );

        // Merge with document symbols on top (fresh symbols win)
        const merged = merge_symbol_tables(filtered_workspace, document_symbols);

        // Global-Mode rule: local macros are only visible from the current file.
        // Strip workspace localMacros; keep the document's own localMacros.
        return {
            ...merged,
            localMacros: new Map(document_symbols.localMacros),
        };
    }
```

- [ ] **Step 4: Run the new test and verify it passes**

Run: `bun test tests/unit/completion.test.ts -t "should not surface workspace local macros"`

Expected: PASS.

- [ ] **Step 5: Run the full completion test file and typecheck**

Run: `bun run typecheck && bun test tests/unit/completion.test.ts`

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/providers/completion.ts tests/unit/completion.test.ts
git commit -m "Stop workspace local macros leaking into Global-Mode completion"
```

---

## Task 2: Add `'out-of-scope'` ranking tier

**Files:**
- Modify: `src/types/index.ts:745`
- Modify: `src/providers/completion.ts:70-115` (`compute_ranking_key`)
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/completion.test.ts`, after the final closing brace of the last `describe` block:

```typescript
describe('Out-of-scope ranking', () => {
    it('should rank out-of-scope items below in-scope items for the same symbol type', () => {
        const { compute_ranking_key } = require('../../src/providers/completion');
        const in_scope_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'global-macro',
            alphabetical_order: 'zzz',
            parent_uri: 'file:///a.do',
        });
        const out_of_scope_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'out-of-scope',
            symbol_type: 'global-macro',
            alphabetical_order: 'aaa',
            parent_uri: 'file:///b.do',
        });
        expect(in_scope_key < out_of_scope_key).toBe(true);
    });

    it('should keep in-scope symbol-type tiering above out-of-scope entries of other categories', () => {
        const { compute_ranking_key } = require('../../src/providers/completion');
        const in_scope_local = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'local-macro',
            alphabetical_order: 'x',
            parent_uri: 'file:///a.do',
        });
        const out_of_scope_program = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'out-of-scope',
            symbol_type: 'user-program',
            alphabetical_order: 'x',
            parent_uri: 'file:///b.do',
        });
        // Programs (priority 0) still sort before locals (10), but both compare
        // the existing scope+directive prefix first; an out-of-scope program
        // must sort AFTER an in-scope local of the same name.
        expect(in_scope_local < out_of_scope_program).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope ranking"`

Expected: FAIL — `compute_ranking_key` does not recognize `'out-of-scope'` and TypeScript will reject the value. You should see either a type error or a key that is not strictly greater than the in-scope key.

- [ ] **Step 3: Extend the type union**

Edit `src/types/index.ts:745`. Replace:

```typescript
  directive_type: 'done-by' | 'included-by' | 'current';
```

with:

```typescript
  directive_type: 'done-by' | 'included-by' | 'current' | 'out-of-scope';
```

- [ ] **Step 4: Update `compute_ranking_key`**

Edit `src/providers/completion.ts:70-115`. Replace the entire function body with:

```typescript
export function compute_ranking_key(factors: CompletionRankingFactors): string {
    // Priority order (lexicographic): scope_depth (0-9), directive_type (0-3), symbol_type (00-63), parent_uri, alphabetical.
    // NOTE: Avoid NUL (\0) padding in sortText. Some clients/editors can behave oddly with NULs.
    const scope_priority = Math.min(factors.scope_depth, 9);

    const directive_priority =
        factors.directive_type === 'current' ? 0 :
        factors.directive_type === 'included-by' ? 1 :
        factors.directive_type === 'done-by' ? 2 : 3;

    let symbol_priority: number;
    if (factors.symbol_type === 'user-program') {
        symbol_priority = 0;
    } else if (factors.symbol_type === 'local-macro') {
        symbol_priority = 10; // 1.0 - current-file locals rank highest
    } else if (factors.symbol_type === 'program-argument') {
        // Program arguments get special ranking between current-file locals and parent locals.
        // - In current context: after current-file locals (1.0) but before globals (2.0).
        // - In non-current contexts (only used in tests / defensive fallback): rank ahead of
        //   parent locals so they still appear before inherited locals.
        symbol_priority = factors.directive_type === 'current' ? 15 : 5;
    } else if (factors.symbol_type === 'global-macro') {
        symbol_priority = 20; // 2.0
    } else if (factors.symbol_type === 'variable') {
        symbol_priority = 30; // 3.0
    } else if (factors.symbol_type === 'scalar') {
        symbol_priority = 40; // 4.0
    } else if (factors.symbol_type === 'matrix') {
        symbol_priority = 50; // 5.0
    } else {
        // Built-in commands: use priority tier for sub-ordering
        // Tier 1 = 61, Tier 2 = 62, Tier 3 = 63
        const command_tier = factors.command_priority || 3;
        symbol_priority = 60 + command_tier;
    }

    const symbol_priority_padded = symbol_priority.toString().padStart(2, '0');

    // Tie-breakers (avoid padding):
    // - parent_uri differentiates same-named symbols from different parents
    // - alphabetical_order provides stable ordering
    const parent_uri = (factors.parent_uri || '').toLowerCase();
    const name = factors.alphabetical_order.toLowerCase();

    // Use separators to avoid accidental concatenation ambiguity.
    return `${scope_priority}${directive_priority}${symbol_priority_padded}|${parent_uri}|${name}`;
}
```

The only functional change is the additional `directive_type === 'done-by' ? 2 : 3` cascade that maps `'out-of-scope'` to `3`, placing it after every existing bucket.

- [ ] **Step 5: Run the new test and verify it passes**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope ranking"`

Expected: PASS.

- [ ] **Step 6: Run full typecheck and test**

Run: `bun run typecheck && bun test tests/unit/completion.test.ts`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/providers/completion.ts tests/unit/completion.test.ts
git commit -m "Add out-of-scope ranking tier for completion items"
```

---

## Task 3: Partition helper + out-of-scope global macros

**Why grouped:** Introducing the helper and threading it through `get_completions` has no visible behavior until at least one producer uses it. Global macros are the simplest to wire first; the other three producers copy the pattern.

**Files:**
- Modify: `src/providers/completion.ts`
  - Add `partition_symbols_for_completion` near the other helpers (after `get_merged_symbols` at line 811).
  - Thread `out_of_scope` through `get_completions` (inside the scope-resolution block, `completion.ts:898-959`).
  - Update `get_macro_completions` signature and body (`completion.ts:1521-1711`).
  - Update the `'macro'` case in `get_completions` dispatch (`completion.ts:1018-1020`).
  - Update the backtick-trigger path (`completion.ts:975-993`) to pass an empty `out_of_scope` (locals only).
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/completion.test.ts`:

```typescript
describe('Out-of-scope global macro completion', () => {
    it('should list workspace globals as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display $f', { globalMacros: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('foo_cfg', {
            name: 'foo_cfg',
            scope: 'global',
            location: {
                uri: 'file:///helper.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///helper.do',
            containingScope: 'dofile',
            definition_line: 0,
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 10 },
            undefined,
            undefined,
            workspace_symbols
        );

        const foo = completions.find(c => c.label === 'foo_cfg');
        expect(foo).toBeDefined();
        expect(foo!.detail).toContain('out of scope');
        expect(foo!.detail).toContain('helper.do');
    });

    it('should still emit in-scope document globals alongside out-of-scope workspace globals', async () => {
        const uri = 'file:///test.do';
        const local_globals = new Map();
        local_globals.set('here_cfg', {
            name: 'here_cfg',
            scope: 'global',
            location: {
                uri,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: uri,
            containingScope: 'dofile',
            definition_line: 0,
        });
        const doc = create_test_document('display $', { globalMacros: local_globals });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('there_cfg', {
            name: 'there_cfg',
            scope: 'global',
            location: {
                uri: 'file:///other.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///other.do',
            containingScope: 'dofile',
            definition_line: 0,
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            '$',
            undefined,
            workspace_symbols
        );
        const here = completions.find(c => c.label === 'here_cfg');
        const there = completions.find(c => c.label === 'there_cfg');
        expect(here).toBeDefined();
        expect(there).toBeDefined();
        expect((here!.detail || '')).not.toContain('out of scope');
        expect((there!.detail || '')).toContain('out of scope');
        // Out-of-scope sorts after in-scope.
        expect(here!.sortText! < there!.sortText!).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope global macro completion"`

Expected: FAIL. `foo_cfg` either is not returned (if Task 1 already hides locals) or is returned without the `"out of scope"` marker.

- [ ] **Step 3: Add the partition helper**

Insert this method into the `CompletionProvider` class, placing it immediately after `get_merged_symbols` (after line 811):

```typescript
    /**
     * Build an `out_of_scope` view of workspace symbols for completion.
     *
     * Includes workspace globals, programs, scalars, and matrices that are:
     *   - not already present (by name) in the `in_scope` bag for the same kind, and
     *   - not defined in the current document.
     *
     * `localMacros` and `variables` are always returned as empty maps:
     *   - Local macros are file-scoped and never show up as out-of-scope.
     *   - Variables stay workspace-wide via the existing in-scope path.
     */
    private partition_symbols_for_completion(
        document: DocumentState,
        workspace_symbols: SymbolTable | undefined,
        in_scope: SymbolTable
    ): SymbolTable {
        const empty: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        if (!workspace_symbols) {
            return empty;
        }

        const keep_out_of_scope = <T extends { sourceUri: string }>(
            workspace_map: Map<string, T>,
            in_scope_map: Map<string, unknown>,
        ): Map<string, T> => {
            const out = new Map<string, T>();
            for (const [name, symbol] of workspace_map) {
                if (symbol.sourceUri === document.uri) continue;
                if (in_scope_map.has(name)) continue;
                out.set(name, symbol);
            }
            return out;
        };

        return {
            programs: keep_out_of_scope(workspace_symbols.programs, in_scope.programs),
            localMacros: new Map(),
            globalMacros: keep_out_of_scope(workspace_symbols.globalMacros, in_scope.globalMacros),
            variables: new Map(),
            scalars: keep_out_of_scope(workspace_symbols.scalars, in_scope.scalars),
            matrices: keep_out_of_scope(workspace_symbols.matrices, in_scope.matrices),
        };
    }
```

- [ ] **Step 4: Thread `out_of_scope` through `get_completions`**

Edit `src/providers/completion.ts:898-959` (the scope-resolution block). Replace that span with:

```typescript
            // === ASYNC PHASE: Scope resolution (only if needed) ===
            let resolved_scope: ResolvedScope | undefined;
            let symbols_for_completion: SymbolTable = document.symbols;

            if (scope_resolver) {
                const resolve_config = build_scope_resolver_config(cross_file_config);
                const temp_scope = await scope_resolver.resolve(
                    document.uri,
                    document.content,
                    resolve_config,
                    cancellation_token
                );
                const has_directives = temp_scope.has_directives;
                const has_auto_parents = temp_scope.has_auto_parents;
                const visible_forward_overlay =
                    this.get_annotated_visible_forward_symbols(
                        temp_scope,
                        position.line,
                    );

                if (has_directives || has_auto_parents) {
                    // With directives: use reachable scope chain (precision).
                    // get_visible_symbols_at already resolves forward calls
                    // with correct precedence; re-merging visible_forward_overlay
                    // would let forward symbols win a second time. Instead, copy
                    // annotations only onto entries whose winner is the forward-
                    // call version.
                    resolved_scope = temp_scope;
                    symbols_for_completion = this.copy_forward_annotations(
                        get_visible_symbols_at(temp_scope, position.line),
                        visible_forward_overlay,
                    );
                } else if (workspace_symbols) {
                    // No directives: use cached merged symbols (workspace + document)
                    const merged_workspace_symbols = this.get_merged_symbols(
                        workspace_symbols,
                        document.symbols,
                        document.uri,
                        document.version || 0,
                        workspace_version || 0,
                    );
                    symbols_for_completion = merge_symbol_tables(
                        merged_workspace_symbols,
                        visible_forward_overlay,
                    );
                } else {
                    symbols_for_completion = merge_symbol_tables(
                        document.symbols,
                        visible_forward_overlay,
                    );
                }
            } else if (workspace_symbols) {
                // No scope resolver, but we can still provide workspace symbols if available
                // Use cached merged symbols
                symbols_for_completion = this.get_merged_symbols(
                    workspace_symbols,
                    document.symbols,
                    document.uri,
                    document.version || 0,
                    workspace_version || 0
                );
            }

            const out_of_scope_symbols = this.partition_symbols_for_completion(
                document,
                workspace_symbols,
                symbols_for_completion,
            );
```

- [ ] **Step 5: Update `get_macro_completions` signature**

Edit `src/providers/completion.ts:1521` and the surrounding signature. Change from:

```typescript
    private get_macro_completions(
        context: MacroCompletionContext,
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
```

to:

```typescript
    private get_macro_completions(
        context: MacroCompletionContext,
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
```

- [ ] **Step 6: Add the out-of-scope pass inside `get_macro_completions`**

Locate the `return the_completions;` at `src/providers/completion.ts:1710`. Immediately before that `return`, insert:

```typescript
        // Out-of-scope pass: emit workspace globals that aren't part of the
        // in-scope bag, labelled so the user sees that accepting them will
        // trigger an undefined-symbol diagnostic. Skip entirely for locals —
        // local macros are file-scoped and never offered workspace-wide.
        const scope_is_local = context.scope === 'local';
        if (!scope_is_local) {
            const out_map = out_of_scope.globalMacros;
            for (const [name, macro] of out_map) {
                const name_lower = name.toLowerCase();
                if (!(prefix === '' || name_lower.startsWith(prefix_lower))) {
                    continue;
                }
                if (seen_labels.has(name)) {
                    continue;
                }

                const ranking_factors: CompletionRankingFactors = {
                    scope_depth: 0,
                    directive_type: 'out-of-scope',
                    symbol_type: 'global-macro',
                    alphabetical_order: name,
                    parent_uri: macro.sourceUri,
                };

                const source_path = this.get_relative_path(macro.sourceUri);
                const new_text = name + (needs_closing_delimiter ? closing_char : '');

                the_completions.push({
                    label: name,
                    kind: CompletionItemKind.Variable,
                    detail: `global macro (out of scope — from ${source_path})`,
                    documentation: macro.value ? `Value: ${macro.value}` : undefined,
                    sortText: compute_ranking_key(ranking_factors),
                    textEdit: {
                        range: replacement_range,
                        newText: new_text,
                    },
                });
                seen_labels.add(name);
            }
        }
```

- [ ] **Step 7: Update the two `get_macro_completions` call sites**

At `src/providers/completion.ts:985-991` (backtick-trigger path), change:

```typescript
                    const macro_completions = this.get_macro_completions(
                        local_context,
                        document,
                        position,
                        symbols_for_completion,
                        resolved_scope
                    );
```

to:

```typescript
                    const macro_completions = this.get_macro_completions(
                        local_context,
                        document,
                        position,
                        symbols_for_completion,
                        out_of_scope_symbols,
                        resolved_scope
                    );
```

At `src/providers/completion.ts:1020`, change:

```typescript
                    return this.get_macro_completions(context as any, document, position, symbols_for_completion, resolved_scope);
```

to:

```typescript
                    return this.get_macro_completions(context as any, document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);
```

- [ ] **Step 8: Run the new tests and verify they pass**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope global macro completion"`

Expected: both tests PASS.

- [ ] **Step 9: Run the full typecheck and test file**

Run: `bun run typecheck && bun test tests/unit/completion.test.ts`

Expected: all pass. Pay attention to any compile error in callers — if present, adjust the corresponding argument list.

- [ ] **Step 10: Commit**

```bash
git add src/providers/completion.ts tests/unit/completion.test.ts
git commit -m "Thread out-of-scope symbols into macro completions"
```

---

## Task 4: Out-of-scope programs

**Files:**
- Modify: `src/providers/completion.ts` — `get_program_completions` (line 1868-1909) and its call site (line 1034).
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/completion.test.ts`:

```typescript
describe('Out-of-scope program completion', () => {
    it('should list workspace programs as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('my_', { programs: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.programs.set('my_helper', {
            name: 'my_helper',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
            signature: { args: [] },
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 3 },
            undefined,
            undefined,
            workspace_symbols
        );

        const helper = completions.find(c => c.label === 'my_helper');
        expect(helper).toBeDefined();
        expect(helper!.detail).toContain('out of scope');
        expect(helper!.detail).toContain('lib.do');
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope program completion"`

Expected: FAIL — `my_helper` is returned without the `"out of scope"` detail.

- [ ] **Step 3: Update `get_program_completions` signature and body**

Edit `src/providers/completion.ts:1868-1909`. Replace the whole method with:

```typescript
    private get_program_completions(
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        for (const [name, program] of symbols.programs) {
            const symbol_info = this.get_completion_symbol_provenance(
                program,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'user-program',
                alphabetical_order: program.name,
                parent_uri: program.sourceUri
            };

            // Add source file annotation for cross-file symbols
            let detail = 'User-defined program';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: program.name,
                kind: CompletionItemKind.Function,
                detail,
                documentation: `Defined at ${program.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
            });
            seen_labels.add(name);
        }

        for (const [name, program] of out_of_scope.programs) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'user-program',
                alphabetical_order: program.name,
                parent_uri: program.sourceUri,
            };

            const source_path = this.get_relative_path(program.sourceUri);

            the_completions.push({
                label: program.name,
                kind: CompletionItemKind.Function,
                detail: `User-defined program (out of scope — from ${source_path})`,
                documentation: `Defined at ${program.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
            });
            seen_labels.add(name);
        }

        return the_completions;
    }
```

- [ ] **Step 4: Update the call site**

Edit `src/providers/completion.ts:1034`. Change:

```typescript
                    return this.get_program_completions(document, position, symbols_for_completion, resolved_scope);
```

to:

```typescript
                    return this.get_program_completions(document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope program completion"`

Expected: PASS.

- [ ] **Step 6: Run the full typecheck and test file**

Run: `bun run typecheck && bun test tests/unit/completion.test.ts`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/providers/completion.ts tests/unit/completion.test.ts
git commit -m "Emit out-of-scope program completions"
```

---

## Task 5: Out-of-scope scalars and matrices

**Why grouped:** Scalars and matrices live in the same producer (`get_variable_completions`) and follow identical patterns. Bundling them keeps the diff cohesive.

**Files:**
- Modify: `src/providers/completion.ts` — `get_variable_completions` (line 1716-1866+) and its call site (line 1027).
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/completion.test.ts`:

```typescript
describe('Out-of-scope scalar and matrix completion', () => {
    it('should list workspace scalars as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display s', { scalars: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.scalars.set('s_alpha', {
            name: 's_alpha',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 's_alpha');
        expect(item).toBeDefined();
        expect(item!.detail).toContain('out of scope');
        expect(item!.detail).toContain('lib.do');
    });

    it('should list workspace matrices as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display m', { matrices: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.matrices.set('m_beta', {
            name: 'm_beta',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 'm_beta');
        expect(item).toBeDefined();
        expect(item!.detail).toContain('out of scope');
        expect(item!.detail).toContain('lib.do');
    });

    it('should not list variables as out-of-scope — variables remain workspace-wide', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('summarize v', { variables: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.variables.set('v_shared', {
            name: 'v_shared',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
            source: 'dataset',
        } as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 11 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 'v_shared');
        expect(item).toBeDefined();
        // Variables keep their normal detail (never the out-of-scope marker).
        expect((item!.detail || '')).not.toContain('out of scope');
    });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope scalar and matrix completion"`

Expected: first two FAIL (the out-of-scope detail is absent). The third (variables) should already pass.

- [ ] **Step 3: Update `get_variable_completions` signature and body**

Edit `src/providers/completion.ts:1716-1866+`. Change the method signature and append an out-of-scope pass for scalars and matrices (leave the existing variable loop untouched). Replace the entire method body with:

```typescript
    private get_variable_completions(
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        // Compute word prefix and replacement range
        const prefix = this.get_word_at_position(document, position);
        let replacement_range: Range;

        if (position.line < get_line_count(document)) {
            const current_line = get_line_text(document, position.line);
            const text_before_cursor = current_line.substring(0, position.character);

            // Find start of word
            let word_start = text_before_cursor.length;
            while (word_start > 0) {
                const char = text_before_cursor[word_start - 1];
                if (!/[a-zA-Z0-9_]/.test(char)) {
                    break;
                }
                word_start--;
            }

            replacement_range = Range.create(
                Position.create(position.line, word_start),
                position
            );
        } else {
            replacement_range = Range.create(position, position);
        }

        // Variables
        for (const [name, variable] of symbols.variables) {
            const symbol_info = this.get_completion_symbol_provenance(
                variable,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'variable',
                alphabetical_order: name,
                parent_uri: variable.sourceUri
            };

            // Add source file annotation for cross-file symbols
            let detail = variable.type ? `${variable.type} variable` : 'Variable';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Field,
                detail,
                documentation: variable.label || `Created via ${variable.source}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Scalars
        const scalars: Map<string, any> = (symbols as any).scalars instanceof Map ? (symbols as any).scalars : new Map();
        for (const [name, scalar] of scalars) {
            const symbol_info = this.get_completion_symbol_provenance(
                scalar,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'scalar',
                alphabetical_order: name,
                parent_uri: scalar.sourceUri
            };

            let detail = 'Scalar';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Constant,
                detail,
                documentation: `Defined at ${scalar.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Matrices
        const matrices: Map<string, any> = (symbols as any).matrices instanceof Map ? (symbols as any).matrices : new Map();
        for (const [name, matrix] of matrices) {
            const symbol_info = this.get_completion_symbol_provenance(
                matrix,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'matrix',
                alphabetical_order: name,
                parent_uri: matrix.sourceUri
            };

            let detail = 'Matrix';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Struct,
                detail,
                documentation: `Defined at ${matrix.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Out-of-scope pass: emit workspace scalars and matrices that are
        // not already in-scope. Variables stay workspace-wide through the
        // in-scope path and are intentionally skipped here.
        for (const [name, scalar] of out_of_scope.scalars) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'scalar',
                alphabetical_order: name,
                parent_uri: scalar.sourceUri,
            };
            const source_path = this.get_relative_path(scalar.sourceUri);

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Constant,
                detail: `Scalar (out of scope — from ${source_path})`,
                documentation: `Defined at ${scalar.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        for (const [name, matrix] of out_of_scope.matrices) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'matrix',
                alphabetical_order: name,
                parent_uri: matrix.sourceUri,
            };
            const source_path = this.get_relative_path(matrix.sourceUri);

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Struct,
                detail: `Matrix (out of scope — from ${source_path})`,
                documentation: `Defined at ${matrix.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        return the_completions;
    }
```

- [ ] **Step 4: Update the call site**

Edit `src/providers/completion.ts:1027`. Change:

```typescript
                    return this.get_variable_completions(document, position, symbols_for_completion, resolved_scope);
```

to:

```typescript
                    return this.get_variable_completions(document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `bun test tests/unit/completion.test.ts -t "Out-of-scope scalar and matrix completion"`

Expected: all three PASS.

- [ ] **Step 6: Run the full typecheck and test file**

Run: `bun run typecheck && bun test tests/unit/completion.test.ts`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/providers/completion.ts tests/unit/completion.test.ts
git commit -m "Emit out-of-scope scalar and matrix completions"
```

---

## Task 6: In-scope regression — scope-resolved globals keep normal rank

**Why:** A regression test. When a file brings a workspace global into scope via an explicit directive or auto-parent, the completion for that global must not be labelled "out of scope", because `partition_symbols_for_completion` filters it out of the out-of-scope bag. This task adds a test that would fail if a future refactor mistakenly builds the out-of-scope bag from the raw workspace table.

**Files:**
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write the regression test**

Append to `tests/unit/completion.test.ts`:

```typescript
describe('In-scope global keeps normal completion rank', () => {
    it('should not label a workspace global as out-of-scope when it is in the in-scope bag', async () => {
        const uri = 'file:///test.do';
        // Simulate an in-scope workspace global by placing it in the document's own symbol table
        // (no separate scope_resolver needed — the filter uses in-scope membership, not provenance).
        const doc_globals = new Map();
        doc_globals.set('shared_cfg', {
            name: 'shared_cfg',
            scope: 'global',
            location: {
                uri: 'file:///helper.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///helper.do',
            containingScope: 'dofile',
            definition_line: 0,
        });
        const doc = create_test_document('display $', { globalMacros: doc_globals });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('shared_cfg', doc_globals.get('shared_cfg') as any);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            '$',
            undefined,
            workspace_symbols
        );

        const shared = completions.find(c => c.label === 'shared_cfg');
        expect(shared).toBeDefined();
        expect((shared!.detail || '')).not.toContain('out of scope');
    });
});
```

- [ ] **Step 2: Run the test and verify it passes (should already pass)**

Run: `bun test tests/unit/completion.test.ts -t "In-scope global keeps normal completion rank"`

Expected: PASS on first run — the partition helper's `in_scope_map.has(name)` check already excludes it.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/completion.test.ts
git commit -m "Add regression test for in-scope workspace global ranking"
```

---

## Task 7: Integration test — demo scenario

**Why:** The original bug report is reproducible at `examples/demo/demo_completions.do`. This task adds an integration-level test that constructs a fixture mirroring that layout and asserts the bug is gone.

**Files:**
- Create: `tests/integration/scope-aware-completion.test.ts`

- [ ] **Step 1: Inspect an existing integration test to pattern-match setup**

Read the top of `tests/integration/completion-dedup-redeclared.test.ts` (or any similar file) to see how the integration tests build a provider with workspace indexing. The helper functions vary by test; copy the pattern that matches the fixture layout used below.

Run: `bun test tests/integration/completion-dedup-redeclared.test.ts` (sanity check the file exists and still passes).

Expected: PASS.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/scope-aware-completion.test.ts` with this content, adapting the setup helpers to match the pattern you found in step 1 (look for imports like `create_test_provider`, `with_workspace`, or similar):

```typescript
import { describe, it, expect } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { WorkspaceIndexer } from '../../src/indexer';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Build a temporary workspace with two files:
 *   - demo_completions.do: defines `local color`, cursor at the tail of `di "\`c`
 *   - other.do:            defines `local cwd` (unrelated)
 * Assert that completion at the cursor returns `color` and NOT `cwd`.
 */
describe('Scope-aware completion (integration): demo scenario', () => {
    it('should not suggest local macros from unrelated workspace files', async () => {
        const tmp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-scope-'));
        const main_path = path.join(tmp_root, 'demo_completions.do');
        const other_path = path.join(tmp_root, 'other.do');

        fs.writeFileSync(main_path, [
            'local fruit "apple banana cherry"',
            'local color "red blue green"',
            'di "`c',
        ].join('\n'));
        fs.writeFileSync(other_path, [
            'local cwd = c(pwd)',
        ].join('\n'));

        const command_db = new CommandDatabase();
        const indexer = new WorkspaceIndexer();
        await indexer.initialize([tmp_root]);

        const document_store = new DocumentStore();
        const main_uri = `file://${main_path}`;
        await document_store.open(main_uri, fs.readFileSync(main_path, 'utf8'), 1, indexer.get_all_symbols());
        const doc = document_store.get(main_uri)!;

        const provider = new CompletionProvider(command_db);
        const completions = await provider.get_completions(
            doc,
            { line: 2, character: 6 }, // after the `c in `di "`c`
            '`',
            undefined,
            indexer.get_all_symbols()
        );

        const labels = completions.map(c => c.label);
        expect(labels).toContain('color');
        expect(labels).not.toContain('cwd');

        fs.rmSync(tmp_root, { recursive: true, force: true });
    });
});
```

If any import name or method signature has shifted since this plan was written, cross-reference `src/indexer/index.ts` (look for `initialize(workspace_folders)` and `get_all_symbols()`) and `src/server-factory.ts` (see how `WorkspaceIndexer` is wired in production).

- [ ] **Step 3: Run the test and confirm it passes**

Run: `bun test tests/integration/scope-aware-completion.test.ts`

Expected: PASS — Task 1 already fixes the underlying leak, so this integration test should succeed on first run. If it fails, diagnose:
- "Cannot find `WorkspaceIndexer`" → look at `src/indexer/index.ts` for the actual export name.
- `scan_workspace` missing → check the indexer's public API (e.g., `add_file`, `index_file`, etc.).

- [ ] **Step 4: Run full typecheck and test suite**

Run: `bun run typecheck && bun test`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/scope-aware-completion.test.ts
git commit -m "Add integration test for scope-aware completion demo scenario"
```

---

## Task 8: Final validation

- [ ] **Step 1: Run the full test suite**

Run: `bun run test` (which runs `bun run typecheck` then `bun test`).

Expected: all tests pass.

- [ ] **Step 2: Smoke-test the demo file manually**

In VS Code with the extension loaded, open `examples/demo/demo_completions.do`, position the cursor after `` `c `` inside a `di "..."` on an empty line after the local definitions, and trigger completion. Confirm:
- `color` appears.
- No local macros from `tests/fixtures/**` appear.
- If workspace has `global` or `scalar` symbols from unrelated files, they appear with `(out of scope — from <path>)` in the detail.

- [ ] **Step 3: Commit any last touch-ups**

If smoke-testing surfaces a small issue (e.g., a typo in the detail string), fix it with a follow-up commit:

```bash
git add -p
git commit -m "<short description of the fix>"
```

Otherwise, skip this step.

---

## Post-implementation checklist

- `bun run typecheck` clean.
- `bun test` green.
- No `any` types introduced beyond the existing cast patterns already in the file.
- New helper `partition_symbols_for_completion` is covered by unit tests through its callers.
- All existing completion tests pass unchanged.
