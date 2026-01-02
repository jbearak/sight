import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

/**
 * Property tests for positional argument recognition.
 * 
 * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
 * Validates: Requirements 3.1, 3.2, 3.3
 * 
 * These tests verify that the analyzer does NOT emit false positive
 * "Undefined local macro" warnings for positional arguments (`1', `2', etc.)
 */
describe('Positional Argument Recognition Property Tests', () => {
    let analyzer: SemanticAnalyzer;
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        analyzer = new SemanticAnalyzer();
        lexer = new StataLexer();
        parser = new StataParser();
    });

    /**
     * Helper function to analyze a document and return diagnostics.
     */
    function analyze_document(my_source: string) {
        const my_lex_result = lexer.tokenize(my_source);
        const my_parse_result = parser.parse(my_lex_result.tokens);
        return analyzer.analyze(
            my_parse_result.ast,
            'file:///test.do',
            undefined,
            { undefined_macro_enabled: true },
            my_lex_result.tokens
        );
    }

    /**
     * Property 3: Positional Argument Recognition
     * 
     * For any macro reference `N' where N is a non-negative integer,
     * the diagnostic provider should NOT emit "Undefined local macro" warnings.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should not flag single-digit positional arguments as undefined', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 9 }),
                (my_arg_num) => {
                    const my_document = `display \`${my_arg_num}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );

                    // Should NOT have any "Undefined local macro" errors for positional args
                    expect(my_undefined_macro_errors.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3b: Multi-digit Positional Arguments
     * 
     * For any macro reference `N' where N is a multi-digit non-negative integer,
     * the diagnostic provider should NOT emit "Undefined local macro" warnings.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2
     */
    it('should not flag multi-digit positional arguments as undefined', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 10, max: 999 }),
                (my_arg_num) => {
                    const my_document = `display \`${my_arg_num}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );

                    // Should NOT have any "Undefined local macro" errors for positional args
                    expect(my_undefined_macro_errors.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3c: Positional Arguments in Local Assignments
     * 
     * For any local assignment using positional arguments (e.g., local name `1'),
     * the diagnostic provider should NOT emit "Undefined local macro" warnings.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.3
     */
    it('should not flag positional arguments in local assignments', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 9 }),
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                (my_arg_num, my_var_name) => {
                    const my_document = `local ${my_var_name} \`${my_arg_num}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics mentioning the positional arg
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_diag.message.includes(`${my_arg_num}`)
                    );

                    // Should NOT have any "Undefined local macro" errors for positional args
                    expect(my_undefined_macro_errors.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3d: Multiple Positional Arguments in Same Document
     * 
     * For any document with multiple positional argument references,
     * none should be flagged as undefined.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2
     */
    it('should not flag multiple positional arguments in same document', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 5 }),
                (my_arg_nums) => {
                    // Build a document using multiple positional arguments
                    const my_lines = my_arg_nums.map(
                        (my_num) => `display \`${my_num}'`
                    );
                    const my_document = my_lines.join('\n');

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );

                    // Should NOT have any "Undefined local macro" errors for positional args
                    expect(my_undefined_macro_errors.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3e: Positional Argument Zero (Script Name)
     * 
     * The special positional argument `0' (script name) should also be recognized.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2
     */
    it('should not flag positional argument zero as undefined', () => {
        const my_document = `display \`0'`;

        const my_result = analyze_document(my_document);

        // Filter for undefined macro diagnostics
        const my_undefined_macro_errors = my_result.diagnostics.filter(
            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
        );

        // Should NOT have any "Undefined local macro" errors for `0'
        expect(my_undefined_macro_errors.length).toBe(0);
    });

    /**
     * Property 3f: Genuine Undefined Macros Still Detected
     * 
     * Ensure that genuinely undefined macros (non-numeric names) are still
     * correctly flagged as undefined.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2, 3.3 (ensuring we don't over-suppress)
     */
    it('should still flag genuinely undefined macros', () => {
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,10}$/),
                (my_macro_name) => {
                    // Use a macro that is NOT defined
                    const my_document = `display \`${my_macro_name}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_diag.message.includes(my_macro_name)
                    );

                    // SHOULD have an "Undefined local macro" error for non-positional args
                    expect(my_undefined_macro_errors.length).toBe(1);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3g: Mixed Positional and Regular Macros
     * 
     * In a document with both positional arguments and regular macros,
     * only the undefined regular macros should be flagged.
     * 
     * Feature: diagnostic-false-positives, Property 3: Positional Argument Recognition
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should correctly distinguish positional args from undefined macros', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 9 }),
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z_]{2,10}$/),  // No digits to avoid confusion
                (my_arg_num, my_undefined_macro) => {
                    // Document with both positional arg and undefined macro
                    const my_document = `display \`${my_arg_num}'
display \`${my_undefined_macro}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );

                    // Should have exactly 1 error (for the undefined macro, not the positional arg)
                    expect(my_undefined_macro_errors.length).toBe(1);
                    expect(my_undefined_macro_errors[0].message).toContain(my_undefined_macro);
                }
            ),
            { numRuns: 100 }
        );
    });
});
