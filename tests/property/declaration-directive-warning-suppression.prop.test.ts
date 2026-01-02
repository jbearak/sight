/**
 * Property tests for Declaration Directive Warning Suppression
 *
 * Feature: lsp-declare-symbols
 * Tests Property 6 from the design document.
 *
 * Property 6: Warning Suppression for Declared Macros
 * For any local or global macro declared via @lsp-local or @lsp-global,
 * references to that macro appearing after the directive line SHALL NOT
 * produce undefined macro warnings.
 *
 * **Validates: Requirements 4.1, 4.2**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Declaration Directive Warning Suppression Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();

    // Generator for valid Stata identifiers (avoiding reserved words)
    const stata_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        { minLength: 2, maxLength: 15 }
    ).filter(s => /^[a-z]/.test(s) && !['if', 'in', 'of', 'do', 'by'].includes(s));

    /**
     * Property 6: Warning Suppression for Declared Macros
     *
     * For any local or global macro declared via @lsp-local or @lsp-global,
     * references to that macro appearing after the directive line SHALL NOT
     * produce undefined macro warnings.
     *
     * **Validates: Requirements 4.1, 4.2**
     */
    describe('Property 6: Warning Suppression for Declared Macros', () => {
        test('@lsp-local suppresses undefined local macro warnings', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // Directive on line 0, reference on line 1
                        const content = `// @lsp-local ${name}
display \`${name}'`;

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

                        // Should NOT have undefined macro warning for the declared macro
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('@lsp-global suppresses undefined global macro warnings', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // Directive on line 0, reference on line 1
                        const content = `// @lsp-global ${name}
display $${name}`;

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

                        // Should NOT have undefined macro warning for the declared macro
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('undeclared macros still produce warnings', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        declared_name: stata_identifier,
                        undeclared_name: stata_identifier,
                    }).filter(({ declared_name, undeclared_name }) => declared_name !== undeclared_name),
                    ({ declared_name, undeclared_name }) => {
                        // Declare one macro but reference a different one
                        const content = `// @lsp-local ${declared_name}
display \`${undeclared_name}'`;

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

                        // Should have undefined macro warning for the undeclared macro
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(undeclared_name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('multiple references after declaration are all suppressed', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        num_references: fc.integer({ min: 2, max: 5 }),
                    }),
                    ({ name, num_references }) => {
                        // Directive on line 0, multiple references after
                        const the_references = Array(num_references)
                            .fill(`display \`${name}'`)
                            .join('\n');
                        const content = `// @lsp-local ${name}\n${the_references}`;

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

                        // Should NOT have any undefined macro warnings for the declared macro
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
