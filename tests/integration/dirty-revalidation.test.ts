import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode } from '../../src/types';

describe('Dirty File Revalidation Integration Tests', () => {
    let scope_resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dirty-reval-test-'));

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

        scope_resolver = new ScopeResolver(undefined, content_provider);
        const forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    test('should detect undefined macro with cross-file resolution using DiagnosticsProvider', async () => {
        // Create main.do that defines a global macro
        write_file('main.do', 'global fruit apple\ndo "child.do"\n');

        // Create child.do that uses the global macro with directive
        const child_content = `// @lsp-done-by: "main.do"
local result = "$fruit"
local other_result = "$other"
`;
        const child_path = write_file('child.do', child_content);

        // Create document state for child.do
        const child_document = create_document_state(child_content);
        child_document.uri = URI.file(child_path).toString();

        // Get diagnostics with scope resolver
        const diagnostics_provider = new DiagnosticsProvider();
        const diagnostics = await diagnostics_provider.get_diagnostics(
            child_document,
            DEFAULT_SETTINGS,
            undefined,
            scope_resolver
        );

        // Should NOT have undefined macro warning for 'fruit' (defined in main.do)
        const undefined_fruit = diagnostics.filter(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'fruit'
        );
        expect(undefined_fruit).toHaveLength(0);

        // Should have undefined macro warning for 'other' (not defined anywhere)
        const undefined_other = diagnostics.filter(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'other'
        );
        expect(undefined_other).toHaveLength(1);
    });
});
