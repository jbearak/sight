import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { CompletionProvider } from '../../src/providers/completion';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Cross-File Awareness Integration', () => {
    const test_temp_dir = join(process.cwd(), 'temp_cross_file_test');
    let indexer: WorkspaceIndexer;
    let definition_provider: DefinitionProvider;
    let completion_provider: CompletionProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        indexer = new WorkspaceIndexer();
        definition_provider = new DefinitionProvider();
        completion_provider = new CompletionProvider();
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('multi-file scope resolution with directive chains', () => {
        it('should resolve chained done-by directives', async () => {
            const config_path = join(test_temp_dir, 'config.do');
            const config_content = 'global ROOT_PATH "/data"\nglobal LOG_LEVEL 2';
            writeFileSync(config_path, config_content);

            const utils_path = join(test_temp_dir, 'utils.do');
            const utils_content = '// @lsp-done-by "config.do"\nglobal TEMP_DIR "$ROOT_PATH/temp"';
            writeFileSync(utils_path, utils_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-done-by "utils.do"\nlocal temp `"$TEMP_DIR"\'';
            writeFileSync(main_path, main_content);

            await indexer.initialize([test_temp_dir]);

            const main_uri = URI.file(main_path).toString();
            const resolved_scope = await scope_resolver.resolve(main_uri, main_content);

            // Should have globals from config.do and utils.do
            expect(resolved_scope.symbols.globalMacros.has('ROOT_PATH')).toBe(true);
            expect(resolved_scope.symbols.globalMacros.has('TEMP_DIR')).toBe(true);
        });

        it('should detect cycles in directive chains', async () => {
            const file_a_path = join(test_temp_dir, 'a.do');
            const file_a_content = '// @lsp-done-by "b.do"\nlocal test `global_from_b\'';
            writeFileSync(file_a_path, file_a_content);

            const file_b_path = join(test_temp_dir, 'b.do');
            const file_b_content = '// @lsp-done-by "a.do"\nglobal global_from_b "value"';
            writeFileSync(file_b_path, file_b_content);

            const resolved_scope = await scope_resolver.resolve(
                URI.file(file_a_path).toString(),
                file_a_content
            );

            // Cycles should be handled gracefully without emitting diagnostics
            // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
            const cycle_diagnostic = resolved_scope.diagnostics.find(
                (my_diag) => my_diag.message.includes('Circular')
            );
            expect(cycle_diagnostic).toBeUndefined();

            // Should still resolve symbols from the current file
            expect(resolved_scope.symbols.localMacros.has('test')).toBe(true);
        });
    });

    describe('cross-file go-to-definition', () => {
        it('should navigate to macro definition across directive chain', async () => {
            const globals_path = join(test_temp_dir, 'globals.do');
            const globals_content = 'global DATA_PATH "/project/data"';
            writeFileSync(globals_path, globals_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-done-by "globals.do"\nuse "$DATA_PATH/dataset.dta"';
            writeFileSync(main_path, main_content);

            await indexer.initialize([test_temp_dir]);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const workspace_symbols = indexer.get_all_symbols();
            const definition = await definition_provider.get_definition(
                document_state,
                { line: 1, character: 7 }, // $DATA_PATH
                workspace_symbols,
                undefined, // context_tracker
                scope_resolver,
                indexer
            );

            expect(definition).toBeDefined();
            const def_uri = Array.isArray(definition) ? definition[0].uri : (definition as any).uri;
            expect(def_uri).toContain('globals.do');
        });

        it('should find program definition through included-by directive', async () => {
            const helpers_path = join(test_temp_dir, 'helpers.do');
            const helpers_content = 'program define cleanup_data\n  drop if missing(id)\nend';
            writeFileSync(helpers_path, helpers_content);

            const analysis_path = join(test_temp_dir, 'analysis.do');
            const analysis_content = '// @lsp-included-by "helpers.do"\ncleanup_data';
            writeFileSync(analysis_path, analysis_content);

            await indexer.initialize([test_temp_dir]);

            const analysis_uri = URI.file(analysis_path).toString();
            await document_store.open(analysis_uri, analysis_content, 1);
            const document_state = document_store.get(analysis_uri)!;

            const workspace_symbols = indexer.get_all_symbols();
            const definition = await definition_provider.get_definition(
                document_state,
                { line: 1, character: 5 }, // cleanup_data
                workspace_symbols,
                undefined, // context_tracker
                scope_resolver,
                indexer
            );

            expect(definition).toBeDefined();
            const def_uri = Array.isArray(definition) ? definition[0].uri : (definition as any).uri;
            expect(def_uri).toContain('helpers.do');
        });
    });

    describe('completion filtering with directives', () => {
        it('should include globals from done-by files in completions', async () => {
            const config_path = join(test_temp_dir, 'config.do');
            const config_content = 'global PROJECT_ROOT "/home/user"\nglobal DEBUG_MODE 1';
            writeFileSync(config_path, config_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-done-by "config.do"\nlocal path $';
            writeFileSync(main_path, main_content);

            await indexer.initialize([test_temp_dir]);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const completions = await completion_provider.get_completions(
                document_state,
                { line: 1, character: 12 }, // after $
                '$', // trigger_character
                scope_resolver
            );

            const global_names = completions.map(item => item.label);
            expect(global_names).toContain('PROJECT_ROOT');
            expect(global_names).toContain('DEBUG_MODE');
        });

        it('should include local macros from included-by files', async () => {
            const shared_path = join(test_temp_dir, 'shared.do');
            const shared_content = 'local shared_var "common_value"\nlocal temp_file "temp.dta"';
            writeFileSync(shared_path, shared_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-included-by "shared.do"\nlocal result `';
            writeFileSync(main_path, main_content);

            await indexer.initialize([test_temp_dir]);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const completions = await completion_provider.get_completions(
                document_state,
                { line: 1, character: 14 }, // after `
                '`', // trigger_character
                scope_resolver
            );

            const macro_names = completions.map(item => item.label);
            expect(macro_names).toContain('shared_var');
            expect(macro_names).toContain('temp_file');
        });
    });

    describe('inheritance rules', () => {
        it('should resolve same-depth conflicts by header order (lattermost directive wins)', async () => {
            const parent_a_path = join(test_temp_dir, 'a.do');
            const parent_b_path = join(test_temp_dir, 'b.do');

            writeFileSync(parent_a_path, 'global DUP "a"');
            writeFileSync(parent_b_path, 'global DUP "b"');

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                '// @lsp-done-by "a.do"\n' +
                '// @lsp-done-by "b.do"\n' +
                'display "$DUP"';
            writeFileSync(child_path, child_content);

            const child_uri = URI.file(child_path).toString();
            const resolved_scope = await scope_resolver.resolve(child_uri, child_content);

            const dup = resolved_scope.symbols.globalMacros.get('DUP');
            expect(dup).toBeDefined();
            const winner_uri = dup?.location.uri ?? '';
            expect(winner_uri).toContain('b.do');
        });

        it('should resolve same-depth conflicts by header order even when swapped', async () => {
            const parent_a_path = join(test_temp_dir, 'a.do');
            const parent_b_path = join(test_temp_dir, 'b.do');

            writeFileSync(parent_a_path, 'global DUP "a"');
            writeFileSync(parent_b_path, 'global DUP "b"');

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                '// @lsp-done-by "b.do"\n' +
                '// @lsp-done-by "a.do"\n' +
                'display "$DUP"';
            writeFileSync(child_path, child_content);

            const child_uri = URI.file(child_path).toString();
            const resolved_scope = await scope_resolver.resolve(child_uri, child_content);

            const dup = resolved_scope.symbols.globalMacros.get('DUP');
            expect(dup).toBeDefined();
            const winner_uri = dup?.location.uri ?? '';
            expect(winner_uri).toContain('a.do');
        });

        it('should resolve program/scalar/matrix conflicts by lattermost directive', async () => {
            const parent_a_path = join(test_temp_dir, 'a.do');
            const parent_b_path = join(test_temp_dir, 'b.do');

            writeFileSync(
                parent_a_path,
                'program define shared_prog\n  display "A"\nend\nscalar S = 1\nmatrix define M = (1)'
            );
            writeFileSync(
                parent_b_path,
                'program define shared_prog\n  display "B"\nend\nscalar S = 2\nmatrix define M = (2)'
            );

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                '// @lsp-done-by "a.do"\n' +
                '// @lsp-done-by "b.do"\n' +
                'shared_prog\n' +
                'display S\n' +
                'matrix list M';
            writeFileSync(child_path, child_content);

            const child_uri = URI.file(child_path).toString();
            const resolved_scope = await scope_resolver.resolve(child_uri, child_content);

            const prog = resolved_scope.symbols.programs.get('shared_prog');
            expect(prog).toBeDefined();
            expect((prog?.location.uri ?? '')).toContain('b.do');

            const scalar = resolved_scope.symbols.scalars.get('S');
            expect(scalar).toBeDefined();
            expect((scalar?.location.uri ?? '')).toContain('b.do');

            const matrix = resolved_scope.symbols.matrices.get('M');
            expect(matrix).toBeDefined();
            expect((matrix?.location.uri ?? '')).toContain('b.do');
        });

        it('should resolve program/scalar/matrix conflicts by lattermost directive when swapped', async () => {
            const parent_a_path = join(test_temp_dir, 'a.do');
            const parent_b_path = join(test_temp_dir, 'b.do');

            writeFileSync(
                parent_a_path,
                'program define shared_prog\n  display "A"\nend\nscalar S = 1\nmatrix define M = (1)'
            );
            writeFileSync(
                parent_b_path,
                'program define shared_prog\n  display "B"\nend\nscalar S = 2\nmatrix define M = (2)'
            );

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                '// @lsp-done-by "b.do"\n' +
                '// @lsp-done-by "a.do"\n' +
                'shared_prog\n' +
                'display S\n' +
                'matrix list M';
            writeFileSync(child_path, child_content);

            const child_uri = URI.file(child_path).toString();
            const resolved_scope = await scope_resolver.resolve(child_uri, child_content);

            const prog = resolved_scope.symbols.programs.get('shared_prog');
            expect(prog).toBeDefined();
            expect((prog?.location.uri ?? '')).toContain('a.do');

            const scalar = resolved_scope.symbols.scalars.get('S');
            expect(scalar).toBeDefined();
            expect((scalar?.location.uri ?? '')).toContain('a.do');

            const matrix = resolved_scope.symbols.matrices.get('M');
            expect(matrix).toBeDefined();
            expect((matrix?.location.uri ?? '')).toContain('a.do');
        });

        it('should warn and prefer included-by when both directive types reference same parent', async () => {
            const parent_path = join(test_temp_dir, 'parent.do');
            const parent_content = 'local parent_local "x"\nglobal parent_global "y"';
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                '// @lsp-done-by "parent.do"\n' +
                '// @lsp-included-by "parent.do"\n' +
                'local use_it `parent_local\'';
            writeFileSync(child_path, child_content);

            const resolved_scope = await scope_resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // included-by should win, so local from parent should be visible
            expect(resolved_scope.symbols.localMacros.has('parent_local')).toBe(true);

            // Should warn about conflicting directives
            const conflict_warning = resolved_scope.diagnostics.find((d) =>
                d.message.includes('Both @lsp-done-by and @lsp-included-by')
            );
            expect(conflict_warning).toBeDefined();
        });

        it('should respect done-by exclusion of local macros', async () => {
            const globals_path = join(test_temp_dir, 'globals.do');
            const globals_content = 'global GLOBAL_VAR "value"\nlocal local_var "local_value"';
            writeFileSync(globals_path, globals_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-done-by "globals.do"\nlocal test $GLOBAL_VAR';
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            const resolved_scope = await scope_resolver.resolve(main_uri, main_content);

            // Should have GLOBAL_VAR but not local_var
            expect(resolved_scope.symbols.globalMacros.has('GLOBAL_VAR')).toBe(true);
            expect(resolved_scope.symbols.localMacros.has('local_var')).toBe(false);
        });

        it('should allow included-by access to all symbols', async () => {
            const shared_path = join(test_temp_dir, 'shared.do');
            const shared_content = 'global SHARED_GLOBAL "value"\nlocal shared_local "local_value"';
            writeFileSync(shared_path, shared_content);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = '// @lsp-included-by "shared.do"\nlocal test $SHARED_GLOBAL';
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            const resolved_scope = await scope_resolver.resolve(main_uri, main_content);

            // Should have both SHARED_GLOBAL and shared_local
            expect(resolved_scope.symbols.globalMacros.has('SHARED_GLOBAL')).toBe(true);
            expect(resolved_scope.symbols.localMacros.has('shared_local')).toBe(true);
        });
    });

    describe('complex multi-file scenarios', () => {
        it('should handle deep directive chains with mixed inheritance', async () => {
            const base_path = join(test_temp_dir, 'base.do');
            const base_content = 'global BASE_VAR "base"\nlocal base_local "local"';
            writeFileSync(base_path, base_content);

            const middle_path = join(test_temp_dir, 'middle.do');
            const middle_content = '// @lsp-done-by "base.do"\nglobal MIDDLE_VAR "middle"\nlocal middle_local "middle_local"';
            writeFileSync(middle_path, middle_content);

            const top_path = join(test_temp_dir, 'top.do');
            const top_content = '// @lsp-included-by "middle.do"\nlocal result $BASE_VAR';
            writeFileSync(top_path, top_content);

            const top_uri = URI.file(top_path).toString();
            const resolved_scope = await scope_resolver.resolve(top_uri, top_content);

            // Should have BASE_VAR (from base via middle), MIDDLE_VAR, and middle_local
            expect(resolved_scope.symbols.globalMacros.has('BASE_VAR')).toBe(true);
            expect(resolved_scope.symbols.globalMacros.has('MIDDLE_VAR')).toBe(true);
            expect(resolved_scope.symbols.localMacros.has('middle_local')).toBe(true);
            // Should NOT have base_local (done-by excludes locals)
            expect(resolved_scope.symbols.localMacros.has('base_local')).toBe(false);
        });
    });

    describe('out-of-scope diagnostics', () => {
        it('should track symbols defined after call site as out-of-scope', async () => {
            // Parent defines BEFORE on line 0, call site on line 1, AFTER on line 2
            const parent_path = join(test_temp_dir, 'parent.do');
            const parent_content = 'global BEFORE "before"\ndo child.do\nglobal AFTER "after"';
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child.do');
            const child_content = '// @lsp-done-by "parent.do" match="do child.do"\nlocal x = 1';
            writeFileSync(child_path, child_content);

            const child_uri = URI.file(child_path).toString();
            const resolved_scope = await scope_resolver.resolve(child_uri, child_content);

            // BEFORE should be in scope (defined on line 0, call site on line 1)
            expect(resolved_scope.symbols.globalMacros.has('BEFORE')).toBe(true);
            // AFTER should NOT be in scope (defined on line 2, after call site)
            expect(resolved_scope.symbols.globalMacros.has('AFTER')).toBe(false);
            // AFTER should be tracked as out-of-scope
            const out_of_scope_after = resolved_scope.out_of_scope_symbols.find(
                s => s.name === 'AFTER'
            );
            expect(out_of_scope_after).toBeDefined();
            expect(out_of_scope_after?.type).toBe('global');
            expect(out_of_scope_after?.call_site_line).toBe(1); // 0-indexed (call site is on line 1)
        });
    });

    describe('active document scalar/matrix parsing', () => {
        it('should parse scalar and matrix definitions in the open document', async () => {
            const file_path = join(test_temp_dir, 'doc.do');
            const content = 'scalar S = 1\nmatrix define M = (1)';
            writeFileSync(file_path, content);

            const uri = URI.file(file_path).toString();
            await document_store.open(uri, content, 1);
            const document_state = document_store.get(uri)!;

            expect(document_state.symbols.scalars.has('S')).toBe(true);
            expect(document_state.symbols.matrices.has('M')).toBe(true);
        });
    });

    describe('go-to-definition respects Rule 2 (disjoint branches stay distinct)', () => {
        // Issue #135: same-name globals in files unreachable through the
        // dep graph have *different* identity. Go-to-definition returns
        // nothing so the user sees the accompanying "undefined global"
        // diagnostic — the correct signal to either add a
        // `do`/`run`/`include` edge, declare `@lsp-global`, or otherwise
        // bring the definition into scope. (Workspace Symbol search
        // remains the discovery tool for "find any `DUP` in the tree".)
        //
        // The positive counterpart — go-to-def pools reachable
        // redeclarations into one identity — is covered in
        // `tests/integration/goto-def-identity-redeclared.test.ts`
        // with a DependencyGraph-wired indexer.
        it('returns null for globals defined only in unrelated files', async () => {
            const file1_path = join(test_temp_dir, 'a.do');
            const file2_path = join(test_temp_dir, 'b.do');
            const use_path = join(test_temp_dir, 'use.do');

            writeFileSync(file1_path, 'global DUP "a"');
            writeFileSync(file2_path, 'global DUP "b"');
            writeFileSync(use_path, 'display "$DUP"');

            await indexer.initialize([test_temp_dir]);

            const use_uri = URI.file(use_path).toString();
            await document_store.open(use_uri, 'display "$DUP"', 1);
            const document_state = document_store.get(use_uri)!;

            const definition = await definition_provider.get_definition(
                document_state,
                { line: 0, character: 10 }, // on DUP in "$DUP"
                indexer.get_all_symbols(),
                undefined,
                scope_resolver,
                indexer,
            );

            expect(definition).toBeNull();
        });
    });
});
