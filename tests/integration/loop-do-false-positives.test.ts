import { describe, it, expect, beforeEach } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { LexerErrorCode, StataDiagnosticCode } from '../../src/types';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';

const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
        undefinedVariableEnabled: false,
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces' as const,
        lineWidth: 80,
        preferredCommentStyle: '//' as const,
        normalizeCommentStyle: false,
        commentLineWidth: 72,
    },
    indexing: { maxFileSizeBytes: 500000 },
    adoPaths: [],
    indexWorkspace: true,
    cross_file: {
        index_workspace: true,
        max_indexed_files: 1000,
        assume_call_site: 'end' as const,
        max_forward_depth: 10,
        diagnostics: {
            undefined_symbol: 'warning' as const,
            out_of_scope: 'info' as const,
            missing_file: 'warning' as const,
        },
    },
};

describe('loop.do Diagnostic False Positives', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;
    let loop_content: string;

    const fixture_path = join(process.cwd(), 'tests/fixtures/diagnostic-false-positives/loop.do');

    beforeEach(() => {
        initialize_builtin_commands();
        lexer = new StataLexer();
        parser = new StataParser();
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({ sendDiagnostics: () => {} } as any);
        if (existsSync(fixture_path)) {
            loop_content = readFileSync(fixture_path, 'utf-8');
        } else {
            throw new Error('Fixture not found: ' + fixture_path);
        }
    });

    it('should parse loop.do without crashing', () => {
        const result = lexer.tokenize(loop_content);
        expect(result.tokens.length).toBeGreaterThan(0);
        const parsed = parser.parse(result.tokens);
        expect(parsed.ast.nodes.length).toBeGreaterThan(0);
    });

    it('should NOT emit unclosed string literal errors', () => {
        const result = lexer.tokenize(loop_content);
        const errors = result.errors.filter(e => 
            e.code === LexerErrorCode.UNBALANCED_QUOTES || 
            e.message.includes('Unclosed string literal')
        );
        expect(errors.length).toBe(0);
    });

    it('should recognize program block structure', () => {
        const result = lexer.tokenize(loop_content);
        const parsed = parser.parse(result.tokens);
        const programs = parsed.ast.nodes.filter(n => n.type === 'program');
        expect(programs.length).toBeGreaterThanOrEqual(1);
        const prog = programs.find(n => n.type === 'program' && n.name === '_loop_execute_survey');
        expect(prog).toBeDefined();
    });


    it('should handle args command correctly', () => {
        const result = lexer.tokenize(loop_content);
        const parsed = parser.parse(result.tokens);
        const args_cmds = parsed.ast.nodes.filter(n => 
            n.type === 'command' && n.name.toLowerCase() === 'args'
        );
        expect(args_cmds.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT emit undefined macro for args-defined macros', async () => {
        await document_store.open('file:///loop.do', loop_content, 1);
        const doc = document_store.get('file:///loop.do')!;
        const diags = await diagnostics_provider.get_diagnostics(doc, DEFAULT_CONFIG);
        const macro_names = ['custom_arg', 'is_script', 'is_default'];
        const errors = diags.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            macro_names.some(n => d.message.includes("'" + n + "'"))
        );
        expect(errors.length).toBe(0);
    });

    it('should maintain context tracking', async () => {
        await document_store.open('file:///loop.do', loop_content, 1);
        const doc = document_store.get('file:///loop.do')!;
        expect(doc.ast).toBeDefined();
        expect(doc.tokens.length).toBeGreaterThan(0);
        expect(loop_content.split('\n').length).toBeGreaterThan(50);
    });
});
