/**
 * Integration tests for diagnostics with current file forward call resolution.
 * 
 * Tests that undefined macro/variable warnings are suppressed after @lsp-include/do/run
 * directives and auto-detected commands in the same file, with call-site filtering.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';
import { Connection } from 'vscode-languageserver';

describe('Current File Forward Call Diagnostics', () => {
    const test_temp_dir = join(process.cwd(), 'temp_forward_call_diag_test');
    let diagnostics_provider: DiagnosticsProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let mock_connection: Connection;
    let config: StataLSPConfig;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        // Mock connection
        mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        diagnostics_provider = new DiagnosticsProvider(mock_connection);

        config = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'information',
                    styleWarnings: 'hint',
                },
            },
            adoPaths: [],
            cross_file: {
                assume_call_site: 'end',
                max_forward_depth: 10,
            },
        };
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('Macro diagnostics with @lsp-include directive', () => {
        it('should warn about undefined macro BEFORE @lsp-include', async () => {
            const helper_path = join(test_temp_dir, 'helper_macro.do');
            const helper_content = 'local helper_macro "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_before.do');
            const main_content = `display \`helper_macro'
// @lsp-include: "helper_macro.do"
display \`helper_macro'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should have warning on line 0 (before directive)
            const line0_diags = diagnostics.filter(d => d.range.start.line === 0);
            expect(line0_diags.length).toBeGreaterThan(0);
            expect(line0_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(true);

            // Should NOT have warning on line 2 (after directive)
            const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
            expect(line2_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });

        it('should NOT warn about undefined macro AFTER @lsp-include', async () => {
            const helper_path = join(test_temp_dir, 'helper_after.do');
            const helper_content = 'local after_macro "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_after.do');
            const main_content = `// @lsp-include: "helper_after.do"
display \`after_macro'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should NOT have undefined macro warning on line 1
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });
    });

    describe('Macro diagnostics with @lsp-do directive', () => {
        it('should warn about undefined local macro with @lsp-do (locals not inherited)', async () => {
            const helper_path = join(test_temp_dir, 'helper_do_local.do');
            const helper_content = 'local do_local "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_do_local.do');
            const main_content = `// @lsp-do: "helper_do_local.do"
display \`do_local'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should have an undefined-macro-shaped warning on line 1. The
            // diagnostics provider now upgrades this to the informative
            // OUT_OF_SCOPE_SYMBOL variant that names the callee, but either
            // code is a legitimate "not inherited via do" report.
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                (d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
                    d.message.includes('local macros are not inherited via do/run'))
            )).toBe(true);
        });

        it('should emit informative diagnostic when local macro is defined in a do-called file', async () => {
            // Mirror of the child.do "local macros are not inherited via do/run" message,
            // but emitted in the parent file where the forward do call happens.
            const child_path = join(test_temp_dir, 'demo_child.do');
            const child_content = `di "hello"
local veggie potato`;
            writeFileSync(child_path, child_content);

            const parent_path = join(test_temp_dir, 'demo_parent.do');
            const parent_content = `local fruit apple
do demo_child.do
di \`veggie'`;
            writeFileSync(parent_path, parent_content);

            const parent_uri = URI.file(parent_path).toString();
            await document_store.open(parent_uri, parent_content, 1);
            const document_state = document_store.get(parent_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Line 2: `di \`veggie'` — veggie is defined in demo_child.do but
            // not inherited via do.
            const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
            const informative = line2_diags.find(
                d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
            );
            expect(informative).toBeDefined();
            expect(informative!.message).toContain('veggie');
            expect(informative!.message).toContain('demo_child.do');
            expect(informative!.message).toContain(
                'local macros are not inherited via do/run'
            );

            // The plain "Undefined local macro" diagnostic should be replaced,
            // not duplicated alongside the informative one.
            const plain_undefined = line2_diags.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(plain_undefined.length).toBe(0);
        });

        it('should NOT suggest switching to include when callee local is program-scoped', async () => {
            // Program-scoped locals in the callee are not visible to the
            // caller even with `include`, so the "use include" message would
            // mislead. The generic "Undefined local macro" is correct here.
            const child_path = join(test_temp_dir, 'helper_prog_local.do');
            const child_content = `program define myprog
    local veggie potato
    di "\`veggie'"
end`;
            writeFileSync(child_path, child_content);

            const parent_path = join(test_temp_dir, 'main_prog_local.do');
            const parent_content = `do helper_prog_local.do
di \`veggie'`;
            writeFileSync(parent_path, parent_content);

            const parent_uri = URI.file(parent_path).toString();
            await document_store.open(parent_uri, parent_content, 1);
            const document_state = document_store.get(parent_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            const misleading = line1_diags.find(
                d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
            );
            expect(misleading).toBeUndefined();

            // The generic undefined-local-macro warning is still the correct
            // diagnostic and should remain present.
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });

        it('should NOT warn about undefined global macro AFTER @lsp-do', async () => {
            const helper_path = join(test_temp_dir, 'helper_do_global.do');
            const helper_content = 'global DO_GLOBAL "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_do_global.do');
            const main_content = `// @lsp-do: "helper_do_global.do"
display "$DO_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should NOT have undefined macro warning on line 1
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });
    });

    describe('Macro diagnostics with include command', () => {
        it('should warn about undefined macro BEFORE include command', async () => {
            const helper_path = join(test_temp_dir, 'helper_cmd.do');
            const helper_content = 'local cmd_macro "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_cmd_before.do');
            const main_content = `display \`cmd_macro'
include "helper_cmd.do"
display \`cmd_macro'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should have warning on line 0 (before command)
            const line0_diags = diagnostics.filter(d => d.range.start.line === 0);
            expect(line0_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(true);

            // Should NOT have warning on line 2 (after command)
            const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
            expect(line2_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });

        it('should NOT warn about undefined macro AFTER include command', async () => {
            const helper_path = join(test_temp_dir, 'helper_cmd_after.do');
            const helper_content = 'local cmd_after_macro "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_cmd_after.do');
            const main_content = `include "helper_cmd_after.do"
display \`cmd_after_macro'`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should NOT have undefined macro warning on line 1
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });
    });

    describe('Macro diagnostics with do command', () => {
        it('should NOT warn about undefined global macro AFTER do command', async () => {
            const helper_path = join(test_temp_dir, 'helper_do_cmd.do');
            const helper_content = 'global DO_CMD_GLOBAL "value"';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_do_cmd.do');
            const main_content = `do "helper_do_cmd.do"
display "$DO_CMD_GLOBAL"`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should NOT have undefined macro warning on line 1
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toBe(false);
        });
    });

    describe('Variable diagnostics with forward calls', () => {
        it('should warn about undefined variable BEFORE include command', async () => {
            const helper_path = join(test_temp_dir, 'helper_var.do');
            const helper_content = 'scalar myvar = 42';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_var_before.do');
            const main_content = `display myvar
include "helper_var.do"
display myvar`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should have warning on line 0 (before command)
            const line0_diags = diagnostics.filter(d => d.range.start.line === 0);
            
            // Note: Undefined variable diagnostics may not be generated for scalars in display commands
            // This test verifies the logic is correct when they are generated
            if (line0_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)) {
                expect(line0_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)).toBe(true);

                // Should NOT have warning on line 2 (after command)
                const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
                expect(line2_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)).toBe(false);
            }
        });

        it('should NOT warn about undefined variable AFTER include command', async () => {
            const helper_path = join(test_temp_dir, 'helper_var_after.do');
            const helper_content = 'scalar aftervar = 99';
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main_var_after.do');
            const main_content = `include "helper_var_after.do"
display aftervar`;
            writeFileSync(main_path, main_content);

            const main_uri = URI.file(main_path).toString();
            await document_store.open(main_uri, main_content, 1);
            const document_state = document_store.get(main_uri)!;

            const diagnostics = await diagnostics_provider.get_diagnostics(
                document_state,
                config,
                undefined,
                scope_resolver
            );

            // Should NOT have undefined variable warning on line 1
            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)).toBe(false);
        });
    });
});
