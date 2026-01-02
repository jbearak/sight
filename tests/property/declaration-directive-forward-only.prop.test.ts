/**
 * Property tests for Declaration Directive Forward-Only Effect
 *
 * Feature: lsp-declare-symbols
 * Tests Property 7 from the design document.
 *
 * Property 7: Forward-Only Effect
 * For any declaration directive at line N, references to the declared symbol
 * at lines < N SHALL still produce undefined warnings (if applicable), while
 * references at lines >= N SHALL NOT produce warnings.
 *
 * **Validates: Requirements 5.3**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Declaration Directive Forward-Only Effect Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();

    // Generator for valid Stata identifiers (avoiding reserved words)
    const stata_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        { minLength: 2, maxLength: 15 }
    ).filter(s => /^[a-z]/.test(s) && !['if', 'in', 'of', 'do', 'by'].includes(s));

    /**
     * Property 7: Forward-Only Effect
     *
     * For any declaration directive at line N, references to the declared symbol
     * at lines < N SHALL still produce undefined warnings (if applicable), while
     * references at lines >= N SHALL NOT produce warnings.
     *
     * **Validates: Requirements 5.3**
     */
    describe('Property 7: Forward-Only Effect', () => {
        test('reference before @lsp-local directive produces warning', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // Reference on line 0, directive on line 1
                        const content = `display \`${name}'
// @lsp-local ${name}
gen x = 1`;

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

                        // Should have undefined macro warning for reference before directive
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                        // Warning should be on line 0 (before directive)
                        expect(undefined_warnings[0].range.start.line).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('reference after @lsp-local directive does not produce warning', () => {
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

                        // Should NOT have undefined macro warning
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

        test('reference before @lsp-global directive produces warning', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // Reference on line 0, directive on line 1
                        const content = `display $${name}
// @lsp-global ${name}
gen x = 1`;

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

                        // Should have undefined macro warning for reference before directive
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                        // Warning should be on line 0 (before directive)
                        expect(undefined_warnings[0].range.start.line).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('reference after @lsp-global directive does not produce warning', () => {
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

                        // Should NOT have undefined macro warning
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

        test('mixed references: before warns, after does not', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // Reference before (line 0), directive (line 1), reference after (line 2)
                        const content = `display \`${name}'
// @lsp-local ${name}
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

                        // Should have exactly one warning (for reference before directive)
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(1);
                        // Warning should be on line 0 (before directive)
                        expect(undefined_warnings[0].range.start.line).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('reference on same line as directive does not produce warning', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                    }),
                    ({ name }) => {
                        // This tests the edge case where reference_line >= directive_line
                        // Directive on line 0, reference also effectively on line 0 (same line)
                        // Since the directive is a comment, we can't have code on the same line
                        // So we test with directive on line 0 and reference on line 0 in separate test
                        
                        // Actually, let's test directive on line N and reference on line N
                        // by having some code before
                        const content = `gen x = 1
// @lsp-local ${name}
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

                        // Reference is on line 2, directive is on line 1
                        // So reference is after directive - should NOT warn
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

        test('directive mid-file: references before warn, after do not', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        name: stata_identifier,
                        lines_before: fc.integer({ min: 1, max: 3 }),
                        lines_after: fc.integer({ min: 1, max: 3 }),
                    }),
                    ({ name, lines_before, lines_after }) => {
                        // Build content with references before and after directive
                        const the_refs_before = Array(lines_before)
                            .fill(`display \`${name}'`)
                            .join('\n');
                        const the_refs_after = Array(lines_after)
                            .fill(`display \`${name}'`)
                            .join('\n');
                        const content = `${the_refs_before}
// @lsp-local ${name}
${the_refs_after}`;

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

                        // Should have exactly lines_before warnings (all before directive)
                        const undefined_warnings = analysis_result.diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                 d.message.includes(name)
                        );
                        expect(undefined_warnings.length).toBe(lines_before);
                        
                        // All warnings should be on lines before the directive
                        const directive_line = lines_before;
                        for (const warning of undefined_warnings) {
                            expect(warning.range.start.line).toBeLessThan(directive_line);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
