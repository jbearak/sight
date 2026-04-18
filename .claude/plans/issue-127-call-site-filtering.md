# Issue #127 — Call-site filtering in find-references classifier

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ReferencesProvider.classify_word_symbol` respect call-site order when deciding whether a `WORD` token is a program/scalar/matrix, by consulting the existing `ScopeResolver` infrastructure that other providers already use.

**Architecture:** Inject an optional `ScopeResolver` into `ReferencesProvider`. When present, `classify_word_symbol` resolves the document's scope and checks two sources: `resolved_scope.symbols` (backward chain + current file, always in scope) and `resolved_scope.forward_call_symbols` filtered to sites where `call_line < cursor.line`. Variables keep their workspace-wide fallback. When `scope_resolver` is absent, preserve the current (pre-fix) code path verbatim — production always wires it, so the fallback is test-only.

**Tech Stack:** TypeScript (project uses ESM), Bun test runner, `vscode-languageserver` LSP types, existing `ScopeResolver` / `ForwardScopeResolver` / `DependencyGraph` infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-18-issue-127-classify-call-site-filtering-design.md` (commit `4b24fc6`, branch `t3code/issue-127-fix`).

**Branch:** `t3code/issue-127-fix` (already on it).

---

## File Structure

**Modify:**
- `src/providers/references.ts` — add `scope_resolver` field + constructor param; make `classify_word_symbol`, `identify_symbol_at_position`, `get_references`, `get_macro_references_only` async-thread cross_file_config; implement new classifier logic with fallback.
- `src/server-handlers.ts` — thread `cross_file_config` through `create_references_handler`, mirroring `create_definition_handler`.
- `src/server-factory.ts` — reorder init so `scope_resolver` is created before `references_provider`, then construct `new ReferencesProvider(scope_resolver)`.

**Create:**
- `tests/integration/find-references-call-site-scope.test.ts` — new integration test file with 6 scenarios.

**No changes to:** `ScopeResolver`, `ForwardScopeResolver`, `WorkspaceIndexer`, `DependencyGraph`, `collect_references`, `find_definitions`, or the include-declaration logic.

---

## Context the engineer should internalize before starting

1. **Existing code conventions** (see `CLAUDE.md`):
   - `my_`/`the_` prefixes for locals, iterators, loop collections. `snake_case` for new locals/functions; existing API uses `camelCase` — match what's nearby when editing.
   - 4-space indent (no tabs). 80-char lines.
   - Bun is the runtime and test runner: `bun run typecheck`, `bun test`, `bun run test` (the last runs typecheck + test).

2. **Commit style** (from recent log):
   - Imperative, sentence case, no prefix like `feat:`/`fix:`. Single-line subject is fine; add a short body if the change needs explanation.
   - Example: `Restrict find-references for locals to include chains`.

3. **How existing providers already consume `ResolvedScope`:**
   - `src/providers/definition.ts::resolve_non_macro_symbols` is the closest analog for the constructor-threading and config-plumbing pattern. Read it before modifying `references.ts`.
   - `src/providers/completion.ts::get_visible_forward_call_sites` (around line 63) is the exact filter we need: `resolved_scope.forward_call_symbols.filter(s => position.line > s.call_line)`. We replicate this inline — no shared helper (the follow-up issue addresses consolidation).

4. **Why this change is safe:**
   - `ScopeResolver.resolve` is memoized on `(uri, content_hash, config)` — repeat requests on the same buffer hit the cache.
   - `resolved_scope.symbols` already contains current-file symbols (see scope-resolver/index.ts around line 705 where `the_chain.push({uri: file_uri, symbols: my_parse_result.symbols, ...})`).
   - `forward_call_symbols` nested calls carry the parent's `call_line`, so the `< cursor.line` filter is correct transitively without any extra walk.

5. **Important invariants to keep:**
   - Variables must remain workspace-wide (dataset columns are legitimately shared across unrelated modules). The spec's "Non-goals" section spells this out.
   - Existing tests in `tests/integration/find-references-definition-site.test.ts` must continue to pass (they do — verified during design; all scenarios route through either `resolved_scope.symbols` or the fallback path unchanged).
   - The macro-declaration pre-check at the top of `classify_word_symbol` stays sync and runs first.

---

## Task 1: Add optional `scope_resolver` parameter to `ReferencesProvider` constructor

**Files:**
- Modify: `src/providers/references.ts` (add field + constructor)

No tests yet — this is inert plumbing. Existing tests still pass because nothing consults the new field.

- [ ] **Step 1: Inspect current class to confirm it has no constructor yet**

Run: `grep -n "constructor\|class ReferencesProvider" src/providers/references.ts`

Expected: one match — `export class ReferencesProvider {` at line 38. No `constructor` line.

- [ ] **Step 2: Add the `ScopeResolver` import**

Edit `src/providers/references.ts`. Near the existing provider-adjacent imports (after the `WorkspaceIndexer` import around line 18):

```typescript
import type { WorkspaceIndexer } from '../indexer';
import type { IContextTracker } from '../context-tracker/types';
import type { ScopeResolver } from '../scope-resolver';
import type { ScopeResolverConfig } from '../types';
```

(Add the two new lines — `ScopeResolver` and `ScopeResolverConfig` — right after the existing imports.)

- [ ] **Step 3: Add the private field and constructor**

Edit `src/providers/references.ts`. Immediately after `export class ReferencesProvider {` (line 38) and before the first existing method (`extract_local_macro_name` at line 43):

```typescript
export class ReferencesProvider {
    private readonly scope_resolver?: ScopeResolver;

    constructor(scope_resolver?: ScopeResolver) {
        this.scope_resolver = scope_resolver;
    }

    /**
     * Extract symbol name from local macro token value.
     * ...
```

Zero-arg construction (`new ReferencesProvider()`) still works — all existing tests use this form and continue to compile unchanged.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`

Expected: clean pass. No code consumes the new field yet; existing call sites in `server-factory.ts` construct with zero args and still type-check.

- [ ] **Step 5: Run the existing references tests to confirm no regression**

Run: `bun test tests/integration/find-references-definition-site.test.ts tests/property/find-references-*`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/references.ts
git commit -m "Add optional scope_resolver to ReferencesProvider constructor"
```

---

## Task 2: Make `classify_word_symbol` and its callers async (no behavior change)

**Files:**
- Modify: `src/providers/references.ts` (4 methods)

This step converts the method chain to async without changing logic. It's a pure refactor so the next task can add an `await this.scope_resolver.resolve(...)` call.

- [ ] **Step 1: Convert `classify_word_symbol` to async**

Edit `src/providers/references.ts`. Replace the current signature at line 487:

```typescript
private classify_word_symbol(
    word: string,
    range: Range,
    document: DocumentState,
    workspace_indexer?: WorkspaceIndexer
): IdentifiedSymbol | null {
```

with:

```typescript
private async classify_word_symbol(
    word: string,
    range: Range,
    document: DocumentState,
    workspace_indexer?: WorkspaceIndexer,
    cross_file_config?: Partial<ScopeResolverConfig>,
    cancellation_token?: CancellationToken
): Promise<IdentifiedSymbol | null> {
```

The body is unchanged. `cross_file_config` and `cancellation_token` are currently unused — they'll be consumed in Task 3.

- [ ] **Step 2: Convert `identify_symbol_at_position` to async**

In `src/providers/references.ts`, replace the current signature at line 416:

```typescript
private identify_symbol_at_position(
    document: DocumentState,
    position: Position,
    workspace_indexer?: WorkspaceIndexer,
    cancellation_token?: CancellationToken
): IdentifiedSymbol | null {
```

with:

```typescript
private async identify_symbol_at_position(
    document: DocumentState,
    position: Position,
    workspace_indexer?: WorkspaceIndexer,
    cancellation_token?: CancellationToken,
    cross_file_config?: Partial<ScopeResolverConfig>
): Promise<IdentifiedSymbol | null> {
```

Inside the body, find the WORD branch (around line 470):

```typescript
                        case 'WORD':
                            return this.classify_word_symbol(word, range, document, workspace_indexer);
```

Replace with:

```typescript
                        case 'WORD':
                            return await this.classify_word_symbol(word, range, document, workspace_indexer, cross_file_config, cancellation_token);
```

- [ ] **Step 3: Update `get_references` to await and accept `cross_file_config`**

In `src/providers/references.ts`, modify `get_references` (around line 243). Current signature:

```typescript
async get_references(
    document: DocumentState,
    position: Position,
    context: ReferenceContext,
    workspace_indexer?: WorkspaceIndexer,
    context_tracker?: IContextTracker,
    cancellation_token?: CancellationToken
): Promise<Location[]> {
```

Replace with:

```typescript
async get_references(
    document: DocumentState,
    position: Position,
    context: ReferenceContext,
    workspace_indexer?: WorkspaceIndexer,
    context_tracker?: IContextTracker,
    cancellation_token?: CancellationToken,
    cross_file_config?: Partial<ScopeResolverConfig>
): Promise<Location[]> {
```

Inside the body, find the `identify_symbol_at_position` call (around line 273):

```typescript
        const identified_symbol = this.identify_symbol_at_position(
            document,
            position,
            workspace_indexer,
            cancellation_token
        );
```

Replace with:

```typescript
        const identified_symbol = await this.identify_symbol_at_position(
            document,
            position,
            workspace_indexer,
            cancellation_token,
            cross_file_config
        );
```

Also find the call to `get_macro_references_only` (around line 262) and update it to pass `cross_file_config`:

```typescript
            if (my_context !== LanguageContext.STATA) {
                return await this.get_macro_references_only(
                    document,
                    position,
                    context,
                    workspace_indexer,
                    cancellation_token,
                    cross_file_config
                );
            }
```

- [ ] **Step 4: Update `get_macro_references_only` to await and accept `cross_file_config`**

In `src/providers/references.ts`, modify `get_macro_references_only` (around line 570). Current signature:

```typescript
private async get_macro_references_only(
    document: DocumentState,
    position: Position,
    context: ReferenceContext,
    workspace_indexer?: WorkspaceIndexer,
    cancellation_token?: CancellationToken
): Promise<Location[]> {
```

Replace with:

```typescript
private async get_macro_references_only(
    document: DocumentState,
    position: Position,
    context: ReferenceContext,
    workspace_indexer?: WorkspaceIndexer,
    cancellation_token?: CancellationToken,
    cross_file_config?: Partial<ScopeResolverConfig>
): Promise<Location[]> {
```

Inside the body, the existing `identify_symbol_at_position` call (around line 577) must be awaited:

```typescript
        const identified_symbol = await this.identify_symbol_at_position(
            document,
            position,
            workspace_indexer,
            cancellation_token,
            cross_file_config
        );
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`

Expected: clean pass. All callers of `get_references` in test files pass exactly the arguments they always did (the new `cross_file_config` is optional and trailing).

- [ ] **Step 6: Run all existing references tests**

Run: `bun test tests/integration/find-references-definition-site.test.ts tests/property/find-references-*`

Expected: all pass. No behavior change because `classify_word_symbol` body is untouched and `cross_file_config` is unused.

- [ ] **Step 7: Commit**

```bash
git add src/providers/references.ts
git commit -m "Make classify_word_symbol and its callers async"
```

---

## Task 3: Add the new integration test file and implement the scope-resolver classifier path

This task does three things together (atomic test+impl commit): create the new test file scaffolding + setup helper, add scenario 1 (the regression test), then implement the new classifier logic so scenario 1 passes.

**Files:**
- Create: `tests/integration/find-references-call-site-scope.test.ts`
- Modify: `src/providers/references.ts` (`classify_word_symbol` body)

- [ ] **Step 1: Create the new integration test file with setup helper + scenario 1 (regression)**

Write `tests/integration/find-references-call-site-scope.test.ts`:

```typescript
/**
 * Integration tests for issue #127: find-references classifier must respect
 * call-site order. A WORD token should not be classified as a program,
 * scalar, or matrix just because a matching definition lives in any
 * dependency-graph-related file — only files reachable at the cursor line
 * (backward chain + forward calls before the cursor) should count.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

/**
 * Wire the full find-references pipeline the same way server-factory.ts does.
 * The scope_resolver and forward_scope_resolver are attached to the indexer's
 * dependency graph so auto-backward-discovery and forward-call resolution work.
 */
function build_pipeline(): {
    indexer: WorkspaceIndexer;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    references_provider: ReferencesProvider;
    document_store: DocumentStore;
    dependency_graph: DependencyGraph;
} {
    const the_indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    the_indexer.set_dependency_graph(the_dep_graph);

    const the_scope_resolver = new ScopeResolver();
    the_scope_resolver.set_dependency_graph(the_dep_graph);

    const the_forward_resolver = new ForwardScopeResolver(the_scope_resolver, {
        max_forward_depth: 10,
    });
    the_scope_resolver.set_forward_scope_resolver(the_forward_resolver);

    const the_references_provider = new ReferencesProvider(the_scope_resolver);
    const the_document_store = new DocumentStore();

    return {
        indexer: the_indexer,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        references_provider: the_references_provider,
        document_store: the_document_store,
        dependency_graph: the_dep_graph,
    };
}

describe('Find References - call-site scope filtering (issue #127)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-scope-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not classify a WORD as a program when the defining file has not been called yet (regression)', async () => {
        // main.do references `shared_prog` on line 0, before the `do "defs.do"`
        // on line 1 that would bring defs.do's program into scope.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `shared_prog` at line 0 in main.do.
        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // defs.do has not run yet at line 0 — classifier must not return
        // `program`, so defs.do's program definition must not be pooled in.
        const defs_uri = URI.file(defs_path).toString();
        const leaks_defs = locations.some(loc => loc.uri === defs_uri);
        expect(leaks_defs).toBe(false);
    });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: the `does not classify a WORD as a program when the defining file has not been called yet (regression)` test FAILS. The current classifier still uses `workspace_indexer.get_related_uris` without call-site filtering, so `shared_prog` gets classified as `program` and the test-assertion `leaks_defs === false` fails (it will actually be true because defs.do's definition is pooled in as a reference location).

- [ ] **Step 3: Implement the new classifier logic in `classify_word_symbol`**

Edit `src/providers/references.ts`. Also add the `build_scope_resolver_config` import. Near the top of the file with the other scope-resolver imports:

```typescript
import type { ScopeResolver } from '../scope-resolver';
import { build_scope_resolver_config } from '../scope-resolver';
import type { ScopeResolverConfig } from '../types';
```

(Adjust: `ScopeResolver` was already a type-only import from Task 1. Change that line and add the value import for `build_scope_resolver_config`, so the result is two import lines — one `import type` and one `import`.)

Then replace the entire body of `classify_word_symbol` (from line 492 through the closing `}` around line 563 — everything after the opening `{` of the method). The full new method body:

```typescript
    private async classify_word_symbol(
        word: string,
        range: Range,
        document: DocumentState,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<IdentifiedSymbol | null> {
        // Cursor sitting inside a macro's own declaration range must resolve
        // to the macro even when a non-macro symbol of the same name exists.
        // Stata allows cross-namespace name collisions (e.g., variable and
        // global macro both named `data_path`), so the declaration-range check
        // runs first and stays sync against document.symbols.
        const global_macro = document.symbols.globalMacros.get(word);
        if (global_macro && this.position_in_range(range.start, global_macro.location.range)) {
            return { name: word, type: 'global_macro', range };
        }
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro && this.position_in_range(range.start, local_macro.location.range)) {
            return { name: word, type: 'local_macro', range };
        }

        // Scope-resolver path: the classifier asks ScopeResolver what symbols
        // are visible at the cursor. `resolved_scope.symbols` already merges
        // the current file with every parent reachable via backward directives
        // (done-by / included-by, auto or explicit). `forward_call_symbols`
        // lists forward calls (do/run/include) with the line they were
        // invoked on; a call is visible only when its call_line is strictly
        // less than the cursor line.
        if (this.scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await this.scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
            const cursor_line = range.start.line;

            // 1. Backward chain + current file (always in scope).
            //    Order matches the pre-fix code: programs → variables → scalars → matrices.
            if (resolved_scope.symbols.programs.has(word)) {
                return { name: word, type: 'program', range };
            }
            if (resolved_scope.symbols.variables.has(word)) {
                return { name: word, type: 'variable', range };
            }
            if (resolved_scope.symbols.scalars.has(word)) {
                return { name: word, type: 'scalar', range };
            }
            if (resolved_scope.symbols.matrices.has(word)) {
                return { name: word, type: 'matrix', range };
            }

            // 2. Forward calls before the cursor. Nested call sites already
            //    carry the parent's call_line (set by ForwardScopeResolver),
            //    so the filter is correct transitively.
            const the_visible_sites = resolved_scope.forward_call_symbols?.filter(
                my_site => my_site.call_line < cursor_line
            ) ?? [];
            for (const my_site of the_visible_sites) {
                if (my_site.symbols.programs.has(word)) {
                    return { name: word, type: 'program', range };
                }
            }
            for (const my_site of the_visible_sites) {
                if (my_site.symbols.scalars.has(word)) {
                    return { name: word, type: 'scalar', range };
                }
            }
            for (const my_site of the_visible_sites) {
                if (my_site.symbols.matrices.has(word)) {
                    return { name: word, type: 'matrix', range };
                }
            }

            // 3. Variables remain workspace-wide: dataset columns are
            //    legitimately shared across unrelated modules, so no
            //    call-site filter here.
            if (workspace_indexer) {
                const has_cross_file_variable = workspace_indexer
                    .find_symbol_definitions(word, 'variable')
                    .some(my_def => my_def.sourceUri !== document.uri);
                if (has_cross_file_variable) {
                    return { name: word, type: 'variable', range };
                }
            }

            return null;
        }

        // Fallback path (test-only): production always wires scope_resolver,
        // but unit/integration tests that construct ReferencesProvider with
        // zero args land here. Preserve the pre-fix behavior so those tests
        // don't regress.
        if (document.symbols.programs.has(word)) {
            return { name: word, type: 'program', range };
        }
        if (document.symbols.variables.has(word)) {
            return { name: word, type: 'variable', range };
        }
        if (document.symbols.scalars.has(word)) {
            return { name: word, type: 'scalar', range };
        }
        if (document.symbols.matrices.has(word)) {
            return { name: word, type: 'matrix', range };
        }

        if (workspace_indexer) {
            const the_related = workspace_indexer.get_related_uris(document.uri);
            const has_cross_file_any = (
                ws_type: 'variable'
            ): boolean =>
                workspace_indexer
                    .find_symbol_definitions(word, ws_type)
                    .some(my_def => my_def.sourceUri !== document.uri);
            const has_cross_file_related = (
                ws_type: 'program' | 'scalar' | 'matrix'
            ): boolean =>
                workspace_indexer
                    .find_symbol_definitions(word, ws_type)
                    .some(my_def =>
                        my_def.sourceUri !== document.uri &&
                        the_related.has(my_def.sourceUri)
                    );
            if (has_cross_file_related('program')) {
                return { name: word, type: 'program', range };
            }
            if (has_cross_file_related('scalar')) {
                return { name: word, type: 'scalar', range };
            }
            if (has_cross_file_related('matrix')) {
                return { name: word, type: 'matrix', range };
            }
            if (has_cross_file_any('variable')) {
                return { name: word, type: 'variable', range };
            }
        }

        return null;
    }
```

- [ ] **Step 4: Run the new test and confirm it passes**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: scenario 1 passes. `shared_prog` at line 0 of main.do is no longer classified as a program (scope_resolver says defs.do hasn't run yet), so `leaks_defs === false`.

- [ ] **Step 5: Run the existing references tests to confirm no regression**

Run: `bun test tests/integration/find-references-definition-site.test.ts tests/property/find-references-*`

Expected: all pass. The existing tests either rely on `resolved_scope.symbols` (backward chain + current file, which is still populated correctly) or the fallback path (when `new ReferencesProvider()` has no scope_resolver).

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: clean pass.

- [ ] **Step 7: Commit**

```bash
git add src/providers/references.ts tests/integration/find-references-call-site-scope.test.ts
git commit -m "Apply call-site filtering in find-references word classifier

Fixes issue #127: classify_word_symbol no longer returns program/
scalar/matrix for symbols in forward-called files that haven't been
reached at the cursor line. Backward-chain symbols stay always-in-
scope; forward-call symbols are filtered by call_line < cursor.line.
Variables remain workspace-wide."
```

---

## Task 4: Add scenario 2 — positive case, cursor after forward call

**Files:**
- Modify: `tests/integration/find-references-call-site-scope.test.ts`

- [ ] **Step 1: Add the test inside the existing describe block**

Append this `it(...)` after the scenario 1 test (before the closing `});` of the describe block):

```typescript
    it('classifies a WORD as a program when the cursor is after the do call that brings it into scope', async () => {
        // Same files as the regression test, plus a second reference to
        // `shared_prog` on a line that is AFTER the do "defs.do" call.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n` +
            `shared_prog\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `shared_prog` at line 2 (AFTER the do on line 1).
        const cursor_line = 2;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // defs.do IS reachable at line 2 — classification should return
        // program and defs.do's declaration should be pooled in.
        const defs_uri = URI.file(defs_path).toString();
        const has_defs_ref = locations.some(loc => loc.uri === defs_uri);
        expect(has_defs_ref).toBe(true);
    });
```

- [ ] **Step 2: Run the file's tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: both scenarios pass. The second one works because at cursor line 2, the filter `site.call_line < 2` keeps defs.do's call site (call_line=1), so `shared_prog` matches in the visible-site scan and gets classified as program.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-call-site-scope.test.ts
git commit -m "Test: find-refs classifies program when cursor is past forward call"
```

---

## Task 5: Add scenario 3 — backward directive is always in scope

**Files:**
- Modify: `tests/integration/find-references-call-site-scope.test.ts`

- [ ] **Step 1: Add the test**

Append this `it(...)` inside the describe block:

```typescript
    it('classifies via backward directive — parent programs are always in scope in the child', async () => {
        // main.do defines `shared_prog` then does child.do. child.do's
        // header pins the backward link with @lsp-done-by. Regardless of
        // the cursor line in child, parent's programs must be in scope
        // (backward chain = always visible).
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `program define shared_prog\n` +
            `end\n` +
            `do "child.do"\n`;
        writeFileSync(main_path, main_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "main.do"\n` +
            `\n` +
            `shared_prog\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        // Cursor on `shared_prog` at line 2 in child.do.
        const cursor_line = 2;
        const cursor_char = child_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Parent's program definition should be pooled in (classifier returned program).
        const main_uri = URI.file(main_path).toString();
        const has_parent_def = locations.some(loc => loc.uri === main_uri);
        expect(has_parent_def).toBe(true);
    });
```

- [ ] **Step 2: Run the file's tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: all three scenarios pass. This scenario validates the `resolved_scope.symbols.programs.has(word)` branch (backward chain — always in scope).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-call-site-scope.test.ts
git commit -m "Test: find-refs classifies via backward directive in child file"
```

---

## Task 6: Add scenario 4 — unrelated branches with same-named programs

**Files:**
- Modify: `tests/integration/find-references-call-site-scope.test.ts`

- [ ] **Step 1: Add the test**

Append this `it(...)`:

```typescript
    it('does not pool refs across unrelated branches that share a program name', async () => {
        // main.do does branch_a then branch_b. Both branches define a
        // program named `common_helper`. The cursor in main.do is placed
        // on line 0 — BEFORE either do call — so neither branch is in
        // scope yet and the classifier must not return program.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `common_helper\n` +
            `do "branch_a.do"\n` +
            `do "branch_b.do"\n`;
        writeFileSync(main_path, main_content);

        const branch_a_path = join(test_temp_dir, 'branch_a.do');
        const branch_a_content =
            `program define common_helper\n` +
            `end\n`;
        writeFileSync(branch_a_path, branch_a_content);

        const branch_b_path = join(test_temp_dir, 'branch_b.do');
        const branch_b_content =
            `program define common_helper\n` +
            `end\n`;
        writeFileSync(branch_b_path, branch_b_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `common_helper` at line 0 in main.do.
        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('common_helper') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Neither branch has been called yet at cursor line 0 — nothing
        // from either branch should be pooled.
        const branch_a_uri = URI.file(branch_a_path).toString();
        const branch_b_uri = URI.file(branch_b_path).toString();
        const leaks_branch_a = locations.some(loc => loc.uri === branch_a_uri);
        const leaks_branch_b = locations.some(loc => loc.uri === branch_b_uri);
        expect(leaks_branch_a).toBe(false);
        expect(leaks_branch_b).toBe(false);
    });
```

- [ ] **Step 2: Run the file's tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: all four scenarios pass. This is the "genuinely wrong" case the issue flagged — pre-fix, `common_helper` would be classified as program by pool-from-any-related-file, and both branches would leak in.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-call-site-scope.test.ts
git commit -m "Test: find-refs does not pool across unrelated same-named branches"
```

---

## Task 7: Add scenario 5 — transitive forward call

**Files:**
- Modify: `tests/integration/find-references-call-site-scope.test.ts`

- [ ] **Step 1: Add the test**

Append this `it(...)`:

```typescript
    it('respects transitive forward calls for call-site filtering', async () => {
        // main.do does mid.do at line 5; mid.do does leaf.do at line 3;
        // leaf.do defines `deep_prog`. Nested call sites carry the
        // outermost parent's call line, so the filter is correct
        // transitively.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `* line 0\n` +
            `* line 1\n` +
            `deep_prog\n` +                 // line 2 — BEFORE any do
            `* line 3\n` +
            `* line 4\n` +
            `do "mid.do"\n` +               // line 5
            `* line 6\n` +
            `* line 7\n` +
            `* line 8\n` +
            `* line 9\n` +
            `deep_prog\n`;                  // line 10 — AFTER do "mid.do"
        writeFileSync(main_path, main_content);

        const mid_path = join(test_temp_dir, 'mid.do');
        const mid_content =
            `* line 0\n` +
            `* line 1\n` +
            `* line 2\n` +
            `do "leaf.do"\n`;               // line 3
        writeFileSync(mid_path, mid_content);

        const leaf_path = join(test_temp_dir, 'leaf.do');
        const leaf_content =
            `program define deep_prog\n` +
            `end\n`;
        writeFileSync(leaf_path, leaf_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const leaf_uri = URI.file(leaf_path).toString();

        // (a) Cursor on line 10 — AFTER do "mid.do" on line 5. leaf.do's
        //     transitive call site carries call_line=5, so deep_prog is
        //     visible and classification returns program.
        const after_cursor_line = 10;
        const after_cursor_char = main_content
            .split('\n')[after_cursor_line]
            .indexOf('deep_prog') + 3;
        const after_locations = await pipeline.references_provider.get_references(
            document_state,
            { line: after_cursor_line, character: after_cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );
        const after_has_leaf = after_locations.some(loc => loc.uri === leaf_uri);
        expect(after_has_leaf).toBe(true);

        // (b) Cursor on line 2 — BEFORE do "mid.do" on line 5. Nothing
        //     is in scope yet; classification must not return program.
        const before_cursor_line = 2;
        const before_cursor_char = main_content
            .split('\n')[before_cursor_line]
            .indexOf('deep_prog') + 3;
        const before_locations = await pipeline.references_provider.get_references(
            document_state,
            { line: before_cursor_line, character: before_cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );
        const before_has_leaf = before_locations.some(loc => loc.uri === leaf_uri);
        expect(before_has_leaf).toBe(false);
    });
```

- [ ] **Step 2: Run the file's tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: all five scenarios pass. This validates that `forward_call_symbols` transitively includes nested sites with the outermost call line.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-call-site-scope.test.ts
git commit -m "Test: find-refs handles transitive forward calls for call-site filter"
```

---

## Task 8: Add scenario 6 — scope-resolver-absent fallback

**Files:**
- Modify: `tests/integration/find-references-call-site-scope.test.ts`

- [ ] **Step 1: Add the test**

Append this `it(...)`:

```typescript
    it('keeps pre-fix behavior when ReferencesProvider is constructed without a scope_resolver', async () => {
        // The fallback path is intended only for test-only setups that
        // construct `new ReferencesProvider()`. Production always wires a
        // scope_resolver. This test pins the fallback so those setups do
        // not regress.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        // Build a references_provider WITHOUT a scope_resolver.
        const fallback_provider = new ReferencesProvider();

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await fallback_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Pre-fix behavior: without scope_resolver, the classifier uses
        // get_related_uris and pools defs.do in. Pin that behavior so
        // test-only setups don't regress.
        const defs_uri = URI.file(defs_path).toString();
        const pools_defs_in_fallback = locations.some(loc => loc.uri === defs_uri);
        expect(pools_defs_in_fallback).toBe(true);
    });
```

- [ ] **Step 2: Run the file's tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts`

Expected: all six scenarios pass. The fallback provider lands in the non-scope_resolver branch of `classify_word_symbol` and exhibits the pre-fix behavior.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/find-references-call-site-scope.test.ts
git commit -m "Test: find-refs fallback path pins pre-fix behavior for test-only setups"
```

---

## Task 9: Thread `cross_file_config` through `create_references_handler`

**Files:**
- Modify: `src/server-handlers.ts`

- [ ] **Step 1: Study the pattern in `create_definition_handler`**

Run: `grep -n "deps.get_document_settings\|assume_call_site\|backward_dependencies\|max_forward_depth" src/server-handlers.ts`

Look at lines 463–476 — the definition handler reads settings and builds a partial `ScopeResolverConfig`. We'll mirror that.

- [ ] **Step 2: Update `create_references_handler`**

In `src/server-handlers.ts`, find `create_references_handler` (around line 488). Current body:

```typescript
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.references_provider) {
            return null;
        }

        return await deps.references_provider.get_references(
            document_state,
            params.position,
            params.context,
            deps.workspace_indexer || undefined,
            document_state.context_tracker,
            token
        );
```

Replace with:

```typescript
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.references_provider) {
            return null;
        }
        const config = await deps.get_document_settings(params.textDocument.uri);

        return await deps.references_provider.get_references(
            document_state,
            params.position,
            params.context,
            deps.workspace_indexer || undefined,
            document_state.context_tracker,
            token,
            {
                assume_call_site: config.cross_file?.assume_call_site,
                backward_dependencies: config.cross_file?.backward_dependencies,
                max_forward_depth: config.cross_file?.max_forward_depth,
            }
        );
```

This matches `create_definition_handler` at lines 463–476 exactly.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: clean pass.

- [ ] **Step 4: Run the references tests**

Run: `bun test tests/integration/find-references-call-site-scope.test.ts tests/integration/find-references-definition-site.test.ts tests/property/find-references-*`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server-handlers.ts
git commit -m "Thread cross_file_config through references handler"
```

---

## Task 10: Inject `scope_resolver` into `ReferencesProvider` from `server-factory`

**Files:**
- Modify: `src/server-factory.ts`

- [ ] **Step 1: Locate the current construction order**

Run: `grep -n "references_provider = new ReferencesProvider\|scope_resolver = new ScopeResolver" src/server-factory.ts`

Expected: `references_provider = new ReferencesProvider()` on line ~858 and `scope_resolver = new ScopeResolver(...)` starting on line ~862. The references provider is constructed *before* `scope_resolver` in the current order.

- [ ] **Step 2: Read the surrounding block to understand the full init sequence**

Run: `sed -n '855,910p' src/server-factory.ts`

Read the output carefully. The current order is:
1. line 858 — `references_provider = new ReferencesProvider();`
2. line 859 — `symbol_provider = new SymbolProvider();`
3. line 860 — `formatter_provider = new CodeFormatter();`
4. line 861 — `workspace_indexer = new WorkspaceIndexer();`
5. line 862+ — `scope_resolver = new ScopeResolver({...}, {...});`

We want `scope_resolver` to be built before `references_provider`.

- [ ] **Step 3: Reorder so `scope_resolver` is constructed before `references_provider`, and pass `scope_resolver` to the constructor**

Edit `src/server-factory.ts`. Find the block starting at line 858 and ending at the `scope_resolver = ...` block's closing brace (around line 887). In practice, the minimal change is:

1. Move the `references_provider = new ReferencesProvider();` line from before the `scope_resolver` construction to immediately after it.
2. Add the `scope_resolver` argument.

Concretely, replace:

```typescript
            hover_provider = new HoverProvider(command_database);
            definition_provider = new DefinitionProvider();
            references_provider = new ReferencesProvider();
            symbol_provider = new SymbolProvider();
            formatter_provider = new CodeFormatter();
            workspace_indexer = new WorkspaceIndexer();
            scope_resolver = new ScopeResolver({
                log: (msg) => connection.console.log(msg),
                warn: (msg) => connection.console.warn(msg),
            }, {
                read_file: async (uri: string) => {
```

with:

```typescript
            hover_provider = new HoverProvider(command_database);
            definition_provider = new DefinitionProvider();
            symbol_provider = new SymbolProvider();
            formatter_provider = new CodeFormatter();
            workspace_indexer = new WorkspaceIndexer();
            scope_resolver = new ScopeResolver({
                log: (msg) => connection.console.log(msg),
                warn: (msg) => connection.console.warn(msg),
            }, {
                read_file: async (uri: string) => {
```

Then, after the `scope_resolver = new ScopeResolver({ ... })` statement ends (closing brace of the constructor call, before the `document_store.set_scope_resolver(scope_resolver);` line around line 889), add the `references_provider` construction:

```typescript
            });

            references_provider = new ReferencesProvider(scope_resolver);

            document_store.set_scope_resolver(scope_resolver);
```

This keeps all other initialization unchanged.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`

Expected: clean pass. `ReferencesProvider` now accepts `scope_resolver` (added in Task 1), so the call type-checks.

- [ ] **Step 5: Run the full test suite**

Run: `bun run test`

Expected: all tests pass. This includes typecheck, the new scope-scenario tests, all existing references tests, and the rest of the project's suite.

- [ ] **Step 6: Commit**

```bash
git add src/server-factory.ts
git commit -m "Wire scope_resolver into ReferencesProvider at startup"
```

---

## Task 11: Full validation pass

**Files:** none.

- [ ] **Step 1: Clean typecheck**

Run: `bun run typecheck`

Expected: no errors, no warnings.

- [ ] **Step 2: Full test suite**

Run: `bun run test`

Expected: all pass. If any fail, STOP and diagnose — this is the last checkpoint before we declare the fix done.

- [ ] **Step 3: Review the diff end-to-end**

Run: `git log --oneline main..HEAD` (or whatever base branch applies) and `git diff main..HEAD -- src/providers/references.ts src/server-handlers.ts src/server-factory.ts tests/integration/find-references-call-site-scope.test.ts | wc -l`

Expected: a manageable diff (~300–500 lines changed). No stray changes to files outside the spec's "Concrete changes" list.

- [ ] **Step 4: Confirm docs/superpowers/specs is unchanged from the committed spec**

Run: `git status` and `git diff docs/superpowers/specs/`

Expected: no changes (the spec was committed in `4b24fc6`).

---

## Task 12: Create the follow-up GitHub issue

**Files:** none in the repo — this creates a GitHub issue via `gh`.

The issue content is specified in the spec's "Follow-up issue" section. Paste it verbatim into the issue body.

- [ ] **Step 1: Draft the issue body**

Save this content to `$TMPDIR/issue-127-followup-body.md`:

```markdown
## Problem statement

The rule "symbols from a forward call are visible only after the call line; backward-directive parents are always visible" is implemented ad-hoc and inconsistently across providers. `ForwardScopeResolver.get_symbols_at_line` already encodes this rule but is not used by any provider.

## Audit of current state

As of the commit that lands #127's narrow fix:

- `src/providers/completion.ts`: filters `forward_call_symbols` by `call_site.call_line < position.line` in 5 places (approx lines 74 — inside a file-local `get_visible_forward_call_sites` helper — and 1148, 1755, 2068, 2329 as inline checks that don't use the helper).
- `src/providers/hover.ts`: same filter, 1 place (approx line 486).
- `src/providers/diagnostics.ts`: `call_site.call_line < diag_line`, 1 place (approx line 310).
- `src/providers/definition.ts::resolve_non_macro_symbols`: consults `resolved_scope.symbols` only — never `forward_call_symbols`. WORD tokens referring to a program defined in a forward-called child cannot resolve via scope-resolver; they fall through to `workspace_indexer.find_symbol_definitions`, which has no cursor-ordering filter and can jump to the wrong definition across unrelated branches. This is the "bigger user impact" variant the #127 report flagged.
- `src/providers/references.ts` post-fix: `classify_word_symbol` uses the filter correctly; `find_definitions` (used for `includeDeclaration`) still uses `get_related_uris` without call-site filtering.
- `ForwardScopeResolver.get_symbols_at_line`: exists, tested, not used by any provider.

## Gaps made explicit

1. `src/providers/definition.ts` has the most user-visible version of this bug.
2. `src/providers/references.ts::find_definitions` is the leftover tail of #127's intentionally narrow scope.
3. The filter is duplicated across ≈8 sites (5 in `completion.ts` — one helper plus four inline; 1 in `hover.ts`; 1 in `diagnostics.ts`; 1 new in `references.ts` after the #127 narrow fix). A shared helper or view object would remove the drift surface.

## Out of scope for this issue

Solution design. A future brainstorm decides whether to consolidate via a helper function, a `ResolvedScopeView` wrapper, or by adopting `ForwardScopeResolver.get_symbols_at_line` in-place. This issue is a durable record of the gaps so that brainstorm can start from evidence rather than reconstruction.

## Related

- Narrow fix: #127 (and its design spec at `docs/superpowers/specs/2026-04-18-issue-127-classify-call-site-filtering-design.md`).
```

- [ ] **Step 2: Create the issue via `gh`**

Run (the command depends on `gh` and network — may need sandbox override):

```bash
gh issue create \
  --title "Unify 'symbols visible at cursor position' across providers (audit + plan)" \
  --body-file "$TMPDIR/issue-127-followup-body.md"
```

Expected: the command prints a new issue URL. Record that URL.

- [ ] **Step 3: Link the new issue from #127**

Run (substitute `<new-issue-number>` with the number from the previous step):

```bash
gh issue comment 127 --body "Follow-up tracked in #<new-issue-number>: coherent architecture audit for the call-site filtering pattern across providers."
```

Expected: comment posted.

---

## Self-review (run by the author before handing off)

1. **Spec coverage.** Every section of the spec maps to a task:
   - Problem + Goal → Task 3 (the implementation with the regression test).
   - Architecture (ScopeResolver injection, async cascade, fallback) → Tasks 1, 2, 3.
   - Concrete changes: references.ts → Tasks 1–3; server-handlers.ts → Task 9; server-factory.ts → Task 10.
   - Test plan: scenarios 1–6 → Tasks 3, 4, 5, 6, 7, 8.
   - Follow-up issue → Task 12.
2. **Placeholder scan.** No TBD/TODO/"handle edge cases"/"add tests for the above" anywhere. Code blocks accompany every code step. Commands show expected output. Commit commands show the exact message.
3. **Type/name consistency.**
   - `scope_resolver` (snake_case field) is introduced in Task 1, consumed in Task 3, wired in Task 10.
   - `cross_file_config?: Partial<ScopeResolverConfig>` is added as the last param of `classify_word_symbol` in Task 2, cascaded through `identify_symbol_at_position`, `get_references`, and `get_macro_references_only` in Task 2, and threaded from the handler in Task 9.
   - `build_scope_resolver_config` is imported in Task 3 and used once inside `classify_word_symbol`.
   - `ForwardCallSite.call_line` and the filter `my_site.call_line < cursor_line` are used consistently in Task 3 and referenced unchanged in the scenario tests.
4. **Bite-sized granularity.** Each step is a single action (edit one place, run one command, commit). The largest code block is the `classify_word_symbol` rewrite in Task 3, which is inherently one logical change.
