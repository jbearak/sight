import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataDiagnosticCode } from '../../src/types';

describe('Backward directive locals inheritance', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(process.cwd(), 'test-backward-locals-'));
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({ sendDiagnostics: () => {} } as any);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_file(relative_path: string, content: string): string {
        const full_path = path.join(temp_dir, relative_path);
        fs.mkdirSync(path.dirname(full_path), { recursive: true });
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    const config = {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'information',
                styleWarnings: 'hint',
            },
            undefinedVariableEnabled: true,
        },
        adoPaths: [],
        cross_file: {
            assume_call_site: 'end' as const,
            max_forward_depth: 10,
        },
    };

    it('does not inherit locals across done-by boundary even when ancestor uses included-by', async () => {
        // grandparent -> parent (included-by) -> child (done-by)
        write_file('grandparent.do', 'local gp_local 1');
        write_file('parent.do', '// @lsp-included-by: "grandparent.do"\n');
        const child_path = write_file(
            'child.do',
            '// @lsp-done-by: "parent.do"\n' +
            'display `gp_local\'\n'
        );

        const child_uri = URI.file(child_path).toString();
        const child_content = fs.readFileSync(child_path, 'utf8');
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const diagnostics = await diagnostics_provider.get_diagnostics(
            document_state,
            config,
            undefined,
            scope_resolver
        );

        // Should have either UNDEFINED_MACRO or OUT_OF_SCOPE_SYMBOL diagnostic
        // OUT_OF_SCOPE_SYMBOL is emitted when the local is found in ancestor but excluded due to done-by
        const gp_local_diag = diagnostics.filter(
            d => (d.code === StataDiagnosticCode.UNDEFINED_MACRO || d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL) 
                 && d.range.start.line === 1
        );
        expect(gp_local_diag.length).toBeGreaterThan(0);
        
        // If it's OUT_OF_SCOPE_SYMBOL, verify the message explains inheritance
        const out_of_scope = gp_local_diag.find(d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL);
        if (out_of_scope) {
            expect(out_of_scope.message).toContain('local macros are not inherited via do/run');
        }
    });

    it('inherits locals across included-by boundary', async () => {
        write_file('grandparent.do', 'local gp_local 1');
        const child_path = write_file(
            'child.do',
            '// @lsp-included-by: "grandparent.do"\n' +
            'display `gp_local\'\n'
        );

        const child_uri = URI.file(child_path).toString();
        const child_content = fs.readFileSync(child_path, 'utf8');
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const diagnostics = await diagnostics_provider.get_diagnostics(
            document_state,
            config,
            undefined,
            scope_resolver
        );

        const undefined_gp = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.range.start.line === 1
        );
        expect(undefined_gp.length).toBe(0);
    });
});
