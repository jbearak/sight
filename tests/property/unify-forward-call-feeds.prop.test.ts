/**
 * Property tests for unify-forward-call-feeds refactoring
 * 
 * Tests Properties 3-4 from the design doc:
 * - Property 3: Position-Aware Symbol Visibility
 * - Property 4: Effective Type Filtering
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer, create_empty_symbol_table } from '../../src/analyzer';
import { ContextTracker } from '../../src/context-tracker';
import { DocumentState, StataDiagnosticCode, ForwardCallSite, StataLSPConfig, ResolvedScope } from '../../src/types';
import { ScopeResolver } from '../../src/scope-resolver';
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
        ...(diag.symbol_name !== undefined || diag.reference_kind !== undefined
            ? { data: { symbol_name: diag.symbol_name, reference_kind: diag.reference_kind } }
            : {}),
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

describe('Feature: unify-forward-call-feeds', () => {
    let temp_dir: string;
    let provider: DiagnosticsProvider;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
        provider = new DiagnosticsProvider(create_mock_connection() as any);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const symbol_name_arb = fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/);
    const effective_type_arb = fc.constantFrom('do', 'include') as fc.Arbitrary<'do' | 'include'>;

    describe('Property 3: Position-Aware Symbol Visibility', () => {
        test('symbols suppress warnings only when reference is after call site', async () => {
            await fc.assert(
                fc.asyncProperty(
                    symbol_name_arb,
                    fc.integer({ min: 0, max: 5 }),  // call_line
                    fc.integer({ min: 0, max: 5 }),  // ref_line (separate from call_line)
                    async (symbol_name, call_line, ref_line) => {
                        // Skip if call and ref are on same line (ambiguous case)
                        if (call_line === ref_line) {
                            return true; // Skip this case
                        }

                        // Create callee file with global macro (globals work for both do/include)
                        const callee_path = path.join(temp_dir, `callee_${Date.now()}_${Math.random().toString(36).slice(2)}.do`);
                        fs.writeFileSync(callee_path, `global ${symbol_name} = "test"\n`);

                        // Build caller content with padding
                        const lines: string[] = [];
                        const max_line = Math.max(ref_line, call_line) + 1;
                        for (let i = 0; i < max_line; i++) {
                            if (i === call_line) {
                                lines.push(`do "${callee_path}"`);
                            } else if (i === ref_line) {
                                lines.push(`display $${symbol_name}`);
                            } else {
                                lines.push('// padding');
                            }
                        }

                        const caller_path = path.join(temp_dir, `caller_${Date.now()}_${Math.random().toString(36).slice(2)}.do`);
                        const caller_content = lines.join('\n') + '\n';
                        fs.writeFileSync(caller_path, caller_content);

                        const caller_uri = URI.file(caller_path).toString();
                        const doc_state = create_document_state(caller_content, caller_uri);

                        // Build a ResolvedScope carrying forward_call_symbols
                        // and wire it through a stub ScopeResolver.
                        const resolved_scope: ResolvedScope = {
                            chain: [],
                            symbols: create_empty_symbol_table(),
                            out_of_scope_symbols: [],
                            diagnostics: [],
                            has_directives: false,
                            has_auto_parents: false,
                            forward_call_symbols: [{
                                callee_uri: URI.file(callee_path).toString(),
                                call_line: call_line,
                                symbols: {
                                    ...create_empty_symbol_table(),
                                    globalMacros: new Map([[symbol_name, {
                                        name: symbol_name,
                                        value: 'test',
                                        sourceUri: URI.file(callee_path).toString(),
                                    }]]),
                                },
                                effective_type: 'do' as const,
                            }] as ForwardCallSite[],
                        };

                        const stub_resolver = make_stub_scope_resolver(resolved_scope);
                        const diagnostics = await provider.get_diagnostics(
                            doc_state,
                            DEFAULT_CONFIG,
                            undefined,
                            stub_resolver
                        );

                        const has_undefined_warning = diagnostics.some(d => 
                            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            d.message.includes(symbol_name)
                        );

                        // Symbol should suppress warning if and only if reference is STRICTLY after call site
                        // The check is: call_site.call_line < diag_line (strict less than)
                        const should_suppress = ref_line > call_line;
                        
                        if (should_suppress) {
                            return !has_undefined_warning; // Should NOT have warning
                        } else {
                            return has_undefined_warning; // Should have warning
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 4: Effective Type Filtering', () => {
        test('do excludes locals, include includes all', async () => {
            await fc.assert(
                fc.asyncProperty(
                    symbol_name_arb,
                    effective_type_arb,
                    fc.boolean(), // is_local
                    async (symbol_name, effective_type, is_local) => {
                        // Create callee file
                        const callee_path = path.join(temp_dir, `callee_${Date.now()}_${Math.random().toString(36).slice(2)}.do`);
                        const callee_content = is_local 
                            ? `local ${symbol_name} = "test"\n`
                            : `global ${symbol_name} = "test"\n`;
                        fs.writeFileSync(callee_path, callee_content);

                        // Create caller with forward call on line 0, reference on line 1
                        const caller_path = path.join(temp_dir, `caller_${Date.now()}_${Math.random().toString(36).slice(2)}.do`);
                        const caller_content = is_local
                            ? `${effective_type} "${callee_path}"\ndisplay \`${symbol_name}'\n`
                            : `${effective_type} "${callee_path}"\ndisplay $${symbol_name}\n`;
                        fs.writeFileSync(caller_path, caller_content);

                        const caller_uri = URI.file(caller_path).toString();
                        const doc_state = create_document_state(caller_content, caller_uri);

                        // Build symbols for the forward-call site
                        const symbols = create_empty_symbol_table();
                        if (is_local) {
                            symbols.localMacros.set(symbol_name, {
                                name: symbol_name,
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            });
                        } else {
                            symbols.globalMacros.set(symbol_name, {
                                name: symbol_name,
                                value: 'test',
                                sourceUri: URI.file(callee_path).toString(),
                            });
                        }

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
                                symbols,
                                effective_type,
                            }] as ForwardCallSite[],
                        };

                        const stub_resolver = make_stub_scope_resolver(resolved_scope);
                        const diagnostics = await provider.get_diagnostics(
                            doc_state,
                            DEFAULT_CONFIG,
                            undefined,
                            stub_resolver
                        );

                        const has_undefined_warning = diagnostics.some(d => 
                            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            d.message.includes(symbol_name)
                        );

                        // Determine expected behavior
                        let should_suppress: boolean;
                        if (effective_type === 'do') {
                            // 'do' should NOT suppress local macros, but SHOULD suppress globals
                            should_suppress = !is_local;
                        } else {
                            // 'include' should suppress ALL symbols
                            should_suppress = true;
                        }

                        if (should_suppress) {
                            return !has_undefined_warning;
                        } else {
                            return has_undefined_warning;
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
