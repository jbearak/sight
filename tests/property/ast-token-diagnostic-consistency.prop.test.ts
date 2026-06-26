/**
 * AST and Token Diagnostic Consistency Property Tests
 *
 * Feature: global-macro-execution-order, Property 7: AST and Token Diagnostic
 * Consistency
 * Validates: Requirements 2.5
 *
 * For any macro reference that is detected by both AST-based and token-based
 * analysis, the diagnostic message format SHALL be identical.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('AST and Token Diagnostic Consistency Property Tests', () => {
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
     * Generator for valid Stata macro names (identifiers starting with
     * letter/underscore, excluding reserved words)
     */
    const arbitrary_macro_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z_]{2,10}$/)
        .filter(name => !['if', 'in', 'using', 'local', 'global', 'end',
            'program', 'foreach', 'forvalues', 'while', 'else', 'capture',
            'quietly', 'noisily', 'display', 'gen', 'replace', 'drop',
            'keep', 'sort', 'merge', 'append', 'save', 'use', 'clear',
            'set', 'mata', 'python', 'frame', 'tempvar', 'tempfile',
            'tempname', 'scalar', 'matrix', 'return', 'ereturn', 'sreturn',
            'args', 'syntax', 'version', 'preserve', 'restore'
        ].includes(name.toLowerCase()));

    // Expected message formats. The diagnostic code (UNDEFINED_MACRO) classifies
    // the rule; the message states subject + predicate. Local macros keep the
    // `name' sigil, globals keep the $name sigil.
    const LOCAL_MACRO_FORMAT = /^`([^']+)' is not defined$/;
    const GLOBAL_MACRO_FORMAT = /^\$([a-zA-Z_][a-zA-Z0-9_]*) is not defined$/;

    /**
     * Property 7: AST and Token Diagnostic Consistency
     *
     * For any macro reference that is detected by both AST-based and
     * token-based analysis, the diagnostic message format SHALL be identical.
     */
    describe('Property 7: AST and Token Diagnostic Consistency', () => {
        /**
         * 7.1: Local macro diagnostics use consistent format `name'
         */
        it('should use consistent format for undefined local macro messages', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    (my_macro_name) => {
                        // Create code with undefined local macro reference
                        const my_document = `display \`${my_macro_name}'`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly one diagnostic
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Verify message format: "`name' is not defined"
                        const my_message = my_undefined_errors[0].message;
                        const my_expected = `\`${my_macro_name}' is not defined`;

                        return my_message === my_expected;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.2: Global macro diagnostics use consistent format $name
         */
        it('should use consistent format for undefined global macro messages', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    (my_macro_name) => {
                        // Create code with undefined global macro reference
                        // Using ${name} format to ensure it's parsed as global
                        const my_document = `display \${${my_macro_name}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly one diagnostic
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Verify message format: "$name is not defined"
                        const my_message = my_undefined_errors[0].message;
                        const my_expected = `$${my_macro_name} is not defined`;

                        return my_message === my_expected;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.3: Multiple local macro references produce consistent messages
         */
        it('should produce consistent messages for multiple local macro refs', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_macro_name, { minLength: 2, maxLength: 5 })
                        .filter(arr => new Set(arr).size === arr.length),
                    (my_macro_names) => {
                        // Create code with multiple undefined local macro refs
                        const my_lines = my_macro_names.map(
                            (my_name) => `display \`${my_name}'`
                        );
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have one diagnostic per macro
                        if (my_undefined_errors.length !== my_macro_names.length) {
                            return false;
                        }

                        // All messages should match the local macro format
                        for (const my_diag of my_undefined_errors) {
                            if (!LOCAL_MACRO_FORMAT.test(my_diag.message)) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.4: Multiple global macro references produce consistent messages
         */
        it('should produce consistent messages for multiple global macro refs', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_macro_name, { minLength: 2, maxLength: 5 })
                        .filter(arr => new Set(arr).size === arr.length),
                    (my_macro_names) => {
                        // Create code with multiple undefined global macro refs
                        const my_lines = my_macro_names.map(
                            (my_name) => `display \${${my_name}}`
                        );
                        const my_document = my_lines.join('\n');

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have one diagnostic per macro
                        if (my_undefined_errors.length !== my_macro_names.length) {
                            return false;
                        }

                        // All messages should match the global macro format
                        for (const my_diag of my_undefined_errors) {
                            if (!GLOBAL_MACRO_FORMAT.test(my_diag.message)) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.5: Mixed local and global macro references maintain distinct formats
         */
        it('should maintain distinct formats for local vs global macros', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    arbitrary_macro_name,
                    (my_local_name, my_global_name) => {
                        // Skip if names are the same
                        if (my_local_name === my_global_name) {
                            return true;
                        }

                        // Create code with both local and global undefined refs
                        const my_document = `display \`${my_local_name}'
display \${${my_global_name}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly 2 diagnostics
                        if (my_undefined_errors.length !== 2) {
                            return false;
                        }

                        // Find local and global diagnostics by their sigils:
                        // local macros render `name', globals render $name.
                        const my_local_diag = my_undefined_errors.find(
                            (my_d) => LOCAL_MACRO_FORMAT.test(my_d.message)
                        );
                        const my_global_diag = my_undefined_errors.find(
                            (my_d) => GLOBAL_MACRO_FORMAT.test(my_d.message)
                        );

                        if (!my_local_diag || !my_global_diag) {
                            return false;
                        }

                        // Verify formats are distinct and correct
                        const my_local_valid = LOCAL_MACRO_FORMAT.test(
                            my_local_diag.message
                        );
                        const my_global_valid = GLOBAL_MACRO_FORMAT.test(
                            my_global_diag.message
                        );

                        return my_local_valid && my_global_valid;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.6: Token-based and AST-based paths produce identical messages
         * for the same macro reference
         */
        it('should produce identical messages from token and AST paths', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    fc.integer({ min: 1, max: 5 }),
                    (my_macro_name, my_line_count) => {
                        // Create code where macro appears in different contexts
                        // Some will be caught by AST, some by token path
                        const the_lines: string[] = [];

                        for (let i = 0; i < my_line_count; i++) {
                            // Alternate between contexts that may use different
                            // detection paths
                            if (i % 2 === 0) {
                                the_lines.push(`display \`${my_macro_name}'`);
                            } else {
                                the_lines.push(`local x = \`${my_macro_name}'`);
                            }
                        }

                        const my_document = the_lines.join('\n');
                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics for this macro
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.symbol_name === my_macro_name
                        );

                        // All messages for the same macro should be identical
                        if (my_undefined_errors.length === 0) {
                            return true; // No diagnostics to compare
                        }

                        const my_first_message = my_undefined_errors[0].message;
                        for (const my_diag of my_undefined_errors) {
                            if (my_diag.message !== my_first_message) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.7: Diagnostic messages contain the exact macro name
         */
        it('should include exact macro name in diagnostic message', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    fc.boolean(),
                    (my_macro_name, my_is_local) => {
                        // Create code with undefined macro reference
                        const my_document = my_is_local
                            ? `display \`${my_macro_name}'`
                            : `display \${${my_macro_name}}`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                        );

                        // Should have exactly one diagnostic
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Message should contain the exact macro name
                        const my_message = my_undefined_errors[0].message;
                        return my_message.includes(my_macro_name);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.8: Forward reference diagnostics use same format as undefined
         */
        it('should use same format for forward reference diagnostics', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    (my_macro_name) => {
                        // Create code with forward reference (use before define)
                        const my_document = `display \`${my_macro_name}'
local ${my_macro_name} "value"`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.symbol_name === my_macro_name
                        );

                        // Should have exactly one diagnostic (forward reference)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Verify message format matches standard local format
                        const my_message = my_undefined_errors[0].message;
                        return LOCAL_MACRO_FORMAT.test(my_message);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * 7.9: Global forward reference diagnostics use same format
         */
        it('should use same format for global forward reference diagnostics', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name,
                    (my_macro_name) => {
                        // Create code with global forward reference
                        const my_document = `display \${${my_macro_name}}
global ${my_macro_name} "value"`;

                        const my_result = analyze_document(my_document);

                        // Filter for undefined macro diagnostics
                        const my_undefined_errors = my_result.diagnostics.filter(
                            (my_diag) =>
                                my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                                my_diag.symbol_name === my_macro_name
                        );

                        // Should have exactly one diagnostic (forward reference)
                        if (my_undefined_errors.length !== 1) {
                            return false;
                        }

                        // Verify message format matches standard global format
                        const my_message = my_undefined_errors[0].message;
                        return GLOBAL_MACRO_FORMAT.test(my_message);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
