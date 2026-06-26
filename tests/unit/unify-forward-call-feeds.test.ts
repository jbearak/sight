/**
 * Unit tests for unify-forward-call-feeds refactoring
 * 
 * Tests edge configurations:
 * - scope_resolver null (fallback path)
 * - scope_resolver available (primary path)
 * - duplicate directive/command scenarios
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer, create_empty_symbol_table } from '../../src/analyzer';
import { undefined_symbol_data_fields } from '../../src/utils/undefined-symbol-diagnostic';
import { ContextTracker } from '../../src/context-tracker';
import { DocumentState, StataDiagnosticCode, StataLSPConfig, ResolvedScope } from '../../src/types';
import { DiagnosticSeverity } from 'vscode-languageserver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';

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
    formatting: { indentSize: 4, indentStyle: 'spaces' },
    adoPaths: [],
    indexWorkspace: true,
};

function create_mock_connection() {
    return { sendDiagnostics: () => {} };
}

/**
 * Wire a stub ScopeResolver whose .resolve() returns the provided
 * ResolvedScope. Used to feed canned forward_call_symbols to
 * DiagnosticsProvider without standing up a full resolver.
 */
function make_stub_scope_resolver(resolved_scope: ResolvedScope): ScopeResolver {
    const the_stub = new ScopeResolver();
    (the_stub as any).resolve = async () => resolved_scope;
    return the_stub;
}

function create_document_state(content: string, uri: string): DocumentState {
    const my_lexer = new StataLexer();
    const my_parser = new StataParser();
    const my_analyzer = new SemanticAnalyzer();
    const my_context_tracker = new ContextTracker();

    const my_lex_result = my_lexer.tokenize(content);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    const my_analysis_result = my_analyzer.analyze(
        my_parse_result.ast,
        uri,
        undefined,
        undefined,
        my_lex_result.tokens
    );

    my_context_tracker.initialize_from_tokens(my_lex_result.tokens, content);
    const my_context_ranges = my_context_tracker.get_all_context_ranges();

    const my_line_offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') {
            my_line_offsets.push(i + 1);
        }
    }

    const diagnostics = my_analysis_result.diagnostics.map(diag => ({
        range: diag.range,
        message: diag.message,
        severity: diag.severity === 'error' ? DiagnosticSeverity.Error
            : diag.severity === 'warning' ? DiagnosticSeverity.Warning
            : diag.severity === 'information' ? DiagnosticSeverity.Information
            : DiagnosticSeverity.Hint,
        code: diag.code,
        source: 'sight',
        ...undefined_symbol_data_fields(diag),
    }));

    return {
        uri,
        version: 1,
        content,
        tokens: my_lex_result.tokens,
        ast: my_parse_result.ast,
        symbols: my_analysis_result.symbols,
        diagnostics,
        context_ranges: my_context_ranges,
        context_tracker: my_context_tracker,
        line_offsets: my_line_offsets,
        forward_calls: my_analysis_result.forward_calls || [],
    };
}

describe('unify-forward-call-feeds refactoring', () => {
    let temp_dir: string;
    let provider: DiagnosticsProvider;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
        provider = new DiagnosticsProvider(create_mock_connection() as any);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    describe('scope_resolver carries forward_call_symbols', () => {
        test('stub resolver providing forward_call_symbols suppresses undefined warnings', async () => {
            const callee_path = path.join(temp_dir, 'callee.do');
            fs.writeFileSync(callee_path, 'global child_var = "test"\n');

            const caller_path = path.join(temp_dir, 'caller.do');
            const caller_content = `do "${callee_path}"\ndisplay $child_var\n`;
            fs.writeFileSync(caller_path, caller_content);

            const caller_uri = URI.file(caller_path).toString();
            const doc_state = create_document_state(caller_content, caller_uri);

            // Build a ResolvedScope carrying forward_call_symbols.
            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: create_empty_symbol_table(),
                out_of_scope_symbols: [],
                diagnostics: [],
                has_directives: false,
                has_auto_parents: false,
                forward_call_symbols: [{
                    callee_uri: URI.file(callee_path).toString(),
                    call_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        globalMacros: new Map([['child_var', {
                            name: 'child_var',
                            value: 'test',
                            sourceUri: URI.file(callee_path).toString(),
                        }]]),
                    },
                    effective_type: 'do',
                }],
            };

            const stub_resolver = make_stub_scope_resolver(resolved_scope);

            const diagnostics = await provider.get_diagnostics(
                doc_state,
                DEFAULT_CONFIG,
                undefined, // workspace_symbols
                stub_resolver
            );

            // Should NOT have undefined macro warning since the stub resolver
            // provides the symbol via resolved_scope.forward_call_symbols.
            const undefined_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'child_var'
            );
            expect(undefined_warnings).toHaveLength(0);
        });
    });

    describe('scope_resolver available (primary path)', () => {
        test('resolved_scope.forward_call_symbols is used when scope_resolver is available', async () => {
            const callee_path = path.join(temp_dir, 'callee.do');
            fs.writeFileSync(callee_path, 'global child_var = "test"\n');

            const caller_path = path.join(temp_dir, 'caller.do');
            const caller_content = `do "${callee_path}"\ndisplay $child_var\n`;
            fs.writeFileSync(caller_path, caller_content);

            const caller_uri = URI.file(caller_path).toString();
            const doc_state = create_document_state(caller_content, caller_uri);

            // Create a scope_resolver that returns forward_call_symbols
            const scope_resolver = new ScopeResolver();
            const forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
            scope_resolver.set_forward_scope_resolver(forward_scope_resolver);

            // Get diagnostics with scope_resolver — the scope resolver provides
            // forward_call_symbols on the ResolvedScope it returns.
            const diagnostics = await provider.get_diagnostics(
                doc_state,
                DEFAULT_CONFIG,
                undefined, // workspace_symbols
                scope_resolver
            );

            // The scope_resolver will resolve forward calls and provide symbols
            // Since the callee file exists and defines child_var, it should be found
            const undefined_warnings = diagnostics.filter(d => 
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'child_var'
            );
            expect(undefined_warnings).toHaveLength(0);
        });
    });

    describe('duplicate directive/command scenarios', () => {
        test('same file referenced by both directive and command is handled gracefully', async () => {
            const callee_path = path.join(temp_dir, 'callee.do');
            fs.writeFileSync(callee_path, 'global child_var = "test"\n');

            const caller_path = path.join(temp_dir, 'caller.do');
            // Both @lsp-do directive and do command reference the same file
            const caller_content = `// @lsp-do: "${callee_path}"\ndo "${callee_path}"\ndisplay $child_var\n`;
            fs.writeFileSync(caller_path, caller_content);

            const caller_uri = URI.file(caller_path).toString();
            const doc_state = create_document_state(caller_content, caller_uri);

            // ResolvedScope with duplicate entries (simulating both directive and command).
            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: create_empty_symbol_table(),
                out_of_scope_symbols: [],
                diagnostics: [],
                has_directives: false,
                has_auto_parents: false,
                forward_call_symbols: [
                    // From @lsp-do directive
                    {
                        callee_uri: URI.file(callee_path).toString(),
                        call_line: 0,
                        symbols: {
                            ...create_empty_symbol_table(),
                            globalMacros: new Map([['child_var', {
                                name: 'child_var',
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            }]]),
                        },
                        effective_type: 'do',
                    },
                    // From do command (duplicate)
                    {
                        callee_uri: URI.file(callee_path).toString(),
                        call_line: 1,
                        symbols: {
                            ...create_empty_symbol_table(),
                            globalMacros: new Map([['child_var', {
                                name: 'child_var',
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            }]]),
                        },
                        effective_type: 'do',
                    },
                ],
            };

            const stub_resolver = make_stub_scope_resolver(resolved_scope);

            const diagnostics = await provider.get_diagnostics(
                doc_state,
                DEFAULT_CONFIG,
                undefined,
                stub_resolver
            );

            // Should handle duplicates gracefully - no undefined macro warning
            const undefined_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'child_var'
            );
            expect(undefined_warnings).toHaveLength(0);
        });

        test('do then include for same file adds locals only on second call', async () => {
            const callee_path = path.join(temp_dir, 'callee.do');
            fs.writeFileSync(callee_path, 'local local_var = "test"\nglobal global_var = "test"\n');

            const caller_path = path.join(temp_dir, 'caller.do');
            // First do (excludes locals), then include (adds locals)
            const caller_content = `do "${callee_path}"\ninclude "${callee_path}"\ndisplay \`local_var'\ndisplay $global_var\n`;
            fs.writeFileSync(caller_path, caller_content);

            const caller_uri = URI.file(caller_path).toString();
            const doc_state = create_document_state(caller_content, caller_uri);

            // ResolvedScope simulating do then include.
            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: create_empty_symbol_table(),
                out_of_scope_symbols: [],
                diagnostics: [],
                has_directives: false,
                has_auto_parents: false,
                forward_call_symbols: [
                    // From do command (excludes locals)
                    {
                        callee_uri: URI.file(callee_path).toString(),
                        call_line: 0,
                        symbols: {
                            ...create_empty_symbol_table(),
                            globalMacros: new Map([['global_var', {
                                name: 'global_var',
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            }]]),
                        },
                        effective_type: 'do',
                    },
                    // From include command (includes locals)
                    {
                        callee_uri: URI.file(callee_path).toString(),
                        call_line: 1,
                        symbols: {
                            ...create_empty_symbol_table(),
                            localMacros: new Map([['local_var', {
                                name: 'local_var',
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            }]]),
                            globalMacros: new Map([['global_var', {
                                name: 'global_var',
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            }]]),
                        },
                        effective_type: 'include',
                    },
                ],
            };

            const stub_resolver = make_stub_scope_resolver(resolved_scope);

            const diagnostics = await provider.get_diagnostics(
                doc_state,
                DEFAULT_CONFIG,
                undefined,
                stub_resolver
            );

            // Both local_var and global_var should be found (no undefined warnings)
            const undefined_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_warnings).toHaveLength(0);
        });
    });
});
