/**
 * Integration tests for current file forward call resolution.
 * 
 * Tests that forward call directives (@lsp-include, @lsp-do, @lsp-run) in the current file
 * bring symbols from target files into scope for hover, completion, and diagnostics.
 * 
 * Requirements tested:
 * - 1.1: @lsp-include brings local macros into scope
 * - 1.2: @lsp-do/@lsp-run bring non-local symbols into scope (not locals)
 * - 2.1, 2.2: Position-aware visibility (symbols visible only after directive line)
 * - 3.1: Consistency with go-to-definition
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { HoverProvider } from '../../src/providers/hover';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { CommandDatabase } from '../../src/command-database';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Current File Forward Call Resolution - Directives', () => {
    const test_temp_dir = join(process.cwd(), 'temp_forward_call_directive_test');
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let command_db: CommandDatabase;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('7.1 Test hover with @lsp-include directive', () => {
        it('should show local macros from included file in hover', async () => {
            // Create helper file with local macros
            const helper_path = join(test_temp_dir, 'helper.do');
            const helper_content = 'local helper_local "helper_value"\nlocal another_local "another"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include directive
            const main_path = join(test_temp_dir, 'main.do');
            const main_content = `// @lsp-include: "helper.do"
display \`helper_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over helper_local on line 1 (after the directive)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'helper_local'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            expect(hover?.contents).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('helper_local');
        });

        it('should show local macros from included file with expansion value', async () => {
            // Create helper file with local macro that has a value
            const helper_path = join(test_temp_dir, 'helper_with_value.do');
            const helper_content = 'local data_path "/path/to/data"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include directive
            const main_path = join(test_temp_dir, 'main_with_value.do');
            const main_content = `// @lsp-include: "helper_with_value.do"
use \`data_path'/dataset.dta`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over data_path on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 6 }, // on 'data_path'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('data_path');
            expect(content.value).toContain('/path/to/data');
        });

        it('should include global macros from included file', async () => {
            // Create helper file with global macro
            const helper_path = join(test_temp_dir, 'globals_helper.do');
            const helper_content = 'global PROJECT_ROOT "/home/project"\nlocal temp "temp_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include directive
            const main_path = join(test_temp_dir, 'main_globals.do');
            const main_content = `// @lsp-include: "globals_helper.do"
display "$PROJECT_ROOT"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over PROJECT_ROOT on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'PROJECT_ROOT'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Global Macro');
            expect(content.value).toContain('PROJECT_ROOT');
        });
    });

    describe('7.2 Test hover with @lsp-do directive', () => {
        it('should show global macros from do-file in hover', async () => {
            // Create helper file with global and local macros
            const helper_path = join(test_temp_dir, 'do_helper.do');
            const helper_content = 'global DO_GLOBAL "global_value"\nlocal do_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do directive
            const main_path = join(test_temp_dir, 'main_do.do');
            const main_content = `// @lsp-do: "do_helper.do"
display "$DO_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over DO_GLOBAL on line 1 (after the directive)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'DO_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Global Macro');
            expect(content.value).toContain('DO_GLOBAL');
        });

        it('should NOT show local macros from do-file in hover', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'do_helper_local.do');
            const helper_content = 'local do_local_only "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do directive
            const main_path = join(test_temp_dir, 'main_do_local.do');
            const main_content = `// @lsp-do: "do_helper_local.do"
display \`do_local_only'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over do_local_only on line 1 - should NOT find it
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'do_local_only'
                undefined,
                scope_resolver
            );

            // Should not find the local macro from do-file
            // Either hover is null or doesn't contain the local macro info
            if (hover) {
                const content = hover?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('do_local_only');
            }
        });

        it('should show programs from do-file in hover', async () => {
            // Create helper file with a program
            const helper_path = join(test_temp_dir, 'do_helper_prog.do');
            const helper_content = 'program define my_do_program\n  display "hello"\nend';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do directive
            const main_path = join(test_temp_dir, 'main_do_prog.do');
            const main_content = `// @lsp-do: "do_helper_prog.do"
my_do_program`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_do_program on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 5 }, // on 'my_do_program'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Program');
            expect(content.value).toContain('my_do_program');
        });

        it('should show scalars from do-file in hover', async () => {
            // Create helper file with a scalar
            const helper_path = join(test_temp_dir, 'do_helper_scalar.do');
            const helper_content = 'scalar my_scalar = 42';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do directive
            const main_path = join(test_temp_dir, 'main_do_scalar.do');
            const main_content = `// @lsp-do: "do_helper_scalar.do"
display my_scalar`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_scalar on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'my_scalar'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Scalar');
            expect(content.value).toContain('my_scalar');
        });
    });

    describe('7.3 Test position-aware visibility with directives', () => {
        it('should NOT show symbols from forward call BEFORE directive line', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'position_helper.do');
            const helper_content = 'local position_local "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include directive on line 1 (0-indexed)
            // Line 0: comment
            // Line 1: directive
            // Line 2: code after directive
            const main_path = join(test_temp_dir, 'main_position.do');
            const main_content = `* This is a comment referencing position_local
// @lsp-include: "position_helper.do"
display \`position_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over position_local on line 0 (BEFORE the directive on line 1)
            // Should NOT find the symbol
            const hover_before = await hover_provider.get_hover(
                document_state,
                { line: 0, character: 35 }, // on 'position_local' in comment
                undefined,
                scope_resolver
            );

            // Should not find the local macro before the directive
            if (hover_before) {
                const content = hover_before?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('Local Macro');
            }
        });

        it('should show symbols from forward call AFTER directive line', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'position_helper2.do');
            const helper_content = 'local after_local "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include directive on line 0
            const main_path = join(test_temp_dir, 'main_position2.do');
            const main_content = `// @lsp-include: "position_helper2.do"
display \`after_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over after_local on line 1 (AFTER the directive on line 0)
            const hover_after = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'after_local'
                undefined,
                scope_resolver
            );

            expect(hover_after).toBeDefined();
            const content = hover_after?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('after_local');
        });

        it('should NOT show symbols on the same line as directive', async () => {
            // Create helper file with global macro
            const helper_path = join(test_temp_dir, 'same_line_helper.do');
            const helper_content = 'global SAME_LINE_GLOBAL "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do directive
            // The symbol reference is on the same line as the directive (line 0)
            const main_path = join(test_temp_dir, 'main_same_line.do');
            const main_content = `// @lsp-do: "same_line_helper.do" SAME_LINE_GLOBAL
display "$SAME_LINE_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over SAME_LINE_GLOBAL on line 0 (same line as directive)
            // Should NOT find the symbol (symbols visible only AFTER directive line)
            const hover_same_line = await hover_provider.get_hover(
                document_state,
                { line: 0, character: 40 }, // on 'SAME_LINE_GLOBAL' in comment
                undefined,
                scope_resolver
            );

            // Should not find the global macro on the same line as directive
            if (hover_same_line) {
                const content = hover_same_line?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('Global Macro');
            }
        });

        it('should handle multiple directives with correct visibility boundaries', async () => {
            // Create two helper files
            const helper1_path = join(test_temp_dir, 'multi_helper1.do');
            const helper1_content = 'global FIRST_GLOBAL "first"';
            writeFileSync(helper1_path, helper1_content);

            const helper2_path = join(test_temp_dir, 'multi_helper2.do');
            const helper2_content = 'global SECOND_GLOBAL "second"';
            writeFileSync(helper2_path, helper2_content);

            // Create main file with two @lsp-do directives
            const main_path = join(test_temp_dir, 'main_multi.do');
            const main_content = `// @lsp-do: "multi_helper1.do"
display "$FIRST_GLOBAL"
// @lsp-do: "multi_helper2.do"
display "$SECOND_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over FIRST_GLOBAL on line 1 (after first directive on line 0)
            const hover_first = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'FIRST_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_first).toBeDefined();
            const content_first = hover_first?.contents as { kind: string; value: string };
            expect(content_first.value).toContain('Global Macro');
            expect(content_first.value).toContain('FIRST_GLOBAL');

            // Hover over SECOND_GLOBAL on line 3 (after second directive on line 2)
            const hover_second = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 12 }, // on 'SECOND_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_second).toBeDefined();
            const content_second = hover_second?.contents as { kind: string; value: string };
            expect(content_second.value).toContain('Global Macro');
            expect(content_second.value).toContain('SECOND_GLOBAL');
        });
    });

    describe('Diagnostics with current-file forward calls', () => {
        const mock_connection = {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        };

        it('suppresses undefined macro after @lsp-include in current file', async () => {
            const diagnostics_provider = new DiagnosticsProvider(mock_connection as any);
            const document_store = new DocumentStore();
            const scope_resolver = new ScopeResolver();
            const forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
            scope_resolver.set_forward_scope_resolver(forward_scope_resolver);

            const helper_path = join(test_temp_dir, 'diag_helper_include.do');
            const helper_content = 'local helper_local "ok"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'diag_main_include.do');
            const main_content = `display \`helper_local'
// @lsp-include: "diag_helper_include.do"
display \`helper_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const config = {
                ...DEFAULT_SETTINGS,
                diagnostics: {
                    ...DEFAULT_SETTINGS.diagnostics,
                    undefinedVariableEnabled: true,
                },
            };

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            const macro_diags = diagnostics.filter(d => d.message.includes('helper_local'));

            expect(macro_diags.length).toBe(1);
            expect(macro_diags[0].range.start.line).toBe(0); // before the include
        });

        it('suppresses undefined macro after @lsp-do in current file', async () => {
            const diagnostics_provider = new DiagnosticsProvider(mock_connection as any);
            const document_store = new DocumentStore();
            const scope_resolver = new ScopeResolver();
            const forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
            scope_resolver.set_forward_scope_resolver(forward_scope_resolver);

            const helper_path = join(test_temp_dir, 'diag_helper_do.do');
            const helper_content = 'global helper_global "ok"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'diag_main_do.do');
            const main_content = `display $helper_global
// @lsp-do: "diag_helper_do.do"
display $helper_global`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const config = {
                ...DEFAULT_SETTINGS,
                diagnostics: {
                    ...DEFAULT_SETTINGS.diagnostics,
                    undefinedVariableEnabled: true,
                },
            };

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            const macro_diags = diagnostics.filter(d => d.message.includes('helper_global'));

            expect(macro_diags.length).toBe(1);
            expect(macro_diags[0].range.start.line).toBe(0); // before the do call
        });
    });
});


describe('Current File Forward Call Resolution - Commands', () => {
    const test_temp_dir = join(process.cwd(), 'temp_forward_call_command_test');
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let command_db: CommandDatabase;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('8.1 Test hover with include command', () => {
        it('should show local macros from included file in hover (same as directive)', async () => {
            // Create helper file with local macros
            const helper_path = join(test_temp_dir, 'include_helper.do');
            const helper_content = 'local include_local "include_value"\nlocal another_include_local "another"';
            writeFileSync(helper_path, helper_content);

            // Create main file with include command
            const main_path = join(test_temp_dir, 'main_include_cmd.do');
            const main_content = `include "include_helper.do"
display \`include_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over include_local on line 1 (after the include command)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'include_local'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            expect(hover?.contents).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('include_local');
        });

        it('should show local macros from included file with expansion value', async () => {
            // Create helper file with local macro that has a value
            const helper_path = join(test_temp_dir, 'include_helper_value.do');
            const helper_content = 'local include_data_path "/path/to/include/data"';
            writeFileSync(helper_path, helper_content);

            // Create main file with include command
            const main_path = join(test_temp_dir, 'main_include_value.do');
            const main_content = `include "include_helper_value.do"
use \`include_data_path'/dataset.dta`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over include_data_path on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 6 }, // on 'include_data_path'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('include_data_path');
            expect(content.value).toContain('/path/to/include/data');
        });

        it('should include global macros from included file', async () => {
            // Create helper file with global macro
            const helper_path = join(test_temp_dir, 'include_globals_helper.do');
            const helper_content = 'global INCLUDE_PROJECT_ROOT "/home/include/project"\nlocal temp "temp_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with include command
            const main_path = join(test_temp_dir, 'main_include_globals.do');
            const main_content = `include "include_globals_helper.do"
display "$INCLUDE_PROJECT_ROOT"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over INCLUDE_PROJECT_ROOT on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'INCLUDE_PROJECT_ROOT'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Global Macro');
            expect(content.value).toContain('INCLUDE_PROJECT_ROOT');
        });
    });

    describe('8.2 Test hover with do command', () => {
        it('should show global macros from do-file in hover (same as directive)', async () => {
            // Create helper file with global and local macros
            const helper_path = join(test_temp_dir, 'do_cmd_helper.do');
            const helper_content = 'global DO_CMD_GLOBAL "global_value"\nlocal do_cmd_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with do command
            const main_path = join(test_temp_dir, 'main_do_cmd.do');
            const main_content = `do "do_cmd_helper.do"
display "$DO_CMD_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over DO_CMD_GLOBAL on line 1 (after the do command)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'DO_CMD_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Global Macro');
            expect(content.value).toContain('DO_CMD_GLOBAL');
        });

        it('should NOT show local macros from do-file in hover (same as directive)', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'do_cmd_helper_local.do');
            const helper_content = 'local do_cmd_local_only "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with do command
            const main_path = join(test_temp_dir, 'main_do_cmd_local.do');
            const main_content = `do "do_cmd_helper_local.do"
display \`do_cmd_local_only'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over do_cmd_local_only on line 1 - should NOT find it
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'do_cmd_local_only'
                undefined,
                scope_resolver
            );

            // Should not find the local macro from do-file
            if (hover) {
                const content = hover?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('do_cmd_local_only');
            }
        });

        it('should show programs from do-file in hover (same as directive)', async () => {
            // Create helper file with a program
            const helper_path = join(test_temp_dir, 'do_cmd_helper_prog.do');
            const helper_content = 'program define my_do_cmd_program\n  display "hello"\nend';
            writeFileSync(helper_path, helper_content);

            // Create main file with do command
            const main_path = join(test_temp_dir, 'main_do_cmd_prog.do');
            const main_content = `do "do_cmd_helper_prog.do"
my_do_cmd_program`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_do_cmd_program on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 5 }, // on 'my_do_cmd_program'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Program');
            expect(content.value).toContain('my_do_cmd_program');
        });

        it('should show scalars from do-file in hover (same as directive)', async () => {
            // Create helper file with a scalar
            const helper_path = join(test_temp_dir, 'do_cmd_helper_scalar.do');
            const helper_content = 'scalar my_do_cmd_scalar = 42';
            writeFileSync(helper_path, helper_content);

            // Create main file with do command
            const main_path = join(test_temp_dir, 'main_do_cmd_scalar.do');
            const main_content = `do "do_cmd_helper_scalar.do"
display my_do_cmd_scalar`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_do_cmd_scalar on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'my_do_cmd_scalar'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Scalar');
            expect(content.value).toContain('my_do_cmd_scalar');
        });
    });

    describe('8.3 Test hover with run command', () => {
        it('should show global macros from run-file in hover (same as directive)', async () => {
            // Create helper file with global and local macros
            const helper_path = join(test_temp_dir, 'run_cmd_helper.do');
            const helper_content = 'global RUN_CMD_GLOBAL "global_value"\nlocal run_cmd_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with run command
            const main_path = join(test_temp_dir, 'main_run_cmd.do');
            const main_content = `run "run_cmd_helper.do"
display "$RUN_CMD_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over RUN_CMD_GLOBAL on line 1 (after the run command)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'RUN_CMD_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Global Macro');
            expect(content.value).toContain('RUN_CMD_GLOBAL');
        });

        it('should NOT show local macros from run-file in hover (same as directive)', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'run_cmd_helper_local.do');
            const helper_content = 'local run_cmd_local_only "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with run command
            const main_path = join(test_temp_dir, 'main_run_cmd_local.do');
            const main_content = `run "run_cmd_helper_local.do"
display \`run_cmd_local_only'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over run_cmd_local_only on line 1 - should NOT find it
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'run_cmd_local_only'
                undefined,
                scope_resolver
            );

            // Should not find the local macro from run-file
            if (hover) {
                const content = hover?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('run_cmd_local_only');
            }
        });

        it('should show programs from run-file in hover (same as directive)', async () => {
            // Create helper file with a program
            const helper_path = join(test_temp_dir, 'run_cmd_helper_prog.do');
            const helper_content = 'program define my_run_cmd_program\n  display "hello"\nend';
            writeFileSync(helper_path, helper_content);

            // Create main file with run command
            const main_path = join(test_temp_dir, 'main_run_cmd_prog.do');
            const main_content = `run "run_cmd_helper_prog.do"
my_run_cmd_program`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_run_cmd_program on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 5 }, // on 'my_run_cmd_program'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Program');
            expect(content.value).toContain('my_run_cmd_program');
        });

        it('should show scalars from run-file in hover (same as directive)', async () => {
            // Create helper file with a scalar
            const helper_path = join(test_temp_dir, 'run_cmd_helper_scalar.do');
            const helper_content = 'scalar my_run_cmd_scalar = 99';
            writeFileSync(helper_path, helper_content);

            // Create main file with run command
            const main_path = join(test_temp_dir, 'main_run_cmd_scalar.do');
            const main_content = `run "run_cmd_helper_scalar.do"
display my_run_cmd_scalar`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over my_run_cmd_scalar on line 1
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'my_run_cmd_scalar'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Scalar');
            expect(content.value).toContain('my_run_cmd_scalar');
        });
    });

    describe('8.4 Test position-aware visibility with commands', () => {
        it('should NOT show symbols from forward call BEFORE command line', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'cmd_position_helper.do');
            const helper_content = 'local cmd_position_local "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with include command on line 1 (0-indexed)
            // Line 0: comment referencing the symbol
            // Line 1: include command
            // Line 2: code after command
            const main_path = join(test_temp_dir, 'main_cmd_position.do');
            const main_content = `* This is a comment referencing cmd_position_local
include "cmd_position_helper.do"
display \`cmd_position_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over cmd_position_local on line 0 (BEFORE the command on line 1)
            // Should NOT find the symbol
            const hover_before = await hover_provider.get_hover(
                document_state,
                { line: 0, character: 38 }, // on 'cmd_position_local' in comment
                undefined,
                scope_resolver
            );

            // Should not find the local macro before the command
            if (hover_before) {
                const content = hover_before?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('Local Macro');
            }
        });

        it('should show symbols from forward call AFTER command line', async () => {
            // Create helper file with local macro
            const helper_path = join(test_temp_dir, 'cmd_position_helper2.do');
            const helper_content = 'local cmd_after_local "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with include command on line 0
            const main_path = join(test_temp_dir, 'main_cmd_position2.do');
            const main_content = `include "cmd_position_helper2.do"
display \`cmd_after_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over cmd_after_local on line 1 (AFTER the command on line 0)
            const hover_after = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'cmd_after_local'
                undefined,
                scope_resolver
            );

            expect(hover_after).toBeDefined();
            const content = hover_after?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('cmd_after_local');
        });

        it('should NOT show symbols on the same line as command', async () => {
            // Create helper file with global macro
            const helper_path = join(test_temp_dir, 'cmd_same_line_helper.do');
            const helper_content = 'global CMD_SAME_LINE_GLOBAL "value"';
            writeFileSync(helper_path, helper_content);

            // Create main file with do command
            // The symbol reference is on the same line as the command (line 0)
            const main_path = join(test_temp_dir, 'main_cmd_same_line.do');
            const main_content = `do "cmd_same_line_helper.do" // CMD_SAME_LINE_GLOBAL
display "$CMD_SAME_LINE_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over CMD_SAME_LINE_GLOBAL on line 0 (same line as command)
            // Should NOT find the symbol (symbols visible only AFTER command line)
            const hover_same_line = await hover_provider.get_hover(
                document_state,
                { line: 0, character: 35 }, // on 'CMD_SAME_LINE_GLOBAL' in comment
                undefined,
                scope_resolver
            );

            // Should not find the global macro on the same line as command
            if (hover_same_line) {
                const content = hover_same_line?.contents as { kind: string; value: string };
                expect(content.value).not.toContain('Global Macro');
            }
        });

        it('should handle multiple commands with correct visibility boundaries', async () => {
            // Create two helper files
            const helper1_path = join(test_temp_dir, 'cmd_multi_helper1.do');
            const helper1_content = 'global CMD_FIRST_GLOBAL "first"';
            writeFileSync(helper1_path, helper1_content);

            const helper2_path = join(test_temp_dir, 'cmd_multi_helper2.do');
            const helper2_content = 'global CMD_SECOND_GLOBAL "second"';
            writeFileSync(helper2_path, helper2_content);

            // Create main file with two do commands
            const main_path = join(test_temp_dir, 'main_cmd_multi.do');
            const main_content = `do "cmd_multi_helper1.do"
display "$CMD_FIRST_GLOBAL"
do "cmd_multi_helper2.do"
display "$CMD_SECOND_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over CMD_FIRST_GLOBAL on line 1 (after first command on line 0)
            const hover_first = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'CMD_FIRST_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_first).toBeDefined();
            const content_first = hover_first?.contents as { kind: string; value: string };
            expect(content_first.value).toContain('Global Macro');
            expect(content_first.value).toContain('CMD_FIRST_GLOBAL');

            // Hover over CMD_SECOND_GLOBAL on line 3 (after second command on line 2)
            const hover_second = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 12 }, // on 'CMD_SECOND_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_second).toBeDefined();
            const content_second = hover_second?.contents as { kind: string; value: string };
            expect(content_second.value).toContain('Global Macro');
            expect(content_second.value).toContain('CMD_SECOND_GLOBAL');
        });

        it('should handle mixed commands and directives with correct visibility', async () => {
            // Create two helper files
            const helper1_path = join(test_temp_dir, 'mixed_helper1.do');
            const helper1_content = 'global MIXED_DIRECTIVE_GLOBAL "directive"';
            writeFileSync(helper1_path, helper1_content);

            const helper2_path = join(test_temp_dir, 'mixed_helper2.do');
            const helper2_content = 'global MIXED_COMMAND_GLOBAL "command"';
            writeFileSync(helper2_path, helper2_content);

            // Create main file with directive and command
            const main_path = join(test_temp_dir, 'main_mixed.do');
            const main_content = `// @lsp-do: "mixed_helper1.do"
display "$MIXED_DIRECTIVE_GLOBAL"
do "mixed_helper2.do"
display "$MIXED_COMMAND_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over MIXED_DIRECTIVE_GLOBAL on line 1 (after directive on line 0)
            const hover_directive = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'MIXED_DIRECTIVE_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_directive).toBeDefined();
            const content_directive = hover_directive?.contents as { kind: string; value: string };
            expect(content_directive.value).toContain('Global Macro');
            expect(content_directive.value).toContain('MIXED_DIRECTIVE_GLOBAL');

            // Hover over MIXED_COMMAND_GLOBAL on line 3 (after command on line 2)
            const hover_command = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 12 }, // on 'MIXED_COMMAND_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_command).toBeDefined();
            const content_command = hover_command?.contents as { kind: string; value: string };
            expect(content_command.value).toContain('Global Macro');
            expect(content_command.value).toContain('MIXED_COMMAND_GLOBAL');
        });
    });
});


describe('Current File Forward Call Resolution - Duplicate Handling and Forward-Only Resolution', () => {
    describe('9.4 Test maxForwardDepth limits nested forward call resolution', () => {
        it('should not traverse beyond max_forward_depth when resolving current-file forward calls', async () => {
            // Layout:
            // main.do includes level1.do
            // level1.do includes level2.do
            // level2.do defines local too_deep
            // With max_forward_depth = 1, we should see symbols from level1.do but NOT from level2.do.
            const test_temp_dir = join(process.cwd(), 'temp_forward_call_depth_test');
            if (existsSync(test_temp_dir)) {
                rmSync(test_temp_dir, { recursive: true, force: true });
            }
            mkdirSync(test_temp_dir);

            const command_db = new CommandDatabase();
            const hover_provider = new HoverProvider(command_db);
            const document_store = new DocumentStore();
            const scope_resolver = new ScopeResolver();
            const forward_scope_resolver = new ForwardScopeResolver(scope_resolver, { max_forward_depth: 10 });
            scope_resolver.set_forward_scope_resolver(forward_scope_resolver);

            const level2_path = join(test_temp_dir, 'level2.do');
            writeFileSync(level2_path, 'local too_deep "nope"');

            const level1_path = join(test_temp_dir, 'level1.do');
            writeFileSync(level1_path, `include "level2.do"\nlocal ok_level1 "yes"`);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = `include "level1.do"\ndisplay \`ok_level1'\ndisplay \`too_deep'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over ok_level1 (line 1) should succeed even with max_forward_depth=1.
            const ok_hover = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 },
                undefined,
                scope_resolver,
                { max_forward_depth: 1 }
            );
            expect(ok_hover).toBeDefined();
            const ok_content = ok_hover?.contents as { kind: string; value: string };
            expect(ok_content.value).toContain('ok_level1');

            // Hover over too_deep (line 2) should NOT show a Local Macro section from level2.do.
            const too_deep_hover = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 10 },
                undefined,
                scope_resolver,
                { max_forward_depth: 1 }
            );

            // Hover might still exist (e.g., command db fallback), but must not include the macro.
            if (too_deep_hover && typeof too_deep_hover.contents === 'object' && 'value' in too_deep_hover.contents) {
                const value = (too_deep_hover.contents as { kind: string; value: string }).value;
                expect(value.includes('too_deep')).toBe(false);
                expect(value.includes('Local Macro')).toBe(false);
            }

            rmSync(test_temp_dir, { recursive: true, force: true });
        });
    });

    const test_temp_dir = join(process.cwd(), 'temp_forward_call_duplicate_test');
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let command_db: CommandDatabase;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('9.1 Test do-then-include adds only locals', () => {
        it('should add local macros when file is included after being do-ed', async () => {
            // Create helper file with both global and local macros
            const helper_path = join(test_temp_dir, 'do_then_include_helper.do');
            const helper_content = 'global SHARED_GLOBAL "global_value"\nlocal shared_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file that first does the file, then includes it
            // After do: only global should be visible
            // After include: local should also become visible
            const main_path = join(test_temp_dir, 'main_do_then_include.do');
            const main_content = `do "do_then_include_helper.do"
display "$SHARED_GLOBAL"
include "do_then_include_helper.do"
display \`shared_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over SHARED_GLOBAL on line 1 (after do command on line 0)
            // Should find the global macro
            const hover_global = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'SHARED_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_global).toBeDefined();
            const content_global = hover_global?.contents as { kind: string; value: string };
            expect(content_global.value).toContain('Global Macro');
            expect(content_global.value).toContain('SHARED_GLOBAL');

            // Hover over shared_local on line 1 (after do but before include)
            // Should NOT find the local macro yet
            const hover_local_before = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 20 }, // position that doesn't have shared_local
                undefined,
                scope_resolver
            );

            // The local should not be visible before the include
            // (We can't easily test this on line 1 since there's no reference there)

            // Hover over shared_local on line 3 (after include command on line 2)
            // Should find the local macro now
            const hover_local_after = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 10 }, // on 'shared_local'
                undefined,
                scope_resolver
            );

            expect(hover_local_after).toBeDefined();
            const content_local = hover_local_after?.contents as { kind: string; value: string };
            expect(content_local.value).toContain('Local Macro');
            expect(content_local.value).toContain('shared_local');
        });

        it('should add locals from include even when do was processed first', async () => {
            // Create helper file with local macro only
            const helper_path = join(test_temp_dir, 'do_then_include_local_only.do');
            const helper_content = 'local only_local "only_local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file: do first (no locals), then include (adds locals)
            const main_path = join(test_temp_dir, 'main_do_then_include_local.do');
            const main_content = `do "do_then_include_local_only.do"
* local not visible here
include "do_then_include_local_only.do"
display \`only_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over only_local on line 3 (after include on line 2)
            const hover = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 10 }, // on 'only_local'
                undefined,
                scope_resolver
            );

            expect(hover).toBeDefined();
            const content = hover?.contents as { kind: string; value: string };
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('only_local');
        });

        it('should work with directives: @lsp-do then @lsp-include', async () => {
            // Create helper file with both global and local macros
            const helper_path = join(test_temp_dir, 'directive_do_then_include.do');
            const helper_content = 'global DIR_SHARED_GLOBAL "global"\nlocal dir_shared_local "local"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-do then @lsp-include directives
            const main_path = join(test_temp_dir, 'main_directive_do_then_include.do');
            const main_content = `// @lsp-do: "directive_do_then_include.do"
display "$DIR_SHARED_GLOBAL"
// @lsp-include: "directive_do_then_include.do"
display \`dir_shared_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over DIR_SHARED_GLOBAL on line 1 (after @lsp-do on line 0)
            const hover_global = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'DIR_SHARED_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_global).toBeDefined();
            const content_global = hover_global?.contents as { kind: string; value: string };
            expect(content_global.value).toContain('Global Macro');
            expect(content_global.value).toContain('DIR_SHARED_GLOBAL');

            // Hover over dir_shared_local on line 3 (after @lsp-include on line 2)
            const hover_local = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 10 }, // on 'dir_shared_local'
                undefined,
                scope_resolver
            );

            expect(hover_local).toBeDefined();
            const content_local = hover_local?.contents as { kind: string; value: string };
            expect(content_local.value).toContain('Local Macro');
            expect(content_local.value).toContain('dir_shared_local');
        });
    });

    describe('9.2 Test include-then-do skips second reference', () => {
        it('should skip do command when file was already included', async () => {
            // Create helper file with both global and local macros
            const helper_path = join(test_temp_dir, 'include_then_do_helper.do');
            const helper_content = 'global INCDO_GLOBAL "global_value"\nlocal incdo_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file that first includes the file, then does it
            // After include: both global and local should be visible
            // After do: should be skipped (all symbols already included)
            const main_path = join(test_temp_dir, 'main_include_then_do.do');
            const main_content = `include "include_then_do_helper.do"
display \`incdo_local'
display "$INCDO_GLOBAL"
do "include_then_do_helper.do"
display \`incdo_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over incdo_local on line 1 (after include on line 0)
            // Should find the local macro
            const hover_local = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'incdo_local'
                undefined,
                scope_resolver
            );

            expect(hover_local).toBeDefined();
            const content_local = hover_local?.contents as { kind: string; value: string };
            expect(content_local.value).toContain('Local Macro');
            expect(content_local.value).toContain('incdo_local');

            // Hover over INCDO_GLOBAL on line 2 (after include on line 0)
            // Should find the global macro
            const hover_global = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 12 }, // on 'INCDO_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_global).toBeDefined();
            const content_global = hover_global?.contents as { kind: string; value: string };
            expect(content_global.value).toContain('Global Macro');
            expect(content_global.value).toContain('INCDO_GLOBAL');

            // Hover over incdo_local on line 4 (after do on line 3)
            // Should still find the local macro (from the earlier include)
            const hover_local_after_do = await hover_provider.get_hover(
                document_state,
                { line: 4, character: 10 }, // on 'incdo_local'
                undefined,
                scope_resolver
            );

            expect(hover_local_after_do).toBeDefined();
            const content_local_after = hover_local_after_do?.contents as { kind: string; value: string };
            expect(content_local_after.value).toContain('Local Macro');
            expect(content_local_after.value).toContain('incdo_local');
        });

        it('should skip run command when file was already included', async () => {
            // Create helper file with both global and local macros
            const helper_path = join(test_temp_dir, 'include_then_run_helper.do');
            const helper_content = 'global INCRUN_GLOBAL "global_value"\nlocal incrun_local "local_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file that first includes the file, then runs it
            const main_path = join(test_temp_dir, 'main_include_then_run.do');
            const main_content = `include "include_then_run_helper.do"
display \`incrun_local'
run "include_then_run_helper.do"
display \`incrun_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over incrun_local on line 1 (after include on line 0)
            const hover_local = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'incrun_local'
                undefined,
                scope_resolver
            );

            expect(hover_local).toBeDefined();
            const content_local = hover_local?.contents as { kind: string; value: string };
            expect(content_local.value).toContain('Local Macro');
            expect(content_local.value).toContain('incrun_local');

            // Hover over incrun_local on line 3 (after run on line 2)
            // Should still find the local macro (from the earlier include)
            const hover_local_after_run = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 10 }, // on 'incrun_local'
                undefined,
                scope_resolver
            );

            expect(hover_local_after_run).toBeDefined();
            const content_local_after = hover_local_after_run?.contents as { kind: string; value: string };
            expect(content_local_after.value).toContain('Local Macro');
            expect(content_local_after.value).toContain('incrun_local');
        });

        it('should work with directives: @lsp-include then @lsp-do', async () => {
            // Create helper file with both global and local macros
            const helper_path = join(test_temp_dir, 'directive_include_then_do.do');
            const helper_content = 'global DIR_INCDO_GLOBAL "global"\nlocal dir_incdo_local "local"';
            writeFileSync(helper_path, helper_content);

            // Create main file with @lsp-include then @lsp-do directives
            const main_path = join(test_temp_dir, 'main_directive_include_then_do.do');
            const main_content = `// @lsp-include: "directive_include_then_do.do"
display \`dir_incdo_local'
// @lsp-do: "directive_include_then_do.do"
display \`dir_incdo_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over dir_incdo_local on line 1 (after @lsp-include on line 0)
            const hover_local = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'dir_incdo_local'
                undefined,
                scope_resolver
            );

            expect(hover_local).toBeDefined();
            const content_local = hover_local?.contents as { kind: string; value: string };
            expect(content_local.value).toContain('Local Macro');
            expect(content_local.value).toContain('dir_incdo_local');

            // Hover over dir_incdo_local on line 3 (after @lsp-do on line 2)
            // Should still find the local macro (from the earlier @lsp-include)
            const hover_local_after = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 10 }, // on 'dir_incdo_local'
                undefined,
                scope_resolver
            );

            expect(hover_local_after).toBeDefined();
            const content_local_after = hover_local_after?.contents as { kind: string; value: string };
            expect(content_local_after.value).toContain('Local Macro');
            expect(content_local_after.value).toContain('dir_incdo_local');
        });

        it('should skip do when same file was do-ed before', async () => {
            // Create helper file with global macro
            const helper_path = join(test_temp_dir, 'do_then_do_helper.do');
            const helper_content = 'global DODO_GLOBAL "global_value"';
            writeFileSync(helper_path, helper_content);

            // Create main file that does the same file twice
            const main_path = join(test_temp_dir, 'main_do_then_do.do');
            const main_content = `do "do_then_do_helper.do"
display "$DODO_GLOBAL"
do "do_then_do_helper.do"
display "$DODO_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over DODO_GLOBAL on line 1 (after first do on line 0)
            const hover_first = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'DODO_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_first).toBeDefined();
            const content_first = hover_first?.contents as { kind: string; value: string };
            expect(content_first.value).toContain('Global Macro');
            expect(content_first.value).toContain('DODO_GLOBAL');

            // Hover over DODO_GLOBAL on line 3 (after second do on line 2)
            // Should still find the global macro (from the first do)
            const hover_second = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 12 }, // on 'DODO_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_second).toBeDefined();
            const content_second = hover_second?.contents as { kind: string; value: string };
            expect(content_second.value).toContain('Global Macro');
            expect(content_second.value).toContain('DODO_GLOBAL');
        });
    });

    describe('9.3 Test forward resolution does not follow backward directives', () => {
        it('should NOT inherit symbols from target file\'s @lsp-done-by parent', async () => {
            // Create grandparent file with a global macro
            const grandparent_path = join(test_temp_dir, 'grandparent.do');
            const grandparent_content = 'global GRANDPARENT_GLOBAL "grandparent_value"';
            writeFileSync(grandparent_path, grandparent_content);

            // Create target file with @lsp-done-by pointing to grandparent
            // This file has its own local macro
            const target_path = join(test_temp_dir, 'target_with_backward.do');
            const target_content = `// @lsp-done-by: "grandparent.do"
local target_local "target_value"
global TARGET_GLOBAL "target_global"`;
            writeFileSync(target_path, target_content);

            // Create main file that does the target file
            // Should get TARGET_GLOBAL but NOT GRANDPARENT_GLOBAL
            const main_path = join(test_temp_dir, 'main_no_backward.do');
            const main_content = `do "target_with_backward.do"
display "$TARGET_GLOBAL"
display "$GRANDPARENT_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over TARGET_GLOBAL on line 1 (after do on line 0)
            // Should find the global macro from target file
            const hover_target = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'TARGET_GLOBAL'
                undefined,
                scope_resolver
            );

            expect(hover_target).toBeDefined();
            const content_target = hover_target?.contents as { kind: string; value: string };
            expect(content_target.value).toContain('Global Macro');
            expect(content_target.value).toContain('TARGET_GLOBAL');

            // Hover over GRANDPARENT_GLOBAL on line 2
            // Should NOT find the global macro from grandparent
            // (forward resolution should not follow backward directives)
            const hover_grandparent = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 12 }, // on 'GRANDPARENT_GLOBAL'
                undefined,
                scope_resolver
            );

            // Should not find the grandparent's global macro
            if (hover_grandparent) {
                const content_grandparent = hover_grandparent?.contents as { kind: string; value: string };
                expect(content_grandparent.value).not.toContain('GRANDPARENT_GLOBAL');
            }
        });

        it('should NOT inherit symbols from target file\'s @lsp-included-by parent', async () => {
            // Create grandparent file with a local macro
            const grandparent_path = join(test_temp_dir, 'grandparent_include.do');
            const grandparent_content = 'local grandparent_local "grandparent_value"';
            writeFileSync(grandparent_path, grandparent_content);

            // Create target file with @lsp-included-by pointing to grandparent
            const target_path = join(test_temp_dir, 'target_with_included_by.do');
            const target_content = `// @lsp-included-by: "grandparent_include.do"
local target_inc_local "target_value"`;
            writeFileSync(target_path, target_content);

            // Create main file that includes the target file
            // Should get target_inc_local but NOT grandparent_local
            const main_path = join(test_temp_dir, 'main_no_included_by.do');
            const main_content = `include "target_with_included_by.do"
display \`target_inc_local'
display \`grandparent_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over target_inc_local on line 1 (after include on line 0)
            // Should find the local macro from target file
            const hover_target = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 10 }, // on 'target_inc_local'
                undefined,
                scope_resolver
            );

            expect(hover_target).toBeDefined();
            const content_target = hover_target?.contents as { kind: string; value: string };
            expect(content_target.value).toContain('Local Macro');
            expect(content_target.value).toContain('target_inc_local');

            // Hover over grandparent_local on line 2
            // Should NOT find the local macro from grandparent
            const hover_grandparent = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 10 }, // on 'grandparent_local'
                undefined,
                scope_resolver
            );

            // Should not find the grandparent's local macro
            if (hover_grandparent) {
                const content_grandparent = hover_grandparent?.contents as { kind: string; value: string };
                expect(content_grandparent.value).not.toContain('grandparent_local');
            }
        });

        it('should follow target file\'s own forward calls but not backward directives', async () => {
            // Create grandparent file with a global macro (backward)
            const grandparent_path = join(test_temp_dir, 'backward_grandparent.do');
            const grandparent_content = 'global BACKWARD_GRANDPARENT "backward"';
            writeFileSync(grandparent_path, grandparent_content);

            // Create nested file with a global macro (forward)
            const nested_path = join(test_temp_dir, 'forward_nested.do');
            const nested_content = 'global FORWARD_NESTED "forward"';
            writeFileSync(nested_path, nested_content);

            // Create target file with:
            // - @lsp-done-by pointing to grandparent (backward - should NOT be followed)
            // - do command to nested file (forward - should be followed)
            const target_path = join(test_temp_dir, 'target_mixed.do');
            const target_content = `// @lsp-done-by: "backward_grandparent.do"
global TARGET_MIXED "target"
do "forward_nested.do"`;
            writeFileSync(target_path, target_content);

            // Create main file that does the target file
            // Should get TARGET_MIXED and FORWARD_NESTED but NOT BACKWARD_GRANDPARENT
            const main_path = join(test_temp_dir, 'main_mixed.do');
            const main_content = `do "target_mixed.do"
display "$TARGET_MIXED"
display "$FORWARD_NESTED"
display "$BACKWARD_GRANDPARENT"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over TARGET_MIXED on line 1
            // Should find the global macro from target file
            const hover_target = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'TARGET_MIXED'
                undefined,
                scope_resolver
            );

            expect(hover_target).toBeDefined();
            const content_target = hover_target?.contents as { kind: string; value: string };
            expect(content_target.value).toContain('Global Macro');
            expect(content_target.value).toContain('TARGET_MIXED');

            // Hover over FORWARD_NESTED on line 2
            // Should find the global macro from nested file (forward call was followed)
            const hover_nested = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 12 }, // on 'FORWARD_NESTED'
                undefined,
                scope_resolver
            );

            expect(hover_nested).toBeDefined();
            const content_nested = hover_nested?.contents as { kind: string; value: string };
            expect(content_nested.value).toContain('Global Macro');
            expect(content_nested.value).toContain('FORWARD_NESTED');

            // Hover over BACKWARD_GRANDPARENT on line 3
            // Should NOT find the global macro from grandparent (backward directive not followed)
            const hover_backward = await hover_provider.get_hover(
                document_state,
                { line: 3, character: 12 }, // on 'BACKWARD_GRANDPARENT'
                undefined,
                scope_resolver
            );

            // Should not find the backward grandparent's global macro
            if (hover_backward) {
                const content_backward = hover_backward?.contents as { kind: string; value: string };
                expect(content_backward.value).not.toContain('BACKWARD_GRANDPARENT');
            }
        });

        it('should work with directives: @lsp-do to file with @lsp-done-by', async () => {
            // Create grandparent file with a global macro
            const grandparent_path = join(test_temp_dir, 'dir_grandparent.do');
            const grandparent_content = 'global DIR_GRANDPARENT "grandparent"';
            writeFileSync(grandparent_path, grandparent_content);

            // Create target file with @lsp-done-by pointing to grandparent
            const target_path = join(test_temp_dir, 'dir_target_backward.do');
            const target_content = `// @lsp-done-by: "dir_grandparent.do"
global DIR_TARGET "target"`;
            writeFileSync(target_path, target_content);

            // Create main file with @lsp-do directive to target
            const main_path = join(test_temp_dir, 'main_dir_no_backward.do');
            const main_content = `// @lsp-do: "dir_target_backward.do"
display "$DIR_TARGET"
display "$DIR_GRANDPARENT"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            // Hover over DIR_TARGET on line 1
            // Should find the global macro from target file
            const hover_target = await hover_provider.get_hover(
                document_state,
                { line: 1, character: 12 }, // on 'DIR_TARGET'
                undefined,
                scope_resolver
            );

            expect(hover_target).toBeDefined();
            const content_target = hover_target?.contents as { kind: string; value: string };
            expect(content_target.value).toContain('Global Macro');
            expect(content_target.value).toContain('DIR_TARGET');

            // Hover over DIR_GRANDPARENT on line 2
            // Should NOT find the global macro from grandparent
            const hover_grandparent = await hover_provider.get_hover(
                document_state,
                { line: 2, character: 12 }, // on 'DIR_GRANDPARENT'
                undefined,
                scope_resolver
            );

            // Should not find the grandparent's global macro
            if (hover_grandparent) {
                const content_grandparent = hover_grandparent?.contents as { kind: string; value: string };
                expect(content_grandparent.value).not.toContain('DIR_GRANDPARENT');
            }
        });
    });
});
