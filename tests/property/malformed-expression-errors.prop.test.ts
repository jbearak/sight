import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { ParseErrorCode } from '../../src/types';

/**
 * Property-based tests for Malformed Expression Error Handling
 * Feature: malformed-expression-errors
 * 
 * Tests Requirement 4.4:
 * - Malformed expressions report appropriate errors without cascading failures
 * - Missing expressions after '=' are detected
 * - Unbalanced parentheses are detected and handled gracefully
 */
describe('Malformed Expression Error Handling Property Tests', () => {
    
    /**
     * Generator for assignment commands
     * Note: 'global' and 'local' are excluded because they parse as macro_def, not command
     */
    function arbitrary_assignment_command(): fc.Arbitrary<string> {
        return fc.constantFrom('generate', 'replace', 'egen');
    }

    /**
     * Generator for variable names
     */
    function arbitrary_variable_name(): fc.Arbitrary<string> {
        return fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,8}$/);
    }

    /**
     * Generator for expressions with unbalanced parentheses
     * Note: Excludes * and / to avoid comment syntax, uses space instead of \s to exclude newlines
     */
    function arbitrary_unbalanced_expression(): fc.Arbitrary<string> {
        return fc.oneof(
            // Too many opening parentheses
            fc.record({
                base: fc.stringMatching(/^[a-zA-Z0-9_+ ]+$/),
                extra_opens: fc.integer({ min: 1, max: 3 })
            }).map(({ base, extra_opens }) => '('.repeat(extra_opens) + base),
            
            // Too many closing parentheses
            fc.record({
                base: fc.stringMatching(/^[a-zA-Z0-9_+ ]+$/),
                extra_closes: fc.integer({ min: 1, max: 3 })
            }).map(({ base, extra_closes }) => base + ')'.repeat(extra_closes)),
            
            // Mixed unbalanced
            fc.record({
                parts: fc.array(fc.stringMatching(/^[a-zA-Z0-9_+ ]+$/), { minLength: 1, maxLength: 3 }),
                opens: fc.integer({ min: 1, max: 2 }),
                closes: fc.integer({ min: 1, max: 2 })
            }).filter(({ opens, closes }) => opens !== closes)
             .map(({ parts, opens, closes }) => 
                '('.repeat(opens) + parts.join(' + ') + ')'.repeat(closes))
        );
    }

    /**
     * Test that missing expressions after '=' are detected
     */
    it('should detect missing expressions after equals sign', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            (command, varname) => {
                // Create command with missing expression after =
                const code = `${command} ${varname} =`;
                
                const lexer = new StataLexer();
                const lexResult = lexer.tokenize(code);
                const parser = new StataParser();
                const parseResult = parser.parse(lexResult.tokens);
                
                // Should have at least one error
                expect(parseResult.errors.length).toBeGreaterThan(0);
                
                // Should have a MISSING_EXPRESSION_AFTER_EQUALS error
                const missingExprError = parseResult.errors.find(
                    error => error.code === ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS
                );
                expect(missingExprError).toBeDefined();
                expect(missingExprError?.message).toContain('Missing expression after equals sign');
                
                // Should not have cascading failures (no more than 2 errors total)
                expect(parseResult.errors.length).toBeLessThanOrEqual(2);
            }
        ), { numRuns: 50 });
    });

    /**
     * Test that unbalanced parentheses are detected
     */
    it('should detect unbalanced parentheses in expressions', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            arbitrary_unbalanced_expression(),
            (command, varname, expression) => {
                // Create command with unbalanced parentheses
                const code = `${command} ${varname} = ${expression}`;
                
                const lexer = new StataLexer();
                const lexResult = lexer.tokenize(code);
                const parser = new StataParser();
                const parseResult = parser.parse(lexResult.tokens);
                
                // Should have at least one error
                expect(parseResult.errors.length).toBeGreaterThan(0);
                
                // Should have an UNBALANCED_PARENTHESES error
                const unbalancedError = parseResult.errors.find(
                    error => error.code === ParseErrorCode.UNBALANCED_PARENTHESES
                );
                expect(unbalancedError).toBeDefined();
                expect(unbalancedError?.message).toContain('Unbalanced parentheses');
                
                // Should not have cascading failures (no more than 3 errors total)
                expect(parseResult.errors.length).toBeLessThanOrEqual(3);
            }
        ), { numRuns: 100 });
    });

    /**
     * Test that well-formed expressions don't trigger false positives
     */
    it('should not report errors for well-formed expressions', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            fc.oneof(
                // Simple expressions (no * or / to avoid comment syntax, space instead of \s to exclude newlines)
                fc.stringMatching(/^[a-zA-Z0-9_+ ]+$/),
                // Balanced parentheses
                fc.record({
                    inner: fc.stringMatching(/^[a-zA-Z0-9_+ ]+$/),
                    depth: fc.integer({ min: 1, max: 3 })
                }).map(({ inner, depth }) => '('.repeat(depth) + inner + ')'.repeat(depth)),
                // Function calls
                fc.record({
                    func: fc.constantFrom('max', 'min', 'log', 'exp'),
                    arg: fc.stringMatching(/^[a-zA-Z0-9_]+$/)
                }).map(({ func, arg }) => `${func}(${arg})`)
            ),
            (command, varname, expression) => {
                // Skip empty expressions as they should trigger missing expression error
                fc.pre(expression.trim().length > 0);
                
                const code = `${command} ${varname} = ${expression}`;
                
                const lexer = new StataLexer();
                const lexResult = lexer.tokenize(code);
                const parser = new StataParser();
                const parseResult = parser.parse(lexResult.tokens);
                
                // Should not have MISSING_EXPRESSION_AFTER_EQUALS or UNBALANCED_PARENTHESES errors
                const malformedErrors = parseResult.errors.filter(
                    error => error.code === ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS ||
                             error.code === ParseErrorCode.UNBALANCED_PARENTHESES
                );
                expect(malformedErrors).toHaveLength(0);
            }
        ), { numRuns: 100 });
    });

    /**
     * Test error recovery - parser should continue after malformed expressions
     */
    it('should recover gracefully after malformed expressions', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            arbitrary_variable_name(),
            (command, varname1, varname2) => {
                // Create code with malformed expression followed by valid statement
                const code = `${command} ${varname1} =\n${command} ${varname2} = 1`;
                
                const lexer = new StataLexer();
                const lexResult = lexer.tokenize(code);
                const parser = new StataParser();
                const parseResult = parser.parse(lexResult.tokens);
                
                // Should have parsed both statements despite the error in the first
                expect(parseResult.ast.nodes.length).toBe(2);
                
                // Should have the missing expression error
                const missingExprError = parseResult.errors.find(
                    error => error.code === ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS
                );
                expect(missingExprError).toBeDefined();
                
                // Second statement should be parsed correctly (no additional errors for it)
                const secondStatement = parseResult.ast.nodes[1];
                expect(secondStatement.type).toBe('command');
            }
        ), { numRuns: 50 });
    });
});