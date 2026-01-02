/**
 * Property tests for Declaration Directive Symbol Registration
 *
 * Feature: lsp-declare-symbols
 * Tests Property 5 from the design document.
 *
 * Property 5: Symbol Registration Correctness
 * For any parsed declaration directive, the analyzer SHALL register the symbol
 * in the appropriate symbol table map (localMacros for @lsp-local, globalMacros
 * for @lsp-global, scalars for @lsp-scalar, matrices for @lsp-matrix, programs
 * for @lsp-program) with the location referencing the directive's line.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DeclarationDirectiveType } from '../../src/types';

describe('Declaration Directive Symbol Registration Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();

    // Generator for valid Stata identifiers
    const stata_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
        { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-zA-Z_]/.test(s)); // Must start with letter or underscore

    // Generator for declaration directive types
    const directive_type = fc.constantFrom('local', 'global', 'scalar', 'matrix', 'program') as fc.Arbitrary<DeclarationDirectiveType>;

    /**
     * Property 5: Symbol Registration Correctness
     *
     * For any parsed declaration directive, the analyzer SHALL register the symbol
     * in the appropriate symbol table map with the location referencing the directive's line.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
     */
    describe('Property 5: Symbol Registration Correctness', () => {
        test('@lsp-local registers symbol in localMacros', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        directive_line: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ name, directive_line }) => {
                        // Build content with directive at specified line
                        const the_prefix_lines = Array(directive_line).fill('gen x = 1').join('\n');
                        const directive_content = `// @lsp-local ${name}`;
                        const content = the_prefix_lines + (directive_line > 0 ? '\n' : '') + directive_content + '\ngen y = 2';

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Symbol should be registered in localMacros
                        expect(analysis_result.symbols.localMacros.has(name)).toBe(true);
                        
                        const symbol = analysis_result.symbols.localMacros.get(name);
                        expect(symbol).toBeDefined();
                        expect(symbol!.name).toBe(name);
                        expect(symbol!.scope).toBe('local');
                        expect(symbol!.definition_line).toBe(directive_line);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('@lsp-global registers symbol in globalMacros', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        directive_line: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ name, directive_line }) => {
                        const the_prefix_lines = Array(directive_line).fill('gen x = 1').join('\n');
                        const directive_content = `// @lsp-global ${name}`;
                        const content = the_prefix_lines + (directive_line > 0 ? '\n' : '') + directive_content + '\ngen y = 2';

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Symbol should be registered in globalMacros
                        expect(analysis_result.symbols.globalMacros.has(name)).toBe(true);
                        
                        const symbol = analysis_result.symbols.globalMacros.get(name);
                        expect(symbol).toBeDefined();
                        expect(symbol!.name).toBe(name);
                        expect(symbol!.scope).toBe('global');
                        expect(symbol!.definition_line).toBe(directive_line);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('@lsp-scalar registers symbol in scalars', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        directive_line: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ name, directive_line }) => {
                        const the_prefix_lines = Array(directive_line).fill('gen x = 1').join('\n');
                        const directive_content = `// @lsp-scalar ${name}`;
                        const content = the_prefix_lines + (directive_line > 0 ? '\n' : '') + directive_content + '\ngen y = 2';

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Symbol should be registered in scalars
                        expect(analysis_result.symbols.scalars.has(name)).toBe(true);
                        
                        const symbol = analysis_result.symbols.scalars.get(name);
                        expect(symbol).toBeDefined();
                        expect(symbol!.name).toBe(name);
                        expect(symbol!.definition_line).toBe(directive_line);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('@lsp-matrix registers symbol in matrices', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        directive_line: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ name, directive_line }) => {
                        const the_prefix_lines = Array(directive_line).fill('gen x = 1').join('\n');
                        const directive_content = `// @lsp-matrix ${name}`;
                        const content = the_prefix_lines + (directive_line > 0 ? '\n' : '') + directive_content + '\ngen y = 2';

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Symbol should be registered in matrices
                        expect(analysis_result.symbols.matrices.has(name)).toBe(true);
                        
                        const symbol = analysis_result.symbols.matrices.get(name);
                        expect(symbol).toBeDefined();
                        expect(symbol!.name).toBe(name);
                        expect(symbol!.definition_line).toBe(directive_line);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('@lsp-program registers symbol in programs (case-sensitive)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        directive_line: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ name, directive_line }) => {
                        const the_prefix_lines = Array(directive_line).fill('gen x = 1').join('\n');
                        const directive_content = `// @lsp-program ${name}`;
                        const content = the_prefix_lines + (directive_line > 0 ? '\n' : '') + directive_content + '\ngen y = 2';

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Symbol should be registered in programs with original case
                        expect(analysis_result.symbols.programs.has(name)).toBe(true);
                        
                        const symbol = analysis_result.symbols.programs.get(name);
                        expect(symbol).toBeDefined();
                        expect(symbol!.name).toBe(name);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('all directive types register in correct symbol table', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        name: stata_identifier,
                    }),
                    ({ type, name }) => {
                        const content = `// @lsp-${type} ${name}\ngen x = 1`;

                        const lexer_result = lexer.tokenize(content);
                        const parse_result = parser.parse(lexer_result.tokens);
                        const analyzer = new SemanticAnalyzer();
                        const analysis_result = analyzer.analyze(
                            parse_result.ast,
                            'file:///test.do',
                            undefined,
                            undefined,
                            lexer_result.tokens
                        );

                        // Check correct symbol table based on type
                        switch (type) {
                            case 'local':
                                expect(analysis_result.symbols.localMacros.has(name)).toBe(true);
                                break;
                            case 'global':
                                expect(analysis_result.symbols.globalMacros.has(name)).toBe(true);
                                break;
                            case 'scalar':
                                expect(analysis_result.symbols.scalars.has(name)).toBe(true);
                                break;
                            case 'matrix':
                                expect(analysis_result.symbols.matrices.has(name)).toBe(true);
                                break;
                            case 'program':
                                expect(analysis_result.symbols.programs.has(name)).toBe(true);
                                break;
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
