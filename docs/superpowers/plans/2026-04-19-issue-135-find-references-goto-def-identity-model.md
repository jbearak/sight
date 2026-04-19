# Find-References and Go-to-Definition — Identity Model Rearchitecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rearchitect Sight so that same-name, same-kind redeclared symbols within the reachable scope chain have a single identity — so that go-to-definition returns *all* matching declarations, find-references pools *all* reference sites for the identity, and hover warns when other definitions exist. Disjoint branches of the dep graph remain distinct (Rule 2).

**Architecture:** Three layered changes (analyzer, providers, docs). The analyzer already tracks redeclared macros via `additional_definitions`; we extend the same mechanism to `ProgramSymbol`, `ScalarSymbol`, `MatrixSymbol`. The definition provider is extended to emit all same-identity declaration sites. The references provider and the scope resolver's `collect_visible_reference_uris` are updated so that same-name symbols inside the reachable chain pool into one identity, while out-of-chain (disjoint) branches stay excluded. Hover gets a mandatory redefinition footer. Variable results become sorted reachable-first. Symmetric reachability (upward walk via `callee_to_callers`) is added. Finally, `docs/find-references.md` is rewritten.

**Tech Stack:** TypeScript (Bun runtime, Bun test). Tests live under `tests/unit/`, `tests/integration/`, and `tests/property/`.

**Design spec:** [`docs/superpowers/specs/2026-04-19-issue-135-find-references-goto-def-identity-model-design.md`](../specs/2026-04-19-issue-135-find-references-goto-def-identity-model-design.md)

**GitHub issue:** [#135](https://github.com/jbearak/sight/issues/135)

---

## File Map

| Action | Path | What changes |
|---|---|---|
| **Modify** | `src/types/index.ts` | Add `additional_definitions` to `ProgramSymbol`, `ScalarSymbol`, `MatrixSymbol` |
| **Modify** | `src/analyzer/index.ts` | Populate `additional_definitions` for programs, scalars, matrices (first-def-wins for primary) |
| **Modify** | `src/providers/definition.ts` | Return all same-identity defs (primary + `additional_definitions` entries) for macros, programs, scalars, matrices |
| **Modify** | `src/providers/references.ts` | Collect all same-identity declaration sites; remove in-chain identity split; add variable sort; upward walk via `callee_to_callers` |
| **Modify** | `src/scope-resolver/visible-symbols.ts` | Collapse "different identity" guard to a no-op for in-chain redeclarations; retain disjoint-branch exclusion |
| **Modify** | `src/providers/hover.ts` | Append mandatory redefinition footer (same-file / cross-file-only / mixed variants) when `additional_definitions` is non-empty |
| **Modify** | `docs/find-references.md` | Rewrite three-tier model to reflect new identity rules |
| **Create** | `tests/integration/find-references-identity-redeclared-local.test.ts` | Redeclared local (flat + branches) pools references |
| **Create** | `tests/integration/find-references-identity-redeclared-global.test.ts` | Redeclared global across do/run pools references |
| **Create** | `tests/integration/find-references-identity-disjoint-branches.test.ts` | Same-name programs in disjoint branches stay distinct |
| **Create** | `tests/integration/find-references-identity-symmetric.test.ts` | Symmetric reachability (either end of chain produces same result) |
| **Create** | `tests/integration/find-references-identity-locals-do-boundary.test.ts` | Local-macro chain does NOT widen to do/run |
| **Create** | `tests/integration/find-references-variables-sort.test.ts` | Variable refs sorted reachable-first, then non-reachable |
| **Create** | `tests/integration/goto-def-identity-redeclared.test.ts` | Go-to-def returns ALL redeclarations |
| **Create** | `tests/unit/hover-redefinition-footer.test.ts` | Hover footer variants (same-file / cross-file-only / mixed) |
| **Create** | `tests/integration/completion-dedup-redeclared.test.ts` | Completion dedups redeclared local (regression guard) |

---

## Phase 1: Foundation — Extend Types and Analyzer

### Task 1: Add `additional_definitions` field to Program/Scalar/Matrix types

**Files:**
- Modify: `src/types/index.ts:356-365` (ProgramSymbol), `src/types/index.ts:581-593` (Scalar/Matrix)

**Goal:** Match MacroSymbol's shape so the downstream identity logic can use a uniform accessor.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types-additional-definitions.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import type { ProgramSymbol, ScalarSymbol, MatrixSymbol } from '../../src/types';

describe('additional_definitions type field exists on non-macro symbols', () => {
    it('ProgramSymbol accepts additional_definitions', () => {
        const program_symbol: ProgramSymbol = {
            name: 'foo',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 5,
                    line: 10,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 10, character: 0 },
                            end: { line: 10, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(program_symbol.additional_definitions?.length).toBe(1);
    });

    it('ScalarSymbol accepts additional_definitions', () => {
        const scalar_symbol: ScalarSymbol = {
            name: 's',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 2,
                    line: 3,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 3, character: 0 },
                            end: { line: 3, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(scalar_symbol.additional_definitions?.length).toBe(1);
    });

    it('MatrixSymbol accepts additional_definitions', () => {
        const matrix_symbol: MatrixSymbol = {
            name: 'm',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 4,
                    line: 7,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 7, character: 0 },
                            end: { line: 7, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(matrix_symbol.additional_definitions?.length).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/types-additional-definitions.test.ts`

Expected: FAIL with TypeScript error "Object literal may only specify known properties, and 'additional_definitions' does not exist in type 'ProgramSymbol'" (or similar).

- [ ] **Step 3: Modify `src/types/index.ts` to add the field**

Change `ProgramSymbol` (lines 356-365):

```typescript
export interface ProgramSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  parameters?: string[];
  signature?: ProgramSignature; // Extracted from syntax command
  c_locals?: string[]; // Macro names created via c_local
  macro_creating_local_options?: string[]; // Local macro names created via options (e.g., c_local `local')
  macro_creating_global_options?: string[]; // Global macro names created via options (e.g., global `global')
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}
```

Change `ScalarSymbol` (lines 581-587):

```typescript
export interface ScalarSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  definition_line?: number;
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}
```

Change `MatrixSymbol` (lines 589-594):

```typescript
export interface MatrixSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  definition_line?: number;
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/types-additional-definitions.test.ts`

Expected: PASS.

- [ ] **Step 5: Typecheck to confirm no unrelated breakage**

Run: `bun run typecheck`

Expected: no new errors. (Previously passing: should still pass.)

- [ ] **Step 6: Commit**

```bash
git add tests/unit/types-additional-definitions.test.ts src/types/index.ts
git commit -m "Add additional_definitions field to Program/Scalar/Matrix types (issue #135)"
```

---

### Task 2: Populate `additional_definitions` for programs in the analyzer

**Files:**
- Modify: `src/analyzer/index.ts:540-570` (`process_program`)
- Test: `tests/unit/analyzer-additional-definitions-program.test.ts`

**Goal:** Match `process_macro_def`'s first-def-wins pattern for programs. The first `program define foo` becomes the primary `location`; later ones append to `additional_definitions`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analyzer-additional-definitions-program.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { Analyzer } from '../../src/analyzer';
import { Parser } from '../../src/parser';
import { Lexer } from '../../src/lexer';

describe('analyzer - program redeclarations in same file', () => {
    it('records first program define as primary, subsequent as additional_definitions', () => {
        const source = [
            'program define foo',
            '    di "first"',
            'end',
            '',
            'program define foo',
            '    di "second"',
            'end',
        ].join('\n');

        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens);
        const ast = parser.parse();
        const analyzer = new Analyzer('file:///a.do');
        const symbols = analyzer.analyze(ast).symbols;

        const foo = symbols.programs.get('foo');
        expect(foo).toBeDefined();
        // Primary = first definition at line 0
        expect(foo!.location.range.start.line).toBe(0);
        // Second declaration becomes additional
        expect(foo!.additional_definitions?.length).toBe(1);
        expect(foo!.additional_definitions![0].line).toBe(4);
    });

    it('keeps primary location stable across 3+ redeclarations', () => {
        const source = [
            'program define bar',
            'end',
            'program define bar',
            'end',
            'program define bar',
            'end',
        ].join('\n');
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens);
        const ast = parser.parse();
        const analyzer = new Analyzer('file:///a.do');
        const symbols = analyzer.analyze(ast).symbols;

        const bar = symbols.programs.get('bar');
        expect(bar!.location.range.start.line).toBe(0);
        expect(bar!.additional_definitions?.length).toBe(2);
        expect(bar!.additional_definitions![0].line).toBe(2);
        expect(bar!.additional_definitions![1].line).toBe(4);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/analyzer-additional-definitions-program.test.ts`

Expected: FAIL (first test should fail because `additional_definitions` is `undefined`; second test because the first program is overwritten and `location.range.start.line` is `4`).

- [ ] **Step 3: Modify `process_program` in `src/analyzer/index.ts`**

Locate `process_program` (around line 541). Replace its body so that it first checks if `symbols.programs.get(node.name)` exists; if so, append to `additional_definitions` instead of overwriting. Keep the rest of the method (scope creation, body traversal, c_locals extraction) unchanged for the primary path:

Before (approximate, lines 540-570):

```typescript
    private process_program(
        node: ProgramNode,
        symbols: SymbolTable,
        all_scopes: ScopeInfo[]
    ): void {
        const program_symbol: ProgramSymbol = {
            name: node.name,
            location: { uri: this.uri, range: node.range },
            sourceUri: this.uri,
        };

        symbols.programs.set(node.name, program_symbol);

        // Create a new scope for the program body
        const program_scope: ScopeInfo = {
            type: 'program',
            range: node.range,
            localMacros: new Map(),
        };
        all_scopes.push(program_scope);

        // Process program body with the new scope
        this.build_symbols(node.body, symbols, program_scope, all_scopes);

        // Extract c_local macro names from program body
        const c_locals = this.extract_c_locals(node.body);
        if (c_locals.length > 0) {
            program_symbol.c_locals = c_locals;
        }
```

After — **first introduce a shared helper** so Task 3 (scalars/matrices) and any future symbol kind can reuse it instead of duplicating the "first-def-wins" block. Add this private method to the `Analyzer` class (alongside `process_macro_def`):

```typescript
/**
 * First-def-wins registration. Creates the primary entry on first call;
 * on subsequent calls, appends to `additional_definitions`.
 *
 * Returns the canonical symbol (primary) — useful when callers need to
 * mutate it further (e.g., attach c_locals to a program).
 */
private add_or_append_definition<
    T extends {
        location: { uri: string; range: Range };
        additional_definitions?: Array<{
            index: number;
            line: number;
            location: { uri: string; range: Range };
        }>;
    }
>(
    symbol_map: Map<string, T>,
    name: string,
    node_index: number,
    range: Range,
    create_primary: () => T
): T {
    const existing = symbol_map.get(name);
    if (existing) {
        if (!existing.additional_definitions) {
            existing.additional_definitions = [];
        }
        existing.additional_definitions.push({
            index: node_index,
            line: range.start.line,
            location: { uri: this.uri, range },
        });
        return existing;
    }
    const primary = create_primary();
    symbol_map.set(name, primary);
    return primary;
}
```

Then rewrite `process_program` to use it:

```typescript
    private process_program(
        node: ProgramNode,
        symbols: SymbolTable,
        all_scopes: ScopeInfo[],
        node_index: number
    ): void {
        const program_symbol = this.add_or_append_definition(
            symbols.programs,
            node.name,
            node_index,
            node.range,
            () => ({
                name: node.name,
                location: { uri: this.uri, range: node.range },
                sourceUri: this.uri,
            })
        );

        // Create a new scope for the program body
        const program_scope: ScopeInfo = {
            type: 'program',
            range: node.range,
            localMacros: new Map(),
        };
        all_scopes.push(program_scope);

        // Process program body with the new scope
        this.build_symbols(node.body, symbols, program_scope, all_scopes);

        // Extract c_local macro names from program body
        const c_locals = this.extract_c_locals(node.body);
        if (c_locals.length > 0) {
            program_symbol.c_locals = c_locals;
        }
```

Also update the caller of `process_program` to pass `node_index`. Search `src/analyzer/index.ts` for `process_program(` (the invocation, not the definition). If the current call site does not pass `node_index`, you'll need to thread it in. Use `Grep` to find: `pattern: "process_program\\("` `path: src/analyzer/index.ts`. The invocation lives inside `build_symbols` where the current `node_index` is already tracked (used by `process_macro_def`).

If `process_program` is invoked without `node_index`, look at the preorder traversal — `build_symbols` maintains a counter. Pass that counter. Apply the same pattern used for `process_macro_def`.

**Optional refactor follow-up:** `process_macro_def` currently hand-rolls the same first-def-wins logic. Leave it alone in this task (it has extra logic around positional args and definition-index tracking that is macro-specific), but a later refactor could migrate it onto `add_or_append_definition` too.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/analyzer-additional-definitions-program.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full analyzer + related tests to detect regressions**

Run: `bun test tests/unit/analyzer tests/property/analyzer`

Expected: all tests still pass. If any test relied on "second program define overwrites first," update that test to match the new first-def-wins behavior — the analyzer's symbol-table shape is documented as first-def-wins per the design spec.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/analyzer-additional-definitions-program.test.ts src/analyzer/index.ts
git commit -m "Populate additional_definitions for redeclared programs (issue #135)"
```

---

### Task 3: Populate `additional_definitions` for scalars and matrices

**Files:**
- Modify: `src/analyzer/index.ts:1260-1305` (scalar/matrix assignment handling)
- Test: `tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts`

**Goal:** Same pattern for scalar/matrix assignments. `scalar s = 1` twice keeps the first primary and appends the second to `additional_definitions`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { Analyzer } from '../../src/analyzer';
import { Parser } from '../../src/parser';
import { Lexer } from '../../src/lexer';

function analyze(source: string) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const analyzer = new Analyzer('file:///a.do');
    return analyzer.analyze(ast).symbols;
}

describe('analyzer - scalar redeclarations', () => {
    it('keeps first scalar as primary, appends second to additional_definitions', () => {
        const source = [
            'scalar s = 1',
            'scalar s = 2',
        ].join('\n');
        const symbols = analyze(source);
        const s = symbols.scalars.get('s');
        expect(s).toBeDefined();
        expect(s!.location.range.start.line).toBe(0);
        expect(s!.additional_definitions?.length).toBe(1);
        expect(s!.additional_definitions![0].line).toBe(1);
    });
});

describe('analyzer - matrix redeclarations', () => {
    it('keeps first matrix as primary, appends second to additional_definitions', () => {
        const source = [
            'matrix m = 1',
            'matrix m = 2',
        ].join('\n');
        const symbols = analyze(source);
        const m = symbols.matrices.get('m');
        expect(m).toBeDefined();
        expect(m!.location.range.start.line).toBe(0);
        expect(m!.additional_definitions?.length).toBe(1);
        expect(m!.additional_definitions![0].line).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts`

Expected: FAIL (primary is overwritten to line 1; additional_definitions is undefined).

- [ ] **Step 3: Modify scalar and matrix registration in `src/analyzer/index.ts`**

Search for `symbols.scalars.set` and `symbols.matrices.set`. The sites are around lines 384, 396, 1264, 1302 (per Task 1 exploration). For each, replace the raw `.set(...)` with a call to the `add_or_append_definition` helper introduced in Task 2. This keeps the first-def-wins logic in one place.

For scalars (around line 1264):

```typescript
// Before:
symbols.scalars.set(scalar_name, {
    name: scalar_name,
    location: { uri: this.uri, range: node.range },
    sourceUri: this.uri,
    definition_line: node.range.start.line,
});
```

```typescript
// After:
this.add_or_append_definition(
    symbols.scalars,
    scalar_name,
    node_index,
    node.range,
    () => ({
        name: scalar_name,
        location: { uri: this.uri, range: node.range },
        sourceUri: this.uri,
        definition_line: node.range.start.line,
    })
);
```

For matrices (around line 1302), do the symmetric change, substituting `symbols.matrices` and the matrix symbol fields.

Apply the same pattern at the other scalar/matrix `.set` call sites (lines 384/396 per Task 1 exploration — syntax-option parsing). Check each with `Grep` (`symbols.scalars.set` / `symbols.matrices.set`) and convert. If any call site does not have a `node_index` in scope, thread one through. The `build_symbols` preorder counter already exists for `process_macro_def`.

(The helper is generic enough to work for any symbol kind whose type has a `location` and optional `additional_definitions` — which now includes `ProgramSymbol`, `ScalarSymbol`, `MatrixSymbol` after Task 1.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full analyzer regression suite**

Run: `bun test tests/unit/analyzer tests/property/analyzer`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts src/analyzer/index.ts
git commit -m "Populate additional_definitions for redeclared scalars and matrices (issue #135)"
```

---

## Phase 2: Definition Provider — Return All Defs

### Task 4: Go-to-definition returns all same-file redeclarations for macros

**Files:**
- Modify: `src/providers/definition.ts` (`resolve_local_macro_only`, `resolve_global_macro_only`, `resolve_word_as_macro_declaration`)
- Test: `tests/integration/goto-def-identity-redeclared.test.ts`

**Goal:** When a macro has `additional_definitions`, go-to-def returns all of them.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/goto-def-identity-redeclared.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Go-to-definition - redeclared same-identity symbols', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'goto-def-redecl-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new DefinitionProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('returns both local macro declarations when redeclared in the same file', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'local fruit apple',         // line 0
            'di "`fruit\' is apple"',    // line 1
            'local fruit banana',        // line 2
            'di "`fruit\' is banana"',   // line 3
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `fruit' in line 3 (the reference inside the string after banana)
        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character: fruit_char },
            undefined,
            undefined,
            indexer,
            undefined,
            undefined,
        );

        // LSP Definition can be a single Location or Location[]; normalize.
        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines_in_file = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines_in_file).toEqual([0, 2]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: FAIL. Current behavior returns only the primary location (line 0).

- [ ] **Step 3: Modify the macro resolvers in `src/providers/definition.ts`**

Introduce a helper that converts `MacroSymbol` (with `additional_definitions`) into a list of locations:

```typescript
// Add near as_locations (around line 599).
private macro_symbol_to_locations(symbol: MacroSymbol): Location[] {
    const out: Location[] = [
        { uri: symbol.location.uri, range: symbol.location.range },
    ];
    if (symbol.additional_definitions) {
        for (const my_extra of symbol.additional_definitions) {
            out.push({ uri: my_extra.location.uri, range: my_extra.location.range });
        }
    }
    return out;
}

private locations_to_definition(locs: Location[]): Definition | null {
    if (locs.length === 0) return null;
    if (locs.length === 1) return locs[0];
    return locs;
}
```

Update `resolve_local_macro_only` (around line 231):

```typescript
// Before (returning a single Location):
const local_macro = resolved_scope.symbols.localMacros.get(word);
if (local_macro) {
    return {
        uri: local_macro.location.uri,
        range: local_macro.location.range,
    };
}
```

```typescript
// After:
const local_macro = resolved_scope.symbols.localMacros.get(word);
if (local_macro) {
    return this.locations_to_definition(this.macro_symbol_to_locations(local_macro));
}
```

Apply the same change to every local-macro and global-macro lookup in `definition.ts` — there are approximately six sites total (resolved-scope local, forward-call local, document local, workspace indexer local, resolved-scope global, document global, workspace global, workspace_symbols globals, and the macro-declaration fallback).

Import the `MacroSymbol` type at the top of the file if not already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: PASS.

- [ ] **Step 5: Run related provider tests to detect regressions**

Run: `bun test tests/unit/definition tests/integration/definition tests/property/goto-definition.prop.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/goto-def-identity-redeclared.test.ts src/providers/definition.ts
git commit -m "Go-to-def returns all macro redeclarations in current file (issue #135)"
```

---

### Task 5: Go-to-definition returns all same-file redeclarations for programs, scalars, matrices

**Files:**
- Modify: `src/providers/definition.ts` (`resolve_non_macro_symbols`)
- Test: extend `tests/integration/goto-def-identity-redeclared.test.ts`

**Goal:** Extend Task 4's treatment to programs, scalars, matrices. Variables are workspace-wide and keep their current behavior.

- [ ] **Step 1: Append failing tests to `tests/integration/goto-def-identity-redeclared.test.ts`**

```typescript
    it('returns both program declarations when redeclared in the same file', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'program define foo',     // line 0
            '    di "first"',
            'end',                    // line 2
            'foo',                    // line 3 (call site)
            'program define foo',     // line 4
            '    di "second"',
            'end',                    // line 6
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `foo` call at line 3
        const foo_char = content.split('\n')[3].indexOf('foo');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character: foo_char },
            undefined,
            undefined,
            indexer,
            undefined,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines).toEqual([0, 4]);
    });

    it('returns both scalar declarations when redeclared', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'scalar s = 1',        // line 0
            'di s',                // line 1 (reference)
            'scalar s = 2',        // line 2
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        const s_char = content.split('\n')[1].indexOf('s');
        const result = await provider.get_definition(
            document_state,
            { line: 1, character: s_char },
            undefined,
            undefined,
            indexer,
            undefined,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines).toEqual([0, 2]);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: both new tests FAIL.

- [ ] **Step 3: Extend `definition.ts` with a non-macro `symbol_to_locations` helper and use it**

Add a generic helper near `macro_symbol_to_locations`:

```typescript
private symbol_to_locations(symbol: {
    location: { uri: string; range: Range };
    additional_definitions?: Array<{ location: { uri: string; range: Range } }>;
}): Location[] {
    const out: Location[] = [
        { uri: symbol.location.uri, range: symbol.location.range },
    ];
    if (symbol.additional_definitions) {
        for (const my_extra of symbol.additional_definitions) {
            out.push({ uri: my_extra.location.uri, range: my_extra.location.range });
        }
    }
    return out;
}
```

Update every program/scalar/matrix lookup in `resolve_non_macro_symbols` (lines 365-430) and `resolve_word_as_macro_declaration`:

```typescript
// Before:
const program = visible.programs.get(word);
if (program) {
    return {
        uri: program.location.uri,
        range: program.location.range,
    };
}
```

```typescript
// After:
const program = visible.programs.get(word);
if (program) {
    return this.locations_to_definition(this.symbol_to_locations(program));
}
```

Replace every similar block for programs, scalars, matrices. Leave variables untouched (they do not accumulate additional_definitions, and even if they did, the semantic model keeps variables workspace-wide, so their individual symbol-site aggregation is not in scope for this task).

You can also refactor `macro_symbol_to_locations` to call `symbol_to_locations` for DRY.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: PASS for all three tests in the file.

- [ ] **Step 5: Run definition regression suite**

Run: `bun test tests/unit/definition tests/integration/definition tests/property/goto-definition.prop.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/goto-def-identity-redeclared.test.ts src/providers/definition.ts
git commit -m "Go-to-def returns all program/scalar/matrix redeclarations (issue #135)"
```

---

### Task 6: Go-to-definition includes cross-file redeclarations in the reachable chain

**Files:**
- Modify: `src/providers/definition.ts` (workspace indexer path — `as_locations`, and the workspace_indexer fallback blocks)
- Test: extend `tests/integration/goto-def-identity-redeclared.test.ts`

**Goal:** When a macro/program/scalar/matrix is redeclared in another file that is reachable through the dep graph, go-to-def surfaces that file's declarations too. Specifically, the workspace indexer's `find_symbol_definitions` already returns the primary location per-file; we additionally need to include that file's `additional_definitions` entries.

- [ ] **Step 1: Append failing test**

```typescript
    it('returns macro declarations from included file AND current file', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local helper = "lib version"',  // line 0
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',              // line 0
            'local helper = "main version"', // line 1
            'di "`helper\'"',                // line 2
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        // Cursor on `helper' at line 2
        const helper_char = main_content.split('\n')[2].indexOf('helper');
        const result = await provider.get_definition(
            document_state,
            { line: 2, character: helper_char },
            undefined,
            undefined,
            indexer,
            undefined,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const same_file = locations
            .filter(loc => loc.uri === main_uri)
            .map(loc => loc.range.start.line);
        const cross_file = locations
            .filter(loc => loc.uri === lib_uri)
            .map(loc => loc.range.start.line);
        expect(same_file).toContain(1);     // main file's `local helper`
        expect(cross_file).toContain(0);    // lib file's `local helper`
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: the new test FAILS. Currently the scope resolver resolves `helper` to the current file's declaration (line 1) and returns only that location.

- [ ] **Step 3: Update the macro-lookup resolvers to also include cross-file redeclarations**

Two changes in `src/providers/definition.ts`:

A) When the resolved scope or document symbol finds the macro, also emit the chain's other declarations for the same identity. Use `ScopeResolver` chain entries — for each `ScopeChainEntry` in `resolved_scope.chain`, look up the same macro name in `entry.symbols.localMacros` (for locals) or `entry.symbols.globalMacros` (for globals), and convert its primary + additional_definitions to `Location[]`. Pool them with the current-file result.

```typescript
// After finding the current-file symbol, add chain entries.
const out: Location[] = this.macro_symbol_to_locations(local_macro);
if (resolved_scope) {
    for (const my_entry of resolved_scope.chain) {
        const my_chain_macro = my_entry.symbols.localMacros.get(word);
        if (my_chain_macro) {
            out.push(...this.macro_symbol_to_locations(my_chain_macro));
        }
    }
    // Also include forward-call symbols (locals via `include`).
    for (const my_site of resolved_scope.forward_call_symbols ?? []) {
        if (my_site.effective_type !== 'include') continue;
        const forward_local = my_site.symbols.localMacros.get(word);
        if (forward_local) {
            out.push(...this.macro_symbol_to_locations(forward_local));
        }
    }
}
return this.locations_to_definition(this.dedupe_locations(out));
```

Implement `dedupe_locations`:

```typescript
private dedupe_locations(the_locs: Location[]): Location[] {
    const seen_keys = new Set<string>();
    const out: Location[] = [];
    for (const my_loc of the_locs) {
        const my_key = `${my_loc.uri}:${my_loc.range.start.line}:${my_loc.range.start.character}:${my_loc.range.end.line}:${my_loc.range.end.character}`;
        if (seen_keys.has(my_key)) continue;
        seen_keys.add(my_key);
        out.push(my_loc);
    }
    return out;
}
```

B) In the workspace-indexer path (current `as_locations(local_defs)` calls around lines 269 and 319), for each `LocatableSymbol` returned by `find_symbol_definitions`, also emit its `additional_definitions` entries (the indexer returns `MacroSymbol` which carries the field). Use `symbol_to_locations` for this.

```typescript
// Before:
if (workspace_indexer) {
    const local_defs = workspace_indexer.find_symbol_definitions(word, 'local');
    if (local_defs.length > 0) {
        return this.as_locations(local_defs);
    }
}
```

```typescript
// After:
if (workspace_indexer) {
    const local_defs = workspace_indexer.find_symbol_definitions(word, 'local');
    if (local_defs.length > 0) {
        const all_locs: Location[] = [];
        for (const my_def of local_defs) {
            all_locs.push(...this.symbol_to_locations(my_def));
        }
        return this.locations_to_definition(this.dedupe_locations(all_locs));
    }
}
```

Apply the same change to programs, scalars, matrices. Do NOT apply to variables (per the spec, variables are identity-by-name, and the existing workspace-wide lookup is correct).

Note: when both a scope-resolved result AND a workspace-indexer result exist (scope resolver returns first), this task's scope-resolver branch already covers in-chain cross-file defs. The workspace-indexer fallback remains for cases where no scope resolver is wired (test-only or bare setups) — and in those cases we still want to dedupe to produce a clean result.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/goto-def-identity-redeclared.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full definition regression**

Run: `bun test tests/unit/definition tests/integration/definition tests/property/goto-definition.prop.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/goto-def-identity-redeclared.test.ts src/providers/definition.ts
git commit -m "Go-to-def includes cross-file redeclarations from reachable chain (issue #135)"
```

---

## Phase 3: References Provider — Retire In-Chain Identity Split

### Task 7: Find-references pools same-file redeclarations (flat case)

**Files:**
- Modify: `src/providers/references.ts` (`find_definitions`)
- Test: `tests/integration/find-references-identity-redeclared-local.test.ts`

**Goal:** `find_definitions` returns all `additional_definitions` entries so that both `local fruit apple` and `local fruit banana` are recognized as declarations when `includeDeclaration=true`, and `apply_include_declaration`'s "represents_declaration" check recognizes both.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/find-references-identity-redeclared-local.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - redeclared local (same file)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-redecl-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools declarations and references across two same-file redeclarations', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'local fruit apple',          // line 0 (decl 1)
            'di "`fruit\' is apple"',     // line 1 (ref 1)
            'local fruit banana',         // line 2 (decl 2)
            'di "`fruit\' is banana"',    // line 3 (ref 2)
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `fruit' at line 3
        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: fruit_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        // Must include both decl lines (0, 2) and both ref lines (1, 3).
        expect(lines).toContain(0);
        expect(lines).toContain(1);
        expect(lines).toContain(2);
        expect(lines).toContain(3);
    });

    it('pools references across same-file redeclarations (includeDeclaration=false)', async () => {
        const file_path = join(test_temp_dir, 'b.do');
        const content = [
            'local fruit apple',
            'di "`fruit\' is apple"',
            'local fruit banana',
            'di "`fruit\' is banana"',
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: fruit_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const ref_lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        expect(ref_lines).toContain(1);
        expect(ref_lines).toContain(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/find-references-identity-redeclared-local.test.ts`

Expected: FAIL. The current `find_definitions` only returns the primary location (line 0), so line 2 is missed; and `apply_include_declaration`'s merge step won't add the additional line 2 when `includeDeclaration=true`. The reference lines (1, 3) may be partially present but may be incorrect depending on `collect_visible_reference_uris`.

- [ ] **Step 3: Update `find_definitions` in `src/providers/references.ts`**

Replace the macro lookup blocks (approximately lines 191-220) to emit all `additional_definitions` entries too:

```typescript
// Before:
case 'local_macro': {
    const local_macro = symbols.localMacros.get(symbol_name);
    if (local_macro) push({ uri: local_macro.location.uri, range: local_macro.location.range });
    break;
}
```

```typescript
// After:
case 'local_macro': {
    const local_macro = symbols.localMacros.get(symbol_name);
    if (local_macro) {
        push({ uri: local_macro.location.uri, range: local_macro.location.range });
        for (const my_extra of local_macro.additional_definitions ?? []) {
            push({ uri: my_extra.location.uri, range: my_extra.location.range });
        }
    }
    break;
}
```

Apply the same pattern to `global_macro`, `program`, `scalar`, `matrix`. Leave `variable` unchanged.

Also, in the workspace-indexer loop (around line 265):

```typescript
// Before:
for (const my_def of workspace_indexer.find_symbol_definitions(symbol_name, ws_type)) {
    if (my_def.sourceUri === document.uri) continue;
    ...
    push({ uri: my_def.location.uri, range: my_def.location.range });
}
```

```typescript
// After (emit additional_definitions too):
for (const my_def of workspace_indexer.find_symbol_definitions(symbol_name, ws_type)) {
    if (my_def.sourceUri === document.uri) continue;
    ...
    push({ uri: my_def.location.uri, range: my_def.location.range });
    if ('additional_definitions' in my_def && my_def.additional_definitions) {
        for (const my_extra of my_def.additional_definitions) {
            if (the_allowed_uris) {
                const range = the_allowed_uris.get(my_def.sourceUri);
                if (!range) continue;
                if (
                    range.scan_through_line !== undefined
                    && my_extra.location.range.start.line >= range.scan_through_line
                ) {
                    continue;
                }
            }
            push({ uri: my_extra.location.uri, range: my_extra.location.range });
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/find-references-identity-redeclared-local.test.ts`

Expected: PASS.

- [ ] **Step 5: Run references regression**

Run: `bun test tests/unit/references tests/integration/find-references tests/property/find-references`

Expected: all pass. If any property test was testing the over-trimming behavior, it needs updating to match the new contract. Investigate any failure by reading the failing case and comparing with the design spec.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/find-references-identity-redeclared-local.test.ts src/providers/references.ts
git commit -m "Find-references pools same-file redeclarations (issue #135)"
```

---

### Task 8: Collapse in-chain "different identity" guard in `visible-symbols.ts`

**Files:**
- Modify: `src/scope-resolver/visible-symbols.ts` (`collect_visible_reference_uris`, `classify_site`)
- Test: extend `tests/integration/find-references-identity-redeclared-local.test.ts` with cross-file case

**Goal:** When two same-name macros live in files inside the same reachable chain (e.g., a local declared in an `included` file and another in the parent), they are the same identity. The current "different identity" guard in `classify_site` must collapse to a no-op for in-chain redeclarations. Keep the guard for disjoint cases — but disjoint cases are already excluded at the outer level (dep-graph reachability), so the guard becomes effectively unneeded for non-variable kinds.

- [ ] **Step 1: Append failing test**

Add to `tests/integration/find-references-identity-redeclared-local.test.ts`:

```typescript
    it('pools local macro references across include chain (same name, same identity)', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local helper = "1"',       // line 0 (decl in lib)
            'di "`helper\' in lib"',    // line 1 (ref in lib)
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',         // line 0
            'local helper = "2"',       // line 1 (decl in main)
            'di "`helper\' in main"',   // line 2 (ref in main)
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const helper_char = main_content.split('\n')[2].indexOf('helper');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: helper_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Expect declarations + references from BOTH files.
        const lib_hits = locations.filter(loc => loc.uri === lib_uri).map(loc => loc.range.start.line).sort();
        const main_hits = locations.filter(loc => loc.uri === main_uri).map(loc => loc.range.start.line).sort();

        expect(lib_hits).toContain(0); // lib decl
        expect(lib_hits).toContain(1); // lib ref
        expect(main_hits).toContain(1); // main decl
        expect(main_hits).toContain(2); // main ref
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/find-references-identity-redeclared-local.test.ts`

Expected: the new test FAILS. With the current identity guard, the lib declaration and reference at lines 0–1 are excluded because the active symbol identity (cursor file) differs from the chain entry's identity.

- [ ] **Step 3: Modify `collect_visible_reference_uris` in `src/scope-resolver/visible-symbols.ts`**

Replace the `redeclares_different_identity` logic so that in-chain redeclarations are treated as the same identity:

Before (around lines 378-403):

```typescript
const redeclares_different_identity =
    !!site_symbol
    && get_reference_symbol_identity(site_symbol) !== active_symbol_identity;
if (redeclares_different_identity) {
    if (!effective_visible) {
        return { include: false };
    }
    if (site_symbol && site_symbol.location.uri === site.callee_uri) {
        const cutoff_line = site_symbol.location.range.start.line;
        if (cutoff_line === 0) {
            return { include: false };
        }
        return {
            include: true,
            scan_through_line: cutoff_line,
        };
    }
    return { include: false };
}
```

After — since same-name redeclarations in the reachable chain are now one identity, the guard collapses to a no-op. Drop the split entirely and fall through to the Case 4/5 logic:

```typescript
// Rule 1 (issue #135): same name + same kind within the reachable chain is
// the same identity. Two in-chain redeclarations (e.g., a parent-file local
// and an included-file local) pool into one identity; there is no
// "different identity" inside the reachable chain. Disjoint-branch
// exclusion is already provided by dep-graph reachability filtering, so the
// previous "different identity" guard is redundant and has been retired.
const site_symbol = get_reference_symbol_from_table(
    site.symbols,
    symbol_type,
    symbol_name,
);
const site_redeclares = !!site_symbol;
if (site_redeclares) {
    // The site redeclares the same-name, same-kind symbol. Include with a
    // full scan (both pre- and post-redeclaration references are part of
    // this identity's reference set).
    if (effective_visible) {
        return { include: true };
    }
    // Not yet visible, but the site declares — include as a declaration
    // source. Subsequent references before any cursor-side visibility will
    // be pooled via the full dep-graph walk. Full scan remains correct
    // because within one identity there is no "pre-redeclaration" cutoff.
    return { include: true };
}
// Case 4: no redeclaration. Promote via site_is_after_current_file_call.
if (effective_visible) {
    return { include: true };
}
// Case 5: neither defines nor inherits.
return { include: false };
```

Also update the comment block preceding `classify_site` to document the new rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/find-references-identity-redeclared-local.test.ts`

Expected: PASS.

- [ ] **Step 5: Run references regression**

Run: `bun test tests/unit/references tests/integration/find-references tests/property/find-references`

Expected: most pass. Some existing tests (issues #127/#128/#129/#132) were testing the "different identity" guard. Re-read each failure and compare with the design spec:

- Tests asserting that declarations in a file with a differently-sourced same-name symbol are EXCLUDED may need updating. If the file is dep-graph-reachable from the cursor, the new model says those declarations should be INCLUDED (same identity). If the file is NOT dep-graph-reachable (disjoint branch), exclusion remains correct and the existing dep-graph reachability filter handles it at the `the_related` level.
- Tests that specifically assert "two unrelated `helper` programs stay distinct" should keep passing; verify the test harness creates disjoint branches (no dep-graph edge) and the result stays distinct.

Update each failing test to reflect the new contract, with a comment referencing issue #135.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/find-references-identity-redeclared-local.test.ts src/scope-resolver/visible-symbols.ts
# (Include any updated regression tests.)
git commit -m "Collapse in-chain identity split for find-references (issue #135)"
```

---

### Task 9: Find-references pools globals across do/run boundaries

**Files:**
- Test: `tests/integration/find-references-identity-redeclared-global.test.ts`

**Goal:** Verify that a global set in a parent and a global with the same name set in a do-called child pool into one identity. The `collect_visible_reference_uris` change from Task 8 should make this work without further code changes.

- [ ] **Step 1: Write the failing test (if still failing) OR regression guard**

Create `tests/integration/find-references-identity-redeclared-global.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - redeclared global across do/run', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-redecl-global-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools global declarations and references across do/run boundary', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'global data "child_value"',    // line 0 decl
            'di "$data in child"',          // line 1 ref
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'global data "parent_value"',   // line 0 decl (parent)
            'do "child.do"',                // line 1
            'di "$data in parent"',         // line 2 ref
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const child_uri = URI.file(child_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        const document_state = document_store.get(parent_uri)!;

        // Cursor on $data at line 2 (after do)
        const data_char = parent_content.split('\n')[2].indexOf('$data');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: data_char + 1 },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const parent_lines = locations.filter(l => l.uri === parent_uri).map(l => l.range.start.line).sort();
        const child_lines = locations.filter(l => l.uri === child_uri).map(l => l.range.start.line).sort();

        expect(parent_lines).toContain(0);  // parent decl
        expect(parent_lines).toContain(2);  // parent ref
        expect(child_lines).toContain(0);   // child decl
        expect(child_lines).toContain(1);   // child ref
    });
});
```

- [ ] **Step 2: Run test**

Run: `bun test tests/integration/find-references-identity-redeclared-global.test.ts`

Expected: likely PASS already due to Task 8. If it FAILS, the failure pinpoints what else needs changing — most likely the dep-graph reachability of a `do` target, or additional handling inside `find_definitions` for cross-file globals.

- [ ] **Step 3: If the test passes, commit as a regression guard. If it fails, diagnose and fix.**

Most likely diagnosis: the child file's `global data` is stored as a primary symbol in the indexer for `child.do`. The parent's `find_definitions` call for globals pools the additional_definitions of the indexer's matches (Task 7). The `collect_visible_reference_uris` call with the Task 8 changes should include `child.do`. If the test fails, add logging to `collect_visible_reference_uris` to check whether `child.do` is being included in `the_related`.

If `child.do` is excluded, the problem is likely that the scope chain for `parent.do` does not include `child.do` as a chain entry (because `child.do` is a `do`-called child, not an `include`-ed parent). The scope resolver's backward chain is parent-to-child for `done-by`/`included-by`. The forward direction (parent calls child via `do`) is covered by `scope.forward_call_symbols`. Verify that `classify_site` handles the forward site and the Task 8 change correctly treats the child's `global data` as the same identity.

If a forward-site-specific fix is needed, extend the Task 8 change to also pool `forward_call_symbols` entries.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/find-references-identity-redeclared-global.test.ts
# Include any fix in src/ if applicable.
git commit -m "Find-references pools globals across do/run boundary (issue #135)"
```

---

### Task 10: Regression guard — local-macro chain does not widen to do/run

**Files:**
- Test: `tests/integration/find-references-identity-locals-do-boundary.test.ts`

**Goal:** A local declared in a `do`-called child is a distinct identity from a same-name local in the parent. Ensure the references provider preserves this (Stata semantics).

- [ ] **Step 1: Write the test**

Create `tests/integration/find-references-identity-locals-do-boundary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - local macro do/run boundary (regression guard)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-local-boundary-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not pool local macros across do boundary', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'local fruit cherry',           // line 0 (child's local)
            'di "`fruit\'"',                // line 1 (child's ref)
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'local fruit apple',            // line 0 (parent's local)
            'do "child.do"',                // line 1
            'di "`fruit\'"',                // line 2 (parent's ref)
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        const document_state = document_store.get(parent_uri)!;

        // Cursor on `fruit' at line 2 (parent's)
        const fruit_char = parent_content.split('\n')[2].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: fruit_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Must NOT include the child's decl or ref.
        const child_hits = locations.filter(l => l.uri === child_uri);
        expect(child_hits.length).toBe(0);
    });
});
```

- [ ] **Step 2: Run test**

Run: `bun test tests/integration/find-references-identity-locals-do-boundary.test.ts`

Expected: PASS (Tier 1 already restricts locals to include-chain files). If it FAILS, the Task 8 change has accidentally widened locals to do/run — fix by confirming `can_reference_chain_entry` / `can_reference_forward_site` still returns `false` for `local_macro` with `done-by`/`run`/`do` direction.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-identity-locals-do-boundary.test.ts
git commit -m "Regression guard: locals do not pool across do/run boundary (issue #135)"
```

---

### Task 11: Regression guard — same-named programs in disjoint branches stay distinct

**Files:**
- Test: `tests/integration/find-references-identity-disjoint-branches.test.ts`

**Goal:** Rule 2: two programs named `helper` in disjoint branches of the dep graph stay distinct. Verify the dep-graph reachability filter provides this protection.

- [ ] **Step 1: Write the test**

Create `tests/integration/find-references-identity-disjoint-branches.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - disjoint branches (Rule 2 regression guard)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-disjoint-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not pool same-named programs across unrelated dep-graph branches', async () => {
        // Two unrelated "analyses" that each define a program named `helper`.
        // No do/run/include edges between them — disjoint branches.
        const analysis_a_path = join(test_temp_dir, 'analysis_a.do');
        writeFileSync(
            analysis_a_path,
            'program define helper\n    di "A"\nend\nhelper\n'
        );

        const analysis_b_path = join(test_temp_dir, 'analysis_b.do');
        writeFileSync(
            analysis_b_path,
            'program define helper\n    di "B"\nend\nhelper\n'
        );

        await indexer.initialize([test_temp_dir]);
        const a_uri = URI.file(analysis_a_path).toString();
        const b_uri = URI.file(analysis_b_path).toString();
        const a_content = 'program define helper\n    di "A"\nend\nhelper\n';
        await document_store.open(a_uri, a_content, 1);
        const document_state = document_store.get(a_uri)!;

        // Cursor on `helper` call at line 3 in analysis_a.do
        const helper_char = a_content.split('\n')[3].indexOf('helper');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: helper_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Must NOT include analysis_b.do.
        const b_hits = locations.filter(l => l.uri === b_uri);
        expect(b_hits.length).toBe(0);
    });
});
```

- [ ] **Step 2: Run test**

Run: `bun test tests/integration/find-references-identity-disjoint-branches.test.ts`

Expected: PASS. (Tier 2 restricts to dep-graph-reachable files. No edges means analysis_b is not reachable from analysis_a.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-identity-disjoint-branches.test.ts
git commit -m "Regression guard: disjoint branches stay distinct for programs (issue #135)"
```

---

## Phase 4: Symmetric Reachability

### Task 12: Find-references walks upward via `callee_to_callers`

**Files:**
- Modify: `src/providers/references.ts` (`collect_references`) or `src/scope-resolver/visible-symbols.ts`
- Test: `tests/integration/find-references-identity-symmetric.test.ts`

**Goal:** If file A `include`s B, find-references from inside B returns references/declarations from A too. Use the dependency graph's `callee_to_callers` reverse index to walk upward.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/find-references-identity-symmetric.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - symmetric reachability', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-symmetric-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('include chain: query from the included file reaches upward to the includer', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local shared = "1"',         // line 0 decl
            'di "`shared\'"',             // line 1 ref
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',           // line 0
            'di "`shared\' in main"',     // line 1 ref
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        // Query from INSIDE lib.do (the included end).
        await document_store.open(lib_uri, lib_content, 1);
        const document_state = document_store.get(lib_uri)!;

        const shared_char = lib_content.split('\n')[1].indexOf('shared');
        const locations = await provider.get_references(
            document_state,
            { line: 1, character: shared_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Must include the main.do reference (line 1 of main.do).
        const main_lines = locations.filter(l => l.uri === main_uri).map(l => l.range.start.line);
        expect(main_lines).toContain(1);
    });

    it('do chain: global refs queried from child file reach upward to parent', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'global shared = "1"',       // line 0 decl
            'di "$shared"',              // line 1 ref
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'do "child.do"',             // line 0
            'di "$shared in parent"',    // line 1 ref
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const child_uri = URI.file(child_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const shared_char = child_content.split('\n')[1].indexOf('shared');
        const locations = await provider.get_references(
            document_state,
            { line: 1, character: shared_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const parent_lines = locations.filter(l => l.uri === parent_uri).map(l => l.range.start.line);
        expect(parent_lines).toContain(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/find-references-identity-symmetric.test.ts`

Expected: FAIL. Currently `collect_visible_reference_uris` walks only downward (chain entries + forward calls), not upward.

- [ ] **Step 3: Add upward walk**

Two possible approaches:

A) Extend `collect_references` in `src/providers/references.ts` to union in upward-reachable URIs before filtering.

B) Extend `collect_visible_reference_uris` in `src/scope-resolver/visible-symbols.ts`.

Recommended: A (simpler; keeps `visible-symbols.ts` focused on pre-computed scope chains, and the upward walk is a dep-graph query orthogonal to the scope-chain structure).

In `src/providers/references.ts`, `collect_references` (around line 815), after computing `the_related` via `collect_visible_reference_uris` or the fallback, union with upward-reachable URIs:

```typescript
// Symmetric reachability (issue #135): find-references from the callee's end
// must reach upward into the caller. The dep graph exposes
// `callee_to_callers`; walk it and add every reachable ancestor to
// `the_related`. Use the same per-kind edge rule:
//   - locals: only 'include' edges upward (Stata's include-chain semantics)
//   - globals/programs/scalars/matrices: all edges (do/run/include)
//   - variables: already workspace-wide; skip.
if (workspace_indexer && restrict_to_related && symbol_type !== 'variable') {
    const upward_kind = symbol_type === 'local_macro' ? 'include_only' : 'all';
    const upward = workspace_indexer.get_upward_related_uris(
        document.uri,
        { include_only: symbol_type === 'local_macro' },
    );
    for (const my_uri of upward) {
        if (!the_related.has(my_uri)) {
            the_related.set(my_uri, {});
        }
    }
}
```

Add `get_upward_related_uris` to `WorkspaceIndexer` if it does not exist. It should be the mirror of `get_related_uris` but using `callee_to_callers`. Check `src/indexer/index.ts` and `src/dependency-graph/` for existing methods. If `get_related_uris` already returns both directions, this step is a no-op.

If `get_upward_related_uris` does not exist, create it:

```typescript
// In src/indexer/index.ts, near get_related_uris:
get_upward_related_uris(
    uri: string,
    options?: { include_only?: boolean }
): Set<string> {
    if (!this.dependency_graph) return new Set();
    return this.dependency_graph.walk_ancestors(uri, options);
}
```

And add `walk_ancestors` to `DependencyGraph`:

```typescript
// In src/dependency-graph/index.ts:
walk_ancestors(
    uri: string,
    options?: { include_only?: boolean }
): Set<string> {
    // DFS up the dep graph via callee_to_callers. A stack (pop from end)
    // is intentional — order does not matter for set membership, and a
    // stack avoids the O(n) cost of shift().
    const out = new Set<string>();
    const the_stack = [uri];
    while (the_stack.length > 0) {
        const my_current = the_stack.pop()!;
        const the_callers = this.callee_to_callers.get(my_current);
        if (!the_callers) continue;
        for (const my_caller of the_callers) {
            if (options?.include_only && my_caller.edge_type !== 'include') continue;
            if (out.has(my_caller.uri)) continue;
            out.add(my_caller.uri);
            the_stack.push(my_caller.uri);
        }
    }
    return out;
}
```

(Adjust to match the actual `callee_to_callers` shape in `dependency-graph/index.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/find-references-identity-symmetric.test.ts`

Expected: PASS.

- [ ] **Step 5: Full references regression**

Run: `bun test tests/unit/references tests/integration/find-references tests/property/find-references`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/find-references-identity-symmetric.test.ts src/providers/references.ts src/indexer/index.ts src/dependency-graph/index.ts
git commit -m "Add symmetric reachability to find-references (issue #135)"
```

---

## Phase 5: Variable Sort

### Task 13: Variable references sorted reachable-first

**Files:**
- Modify: `src/providers/references.ts` (`collect_references` — the variable path and `sort_locations`)
- Test: `tests/integration/find-references-variables-sort.test.ts`

**Goal:** When the symbol is a variable, the workspace-wide result set is sorted so files dep-graph-reachable from the cursor appear first; within each group, preserve the existing URI/line order.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/find-references-variables-sort.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find-references - variables sorted reachable-first', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-var-sort-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('sorts reachable file refs before non-reachable refs', async () => {
        // main.do do "sub.do" — reachable pair.
        // unrelated.do — not in dep graph.
        const sub_path = join(test_temp_dir, 'sub.do');
        writeFileSync(sub_path, 'di cm_birth\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'gen cm_birth = 1',    // line 0 decl
            'do "sub.do"',         // line 1
            'di cm_birth',         // line 2 ref
        ].join('\n');
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        writeFileSync(unrelated_path, 'di cm_birth\n');

        await indexer.initialize([test_temp_dir]);
        const sub_uri = URI.file(sub_path).toString();
        const main_uri = URI.file(main_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const cm_char = main_content.split('\n')[2].indexOf('cm_birth');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: cm_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Expect three URIs in the result. Reachable first (main, sub), then unrelated.
        const ordered_uris = locations.map(l => l.uri);
        const first_reachable_idx = Math.min(
            ordered_uris.indexOf(main_uri),
            ordered_uris.indexOf(sub_uri),
        );
        const last_reachable_idx = Math.max(
            ordered_uris.lastIndexOf(main_uri),
            ordered_uris.lastIndexOf(sub_uri),
        );
        const unrelated_idx = ordered_uris.indexOf(unrelated_uri);

        expect(first_reachable_idx).toBeLessThan(unrelated_idx);
        expect(last_reachable_idx).toBeLessThan(unrelated_idx);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/find-references-variables-sort.test.ts`

Expected: likely FAIL. Current variable sort groups by URI lexically; unrelated.do may come before main.do by alphabet.

- [ ] **Step 3: Modify `sort_locations` (or `collect_references`) to apply reachable-first sort for variables**

Locate `sort_locations` in `src/providers/references.ts` (near `apply_include_declaration`). Extend its signature and contract so that when given a set of reachable URIs, reachable-origin entries come first:

```typescript
// Before:
private sort_locations(locations: Location[], related_uris?: Set<string>): Location[] {
    return locations.slice().sort((a, b) => {
        if (a.uri !== b.uri) return a.uri.localeCompare(b.uri);
        if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
        return a.range.start.character - b.range.start.character;
    });
}
```

```typescript
// After:
private sort_locations(locations: Location[], related_uris?: Set<string>): Location[] {
    return locations.slice().sort((a, b) => {
        if (related_uris) {
            const a_reachable = related_uris.has(a.uri);
            const b_reachable = related_uris.has(b.uri);
            if (a_reachable !== b_reachable) {
                return a_reachable ? -1 : 1;
            }
        }
        if (a.uri !== b.uri) return a.uri.localeCompare(b.uri);
        if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
        return a.range.start.character - b.range.start.character;
    });
}
```

In `collect_references`, when `symbol_type === 'variable'`, compute the reachable set (via `get_related_uris` + upward walk) and pass it to `apply_include_declaration` / `sort_locations`. Currently the `restrict_to_related ? undefined : new Set(the_related.keys())` ternary passes `undefined` for variables. Change the variable path so `the_related` is filled with reachable URIs (for sorting only, not filtering), and pass that set to `apply_include_declaration`:

```typescript
// Before:
const restrict_to_related = symbol_type !== 'variable';
let the_related: Map<string, ReferenceScanRange>;
if (!workspace_indexer) {
    the_related = new Map([[document.uri, {}]]);
} else if (
    restrict_to_related &&
    resolved_scope !== undefined &&
    cursor_line !== undefined
) {
    the_related = collect_visible_reference_uris(...);
} else {
    const the_fallback_set = ...;
    the_related = new Map(...);
}
```

Add a parallel, always-computed "reachable hint" map for variables used only for sorting (and keep the existing `the_related` behavior for filtering):

```typescript
// Variable path: compute a reachable hint set for sort ordering.
let variable_reachable_hint: Set<string> | undefined;
if (symbol_type === 'variable' && workspace_indexer) {
    const downward = workspace_indexer.get_related_uris(document.uri);
    const upward = workspace_indexer.get_upward_related_uris(document.uri, { include_only: false });
    variable_reachable_hint = new Set([...downward, ...upward, document.uri]);
}
```

Pass `variable_reachable_hint` to `apply_include_declaration` in place of `undefined` when `symbol_type === 'variable'`:

```typescript
return this.apply_include_declaration(
    locations,
    definitions,
    include_declaration,
    restrict_to_related
        ? undefined
        : (variable_reachable_hint ?? new Set(the_related.keys())),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/find-references-variables-sort.test.ts`

Expected: PASS.

- [ ] **Step 5: Full references regression**

Run: `bun test tests/unit/references tests/integration/find-references tests/property/find-references`

Expected: all pass. Check `find-references-ordering.prop.test.ts` specifically — it asserts URI/line ordering; the new reachable-first rule should be orthogonal (same-group ordering preserved).

- [ ] **Step 6: Commit**

```bash
git add tests/integration/find-references-variables-sort.test.ts src/providers/references.ts
git commit -m "Sort variable references reachable-first (issue #135)"
```

---

## Phase 6: Hover Redefinition Footer

### Task 14: Hover footer — same-file redeclarations only

**Files:**
- Modify: `src/providers/hover.ts` (`get_local_macro_hover`, `get_global_macro_hover`, `get_program_hover`, `get_scalar_hover`, `get_matrix_hover`)
- Test: `tests/unit/hover-redefinition-footer.test.ts`

**Goal:** When a symbol has `additional_definitions` that are all in the same file as the primary, append a footer listing the other line numbers.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hover-redefinition-footer.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { HoverProvider } from '../../src/providers/hover';
import { DocumentStore } from '../../src/document-store';
import type { MarkupContent } from 'vscode-languageserver';

async function hover_at(source: string, line: number, character: number): Promise<MarkupContent | null> {
    const document_store = new DocumentStore();
    const uri = 'file:///test.do';
    await document_store.open(uri, source, 1);
    const document_state = document_store.get(uri)!;
    const hover_provider = new HoverProvider();
    const result = await hover_provider.get_hover(
        document_state,
        { line, character },
        undefined,
        undefined,
        undefined,
    );
    return result?.contents as MarkupContent | null;
}

describe('Hover redefinition footer - same-file only', () => {
    it('shows redefined-at footer for redeclared local macro', async () => {
        const source = [
            'local fruit apple',      // line 0 (primary)
            'di "`fruit\'"',          // line 1
            'local fruit banana',     // line 2
            'di "`fruit\'"',          // line 3
            'local fruit cherry',     // line 4
        ].join('\n');
        // Cursor on `fruit' at line 1.
        const content = await hover_at(source, 1, 6);
        expect(content).not.toBeNull();
        const text = content!.value;
        // Primary definition info.
        expect(text).toContain('Local Macro');
        // Footer: 1-indexed lines for redefinitions.
        expect(text).toContain('Redefined at lines 3, 5');
        // No file-count text for same-file-only case.
        expect(text).not.toContain('other files');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/hover-redefinition-footer.test.ts`

Expected: FAIL. Hover does not emit a footer.

- [ ] **Step 3: Add a `format_redefinition_footer` helper and use it**

In `src/providers/hover.ts`, near the top of the class, add:

```typescript
/**
 * Build a redefinition footer for a symbol with additional_definitions.
 * Variants:
 * - Same-file only: "Redefined at lines 3, 5 — see all references"
 * - Cross-file only: "Redefined in 2 other files — see all references"
 * - Mixed: "Redefined at lines 3 and in 2 other files — see all references"
 * Returns empty string when additional_definitions is empty or undefined.
 */
private format_redefinition_footer(
    primary_uri: string,
    additional_definitions: Array<{
        line: number;
        location: { uri: string };
    }> | undefined
): string {
    if (!additional_definitions || additional_definitions.length === 0) {
        return '';
    }
    const same_file_lines: number[] = [];
    const other_file_uris = new Set<string>();
    for (const my_extra of additional_definitions) {
        if (my_extra.location.uri === primary_uri) {
            same_file_lines.push(my_extra.line + 1); // LSP is 0-indexed; hover is 1-indexed.
        } else {
            other_file_uris.add(my_extra.location.uri);
        }
    }
    same_file_lines.sort((a, b) => a - b);

    const has_same_file = same_file_lines.length > 0;
    const has_cross_file = other_file_uris.size > 0;
    const file_word = other_file_uris.size === 1 ? 'other file' : 'other files';

    let body: string;
    if (has_same_file && has_cross_file) {
        body = `Redefined at lines ${same_file_lines.join(', ')} and in ${other_file_uris.size} ${file_word}`;
    } else if (has_same_file) {
        body = `Redefined at lines ${same_file_lines.join(', ')}`;
    } else {
        body = `Redefined in ${other_file_uris.size} ${file_word}`;
    }
    return `\n\n${body} — see all references`;
}
```

Then at every `MacroSymbol`, `ProgramSymbol`, `ScalarSymbol`, `MatrixSymbol` hover builder, append the footer:

```typescript
// Example for local macros (around line 527):
const footer = this.format_redefinition_footer(
    local_macro.location.uri,
    local_macro.additional_definitions,
);
return {
    kind: MarkupKind.Markdown,
    value: `**Local Macro:** \`${word}\`${source_info}${expansion_text}${footer}`,
};
```

Apply the same pattern for each of the 6+ hover builders in `hover.ts`:
- `get_local_macro_hover` (both resolved_scope and document paths)
- `get_global_macro_hover` (both paths)
- `get_program_hover` / `get_hover_for_user_program` (programs)
- `get_scalar_hover`
- `get_matrix_hover`

(Variables do not currently accumulate `additional_definitions`, so skip — or extend later as a follow-up.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/hover-redefinition-footer.test.ts`

Expected: PASS.

- [ ] **Step 5: Full hover regression**

Run: `bun test tests/unit/hover tests/unit/providers/hover tests/integration/hover tests/property/hover-completeness.prop.test.ts tests/property/providers/hover.test.ts tests/property/hover-out-of-scope.prop.test.ts tests/property/syntax-command-hover.prop.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/hover-redefinition-footer.test.ts src/providers/hover.ts
git commit -m "Hover footer for same-file redeclarations (issue #135)"
```

---

### Task 15: Hover footer — cross-file-only and mixed variants

**Files:**
- Test: extend `tests/unit/hover-redefinition-footer.test.ts` with cross-file cases

**Goal:** Cover the remaining two variants of the footer using the helper added in Task 14. Since `format_redefinition_footer` already handles all three variants, these tests are verification guards.

- [ ] **Step 1: Append tests**

```typescript
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';

describe('Hover redefinition footer - cross-file variants', () => {
    // Integration-style: multi-file workspace with indexer to exercise
    // cross-file additional_definitions merging.
    it('shows "N other files" footer when all redefinitions are cross-file', async () => {
        const test_temp_dir = mkdtempSync(join(tmpdir(), 'hover-cross-'));
        try {
            // Three files: a central lib.do, and two callers that each
            // redeclare `global data`.
            const lib_path = join(test_temp_dir, 'lib.do');
            writeFileSync(lib_path, 'global data = "lib"\n');
            const a_path = join(test_temp_dir, 'a.do');
            writeFileSync(a_path, 'include "lib.do"\nglobal data = "a"\ndi "$data"\n');
            const b_path = join(test_temp_dir, 'b.do');
            writeFileSync(b_path, 'include "lib.do"\nglobal data = "b"\n');

            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(new DependencyGraph());
            await indexer.initialize([test_temp_dir]);

            const document_store = new DocumentStore();
            const lib_uri = URI.file(lib_path).toString();
            const lib_content = 'global data = "lib"\n';
            await document_store.open(lib_uri, lib_content, 1);
            const document_state = document_store.get(lib_uri)!;

            const provider = new HoverProvider();
            const result = await provider.get_hover(
                document_state,
                { line: 0, character: 12 },  // on `data`
                undefined,
                undefined,
                indexer,
                undefined,
            );
            const content = result?.contents as MarkupContent | null;
            expect(content).not.toBeNull();
            const text = content!.value;
            expect(text).toMatch(/Redefined in \d+ other files?/);
        } finally {
            if (existsSync(test_temp_dir)) rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('shows mixed footer when redefinitions are in same file and other files', async () => {
        const test_temp_dir = mkdtempSync(join(tmpdir(), 'hover-mixed-'));
        try {
            const lib_path = join(test_temp_dir, 'lib.do');
            writeFileSync(lib_path, [
                'global data = "lib1"',   // line 0
                'global data = "lib2"',   // line 1 (same-file redecl)
            ].join('\n'));
            const a_path = join(test_temp_dir, 'a.do');
            writeFileSync(a_path, 'include "lib.do"\nglobal data = "a"\n');

            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(new DependencyGraph());
            await indexer.initialize([test_temp_dir]);

            const document_store = new DocumentStore();
            const lib_uri = URI.file(lib_path).toString();
            const lib_content = 'global data = "lib1"\nglobal data = "lib2"\n';
            await document_store.open(lib_uri, lib_content, 1);
            const document_state = document_store.get(lib_uri)!;

            const provider = new HoverProvider();
            const result = await provider.get_hover(
                document_state,
                { line: 0, character: 12 },
                undefined,
                undefined,
                indexer,
                undefined,
            );
            const content = result?.contents as MarkupContent | null;
            expect(content).not.toBeNull();
            const text = content!.value;
            expect(text).toMatch(/Redefined at lines 2 and in \d+ other files?/);
        } finally {
            if (existsSync(test_temp_dir)) rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/unit/hover-redefinition-footer.test.ts`

Expected: MAY FAIL if the hover builder doesn't see cross-file `additional_definitions`. In that case, the hover path needs to aggregate `additional_definitions` from workspace-indexed matches.

- [ ] **Step 3 (if failing): Thread workspace-indexed additional_definitions into the hover**

Update each hover builder path that falls back to `workspace_symbols` or `workspace_indexer`: when the symbol is found in the workspace index, build a synthetic combined list that includes the primary file's additional_definitions + every cross-file match's primary location (and its own additional_definitions).

In practice, the simplest fix is to build a "full identity view" of the symbol at hover time: call `workspace_indexer.find_symbol_definitions(name, type)` and fold every matching entry's primary + additional_definitions into a single `additional_definitions`-shaped array. Pass that into `format_redefinition_footer`.

**Performance note.** `workspace_indexer.find_symbol_definitions` is O(F) in the number of indexed files (it iterates every entry in `symbol_index.values()` — see `src/indexer/index.ts:740`). Hover fires per mouse rest, so calling this on every hover can become noticeable on large workspaces. Mitigations, in order of preference:

1. **Gate the call behind "did we actually find a primary?"** — only invoke `find_symbol_definitions` when the hover is for a real symbol (we're about to render the hover card anyway), not on every mouse move over whitespace. The existing hover builders already return early when `word` is empty or not a symbol, so this is usually free.
2. **Skip the call when we already have enough info** — if the resolved scope / document symbol path already produced a full `additional_definitions` array and there is no parent/child dep-graph edge, skip the workspace index lookup entirely.
3. **If profiling shows this is still hot**, add a small LRU cache keyed on `(workspace_indexer.get_version(), name, type)` inside the hover provider. The indexer exposes a monotonic `version` so cache invalidation is just a version comparison. Do **not** add this speculatively — add only if a profile shows a regression.

Document this decision in a short comment above the `find_symbol_definitions` call so the next reader understands why it's deliberately direct (no cache) and what triggers a rethink. Do not premature-optimize with a cache in this task; verify with the hover regression suite that performance is acceptable first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/hover-redefinition-footer.test.ts`

Expected: PASS.

- [ ] **Step 5: Full hover regression**

Run: `bun test tests/unit/hover tests/unit/providers/hover tests/integration/hover tests/property/hover-completeness.prop.test.ts tests/property/providers/hover.test.ts tests/property/hover-out-of-scope.prop.test.ts tests/property/syntax-command-hover.prop.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/hover-redefinition-footer.test.ts src/providers/hover.ts
git commit -m "Hover footer for cross-file and mixed redeclarations (issue #135)"
```

---

## Phase 7: Completion Verification

### Task 16: Completion dedups redeclared locals (regression guard)

**Files:**
- Test: `tests/integration/completion-dedup-redeclared.test.ts`

**Goal:** Verify that a file with two `local fruit` declarations produces exactly one `fruit` completion item with stable ranking, independent of which declaration is "primary."

- [ ] **Step 1: Write the test**

Create `tests/integration/completion-dedup-redeclared.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { DocumentStore } from '../../src/document-store';

describe('Completion dedups redeclared symbols', () => {
    it('offers `fruit` exactly once when two `local fruit` declarations exist', async () => {
        const source = [
            'local fruit apple',
            'local fruit banana',
            'di "`fru',
        ].join('\n');
        const document_store = new DocumentStore();
        const uri = 'file:///test.do';
        await document_store.open(uri, source, 1);
        const document_state = document_store.get(uri)!;

        const completion_provider = new CompletionProvider();
        const result = await completion_provider.get_completions(
            document_state,
            { line: 2, character: 7 },
            undefined,
            undefined,
            undefined,
        );

        const fruit_items = result.items.filter(item => item.label === 'fruit');
        expect(fruit_items.length).toBe(1);
    });
});
```

- [ ] **Step 2: Run test**

Run: `bun test tests/integration/completion-dedup-redeclared.test.ts`

Expected: PASS (the existing `seen_labels` dedup handles this). If it FAILS, the completion provider needs investigation — the `seen_labels` Set should already be catching duplicates.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/completion-dedup-redeclared.test.ts
git commit -m "Regression guard: completion dedups redeclared locals (issue #135)"
```

---

## Phase 8: Documentation

### Task 17: Rewrite `docs/find-references.md`

**Files:**
- Modify: `docs/find-references.md`

**Goal:** Update the three-tier scoping model to reflect the new identity rules. Preserve rationale blocks; add explicit statements for globals across do/run and for programs/scalars/matrices.

- [ ] **Step 1: Rewrite `docs/find-references.md`**

Replace the entire contents of `docs/find-references.md` with:

```markdown
# Find References — Design Notes

This page documents a deliberate design decision in Sight's Find References
feature. It is not a usage guide.

## Three-Tier Scoping Model (Identity Edition)

The references provider applies different scoping rules depending on symbol
type. **Within the reachable chain, name + kind is identity; across disjoint
branches of the dep graph, the name is coincidental.** (See issue #135 for
the rationale; previous versions of this model over-trimmed by splitting
same-file and in-chain redeclarations into separate identities.)

| Symbol type | Scope | Identity |
|---|---|---|
| **Local macros** | Include-chain files only (no `do`/`run`) | Same name + `local` kind within include chain = one identity |
| **Global macros, programs, scalars, matrices** | Dep-graph-reachable files (all `do`/`run`/`include` edges) | Same name + same kind within the dep-graph-reachable set = one identity |
| **Variables** | Entire workspace | Always same name = same identity; reachability only affects sort order |

## Rules

### Rule 1 — Same identity for redeclarations within the reachable chain

Two declarations of the same name + same kind, reachable from the cursor's
file, are **the same symbol**. This applies whether they sit in the same
file, in sibling branches of an `if/else`, in a parent file and a do-called
child, or anywhere else in the reachable chain.

Find-references pools all reference sites across these declarations.
Go-to-definition returns every declaration as a target location (LSP
supports multi-location results).

### Rule 2 — Unrelated branches stay out

Two declarations of the same name that are **not** mutually reachable
through the dep graph remain distinct. Two `helper` programs in unrelated
analyses stay distinct, preventing pooling of coincidentally same-named
symbols.

### Rule 3 — Reachability is static only

"Reachable" is determined purely from static `do`/`run`/`include` edges.
Sight does not trace data-flow: a script that writes a `.dta` file and a
downstream script that reads it are not connected.

### Reachability is symmetric

Find-references reaches both downward (callees) and upward (callers). If
file A `include`s B, a query from inside B returns references in A too.

## Rationale

**Why local macros are narrowest:** Stata only propagates local macros
through `include`, never through `do` or `run`. A local macro with the
same name in a `do`-called child is a separate, unrelated macro.

**Why global macros and code symbols are dep-graph-scoped:** These symbols
outlive `do`/`run` boundaries, so any path through the dep graph pools
them into one identity. A global set in a parent and a same-named global
set in a do-called child are the same identity — both are reachable
through the dep graph. Programs, scalars, and matrices follow the same
rule: same name within the reachable set = same identity.

**Why variables are workspace-wide:** Stata dataset columns are
legitimately shared across unrelated analyses. Column names like `id`,
`year`, or `analysis_sample` frequently refer to the same underlying
dataset column across many unrelated `.do` files. Even when Sight *can*
identify the recode chain, the user may still want the identically-named
columns from sibling surveys. Results are sorted so dep-graph-reachable
files appear first (see [sort order](#variable-result-ordering) below).

## Variable Result Ordering

Variable references are sorted in two groups:

1. **Reachable group:** files reachable through the dep graph from the
   cursor's file (both directions). Within this group, results are ordered
   by URI then by line.
2. **Non-reachable group:** every other file in the workspace. Same
   within-group ordering.

Future work (out of scope for issue #135): grouping non-reachable results
by recode-chain cluster (e.g., NSFG, DHS) with a UI affordance. Useful,
but requires defining chain labels and handling multi-chain files.

## Hover and Redefinition Footer

When a symbol has multiple definitions across the reachable chain, hover
shows the first definition (ordered by preorder index) and appends a
footer summarizing the others:

- **Same-file only:** `Redefined at lines 12, 17, 23 — see all references`
- **Cross-file only:** `Redefined in 2 other files — see all references`
- **Mixed:** `Redefined at lines 12, 17 and in 2 other files — see all references`

The footer directs the user to find-references for granular locations
(paths are intentionally omitted from the footer to keep it compact).

## Implementation

- `src/providers/references.ts::collect_references` — main reference
  collection logic. Look for the "Search workspace-indexed files" comment.
  The dep-graph reachability walk is the primary filter; same-identity
  pooling happens inside `collect_visible_reference_uris`.
- `src/providers/definition.ts::resolve_*` — each resolver now returns all
  reachable same-identity declaration sites, not just the primary.
- `src/scope-resolver/visible-symbols.ts::collect_visible_reference_uris`
  — computes which URIs participate in find-references. The former
  "active visible symbol instance" identity filter has been retired for
  the in-chain case; disjoint-branch exclusion is provided by dep-graph
  reachability upstream.
- `src/providers/hover.ts::format_redefinition_footer` — produces the
  hover footer variants described above.

## Performance

Pooling same-identity references has a worst case for names like
`local i`, `local j`, `local tmp` reused heavily within one dep graph.
Rule 2 bounds the blast radius across disjoint branches; Rule 1 still
surfaces all uses within one recode chain. Measurement and observed
characteristics are intentionally left to a follow-up — instrumented
`collect_references` is the plan; hard caps or lazy enumeration are
candidates for future issues if measurement warrants.
```

- [ ] **Step 2: Verify the file is rewritten**

Run: `wc -l docs/find-references.md` — expect a reasonable line count (approximately 80–120).

- [ ] **Step 3: Commit**

```bash
git add docs/find-references.md
git commit -m "Rewrite find-references docs for new identity model (issue #135)"
```

---

## Phase 9: Final Integration Checks

### Task 18: Full test suite pass and typecheck

**Files:**
- None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`

Expected: all pass. If failures appear, diagnose and fix. Do NOT mark this task complete until all tests pass.

- [ ] **Step 3: Review open regressions against the design spec**

For each failing test that was updated during Tasks 7–8, confirm in a comment (and in the commit message) that the change aligns with the design spec. No test should be "adjusted" without a spec-level justification.

- [ ] **Step 4: Commit any test adjustments**

```bash
git add tests/
git commit -m "Align regression tests with new identity model (issue #135)"
```

---

## Completion Criteria

- All new integration tests pass:
  - `tests/integration/find-references-identity-redeclared-local.test.ts`
  - `tests/integration/find-references-identity-redeclared-global.test.ts`
  - `tests/integration/find-references-identity-disjoint-branches.test.ts`
  - `tests/integration/find-references-identity-symmetric.test.ts`
  - `tests/integration/find-references-identity-locals-do-boundary.test.ts`
  - `tests/integration/find-references-variables-sort.test.ts`
  - `tests/integration/goto-def-identity-redeclared.test.ts`
  - `tests/integration/completion-dedup-redeclared.test.ts`
- New unit tests pass:
  - `tests/unit/types-additional-definitions.test.ts`
  - `tests/unit/analyzer-additional-definitions-program.test.ts`
  - `tests/unit/analyzer-additional-definitions-scalar-matrix.test.ts`
  - `tests/unit/hover-redefinition-footer.test.ts`
- Existing test suite continues to pass (with updates where required to
  align with the new identity model — each update commented with
  rationale).
- `docs/find-references.md` rewritten.
- `bun run typecheck` clean.
- Every commit has a descriptive message referencing issue #135.

---

## Self-Review (performed after plan finalization)

1. **Spec coverage:** Every bullet in the design spec's "Concrete changes"
   block maps to a task:
   - `src/analyzer/index.ts` → Tasks 2, 3 (plus Task 1 type extension).
   - `src/providers/definition.ts` → Tasks 4, 5, 6.
   - `src/providers/references.ts` → Tasks 7, 9, 12, 13.
   - `src/scope-resolver/visible-symbols.ts` → Task 8.
   - `src/providers/hover.ts` → Tasks 14, 15.
   - `src/providers/completion.ts` → Task 16 (verification).
   - `docs/find-references.md` → Task 17.
   - Test plan from the spec is covered by the eight new integration tests.
2. **Placeholders:** Each code block shows the before/after diff or the
   exact new content. No `// implement later` comments.
3. **Type consistency:** `macro_symbol_to_locations`, `symbol_to_locations`,
   `locations_to_definition`, `dedupe_locations`, and
   `format_redefinition_footer` are used consistently across tasks.

---

## Plan Drift Log (Implementation Notes for Reviewers)

This section records where the plan's prescribed code or tests diverged
from what actually shipped. Each item explains *why* the drift was
necessary so a reviewer can assess whether the change is faithful to the
design intent.

### Phase 4 — Task 13 (Phase 5 in commit history)

- **Plan text referenced a non-existent helper** `get_upward_related_uris`
  for upward reachability in the variable sort. The codebase already had
  `workspace_indexer.get_related_uris(uri)`, which returns the full
  bidirectional reachable set, and the variable tier already sorted
  reachable-first (landed in commit `2fe11ab` long before #135). Task 13
  shipped as a regression-guard-only commit (commit `582ee27`) —
  `tests/integration/find-references-variables-sort.test.ts` — covering
  both wiring variants (fallback path with no scope resolver, and the
  production path with scope + forward scope resolvers).

### Phase 6 — Task 14 (Hover footer, same-file)

- **Test construction differs from the plan's sketch.** The plan's test
  used `new HoverProvider()` (no args) and `new DocumentStore().open(...)`.
  `HoverProvider` requires a `CommandDatabase`; the test passes
  `new CommandDatabase()`. The `DocumentStore.open` contract used here
  matches the plan.
- **Parser requires `program define NAME`** (not bare `program NAME`) to
  register a program symbol. The program-redeclaration test uses
  `program define MyProg` with a non-empty body; bare `program MyProg ... end`
  produced an empty `symbols.programs` map and a null hover. The test
  comment records this requirement for future readers.
- **`format_redefinition_footer` accepts `string | undefined` primary URI**
  and tolerates extras whose `location` is missing. Some existing
  `get_scalar_hover` / `get_matrix_hover` unit tests feed partial symbol
  stubs without `.location` (see `tests/unit/providers/hover.test.ts`
  cases titled "should find matrix from workspace_symbols when
  resolved_scope has empty symbols" and "should prefer resolved_scope
  scalar over workspace_symbols"). Rather than changing those tests, the
  helper degrades gracefully and every call site falls back to
  `symbol.location?.uri ?? symbol.sourceUri`. This preserves the
  plan's intent (same-file vs cross-file attribution) without breaking
  existing test stubs.

### Phase 6 — Task 15 (Hover footer, cross-file + mixed)

- **`get_hover` gained a new `workspace_indexer` parameter (8th arg).**
  The plan's example test wired `indexer` positionally into an argument
  slot that was actually `cross_file_config` in the current signature.
  Rather than overload an existing slot, a new optional parameter was
  added, threaded through `collect_all_symbol_matches` and every symbol
  builder (`get_local_macro_hover`, `get_global_macro_hover`,
  `get_program_hover` + `get_hover_for_user_program`, `get_scalar_hover`,
  `get_matrix_hover`). `src/server-handlers.ts` was updated to pass
  `deps.workspace_indexer` through to the provider.
- **Cross-file extras aggregation is a new private helper**
  `collect_workspace_additional_definitions(name, type, primary, indexer)`
  on `HoverProvider`. It folds the primary's own `additional_definitions`
  plus every indexed cross-file definition (each hit's primary location +
  its own extras) into a single list, deduped by `(uri, line)`. The
  helper is deliberately uncached — see the comment at the top of the
  method for the performance rationale (workspace_indexer version-keyed
  LRU is a future-work option if profiling shows hover latency).
- **Test cursor position corrected:** the plan's "on `data`" comment at
  `{ line: 0, character: 12 }` actually lands on the `=` of
  `global data = "lib"`. The shipped test uses `{ line: 0, character: 9 }`,
  which is on the `t` of `data`.

### Phase 7 — Task 16 (Completion dedup)

- **`CompletionProvider.get_completions` returns `CompletionItem[]`
  directly**, not `{ items: CompletionItem[] }`. The plan's sketch used
  `result.items.filter(...)`; the shipped test uses `result.filter(...)`.
- Test passed on first run, per the plan's prediction. Shipped as
  regression-guard only (no production code change).

### Phase 9 — Task 18 (Final integration)

- **No trailing "align regression tests" commit** was created. The plan's
  Step 4 is conditional on test adjustments landing outside the per-task
  commits; every test change in Phases 6–7 landed inside its own
  feature commit, so no separate bundling commit was needed.

### Unchanged from plan

- The identity-consolidation commits for Phases 1–5 already landed before
  this drift log was started; see the commit range
  `ff4de77..582ee27` for the Task 1–13 history. Test names, file paths,
  and commit-message convention (`... (issue #135)`) match the plan.

