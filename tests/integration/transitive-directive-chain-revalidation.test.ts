/**
 * Integration tests for Transitive Backward Directive Chain Revalidation
 *
 * Tests verify that when a file's interface changes (e.g., a global macro is removed),
 * all files that transitively depend on it via backward directives receive updated diagnostics.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { URI } from 'vscode-uri';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode } from '../../src/types';

describe('Transitive Directive Chain Revalidation Integration Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let diagnostics_provider: DiagnosticsProvider;
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transitive-chain-test-'));

        const content_provider = {
            read_file: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return fs.promises.readFile(fs_path, 'utf8');
            },
            exists: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                try {
                    await fs.promises.access(fs_path);
                    return true;
                } catch {
                    return false;
                }
            }
        };

        const mock_connection = { sendDiagnostics: () => {} } as any;
        scope_resolver = new ScopeResolver(undefined, content_provider);
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        diagnostics_provider = new DiagnosticsProvider(mock_connection);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const file_uri = (file_path: string): string => URI.file(file_path).toString();

    const get_diagnostics_for_file = async (
        file_path: string,
        content: string
    ) => {
        const document = create_document_state(content);
        document.uri = file_uri(file_path);

        return diagnostics_provider.get_diagnostics(
            document,
            DEFAULT_SETTINGS,
            undefined,
            scope_resolver
        );
    };

    describe('Three-file directive chain revalidation', () => {
        test('removing global macro from root file produces undefined warnings in all dependents', async () => {
            // Create a three-file directive chain: a.do → b.do → c.do
            // a.do defines a global macro that b.do and c.do use
            const a_content_v1 = `global shared_macro "value"
do "b.do"`;
            const a_path = write_file('a.do', a_content_v1);
            const a_uri = file_uri(a_path);

            const b_content = `// @lsp-done-by "a.do"
local b_result = "$shared_macro"
do "c.do"`;
            const b_path = write_file('b.do', b_content);
            const b_uri = file_uri(b_path);

            const c_content = `// @lsp-done-by "b.do"
local c_result = "$shared_macro"`;
            const c_path = write_file('c.do', c_content);
            const c_uri = file_uri(c_path);

            // Initial resolution - all files should resolve without undefined macro warnings
            // for shared_macro since it's defined in a.do
            const b_diagnostics_v1 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v1 = await get_diagnostics_for_file(c_path, c_content);

            // Verify no undefined macro warnings for shared_macro initially
            const b_undefined_shared_v1 = b_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );
            const c_undefined_shared_v1 = c_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );

            expect(b_undefined_shared_v1).toHaveLength(0);
            expect(c_undefined_shared_v1).toHaveLength(0);

            // Now modify a.do to remove the global macro
            const a_content_v2 = `global other_macro "different"
do "b.do"`;
            fs.writeFileSync(a_path, a_content_v2);

            // Invalidate the file cache for a.do (simulating what server-factory does)
            scope_resolver.invalidate_file_cache(a_uri);

            // Get transitive dependents - should include both b.do and c.do
            const transitive_dependents = scope_resolver.get_transitive_backward_directive_children(a_uri);
            expect(transitive_dependents.has(b_uri)).toBe(true);
            expect(transitive_dependents.has(c_uri)).toBe(true);

            // Invalidate scope caches for all transitive dependents
            for (const dependent_uri of transitive_dependents) {
                scope_resolver.invalidate_scope_cache(dependent_uri);
            }

            // Re-resolve b.do and c.do - they should now have undefined macro warnings
            const b_diagnostics_v2 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v2 = await get_diagnostics_for_file(c_path, c_content);

            // Verify undefined macro warnings for shared_macro after removal
            const b_undefined_shared_v2 = b_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );
            const c_undefined_shared_v2 = c_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );

            expect(b_undefined_shared_v2.length).toBeGreaterThan(0);
            expect(c_undefined_shared_v2.length).toBeGreaterThan(0);
        });

        test('adding global macro to root file suppresses undefined warnings in all dependents', async () => {
            // Start with a.do NOT defining shared_macro
            const a_content_v1 = `global other_macro "value"
do "b.do"`;
            const a_path = write_file('a.do', a_content_v1);
            const a_uri = file_uri(a_path);

            const b_content = `// @lsp-done-by "a.do"
local b_result = "$shared_macro"
do "c.do"`;
            const b_path = write_file('b.do', b_content);
            const b_uri = file_uri(b_path);

            const c_content = `// @lsp-done-by "b.do"
local c_result = "$shared_macro"`;
            const c_path = write_file('c.do', c_content);
            const c_uri = file_uri(c_path);

            // Initial resolution - should have undefined macro warnings
            const b_diagnostics_v1 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v1 = await get_diagnostics_for_file(c_path, c_content);

            const b_undefined_shared_v1 = b_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );
            const c_undefined_shared_v1 = c_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );

            expect(b_undefined_shared_v1.length).toBeGreaterThan(0);
            expect(c_undefined_shared_v1.length).toBeGreaterThan(0);

            // Now modify a.do to add the global macro
            const a_content_v2 = `global shared_macro "value"
do "b.do"`;
            fs.writeFileSync(a_path, a_content_v2);

            // Invalidate caches
            scope_resolver.invalidate_file_cache(a_uri);
            const transitive_dependents = scope_resolver.get_transitive_backward_directive_children(a_uri);
            for (const dependent_uri of transitive_dependents) {
                scope_resolver.invalidate_scope_cache(dependent_uri);
            }

            // Re-resolve - should no longer have undefined macro warnings
            const b_diagnostics_v2 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v2 = await get_diagnostics_for_file(c_path, c_content);

            const b_undefined_shared_v2 = b_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );
            const c_undefined_shared_v2 = c_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('shared_macro')
            );

            expect(b_undefined_shared_v2).toHaveLength(0);
            expect(c_undefined_shared_v2).toHaveLength(0);
        });

        test('modifying middle file in chain propagates to leaf files', async () => {
            // Create chain: a.do → b.do → c.do
            // b.do defines a macro that c.do uses
            const a_content = `global root_macro "root"
do "b.do"`;
            const a_path = write_file('a.do', a_content);

            const b_content_v1 = `// @lsp-done-by "a.do"
global middle_macro "middle"
do "c.do"`;
            const b_path = write_file('b.do', b_content_v1);
            const b_uri = file_uri(b_path);

            const c_content = `// @lsp-done-by "b.do"
local c_result = "$middle_macro"`;
            const c_path = write_file('c.do', c_content);
            const c_uri = file_uri(c_path);

            // Initial resolution - c.do should not have undefined warning for middle_macro
            const c_diagnostics_v1 = await get_diagnostics_for_file(c_path, c_content);
            const c_undefined_middle_v1 = c_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('middle_macro')
            );
            expect(c_undefined_middle_v1).toHaveLength(0);

            // Modify b.do to remove middle_macro
            const b_content_v2 = `// @lsp-done-by "a.do"
global different_macro "different"
do "c.do"`;
            fs.writeFileSync(b_path, b_content_v2);

            // Invalidate caches
            scope_resolver.invalidate_file_cache(b_uri);
            const transitive_dependents = scope_resolver.get_transitive_backward_directive_children(b_uri);
            expect(transitive_dependents.has(c_uri)).toBe(true);

            for (const dependent_uri of transitive_dependents) {
                scope_resolver.invalidate_scope_cache(dependent_uri);
            }

            // Re-resolve c.do - should now have undefined warning for middle_macro
            const c_diagnostics_v2 = await get_diagnostics_for_file(c_path, c_content);
            const c_undefined_middle_v2 = c_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('middle_macro')
            );
            expect(c_undefined_middle_v2.length).toBeGreaterThan(0);
        });
    });

    describe('Diamond dependency revalidation', () => {
        test('modifying root in diamond propagates to all dependents', async () => {
            // Create diamond: a.do → b.do, a.do → c.do, b.do → d.do, c.do → d.do
            const a_content_v1 = `global diamond_macro "value"
do "b.do"
do "c.do"`;
            const a_path = write_file('a.do', a_content_v1);
            const a_uri = file_uri(a_path);

            const b_content = `// @lsp-done-by "a.do"
local b_result = "$diamond_macro"
do "d.do"`;
            const b_path = write_file('b.do', b_content);
            const b_uri = file_uri(b_path);

            const c_content = `// @lsp-done-by "a.do"
local c_result = "$diamond_macro"
do "d.do"`;
            const c_path = write_file('c.do', c_content);
            const c_uri = file_uri(c_path);

            const d_content = `// @lsp-done-by "b.do"
// @lsp-done-by "c.do"
local d_result = "$diamond_macro"`;
            const d_path = write_file('d.do', d_content);
            const d_uri = file_uri(d_path);

            // Initial resolution - no undefined warnings
            const b_diagnostics_v1 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v1 = await get_diagnostics_for_file(c_path, c_content);
            const d_diagnostics_v1 = await get_diagnostics_for_file(d_path, d_content);

            expect(b_diagnostics_v1.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);
            expect(c_diagnostics_v1.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);
            expect(d_diagnostics_v1.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);

            // Modify a.do to remove diamond_macro
            const a_content_v2 = `global other_macro "other"
do "b.do"
do "c.do"`;
            fs.writeFileSync(a_path, a_content_v2);

            // Invalidate caches
            scope_resolver.invalidate_file_cache(a_uri);
            const transitive_dependents = scope_resolver.get_transitive_backward_directive_children(a_uri);

            // All of b, c, d should be transitive dependents
            expect(transitive_dependents.has(b_uri)).toBe(true);
            expect(transitive_dependents.has(c_uri)).toBe(true);
            expect(transitive_dependents.has(d_uri)).toBe(true);

            for (const dependent_uri of transitive_dependents) {
                scope_resolver.invalidate_scope_cache(dependent_uri);
            }

            // Re-resolve - all should have undefined warnings
            const b_diagnostics_v2 = await get_diagnostics_for_file(b_path, b_content);
            const c_diagnostics_v2 = await get_diagnostics_for_file(c_path, c_content);
            const d_diagnostics_v2 = await get_diagnostics_for_file(d_path, d_content);

            expect(b_diagnostics_v2.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
            expect(c_diagnostics_v2.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
            expect(d_diagnostics_v2.filter(d => d.message.includes('diamond_macro') && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
        });
    });

    describe('Symbol inheritance through chain', () => {
        test('symbols from root are visible in all chain files', async () => {
            // Create chain: a.do → b.do → c.do
            const a_content = `global root_global "root"
scalar root_scalar = 1
do "b.do"`;
            const a_path = write_file('a.do', a_content);

            const b_content = `// @lsp-done-by "a.do"
local b_check = "$root_global"
display root_scalar
do "c.do"`;
            const b_path = write_file('b.do', b_content);

            const c_content = `// @lsp-done-by "b.do"
local c_check = "$root_global"
display root_scalar`;
            const c_path = write_file('c.do', c_content);

            // Resolve and check that symbols from a.do are visible in c.do
            const c_diagnostics = await get_diagnostics_for_file(c_path, c_content);

            // Should not have undefined warnings for root_global
            const undefined_root_global = c_diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('root_global')
            );
            expect(undefined_root_global).toHaveLength(0);
        });
    });
});
