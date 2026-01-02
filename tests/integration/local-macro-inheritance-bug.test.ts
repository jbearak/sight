import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { StataLSPConfig } from '../../src/types';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';
import { Connection } from 'vscode-languageserver';

describe('Local Macro Inheritance Bug', () => {
    const test_temp_dir = join(process.cwd(), 'temp_local_macro_inheritance_test');
    let diagnostic_provider: DiagnosticsProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        // Create a mock connection for DiagnosticsProvider
        const mock_connection = {
            sendDiagnostics: () => {}
        } as Connection;

        diagnostic_provider = new DiagnosticsProvider(mock_connection);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('should show correct diagnostic message for local macros not inherited via do/run', async () => {
        // Create the file hierarchy where child tries to inherit local macro via @lsp-done-by

        // parent.do - defines local macro
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = 'local mylocal "value"';
        writeFileSync(parent_path, parent_content);

        // child.do - has @lsp-done-by directive and tries to use local macro
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = '// @lsp-done-by "parent.do"\ndisplay "`mylocal\'"';
        writeFileSync(child_path, child_content);

        // Process child.do
        const child_uri = URI.file(child_path);
        await document_store.open(child_uri.toString(), child_content, 1);

        const document = document_store.get(child_uri.toString());
        const config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning'
                }
            },
            cross_file: {
                diagnostics: {
                    undefined_symbol: 'warning',
                    missing_file: 'warning',
                    out_of_scope: 'warning'
                }
            }
        };

        const diagnostics = await diagnostic_provider.get_diagnostics(
            document!,
            config,
            undefined,
            scope_resolver
        );

        // Should have diagnostic for undefined local macro
        // Filter out call site identification diagnostics (information level)
        const macro_diagnostics = diagnostics.filter(d =>
            d.message.includes('local macros') && !d.message.includes('Could not identify call site')
        );
        expect(macro_diagnostics.length).toBe(1);
        expect(macro_diagnostics[0].message).toContain('local macros are not inherited via do/run');
        expect(macro_diagnostics[0].message).not.toContain('after the call site');
    });
});