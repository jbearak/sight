import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Connection } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { ContextTracker } from '../../src/context-tracker';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentState, DocumentStore } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { ScopeResolver } from '../../src/scope-resolver';
import { Token } from '../../src/types';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

describe('Out-of-scope diagnostic cleanup integration', () => {
    const test_temp_dir = join(
        process.cwd(),
        'temp_out_of_scope_cleanup_test',
    );
    let diagnostics_provider: DiagnosticsProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;

    const base_config: StataLSPConfig = {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'warning',
                styleWarnings: 'warning',
            },
        },
        cross_file: {
            assume_call_site: 'end',
            diagnostics: {
                missing_file: 'warning',
                max_depth: 'warning',
                call_site_identification: 'warning',
            },
        },
    } as unknown as StataLSPConfig;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        const mock_connection = {
            sendDiagnostics: () => {},
        } as Connection;

        diagnostics_provider = new DiagnosticsProvider(mock_connection);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    async function diagnose_target(
        target_filename: string,
        target_content: string,
        extra_files: Array<{ filename: string; content: string }> = [],
        config: StataLSPConfig = base_config,
        options?: { enable_undefined_variables?: boolean },
    ) {
        for (const my_file of extra_files) {
            writeFileSync(
                join(test_temp_dir, my_file.filename),
                my_file.content,
            );
        }

        const target_path = join(test_temp_dir, target_filename);
        writeFileSync(target_path, target_content);
        const target_uri = URI.file(target_path).toString();
        let document: DocumentState;

        if (options?.enable_undefined_variables) {
            document = create_document_state(
                target_uri,
                target_content,
                true,
            );
        } else {
            await document_store.open(target_uri, target_content, 1);
            document = document_store.get(target_uri)!;
        }

        return diagnostics_provider.get_diagnostics(
            document,
            config,
            undefined,
            scope_resolver,
        );
    }

    function create_document_state(
        uri: string,
        content: string,
        enable_undefined_variables = false,
    ): DocumentState {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();
        const context_tracker = new ContextTracker();

        const lex_result = lexer.tokenize(content);
        const parse_result = parser.parse(lex_result.tokens);
        const analysis_result = analyzer.analyze(
            parse_result.ast,
            uri,
            undefined,
            enable_undefined_variables
                ? { undefined_variable_enabled: true }
                : undefined,
            lex_result.tokens,
        );

        context_tracker.initialize_from_tokens(lex_result.tokens, content);

        return {
            uri,
            version: 1,
            content,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            symbols: analysis_result.symbols,
            diagnostics: analysis_result.diagnostics.map(my_diag => ({
                range: my_diag.range,
                message: my_diag.message,
                severity: 1,
                code: my_diag.code,
                source: 'sight',
                ...(my_diag.symbol_name !== undefined
                    || my_diag.reference_kind !== undefined
                    ? {
                        data: {
                            symbol_name: my_diag.symbol_name,
                            reference_kind: my_diag.reference_kind,
                        },
                    }
                    : {}),
            })),
            context_ranges: context_tracker.get_all_context_ranges(),
            context_tracker,
            line_offsets: build_line_offsets(content),
            forward_calls: analysis_result.forward_calls,
            token_line_index: build_token_line_index(lex_result.tokens),
            ignored_lines: analysis_result.ignored_lines,
        };
    }

    function build_line_offsets(content: string): number[] {
        const line_offsets = [0];
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                line_offsets.push(i + 1);
            }
        }
        return line_offsets;
    }

    function build_token_line_index(tokens: Token[]): Map<number, Token[]> {
        const token_line_index = new Map<number, Token[]>();
        for (const my_token of tokens) {
            const my_line = my_token.range.start.line;
            const the_line_tokens = token_line_index.get(my_line) ?? [];
            the_line_tokens.push(my_token);
            token_line_index.set(my_line, the_line_tokens);
        }
        return token_line_index;
    }

    it('rewrites same-file macro forward references to OUT_OF_SCOPE_SYMBOL', async () => {
        const diagnostics = await diagnose_target(
            'same_file_forward.do',
            ['display `later_macro\'', 'local later_macro "value"'].join('\n'),
        );

        const line0_diags = diagnostics.filter(d => d.range.start.line === 0);
        const rewrite = line0_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
        );

        expect(rewrite).toBeDefined();
        expect(rewrite!.message).toBe(
            "`later_macro' is used before it is defined (line 2)",
        );
        expect(
            line0_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO,
            ),
        ).toBe(false);
    });

    it('rewrites out-of-scope variables using the variable-specific path', async () => {
        const diagnostics = await diagnose_target(
            'child.do',
            [
                '// @lsp-done-by "parent.do" line=1',
                'summarize after_var',
            ].join('\n'),
            [
                {
                    filename: 'parent.do',
                    content: ['do "child.do"', 'gen after_var = 1'].join('\n'),
                },
            ],
            base_config,
            { enable_undefined_variables: true },
        );

        const line1_diags = diagnostics.filter(d => d.range.start.line === 1);
        const rewrite = line1_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
        );

        expect(rewrite).toBeDefined();
        expect(rewrite!.message).toBe(
            'after_var is defined in parent.do but after the call site (line 1)',
        );
        expect(
            line1_diags.some(
                d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE,
            ),
        ).toBe(false);
    });

    it('suppresses same-line ignore rewrites for same-file, backward, and forward cases', async () => {
        const same_file_diags = await diagnose_target(
            'same_file_ignore.do',
            [
                'display `same_file_macro\' // @lsp-ignore',
                'local same_file_macro "value"',
            ].join('\n'),
        );
        expect(
            same_file_diags.some(
                d =>
                    d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                    && d.message.includes('same_file_macro'),
            ),
        ).toBe(false);

        const backward_diags = await diagnose_target(
            'backward_ignore_child.do',
            [
                '// @lsp-done-by "backward_ignore_parent.do"',
                'display $after_global // @lsp-ignore',
            ].join('\n'),
            [
                {
                    filename: 'backward_ignore_parent.do',
                    content: [
                        'do "backward_ignore_child.do"',
                        'global after_global "value"',
                    ].join('\n'),
                },
            ],
        );
        expect(
            backward_diags.some(
                d =>
                    d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                    && d.message.includes('after_global'),
            ),
        ).toBe(false);

        const forward_diags = await diagnose_target(
            'forward_ignore_main.do',
            [
                'do "forward_ignore_child.do"',
                'display `forward_macro\' // @lsp-ignore',
            ].join('\n'),
            [
                {
                    filename: 'forward_ignore_child.do',
                    content: 'local forward_macro "value"',
                },
            ],
        );
        expect(
            forward_diags.some(
                d =>
                    d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                    && d.message.includes('forward_macro'),
            ),
        ).toBe(false);
    });
});
