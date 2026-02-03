/**
 * Unit Tests for Stata System-Defined Global Macros
 *
 * Tests that verify the analyzer correctly recognizes each Stata system-defined
 * global macro and does NOT flag them as undefined.
 *
 * Feature: stata-system-globals
 * Task: 5.1 Write unit tests for all system globals
 * Requirements: 1.1
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SemanticAnalyzer, STATA_SYSTEM_GLOBALS } from '../../../src/analyzer/index';
import { StataLexer } from '../../../src/lexer';
import { StataParser } from '../../../src/parser';
import { StataDiagnosticCode } from '../../../src/types';

describe('System-Defined Global Macros Unit Tests', () => {
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
     * Helper function to check if a system global produces no undefined macro warning.
     */
    function verify_no_undefined_warning(my_system_global: string) {
        const my_document = `display $${my_system_global}`;
        const my_result = analyze_document(my_document);

        const my_undefined_errors = my_result.diagnostics.filter(
            (my_diag) =>
                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                my_diag.message.includes(my_system_global)
        );

        expect(my_undefined_errors.length).toBe(0);
    }

    describe('Date and Time System Globals', () => {
        /**
         * S_DATE - Current date (format: "dd Mon yyyy")
         * Validates: Requirement 1.1
         */
        it('should not flag $S_DATE as undefined', () => {
            verify_no_undefined_warning('S_DATE');
        });

        /**
         * S_TIME - Current time (format: "hh:mm:ss")
         * Validates: Requirement 1.1
         */
        it('should not flag $S_TIME as undefined', () => {
            verify_no_undefined_warning('S_TIME');
        });
    });

    describe('File Information System Globals', () => {
        /**
         * S_FN - Current filename (name of file in memory)
         * Validates: Requirement 1.1
         */
        it('should not flag $S_FN as undefined', () => {
            verify_no_undefined_warning('S_FN');
        });

        /**
         * S_FNDATE - Date/time when current file was last saved
         * Validates: Requirement 1.1
         */
        it('should not flag $S_FNDATE as undefined', () => {
            verify_no_undefined_warning('S_FNDATE');
        });
    });

    describe('System Information System Globals', () => {
        /**
         * S_ADO - ado-path
         * Validates: Requirement 1.1
         */
        it('should not flag $S_ADO as undefined', () => {
            verify_no_undefined_warning('S_ADO');
        });

        /**
         * S_FLAVOR - Stata flavor (Small, IC, SE, MP)
         * Validates: Requirement 1.1
         */
        it('should not flag $S_FLAVOR as undefined', () => {
            verify_no_undefined_warning('S_FLAVOR');
        });

        /**
         * S_OS - Operating system
         * Validates: Requirement 1.1
         */
        it('should not flag $S_OS as undefined', () => {
            verify_no_undefined_warning('S_OS');
        });

        /**
         * S_MACH - Machine type
         * Validates: Requirement 1.1
         */
        it('should not flag $S_MACH as undefined', () => {
            verify_no_undefined_warning('S_MACH');
        });

        /**
         * S_OSDTL - OS details
         * Validates: Requirement 1.1
         */
        it('should not flag $S_OSDTL as undefined', () => {
            verify_no_undefined_warning('S_OSDTL');
        });

        /**
         * S_LEVEL - Confidence level (default 95)
         * Validates: Requirement 1.1
         */
        it('should not flag $S_LEVEL as undefined', () => {
            verify_no_undefined_warning('S_LEVEL');
        });
    });

    describe('Edition Indicator System Globals', () => {
        /**
         * S_StataSE - Stata SE edition indicator
         * Validates: Requirement 1.1
         */
        it('should not flag $S_StataSE as undefined', () => {
            verify_no_undefined_warning('S_StataSE');
        });

        /**
         * S_StataMP - Stata MP edition indicator
         * Validates: Requirement 1.1
         */
        it('should not flag $S_StataMP as undefined', () => {
            verify_no_undefined_warning('S_StataMP');
        });

        /**
         * S_StataIC - Stata IC edition indicator
         * Validates: Requirement 1.1
         */
        it('should not flag $S_StataIC as undefined', () => {
            verify_no_undefined_warning('S_StataIC');
        });
    });

    describe('Mode Indicator System Globals', () => {
        /**
         * S_CONSOLE - Console mode indicator
         * Validates: Requirement 1.1
         */
        it('should not flag $S_CONSOLE as undefined', () => {
            verify_no_undefined_warning('S_CONSOLE');
        });

        /**
         * S_MODE - Stata mode
         * Validates: Requirement 1.1
         */
        it('should not flag $S_MODE as undefined', () => {
            verify_no_undefined_warning('S_MODE');
        });
    });

    describe('STATA_SYSTEM_GLOBALS Set Verification', () => {
        /**
         * Verify the STATA_SYSTEM_GLOBALS set contains exactly 15 system globals.
         * Validates: Requirement 1.1
         */
        it('should contain exactly 15 system globals', () => {
            expect(STATA_SYSTEM_GLOBALS.size).toBe(15);
        });

        /**
         * Verify all expected system globals are in the set.
         * Validates: Requirement 1.1
         */
        it('should contain all expected system globals', () => {
            const the_expected_globals = [
                // Date and time
                'S_DATE',
                'S_TIME',
                // File information
                'S_FN',
                'S_FNDATE',
                // System information
                'S_ADO',
                'S_FLAVOR',
                'S_OS',
                'S_MACH',
                'S_OSDTL',
                'S_LEVEL',
                // Edition indicators
                'S_StataSE',
                'S_StataMP',
                'S_StataIC',
                // Mode indicators
                'S_CONSOLE',
                'S_MODE',
            ];

            // Verify count matches
            expect(the_expected_globals.length).toBe(15);

            for (const my_expected_global of the_expected_globals) {
                expect(STATA_SYSTEM_GLOBALS.has(my_expected_global)).toBe(true);
            }
        });

        /**
         * Verify the STATA_SYSTEM_GLOBALS set is exported and accessible.
         * Validates: Requirement 4.2
         */
        it('should export STATA_SYSTEM_GLOBALS for use by other components', () => {
            expect(STATA_SYSTEM_GLOBALS).toBeDefined();
            expect(STATA_SYSTEM_GLOBALS instanceof Set).toBe(true);
        });
    });

    describe('System Globals with ${} Syntax', () => {
        /**
         * Verify system globals work with braced syntax ${NAME}.
         * Validates: Requirement 1.1, 1.2
         */
        it('should not flag system globals with ${} syntax as undefined', () => {
            const the_system_globals = Array.from(STATA_SYSTEM_GLOBALS);

            for (const my_system_global of the_system_globals) {
                const my_document = `display \${${my_system_global}}`;
                const my_result = analyze_document(my_document);

                const my_undefined_errors = my_result.diagnostics.filter(
                    (my_diag) =>
                        my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                        my_diag.message.includes(my_system_global)
                );

                expect(my_undefined_errors.length).toBe(0);
            }
        });
    });

    describe('System Globals in Different Contexts', () => {
        /**
         * Verify system globals work in string contexts.
         * Validates: Requirement 1.1, 1.2
         */
        it('should not flag system globals in string contexts', () => {
            const my_document = `display "Today is $S_DATE at $S_TIME"`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') || my_diag.message.includes('S_TIME'))
            );

            expect(my_undefined_errors.length).toBe(0);
        });

        /**
         * Verify system globals work in local macro assignments.
         * Validates: Requirement 1.1, 1.2
         */
        it('should not flag system globals in local assignments', () => {
            const my_document = `local today $S_DATE`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_DATE')
            );

            expect(my_undefined_errors.length).toBe(0);
        });

        /**
         * Verify system globals work in conditional expressions.
         * Validates: Requirement 1.1, 1.2
         */
        it('should not flag system globals in conditional expressions', () => {
            const my_document = `if "$S_OS" == "Windows" {
    display "Running on Windows"
}`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_OS')
            );

            expect(my_undefined_errors.length).toBe(0);
        });

        /**
         * Verify multiple system globals in the same document.
         * Validates: Requirement 1.1, 1.2
         */
        it('should not flag multiple system globals in same document', () => {
            const my_document = `display $S_DATE
display $S_TIME
display $S_OS
display $S_FLAVOR
display $S_LEVEL`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') ||
                     my_diag.message.includes('S_TIME') ||
                     my_diag.message.includes('S_OS') ||
                     my_diag.message.includes('S_FLAVOR') ||
                     my_diag.message.includes('S_LEVEL'))
            );

            expect(my_undefined_errors.length).toBe(0);
        });
    });
});


describe('Edge Cases for System-Defined Global Macros', () => {
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
     * Task: 5.2 Write unit tests for edge cases
     * Requirements: 1.3, 2.2
     */

    describe('Case Sensitivity (Requirement 1.3)', () => {
        /**
         * Lowercase variants of system globals should be flagged as undefined.
         * Stata is case-sensitive, so $s_date is NOT the same as $S_DATE.
         * Validates: Requirement 1.3
         */
        it('should flag lowercase $s_date as undefined', () => {
            const my_document = `display $s_date`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('s_date')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * Lowercase $s_time should be flagged as undefined.
         * Validates: Requirement 1.3
         */
        it('should flag lowercase $s_time as undefined', () => {
            const my_document = `display $s_time`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('s_time')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * Lowercase $s_os should be flagged as undefined.
         * Validates: Requirement 1.3
         */
        it('should flag lowercase $s_os as undefined', () => {
            const my_document = `display $s_os`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('s_os')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * Mixed case variants should be flagged as undefined.
         * Validates: Requirement 1.3
         */
        it('should flag mixed case $S_date as undefined', () => {
            const my_document = `display $S_date`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_date')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * All lowercase variants of system globals should be flagged.
         * Validates: Requirement 1.3
         */
        it('should flag all lowercase variants of system globals', () => {
            const the_lowercase_variants = [
                's_date',
                's_time',
                's_fn',
                's_fndate',
                's_ado',
                's_flavor',
                's_os',
                's_mach',
                's_osdtl',
                's_level',
                's_statase',
                's_statamp',
                's_stataic',
                's_console',
                's_mode',
            ];

            for (const my_lowercase_variant of the_lowercase_variants) {
                const my_document = `display $${my_lowercase_variant}`;
                const my_result = analyze_document(my_document);

                const my_undefined_errors = my_result.diagnostics.filter(
                    (my_diag) =>
                        my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                        my_diag.message.includes(my_lowercase_variant)
                );

                expect(my_undefined_errors.length).toBe(1);
            }
        });
    });

    describe('Similar Names Not in Set (Requirement 2.2)', () => {
        /**
         * $S_CUSTOM should be flagged as undefined (not a system global).
         * Validates: Requirement 2.2
         */
        it('should flag $S_CUSTOM as undefined', () => {
            const my_document = `display $S_CUSTOM`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_CUSTOM')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * $S_MYVAR should be flagged as undefined (not a system global).
         * Validates: Requirement 2.2
         */
        it('should flag $S_MYVAR as undefined', () => {
            const my_document = `display $S_MYVAR`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_MYVAR')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * $S_DATE2 should be flagged as undefined (similar but not exact match).
         * Validates: Requirement 2.2
         */
        it('should flag $S_DATE2 as undefined', () => {
            const my_document = `display $S_DATE2`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_DATE2')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * $S_DATETIME should be flagged as undefined (similar but not exact match).
         * Validates: Requirement 2.2
         */
        it('should flag $S_DATETIME as undefined', () => {
            const my_document = `display $S_DATETIME`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_DATETIME')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * $S_ prefix alone should be flagged as undefined.
         * Validates: Requirement 2.2
         */
        it('should flag $S_UNKNOWN as undefined', () => {
            const my_document = `display $S_UNKNOWN`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_UNKNOWN')
            );

            expect(my_undefined_errors.length).toBe(1);
        });
    });

    describe('Integration with User-Defined Globals', () => {
        /**
         * User-defined globals should still work normally alongside system globals.
         * Validates: Requirement 2.1
         */
        it('should not flag user-defined globals when defined', () => {
            const my_document = `global myvar "hello"
display $myvar`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('myvar')
            );

            expect(my_undefined_errors.length).toBe(0);
        });

        /**
         * User-defined globals should be flagged when NOT defined.
         * Validates: Requirement 2.1
         */
        it('should flag user-defined globals when not defined', () => {
            const my_document = `display $undefined_global`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('undefined_global')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * User-defined global with S_ prefix should be flagged if not defined.
         * Validates: Requirement 2.1, 2.2
         */
        it('should flag user-defined global with S_ prefix when not defined', () => {
            const my_document = `display $S_USER_DEFINED`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_USER_DEFINED')
            );

            expect(my_undefined_errors.length).toBe(1);
        });

        /**
         * User-defined global with S_ prefix should NOT be flagged if defined.
         * Validates: Requirement 2.1
         */
        it('should not flag user-defined global with S_ prefix when defined', () => {
            const my_document = `global S_USER_DEFINED "custom value"
display $S_USER_DEFINED`;
            const my_result = analyze_document(my_document);

            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_USER_DEFINED')
            );

            expect(my_undefined_errors.length).toBe(0);
        });
    });

    describe('Mixed Usage: System Globals and User-Defined Globals', () => {
        /**
         * System globals and user-defined globals should work together.
         * Validates: Requirement 1.2, 2.1
         */
        it('should handle system globals and user-defined globals in same document', () => {
            const my_document = `global myvar "hello"
display $S_DATE
display $myvar
display $S_TIME`;
            const my_result = analyze_document(my_document);

            // No undefined errors for system globals or defined user globals
            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') ||
                     my_diag.message.includes('myvar') ||
                     my_diag.message.includes('S_TIME'))
            );

            expect(my_undefined_errors.length).toBe(0);
        });

        /**
         * Should flag undefined user globals while allowing system globals.
         * Validates: Requirement 1.2, 2.1
         */
        it('should flag undefined user globals while allowing system globals', () => {
            const my_document = `display $S_DATE
display $undefined_user_global
display $S_TIME`;
            const my_result = analyze_document(my_document);

            // System globals should not be flagged
            const my_system_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') || my_diag.message.includes('S_TIME'))
            );
            expect(my_system_errors.length).toBe(0);

            // Undefined user global should be flagged
            const my_user_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('undefined_user_global')
            );
            expect(my_user_errors.length).toBe(1);
        });

        /**
         * Should handle complex mixed usage with multiple globals.
         * Validates: Requirement 1.2, 2.1, 2.2
         */
        it('should handle complex mixed usage with multiple globals', () => {
            const my_document = `global user_global1 "value1"
global user_global2 "value2"
display "Date: $S_DATE, Time: $S_TIME"
display "User1: $user_global1, User2: $user_global2"
display "OS: $S_OS, Flavor: $S_FLAVOR"
display "Undefined: $undefined_global"
display "Similar: $S_CUSTOM"`;
            const my_result = analyze_document(my_document);

            // System globals should not be flagged
            const my_system_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') ||
                     my_diag.message.includes('S_TIME') ||
                     my_diag.message.includes('S_OS') ||
                     my_diag.message.includes('S_FLAVOR'))
            );
            expect(my_system_errors.length).toBe(0);

            // Defined user globals should not be flagged
            const my_defined_user_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('user_global1') ||
                     my_diag.message.includes('user_global2'))
            );
            expect(my_defined_user_errors.length).toBe(0);

            // Undefined user global should be flagged
            const my_undefined_user_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('undefined_global')
            );
            expect(my_undefined_user_errors.length).toBe(1);

            // Similar-looking non-system global should be flagged
            const my_similar_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('S_CUSTOM')
            );
            expect(my_similar_errors.length).toBe(1);
        });

        /**
         * Should handle system globals in expressions with user globals.
         * Validates: Requirement 1.2, 2.1
         */
        it('should handle system globals in expressions with user globals', () => {
            const my_document = `global prefix "Report"
local title "$prefix - $S_DATE"
display "\`title'"`;
            const my_result = analyze_document(my_document);

            // No undefined errors for system globals or defined user globals
            const my_undefined_errors = my_result.diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('S_DATE') || my_diag.message.includes('prefix'))
            );

            expect(my_undefined_errors.length).toBe(0);
        });
    });
});
