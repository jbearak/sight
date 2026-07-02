import { create_real_document_state } from '../test-context-helper';
import { describe, it, expect, mock } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import {
    StataLSPConfig,
    StataDiagnosticCode,
    ResolvedScope,
} from '../../src/types';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ScopeResolver } from '../../src/scope-resolver';

function create_mock_connection() {
    return {
        sendDiagnostics: mock(() => {}),
    };
}

const DEFAULT_CONFIG: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces',
    },
    adoPaths: [],
    indexWorkspace: true,
};

function make_stub_scope_resolver(resolved_scope: ResolvedScope): ScopeResolver {
    const the_stub = new ScopeResolver();
    (the_stub as unknown as { resolve: () => Promise<ResolvedScope> }).resolve =
        async () => resolved_scope;
    return the_stub;
}

// Issue #145: an undefined local that exists only inside another program
// body gets a specific scope-isolation message, and the 2026-04-21
// revert scenario (misleading rewrites) stays impossible.
describe('scope-isolation diagnostics (#145)', () => {
    function make_provider(): DiagnosticsProvider {
        return new DiagnosticsProvider(
            create_mock_connection() as unknown as ConstructorParameters<
                typeof DiagnosticsProvider
            >[0]
        );
    }

    it('rewrites a program-only local reference after the program', async () => {
        const document = create_real_document_state(`
program define myprog
    local inside_x 1
end
display \`inside_x'
`);
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(document, DEFAULT_CONFIG);
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('inside_x'));
        expect(the_matches).toHaveLength(1);
        expect(the_matches[0].code).toBe(StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL);
        expect(the_matches[0].message).toBe(
            "`inside_x' is defined only inside program myprog"
        );
    });

    it('rewrites a reference before the program (not as same-file forward)', async () => {
        const document = create_real_document_state(`
display \`inside_x'
program define myprog
    local inside_x 1
end
`);
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(document, DEFAULT_CONFIG);
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('inside_x'));
        expect(the_matches).toHaveLength(1);
        expect(the_matches[0].message).toBe(
            "`inside_x' is defined only inside program myprog"
        );
        expect(the_matches[0].message).not.toContain('before it is defined');
    });

    it('names every program that defines the isolated local', async () => {
        const document = create_real_document_state(`
program define prog_a
    local shared 1
end
program define prog_b
    local shared 2
end
display \`shared'
`);
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(document, DEFAULT_CONFIG);
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('shared'));
        expect(the_matches).toHaveLength(1);
        expect(the_matches[0].message).toContain('prog_a');
        expect(the_matches[0].message).toContain('prog_b');
    });

    it('same-scope forward references keep the same-file-forward rewrite', async () => {
        const document = create_real_document_state(`
display \`later'
local later 1
`);
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(document, DEFAULT_CONFIG);
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('later'));
        expect(the_matches).toHaveLength(1);
        expect(the_matches[0].message).toContain('before it is defined');
    });

    it('genuine cross-file resolution still suppresses the diagnostic', async () => {
        const document = create_real_document_state(`
program define myprog
    local inside_x 1
end
display \`inside_x'
`);
        // A parent scope (e.g. via @lsp-included-by) genuinely defines
        // the local in another file: cross-file suppression must win
        // over the scope-isolation rewrite.
        const parent_symbols = create_empty_symbol_table();
        parent_symbols.localMacros.set('inside_x', {
            name: 'inside_x',
            scope: 'local',
            location: {
                uri: 'file:///parent.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///parent.do',
            containingScope: 'dofile',
        });
        const resolved_scope: ResolvedScope = {
            chain: [],
            symbols: parent_symbols,
            out_of_scope_symbols: [],
            diagnostics: [],
            has_directives: true,
            has_auto_parents: false,
        };
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(
            document,
            DEFAULT_CONFIG,
            undefined,
            make_stub_scope_resolver(resolved_scope)
        );
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('inside_x'));
        expect(the_matches).toHaveLength(0);
    });

    it('severity follows the undefinedMacro setting', async () => {
        const document = create_real_document_state(`
program define myprog
    local inside_x 1
end
display \`inside_x'
`);
        const error_config: StataLSPConfig = {
            ...DEFAULT_CONFIG,
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'error',
                    undefinedVariable: 'information',
                    styleWarnings: 'hint',
                },
            },
        };
        const provider = make_provider();
        const the_diagnostics = await provider.get_diagnostics(document, error_config);
        const the_matches = the_diagnostics.filter(d =>
            d.message.includes('inside_x'));
        expect(the_matches).toHaveLength(1);
        expect(the_matches[0].severity).toBe(DiagnosticSeverity.Error);
    });
});
