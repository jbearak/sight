/**
 * Genuine Undefined Macro Detection Property Tests
 *
 * Tests that verify the analyzer correctly identifies genuinely undefined macros
 * while not suppressing all undefined macro warnings (only false positives).
 *
 * Feature: diagnostic-false-positives
 * Property 4: Genuine Undefined Macro Detection
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Genuine Undefined Macro Detection Property Tests', () => {
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
     * Generator for valid Stata macro names (identifiers starting with letter/underscore)
     */
    const arbitrary_macro_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,15}$/);

    /**
     * Generator for macro names that are NOT positional arguments (not purely numeric)
     */
    const arbitrary_non_positional_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z_]{2,10}$/);

    /**
     * Property 4: Genuine Undefined Macro Detection
     *
     * For any local macro reference where the macro is never defined in any code path,
     * the diagnostic provider SHOULD emit "Undefined local macro" warning.
     *
     * Feature: diagnostic-false-positives, Property 4: Genuine Undefined Macro Detection
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    describe('Property 4: Genuine Undefined Macro Detection', () => {
        /**
         * 4.1: WHEN a macro is referenced but never defined in any reachable code path,
         * THE Diagnostic_Provider SHALL report "Undefined local macro"
         */
        it('should report undefined local macro when macro is never defined', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_macro_name) => {
                        // Use a macro that is NOT defined anywhere
                        const my_document = `display \`${my_macro_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_macro_name)
                        );

                        // SHOULD have an "Undefined local macro" error
                        return my_undefined_errors.length === 1;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.1b: Multiple undefined macros should each be reported
         */
        it('should report each undefined macro separately', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_non_positional_name, { minLength: 2, maxLength: 5 })
                        .filter(arr => new Set(arr).size === arr.length), // unique names
                    (my_macro_names) => {
                        // Use multiple undefined macros
                        const my_lines = my_macro_names.map(
                            (my_name) => `display \`${my_name}'`
                        );
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have one error per undefined macro
                        return my_undefined_errors.length === my_macro_names.length;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.3: THE Diagnostic_Provider SHALL NOT suppress all undefined macro warnings;
         * only false positives should be eliminated
         *
         * This test ensures that defined macros don't trigger warnings while
         * undefined ones still do.
         */
        it('should report undefined macros but not defined ones', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    arbitrary_non_positional_name,
                    (my_defined_name, my_undefined_name) => {
                        // Skip if names are the same
                        if (my_defined_name === my_undefined_name) {
                            return true;
                        }

                        // Define one macro, use both
                        const my_document = `local ${my_defined_name} "value"
display \`${my_defined_name}'
display \`${my_undefined_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 1 error (for the undefined macro only)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // The error should be for the undefined macro, not the defined one
                        // Message format is: "Undefined local macro: `name'"
                        const my_msg = my_undefined_errors[0].message;
                        const has_undefined = my_msg.includes(`\`${my_undefined_name}'`);
                        const has_defined = my_msg.includes(`\`${my_defined_name}'`);
                        return has_undefined && !has_defined;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure undefined global macros are also detected
         */
        it('should report undefined global macros', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_macro_name) => {
                        // Use a global macro that is NOT defined
                        const my_document = `display $${my_macro_name}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_macro_name)
                        );

                        // SHOULD have an "Undefined global macro" error
                        return my_undefined_errors.length === 1;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure defined global macros don't trigger warnings
         */
        it('should not report defined global macros', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_macro_name) => {
                        // Define and use a global macro
                        const my_document = `global ${my_macro_name} "value"
display $${my_macro_name}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this macro
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_macro_name)
                        );

                        // Should NOT have any undefined macro errors for defined macro
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure macros defined in loops are recognized
         */
        it('should recognize macros defined in foreach loops', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_loop_var) => {
                        // Loop variable should be recognized as defined
                        const my_document = `foreach ${my_loop_var} in a b c {
    display \`${my_loop_var}'
}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for the loop var
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_loop_var)
                        );

                        // Should NOT have undefined macro error for loop variable
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure macros defined in forvalues loops are recognized
         */
        it('should recognize macros defined in forvalues loops', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_loop_var) => {
                        // Loop variable should be recognized as defined
                        const my_document = `forvalues ${my_loop_var} = 1/10 {
    display \`${my_loop_var}'
}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for the loop var
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_loop_var)
                        );

                        // Should NOT have undefined macro error for loop variable
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure macros defined inside if blocks are recognized
         */
        it('should recognize macros defined inside if blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_macro_name) => {
                        // Macro defined inside if block should be recognized
                        const my_document = `if 1 {
    local ${my_macro_name} "value"
}
display \`${my_macro_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this macro
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_macro_name)
                        );

                        // Should NOT have undefined macro error (macro is defined in if block)
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure positional arguments are NOT flagged (regression test)
         * This confirms we don't over-suppress warnings
         */
        it('should not flag positional arguments while still flagging undefined macros', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 9 }),
                    arbitrary_non_positional_name,
                    (my_positional_num, my_undefined_name) => {
                        // Mix positional argument with undefined macro
                        const my_document = `display \`${my_positional_num}'
display \`${my_undefined_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 1 error (for undefined macro, not positional)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Error should be for the undefined macro
                        return my_undefined_errors[0].message.includes(my_undefined_name);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure macros used multiple times only generate one warning per reference
         */
        it('should report each undefined macro reference', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    fc.integer({ min: 2, max: 5 }),
                    (my_macro_name, my_count) => {
                        // Use the same undefined macro multiple times
                        const my_lines = Array(my_count).fill(`display \`${my_macro_name}'`);
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this macro
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_macro_name)
                        );

                        // Should have one error per reference (not suppressed)
                        return my_undefined_errors.length === my_count;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Ensure tempvar macros are recognized as defined
         */
        it('should recognize tempvar macros as defined', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_positional_name,
                    (my_tempvar_name) => {
                        // tempvar creates a local macro
                        const my_document = `tempvar ${my_tempvar_name}
display \`${my_tempvar_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this macro
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_tempvar_name)
                        );

                        // Should NOT have undefined macro error (tempvar defines the macro)
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
