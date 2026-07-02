/**
 * Integration tests for issue #271: locals defined inside `program ... end`
 * bodies must not be inherited across `include` boundaries, in either
 * direction (backward `@lsp-included-by`/`@lsp-done-by` directives and
 * forward `include`/`do` commands), while genuine do-file-level locals
 * keep flowing through `include`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import {
    DiagnosticsConnection,
    DiagnosticsProvider,
} from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Program-body locals across include boundaries (issue #271)', () => {
    const test_temp_dir = join(process.cwd(), 'temp_program_local_include_test');
    let diagnostics_provider: DiagnosticsProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let mock_connection: DiagnosticsConnection;
    let config: StataLSPConfig;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        mock_connection = {
            sendDiagnostics: () => {},
        };

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

    async function get_diagnostics_for(main_path: string, main_content: string) {
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;
        return diagnostics_provider.get_diagnostics(
            document_state,
            config,
            undefined,
            scope_resolver
        );
    }

    describe('backward @lsp-included-by', () => {
        it('does not suppress a parent program-body local (issue #271 repro)', async () => {
            const parent_path = join(test_temp_dir, 'parent1.do');
            const parent_content = `program define p
    local hidden 1
end
include child1.do`;
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child1.do');
            const child_content = `// @lsp-included-by: "parent1.do"
display \`hidden'`;
            writeFileSync(child_path, child_content);

            const diagnostics = await get_diagnostics_for(child_path, child_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });

        it('still suppresses a parent dofile-level local', async () => {
            const parent_path = join(test_temp_dir, 'parent2.do');
            const parent_content = `local visible 1
include child2.do`;
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child2.do');
            const child_content = `// @lsp-included-by: "parent2.do"
display \`visible'`;
            writeFileSync(child_path, child_content);

            const diagnostics = await get_diagnostics_for(child_path, child_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(false);
        });
    });

    describe('backward @lsp-done-by excluded-locals messaging', () => {
        it('program-body parent local gets the plain undefined warning, not use-include advice', async () => {
            const parent_path = join(test_temp_dir, 'parent3.do');
            const parent_content = `program define q
    local hidden 1
end
do child3.do`;
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child3.do');
            const child_content = `// @lsp-done-by: "parent3.do"
display \`hidden'`;
            writeFileSync(child_path, child_content);

            const diagnostics = await get_diagnostics_for(child_path, child_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            // "use include instead" would be false advice: include does not
            // surface program-body locals either.
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
            )).toBe(false);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });

        it('dofile-level parent local still gets the use-include out-of-scope message', async () => {
            const parent_path = join(test_temp_dir, 'parent4.do');
            const parent_content = `local veggie 1
do child4.do`;
            writeFileSync(parent_path, parent_content);

            const child_path = join(test_temp_dir, 'child4.do');
            const child_content = `// @lsp-done-by: "parent4.do"
display \`veggie'`;
            writeFileSync(child_path, child_content);

            const diagnostics = await get_diagnostics_for(child_path, child_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            const informative = line1_diags.find(
                d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                    && d.message.includes('veggie')
            );
            expect(informative).toBeDefined();
            expect(informative!.message).toContain('use include instead');
        });
    });

    describe('forward include command', () => {
        it('does not suppress a callee program-body local (mirror of the do-path test)', async () => {
            const helper_path = join(test_temp_dir, 'helper5.do');
            const helper_content = `program define myprog
    local veggie potato
    di "\`veggie'"
end`;
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main5.do');
            const main_content = `include helper5.do
di \`veggie'`;
            writeFileSync(main_path, main_content);

            const diagnostics = await get_diagnostics_for(main_path, main_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
            )).toBe(false);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });

        it('still suppresses a callee dofile-level local', async () => {
            const helper_path = join(test_temp_dir, 'helper6.do');
            writeFileSync(helper_path, 'local veggie potato');

            const main_path = join(test_temp_dir, 'main6.do');
            const main_content = `include helper6.do
di \`veggie'`;
            writeFileSync(main_path, main_content);

            const diagnostics = await get_diagnostics_for(main_path, main_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(false);
        });

        it('include after do adds only dofile-level locals (add_locals_only path)', async () => {
            const helper_path = join(test_temp_dir, 'helper7.do');
            const helper_content = `local filelevel 1
program define hp
    local progonly 2
end`;
            writeFileSync(helper_path, helper_content);

            const main_path = join(test_temp_dir, 'main7.do');
            const main_content = `do helper7.do
include helper7.do
di \`filelevel'
di \`progonly'`;
            writeFileSync(main_path, main_content);

            const diagnostics = await get_diagnostics_for(main_path, main_content);

            const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
            expect(line2_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(false);

            const line3_diags = diagnostics.filter(d => d.range.start.line === 3);
            expect(line3_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });

        it('filters program-body locals at every hop of a multi-level include chain', async () => {
            const leaf_path = join(test_temp_dir, 'leaf8.do');
            const leaf_content = `local deep_ok 1
program define leafp
    local deep_hidden 2
end`;
            writeFileSync(leaf_path, leaf_content);

            const mid_path = join(test_temp_dir, 'mid8.do');
            writeFileSync(mid_path, 'include leaf8.do');

            const main_path = join(test_temp_dir, 'main8.do');
            const main_content = `include mid8.do
di \`deep_ok'
di \`deep_hidden'`;
            writeFileSync(main_path, main_content);

            const diagnostics = await get_diagnostics_for(main_path, main_content);

            const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
            expect(line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(false);

            const line2_diags = diagnostics.filter(d => d.range.start.line === 2);
            expect(line2_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )).toBe(true);
        });
    });
});
