import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

/**
 * Property-based tests for args command macro scope.
 * 
 * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
 * Validates: Requirements 2.1, 2.2, 2.3
 * 
 * These tests verify that the analyzer does NOT emit false positive
 * "Undefined local macro" warnings for macros defined by the `args` command,
 * regardless of whether the reference appears before or after the `args` command.
 */
describe('Args Command Macro Scope Property Tests', () => {
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
     * Generator for valid Stata macro names.
     * Macro names must start with a letter or underscore, followed by
     * letters, digits, or underscores.
     */
    const macro_name_gen = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/);

    /**
     * Property 4a: Args-defined macros are registered in symbol table
     * 
     * For any `args` command with 1-5 macro names, all specified names
     * SHALL be registered as local macros in the symbol table.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.1
     */
    it('should register all args-defined macros in symbol table', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 5 }),
                (my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    const my_document = `args ${my_unique_names.join(' ')}`;
                    const my_result = analyze_document(my_document);

                    // All args-defined macros should be in the symbol table
                    for (const my_name of my_unique_names) {
                        const my_symbol = my_result.symbols.localMacros.get(my_name);
                        expect(my_symbol).toBeDefined();
                        expect(my_symbol?.name).toBe(my_name);
                        expect(my_symbol?.scope).toBe('local');
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4b: References AFTER args command produce no warnings
     * 
     * For any `args` command defining local macros, references to those macros
     * AFTER the `args` command SHALL NOT produce "undefined local macro" warnings.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.2
     */
    it('should not flag args-defined macros referenced after args command', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 5 }),
                (my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    // Build document with args command followed by references
                    const my_args_line = `args ${my_unique_names.join(' ')}`;
                    const my_reference_lines = my_unique_names.map(
                        my_name => `display \`${my_name}'`
                    );
                    const my_document = [my_args_line, ...my_reference_lines].join('\n');

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );

                    // Should NOT have any "Undefined local macro" errors for args-defined macros
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4c: References BEFORE args command produce no warnings
     * 
     * For any `args` command defining local macros, references to those macros
     * BEFORE the `args` command SHALL NOT produce "undefined local macro" warnings.
     * This is the key property - args macros should be valid from the start of scope.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.2, 2.3
     */
    it('should not flag args-defined macros referenced before args command', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 5 }),
                (my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    // Build document with references BEFORE args command
                    const my_reference_lines = my_unique_names.map(
                        my_name => `display \`${my_name}'`
                    );
                    const my_args_line = `args ${my_unique_names.join(' ')}`;
                    const my_document = [...my_reference_lines, my_args_line].join('\n');

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics for args-defined macros
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_unique_names.some(my_name => my_diag.message.includes(my_name))
                    );

                    // Should NOT have any "Undefined local macro" errors for args-defined macros
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4d: Mixed references (before and after) produce no warnings
     * 
     * For any `args` command defining local macros, references to those macros
     * anywhere in the containing scope (before or after the `args` command)
     * SHALL NOT produce "undefined local macro" warnings.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    it('should not flag args-defined macros with mixed before/after references', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 5 }),
                (my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    // Build document with references both before and after args command
                    const my_before_refs = my_unique_names.map(
                        my_name => `display "before: \`${my_name}'"`
                    );
                    const my_args_line = `args ${my_unique_names.join(' ')}`;
                    const my_after_refs = my_unique_names.map(
                        my_name => `display "after: \`${my_name}'"`
                    );
                    const my_document = [
                        ...my_before_refs,
                        my_args_line,
                        ...my_after_refs
                    ].join('\n');

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics for args-defined macros
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_unique_names.some(my_name => my_diag.message.includes(my_name))
                    );

                    // Should NOT have any "Undefined local macro" errors for args-defined macros
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4e: Undefined macros (not in args) still produce warnings
     * 
     * Ensure that genuinely undefined macros (not defined by args) are still
     * correctly flagged as undefined.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.1, 2.2, 2.3 (ensuring we don't over-suppress)
     */
    it('should still flag genuinely undefined macros not in args', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 3 }),
                // Generate a different macro name that won't be in args
                fc.stringMatching(/^undefined_[a-zA-Z0-9_]{2,10}$/),
                (my_args_names, my_undefined_name) => {
                    // Ensure unique names and undefined name is not in args
                    const my_unique_args = [...new Set(my_args_names)];
                    if (my_unique_args.length === 0) return true;
                    if (my_unique_args.includes(my_undefined_name)) return true;

                    // Build document with args and reference to undefined macro
                    const my_document = `args ${my_unique_args.join(' ')}
display \`${my_undefined_name}'`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics for the undefined macro
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_diag.message.includes(my_undefined_name)
                    );

                    // SHOULD have an "Undefined local macro" error for the undefined macro
                    expect(my_undefined_macro_errors.length).toBe(1);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4f: Args macros in program scope
     * 
     * For any program containing an `args` command, references to args-defined
     * macros within the program body SHALL NOT produce warnings.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    it('should not flag args-defined macros within program scope', () => {
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,10}$/),
                fc.array(macro_name_gen, { minLength: 1, maxLength: 3 }),
                (my_program_name, my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    // Build program with args and references
                    const my_reference_lines = my_unique_names.map(
                        my_name => `    display \`${my_name}'`
                    );
                    const my_document = `program ${my_program_name}
    args ${my_unique_names.join(' ')}
${my_reference_lines.join('\n')}
end`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics for args-defined macros
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_unique_names.some(my_name => my_diag.message.includes(my_name))
                    );

                    // Should NOT have any "Undefined local macro" errors for args-defined macros
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4g: Args macros with forward references in program
     * 
     * For any program with references BEFORE the args command within the program,
     * those references SHALL NOT produce warnings.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.2, 2.3
     */
    it('should not flag forward references to args-defined macros in program', () => {
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,10}$/),
                fc.array(macro_name_gen, { minLength: 1, maxLength: 3 }),
                (my_program_name, my_macro_names) => {
                    // Ensure unique names
                    const my_unique_names = [...new Set(my_macro_names)];
                    if (my_unique_names.length === 0) return true;

                    // Build program with forward references (before args)
                    const my_reference_lines = my_unique_names.map(
                        my_name => `    display \`${my_name}'`
                    );
                    const my_document = `program ${my_program_name}
${my_reference_lines.join('\n')}
    args ${my_unique_names.join(' ')}
end`;

                    const my_result = analyze_document(my_document);

                    // Filter for undefined macro diagnostics for args-defined macros
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_unique_names.some(my_name => my_diag.message.includes(my_name))
                    );

                    // Should NOT have any "Undefined local macro" errors for args-defined macros
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4h: Multiple args commands
     * 
     * When multiple args commands exist, all defined macros from all args
     * commands should be valid throughout the scope.
     * 
     * Feature: diagnostic-false-positives, Property 4: Args Command Macro Scope
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    it('should handle multiple args commands correctly', () => {
        fc.assert(
            fc.property(
                fc.array(macro_name_gen, { minLength: 1, maxLength: 2 }),
                fc.array(macro_name_gen, { minLength: 1, maxLength: 2 }),
                (my_first_args, my_second_args) => {
                    // Ensure unique names within each args command
                    const my_first_unique = [...new Set(my_first_args)];
                    const my_second_unique = [...new Set(my_second_args)];
                    if (my_first_unique.length === 0 || my_second_unique.length === 0) return true;

                    // Combine all names for reference checking
                    const my_all_names = [...my_first_unique, ...my_second_unique];

                    // Build document with two args commands and references
                    const my_document = `args ${my_first_unique.join(' ')}
display \`${my_first_unique[0]}'
args ${my_second_unique.join(' ')}
display \`${my_second_unique[0]}'`;

                    const my_result = analyze_document(my_document);

                    // All macros from both args commands should be registered
                    for (const my_name of my_all_names) {
                        const my_symbol = my_result.symbols.localMacros.get(my_name);
                        expect(my_symbol).toBeDefined();
                    }

                    // Filter for undefined macro diagnostics for args-defined macros
                    const my_undefined_macro_errors = my_result.diagnostics.filter(
                        my_diag => 
                            my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                            my_all_names.some(my_name => my_diag.message.includes(my_name))
                    );

                    // Should NOT have any "Undefined local macro" errors
                    expect(my_undefined_macro_errors.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
