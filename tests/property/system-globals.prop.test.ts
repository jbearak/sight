/**
 * System-Defined Global Macros Property Tests
 *
 * Tests that verify the analyzer correctly recognizes Stata system-defined
 * global macros and does NOT flag them as undefined.
 *
 * Feature: stata-system-globals
 * Property 1: System Globals Never Flagged as Undefined
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer, STATA_SYSTEM_GLOBALS } from '../../src/analyzer/index';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('System-Defined Global Macros Property Tests', () => {
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
     * Generator for system global macro names from STATA_SYSTEM_GLOBALS set.
     */
    const arbitrary_system_global = fc.constantFrom(...Array.from(STATA_SYSTEM_GLOBALS));

    /**
     * Property 1: System Globals Never Flagged as Undefined
     *
     * For any Stata code containing a reference to a system-defined global macro
     * (from the STATA_SYSTEM_GLOBALS set), the analyzer shall NOT produce an
     * undefined global macro diagnostic for that reference.
     *
     * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
     * **Validates: Requirements 1.1, 1.2**
     */
    describe('Property 1: System Globals Never Flagged as Undefined', () => {
        /**
         * 1.1: WHEN a system-defined global macro is referenced using $NAME syntax,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag system globals with $ syntax as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        // Use a system global macro with $ syntax
                        const my_document = `display $${my_system_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_system_global)
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.2: WHEN a system-defined global macro is referenced using ${NAME} syntax,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag system globals with ${} syntax as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        // Use a system global macro with ${} syntax
                        const my_document = `display \${${my_system_global}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_system_global)
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.3: WHEN multiple system-defined global macros are referenced in the same document,
         * THE Analyzer SHALL NOT report undefined global macro warnings for any of them.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag multiple system globals in same document', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_system_global, { minLength: 2, maxLength: 5 }),
                    (my_system_globals) => {
                        // Build a document using multiple system globals with $ prefix
                        const my_lines = my_system_globals.map(
                            (my_name) => `display $${my_name}`
                        );
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for any system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_system_globals.some((my_name) =>
                                    my_diag.message.includes(my_name)
                                )
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.4: WHEN a system-defined global macro is used in a string context,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag system globals in string contexts', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        // Use a system global macro inside a string with $ prefix
                        const my_document = `display "Today is $${my_system_global}"`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_system_global)
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.5: WHEN a system-defined global macro is used in a local assignment,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag system globals in local assignments', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,10}$/),
                    (my_system_global, my_local_name) => {
                        // Assign a system global to a local macro with $ prefix
                        const my_document = `local ${my_local_name} $${my_system_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_system_global)
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.6: WHEN a system-defined global macro is used in a conditional expression,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should not flag system globals in conditional expressions', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        // Use a system global in a conditional with $ prefix
                        const my_document = `if "$${my_system_global}" != "" {
    display "System global is set"
}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_system_global)
                        );

                        // Should NOT have any undefined macro errors for system globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 1.7: Verify all system globals in STATA_SYSTEM_GLOBALS are recognized.
         * This is an exhaustive test that checks every system global in the set.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should recognize all system globals in STATA_SYSTEM_GLOBALS set', () => {
            const the_system_globals = Array.from(STATA_SYSTEM_GLOBALS);

            for (const my_system_global of the_system_globals) {
                // Use $ prefix for global macro reference
                const my_document = `display $${my_system_global}`;

                const my_result = analyze_document(my_document);

                // Filter for undefined macro diagnostics for this system global
                const my_undefined_errors = my_result.diagnostics.filter(
                    (my_diag) =>
                        my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                        my_diag.message.includes(my_system_global)
                );

                // Should NOT have any undefined macro errors for system globals
                expect(my_undefined_errors.length).toBe(0);
            }
        });

        /**
         * 1.8: WHEN system globals are mixed with undefined user globals,
         * THE Analyzer SHALL only flag the undefined user globals.
         *
         * Feature: stata-system-globals, Property 1: System Globals Never Flagged as Undefined
         * **Validates: Requirements 1.1, 1.2**
         */
        it('should distinguish system globals from undefined user globals', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    fc.stringMatching(/^[a-zA-Z_][a-zA-Z_]{2,10}$/)
                        .filter((my_name) => !STATA_SYSTEM_GLOBALS.has(my_name)),
                    (my_system_global, my_undefined_global) => {
                        // Document with both system global and undefined user global (with $ prefix)
                        const my_document = `display $${my_system_global}
display $${my_undefined_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 1 error (for the undefined user global)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // The error should be for the undefined user global, not the system global
                        const my_msg = my_undefined_errors[0].message;
                        const has_undefined = my_msg.includes(my_undefined_global);
                        const has_system = my_msg.includes(my_system_global);
                        return has_undefined && !has_system;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Case-Sensitive System Global Matching
     *
     * For any system global macro name, when referenced with incorrect case
     * (e.g., `$s_date` instead of `$S_DATE`), the analyzer SHALL produce an
     * undefined global macro warning.
     *
     * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
     * **Validates: Requirements 1.3**
     */
    describe('Property 2: Case-Sensitive System Global Matching', () => {
        /**
         * Generator for lowercase variants of system global macro names.
         * Converts system globals like 'S_DATE' to 's_date'.
         */
        const arbitrary_lowercase_system_global = fc.constantFrom(
            ...Array.from(STATA_SYSTEM_GLOBALS).map((my_name) => my_name.toLowerCase())
        );

        /**
         * 2.1: WHEN a system-defined global macro is referenced with all lowercase,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
         * **Validates: Requirements 1.3**
         */
        it('should flag lowercase variants of system globals as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_lowercase_system_global,
                    (my_lowercase_global) => {
                        // Use a lowercase variant of a system global macro with $ prefix
                        const my_document = `display $${my_lowercase_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this lowercase global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_lowercase_global)
                        );

                        // SHOULD have undefined macro error for lowercase variant
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 2.2: WHEN a system-defined global macro is referenced with ${} syntax in lowercase,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
         * **Validates: Requirements 1.3**
         */
        it('should flag lowercase variants with ${} syntax as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_lowercase_system_global,
                    (my_lowercase_global) => {
                        // Use a lowercase variant with ${} syntax
                        const my_document = `display \${${my_lowercase_global}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this lowercase global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_lowercase_global)
                        );

                        // SHOULD have undefined macro error for lowercase variant
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 2.3: WHEN comparing correct case vs incorrect case for the same system global,
         * THE Analyzer SHALL only flag the incorrect case variant.
         *
         * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
         * **Validates: Requirements 1.3**
         */
        it('should flag incorrect case but not correct case for same global', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        const my_lowercase_variant = my_system_global.toLowerCase();

                        // Skip if lowercase is same as original (shouldn't happen with S_ prefix)
                        if (my_lowercase_variant === my_system_global) {
                            return true;
                        }

                        // Document with both correct and incorrect case (with $ prefix)
                        const my_document = `display $${my_system_global}
display $${my_lowercase_variant}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 1 error (for the lowercase variant)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // The error should be for the lowercase variant
                        const my_msg = my_undefined_errors[0].message;
                        return my_msg.includes(my_lowercase_variant);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 2.4: WHEN a system-defined global macro is referenced with mixed case,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
         * **Validates: Requirements 1.3**
         */
        it('should flag mixed case variants of system globals as undefined', () => {
            /**
             * Generator for mixed case variants of system global macro names.
             * Creates variants like 's_Date', 'S_date', 's_DATE' from 'S_DATE'.
             */
            const arbitrary_mixed_case_global = fc.tuple(
                arbitrary_system_global,
                fc.integer({ min: 0, max: 2 })
            ).map(([my_name, my_variant]) => {
                // Create different mixed case variants
                switch (my_variant) {
                    case 0:
                        // First char lowercase, rest unchanged: 's_DATE'
                        return my_name.charAt(0).toLowerCase() + my_name.slice(1);
                    case 1:
                        // First char unchanged, rest lowercase: 'S_date'
                        return my_name.charAt(0) + my_name.slice(1).toLowerCase();
                    case 2:
                        // Alternating case: 's_DaTe'
                        return my_name.split('').map((my_char, my_idx) =>
                            my_idx % 2 === 0 ? my_char.toLowerCase() : my_char.toUpperCase()
                        ).join('');
                    default:
                        return my_name.toLowerCase();
                }
            }).filter((my_name) => !STATA_SYSTEM_GLOBALS.has(my_name));

            fc.assert(
                fc.property(
                    arbitrary_mixed_case_global,
                    (my_mixed_case_global) => {
                        // Use a mixed case variant of a system global macro with $ prefix
                        const my_document = `display $${my_mixed_case_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this mixed case global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_mixed_case_global)
                        );

                        // SHOULD have undefined macro error for mixed case variant
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 2.5: Verify all lowercase variants of system globals are flagged.
         * This is an exhaustive test that checks every system global's lowercase variant.
         *
         * Feature: stata-system-globals, Property 2: Case-Sensitive System Global Matching
         * **Validates: Requirements 1.3**
         */
        it('should flag all lowercase variants of system globals', () => {
            const the_system_globals = Array.from(STATA_SYSTEM_GLOBALS);

            for (const my_system_global of the_system_globals) {
                const my_lowercase_variant = my_system_global.toLowerCase();

                // Skip if lowercase is same as original (shouldn't happen)
                if (my_lowercase_variant === my_system_global) {
                    continue;
                }

                // Use $ prefix for global macro reference
                const my_document = `display $${my_lowercase_variant}`;

                const my_result = analyze_document(my_document);

                // Filter for undefined macro diagnostics for this lowercase global
                const my_undefined_errors = my_result.diagnostics.filter(
                    (my_diag) =>
                        my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                        my_diag.message.includes(my_lowercase_variant)
                );

                // SHOULD have undefined macro error for lowercase variant
                expect(my_undefined_errors.length).toBeGreaterThan(0);
            }
        });
    });


    /**
     * Property 3: Non-System Globals Still Flagged
     *
     * For any global macro name that is NOT in the STATA_SYSTEM_GLOBALS set
     * and is not defined in the code, the analyzer SHALL produce an undefined
     * global macro warning.
     *
     * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
     * **Validates: Requirements 2.1, 2.2**
     */
    describe('Property 3: Non-System Globals Still Flagged', () => {
        /**
         * Generator for valid Stata global macro names that are NOT system globals.
         * Generates names like 'MY_VAR', 'custom_macro', 'X123', etc.
         * Filters out any names that happen to be in STATA_SYSTEM_GLOBALS.
         */
        const arbitrary_non_system_global = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{1,15}$/)
            .filter((my_name) => !STATA_SYSTEM_GLOBALS.has(my_name));

        /**
         * Generator for global macro names that look similar to system globals
         * but are NOT in the STATA_SYSTEM_GLOBALS set.
         * Examples: 'S_CUSTOM', 'S_MYVAR', 'S_TEST123'
         */
        const arbitrary_similar_to_system_global = fc.stringMatching(/^S_[A-Z][A-Z0-9_]{1,10}$/)
            .filter((my_name) => !STATA_SYSTEM_GLOBALS.has(my_name));

        /**
         * 3.1: WHEN a non-system global macro is referenced using $NAME syntax,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag non-system globals with $ syntax as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_system_global,
                    (my_non_system_global) => {
                        // Use a non-system global macro with $ syntax
                        const my_document = `display $${my_non_system_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this non-system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_non_system_global)
                        );

                        // SHOULD have undefined macro error for non-system globals
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.2: WHEN a non-system global macro is referenced using ${NAME} syntax,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag non-system globals with ${} syntax as undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_system_global,
                    (my_non_system_global) => {
                        // Use a non-system global macro with ${} syntax
                        const my_document = `display \${${my_non_system_global}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this non-system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_non_system_global)
                        );

                        // SHOULD have undefined macro error for non-system globals
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.3: WHEN a global macro with S_ prefix but NOT in STATA_SYSTEM_GLOBALS is referenced,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * This validates Requirement 2.2: THE Analyzer SHALL NOT treat user-defined macros
         * with similar names as system macros (e.g., $S_CUSTOM should still be flagged if undefined)
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag S_ prefixed globals that are not system globals', () => {
            fc.assert(
                fc.property(
                    arbitrary_similar_to_system_global,
                    (my_similar_global) => {
                        // Use a global that looks like a system global but isn't
                        const my_document = `display $${my_similar_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this similar global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_similar_global)
                        );

                        // SHOULD have undefined macro error for non-system globals
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.4: WHEN multiple non-system global macros are referenced in the same document,
         * THE Analyzer SHALL report undefined global macro warnings for all of them.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag multiple non-system globals in same document', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_non_system_global, { minLength: 2, maxLength: 5 })
                        .map((my_arr) => [...new Set(my_arr)]) // Remove duplicates
                        .filter((my_arr) => my_arr.length >= 2),
                    (my_non_system_globals) => {
                        // Build a document using multiple non-system globals with $ prefix
                        const my_lines = my_non_system_globals.map(
                            (my_name) => `display $${my_name}`
                        );
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have at least one error for each non-system global
                        // (may have more if same global referenced multiple times)
                        return my_undefined_errors.length >= my_non_system_globals.length;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.5: WHEN a non-system global macro is used in a string context,
         * THE Analyzer SHALL report an undefined global macro warning.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag non-system globals in string contexts', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_system_global,
                    (my_non_system_global) => {
                        // Use a non-system global macro inside a string with $ prefix
                        const my_document = `display "Value is $${my_non_system_global}"`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this non-system global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_non_system_global)
                        );

                        // SHOULD have undefined macro error for non-system globals
                        return my_undefined_errors.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.6: WHEN a non-system global is defined before use,
         * THE Analyzer SHALL NOT report an undefined global macro warning.
         *
         * This ensures the analyzer still correctly handles user-defined globals.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should not flag non-system globals that are defined before use', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_system_global,
                    fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/),
                    (my_global_name, my_value) => {
                        // Define the global before using it
                        const my_document = `global ${my_global_name} "${my_value}"
display $${my_global_name}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this global
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.message.includes(my_global_name)
                        );

                        // Should NOT have undefined macro error for defined globals
                        return my_undefined_errors.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 3.7: Specific test for $S_CUSTOM - a common example of a non-system global
         * that looks like a system global but isn't.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should flag $S_CUSTOM as undefined (specific example from requirements)', () => {
            const my_document = `display $S_CUSTOM`;

            const my_result = analyze_document(my_document);

            // Filter for undefined macro diagnostics for S_CUSTOM
            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_CUSTOM')
            );

            // SHOULD have undefined macro error for S_CUSTOM
            expect(my_undefined_errors.length).toBeGreaterThan(0);
        });

        /**
         * 3.8: WHEN a non-system global is mixed with system globals,
         * THE Analyzer SHALL only flag the non-system global.
         *
         * Feature: stata-system-globals, Property 3: Non-System Globals Still Flagged
         * **Validates: Requirements 2.1, 2.2**
         */
        it('should only flag non-system globals when mixed with system globals', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    arbitrary_non_system_global,
                    (my_system_global, my_non_system_global) => {
                        // Document with both system global and non-system global
                        const my_document = `display $${my_system_global}
display $${my_non_system_global}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 1 error (for the non-system global)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // The error should be for the non-system global, not the system global
                        const my_msg = my_undefined_errors[0].message;
                        const has_non_system = my_msg.includes(my_non_system_global);
                        const has_system = my_msg.includes(my_system_global);
                        return has_non_system && !has_system;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: System Global Set Completeness
     *
     * For any macro name in the STATA_SYSTEM_GLOBALS set, the is_system_global
     * function shall return true, and for any macro name NOT in the set, it
     * shall return false.
     *
     * Since is_system_global is a private method that simply checks
     * STATA_SYSTEM_GLOBALS.has(name), we test the set directly.
     *
     * Feature: stata-system-globals, Property 4: System Global Set Completeness
     * **Validates: Requirements 4.1**
     */
    describe('Property 4: System Global Set Completeness', () => {
        /**
         * Generator for system global macro names from STATA_SYSTEM_GLOBALS set.
         */
        const arbitrary_system_global = fc.constantFrom(...Array.from(STATA_SYSTEM_GLOBALS));

        /**
         * Generator for valid Stata macro names that are NOT system globals.
         * Generates names like 'MY_VAR', 'custom_macro', 'X123', etc.
         * Filters out any names that happen to be in STATA_SYSTEM_GLOBALS.
         */
        const arbitrary_non_system_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{1,15}$/)
            .filter((my_name) => !STATA_SYSTEM_GLOBALS.has(my_name));

        /**
         * 4.1: WHEN checking if a name in STATA_SYSTEM_GLOBALS is a system global,
         * THE Set.has() method SHALL return true.
         *
         * This tests that all members of the set are correctly identified.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return true for all members of STATA_SYSTEM_GLOBALS', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        // The set should contain all system globals
                        return STATA_SYSTEM_GLOBALS.has(my_system_global) === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.2: WHEN checking if a name NOT in STATA_SYSTEM_GLOBALS is a system global,
         * THE Set.has() method SHALL return false.
         *
         * This tests that non-members are correctly rejected.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return false for names not in STATA_SYSTEM_GLOBALS', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_system_name,
                    (my_non_system_name) => {
                        // The set should NOT contain non-system globals
                        return STATA_SYSTEM_GLOBALS.has(my_non_system_name) === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.3: WHEN checking lowercase variants of system globals,
         * THE Set.has() method SHALL return false (case-sensitive).
         *
         * This validates that the set lookup is case-sensitive.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return false for lowercase variants of system globals', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    (my_system_global) => {
                        const my_lowercase_variant = my_system_global.toLowerCase();

                        // Skip if lowercase is same as original (shouldn't happen with S_ prefix)
                        if (my_lowercase_variant === my_system_global) {
                            return true;
                        }

                        // The set should NOT contain lowercase variants
                        return STATA_SYSTEM_GLOBALS.has(my_lowercase_variant) === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.4: Exhaustive test that all expected system globals are in the set.
         *
         * This verifies the set contains exactly the expected system globals
         * as specified in Requirements 1.1.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should contain all expected system globals from requirements', () => {
            // Expected system globals from Requirements 1.1
            const the_expected_globals = [
                'S_DATE',      // Current date
                'S_TIME',      // Current time
                'S_FN',        // Current filename
                'S_FNDATE',    // Date/time when current file was last saved
                'S_ADO',       // ado-path
                'S_FLAVOR',    // Stata flavor (Small, IC, SE, MP)
                'S_OS',        // Operating system
                'S_MACH',      // Machine type
                'S_OSDTL',     // OS details
                'S_LEVEL',     // Confidence level
                'S_StataSE',   // Stata SE edition indicator
                'S_StataMP',   // Stata MP edition indicator
                'S_StataIC',   // Stata IC edition indicator
                'S_CONSOLE',   // Console mode indicator
                'S_MODE',      // Stata mode
            ];

            // Verify all expected globals are in the set
            for (const my_expected_global of the_expected_globals) {
                expect(STATA_SYSTEM_GLOBALS.has(my_expected_global)).toBe(true);
            }

            // Verify the set size matches expected count
            expect(STATA_SYSTEM_GLOBALS.size).toBe(the_expected_globals.length);
        });

        /**
         * 4.5: WHEN checking empty string or whitespace-only names,
         * THE Set.has() method SHALL return false.
         *
         * This tests edge cases for invalid macro names.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return false for empty or whitespace-only names', () => {
            // Empty string
            expect(STATA_SYSTEM_GLOBALS.has('')).toBe(false);

            // Whitespace-only strings
            expect(STATA_SYSTEM_GLOBALS.has(' ')).toBe(false);
            expect(STATA_SYSTEM_GLOBALS.has('  ')).toBe(false);
            expect(STATA_SYSTEM_GLOBALS.has('\t')).toBe(false);
            expect(STATA_SYSTEM_GLOBALS.has('\n')).toBe(false);
        });

        /**
         * 4.6: WHEN checking names with special characters,
         * THE Set.has() method SHALL return false.
         *
         * This tests that names with invalid characters are rejected.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return false for names with special characters', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                    fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=', '[', ']', '{', '}', '|', '\\', '/', '?', '<', '>', ',', '.', ':', ';', '"', "'", '`', '~'),
                    (my_base_name, my_special_char) => {
                        // Create names with special characters inserted
                        const my_name_with_special = my_base_name + my_special_char;

                        // The set should NOT contain names with special characters
                        return STATA_SYSTEM_GLOBALS.has(my_name_with_special) === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 4.7: WHEN checking names that are substrings or superstrings of system globals,
         * THE Set.has() method SHALL return false (exact match required).
         *
         * This tests that partial matches are not accepted.
         *
         * Feature: stata-system-globals, Property 4: System Global Set Completeness
         * **Validates: Requirements 4.1**
         */
        it('should return false for substrings and superstrings of system globals', () => {
            fc.assert(
                fc.property(
                    arbitrary_system_global,
                    fc.stringMatching(/^[a-zA-Z0-9_]{1,5}$/),
                    (my_system_global, my_suffix) => {
                        // Substring (remove last character)
                        const my_substring = my_system_global.slice(0, -1);
                        // Superstring (add suffix)
                        const my_superstring = my_system_global + my_suffix;

                        // Neither should be in the set (unless they happen to be another system global)
                        const substring_result = STATA_SYSTEM_GLOBALS.has(my_substring);
                        const superstring_result = STATA_SYSTEM_GLOBALS.has(my_superstring);

                        // Substring should not be a system global (S_DAT is not S_DATE)
                        // Superstring should not be a system global (S_DATE123 is not S_DATE)
                        // Exception: if substring/superstring happens to be another system global
                        const substring_is_valid = !substring_result || STATA_SYSTEM_GLOBALS.has(my_substring);
                        const superstring_is_valid = !superstring_result || STATA_SYSTEM_GLOBALS.has(my_superstring);

                        return substring_is_valid && superstring_is_valid;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
