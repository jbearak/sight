/**
 * Property tests for Cross-File Symbol Suppression
 *
 * Feature: cross-file-forward-reference-fix, Property 3
 * Tests that workspace_symbols parameter does NOT suppress warnings.
 *
 * Property 3: Workspace symbols do NOT suppress undefined macro warnings
 * The workspace_symbols parameter is used only for completions, go-to-definition,
 * and c_local lookup. It does NOT suppress undefined macro warnings.
 * Only cross-file directives (@lsp-done-by, @lsp-included-by, etc.) suppress warnings.
 *
 * **Validates: Workspace symbols do not suppress warnings**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

describe('Cross-File Symbol Suppression Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    const stata_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        { minLength: 2, maxLength: 15 }
    ).filter(s => /^[a-z]/.test(s) && !['if', 'in', 'of', 'do', 'by'].includes(s));

    /**
     * Property 3: Workspace symbols do NOT suppress undefined macro warnings
     *
     * The workspace_symbols parameter is used only for completions and go-to-definition.
     * It does NOT suppress undefined macro warnings. Only cross-file directives provide
     * scope resolution for warning suppression.
     *
     * **Validates: Workspace symbols do not suppress warnings**
     */
    describe('Property 3: Workspace symbols do NOT suppress undefined macro warnings', () => {
        test('workspace global macros do NOT suppress undefined warnings', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        global_name: stata_identifier,
                    }),
                    ({ global_name }) => {
                        // Create workspace symbol table with global
                        const workspace_symbols: SymbolTable = {
                            localMacros: new Map(),
                            globalMacros: new Map([
                                [global_name, {
                                    name: global_name,
                                    scope: 'global',
                                    location: { uri: 'file:///workspace.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                                    sourceUri: 'file:///workspace.do',
                                    containingScope: 'dofile',
                                    definition_line: 0,
                                }]
                            ]),
                            programs: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Child references global without any directive
                        const child_content = `display $${global_name}`;

                        // Analyze child with workspace symbols
                        const lex_result = lexer.tokenize(child_content);
                        const parse_result = parser.parse(lex_result.tokens);
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///child.do',
                            workspace_symbols,
                            { undefined_macro_enabled: true },
                            lex_result.tokens
                        );

                        // WILL have undefined macro warnings because workspace_symbols do NOT suppress
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(global_name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('workspace local macros do NOT suppress undefined warnings', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        local_name: stata_identifier,
                    }),
                    ({ local_name }) => {
                        // Create workspace symbol table with local
                        const workspace_symbols: SymbolTable = {
                            localMacros: new Map([
                                [local_name, {
                                    name: local_name,
                                    scope: 'local',
                                    location: { uri: 'file:///workspace.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                                    sourceUri: 'file:///workspace.do',
                                    containingScope: 'dofile',
                                    definition_line: 0,
                                }]
                            ]),
                            globalMacros: new Map(),
                            programs: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Child references local without any directive
                        const child_content = `display \`${local_name}'`;

                        // Analyze child with workspace symbols
                        const lex_result = lexer.tokenize(child_content);
                        const parse_result = parser.parse(lex_result.tokens);
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///child.do',
                            workspace_symbols,
                            { undefined_macro_enabled: true },
                            lex_result.tokens
                        );

                        // workspace_symbols do NOT suppress warnings
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(local_name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('workspace programs are not merged into result symbols', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        program_name: stata_identifier,
                    }),
                    ({ program_name }) => {
                        // Create workspace symbol table with program
                        const workspace_symbols: SymbolTable = {
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            programs: new Map([
                                [program_name.toLowerCase(), {
                                    name: program_name,
                                    location: { uri: 'file:///workspace.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                                    sourceUri: 'file:///workspace.do',
                                }]
                            ]),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Child calls program
                        const child_content = `${program_name}`;

                        // Analyze child with workspace symbols
                        const lex_result = lexer.tokenize(child_content);
                        const parse_result = parser.parse(lex_result.tokens);
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///child.do',
                            workspace_symbols,
                            { undefined_macro_enabled: true },
                            lex_result.tokens
                        );

                        // Workspace symbols are ignored - not merged into result
                        const result_symbols = analysis_result.symbols;
                        expect(result_symbols.programs.has(program_name.toLowerCase())).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('undefined symbols produce warnings without cross-file context', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        undefined_local: stata_identifier,
                        undefined_global: stata_identifier,
                    }),
                    ({ undefined_local, undefined_global }) => {
                        // Child references undefined macros without any workspace symbols
                        const child_content = `display \`${undefined_local}'
display $${undefined_global}`;

                        // Analyze child without cross-file symbols
                        const lex_result = lexer.tokenize(child_content);
                        const parse_result = parser.parse(lex_result.tokens);
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///child.do',
                            undefined,
                            { undefined_macro_enabled: true },
                            lex_result.tokens
                        );

                        // Should have undefined macro warnings
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );
                        expect(undefined_warnings.length).toBe(2);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('workspace symbols do NOT suppress any warnings (both defined and undefined warn)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        defined_global: stata_identifier,
                        undefined_local: stata_identifier,
                    }).filter(({ defined_global, undefined_local }) => defined_global !== undefined_local),
                    ({ defined_global, undefined_local }) => {
                        // Create workspace symbol table with only global
                        const workspace_symbols: SymbolTable = {
                            localMacros: new Map(),
                            globalMacros: new Map([
                                [defined_global, {
                                    name: defined_global,
                                    scope: 'global',
                                    location: { uri: 'file:///workspace.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                                    sourceUri: 'file:///workspace.do',
                                    containingScope: 'dofile',
                                    definition_line: 0,
                                }]
                            ]),
                            programs: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Child references both defined global and undefined local
                        const child_content = `display $${defined_global}
display \`${undefined_local}'`;

                        // Analyze child with workspace symbols
                        const lex_result = lexer.tokenize(child_content);
                        const parse_result = parser.parse(lex_result.tokens);
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///child.do',
                            workspace_symbols,
                            { undefined_macro_enabled: true },
                            lex_result.tokens
                        );

                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // BOTH should warn - workspace symbols do NOT suppress
                        expect(undefined_warnings.length).toBe(2);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
