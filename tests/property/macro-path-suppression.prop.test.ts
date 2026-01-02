import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ForwardCallType } from '../../src/types';

/**
 * Property-based tests for macro path diagnostic suppression.
 * 
 * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
 * Validates: Requirements 3.1, 3.2
 * 
 * These tests verify that for any `do`/`run`/`include` command where the path
 * contains a macro reference (backtick or dollar sign character), the forward
 * scope resolver SHALL NOT emit a "cannot read file" diagnostic.
 */
describe('Macro Path Diagnostic Suppression Property Tests', () => {
    let analyzer: SemanticAnalyzer;
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        analyzer = new SemanticAnalyzer();
        lexer = new StataLexer();
        parser = new StataParser();
    });

    /**
     * Helper function to analyze a document and return the analysis result.
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
     * Generator for valid file path segments (no special characters).
     */
    const path_segment_gen = fc.stringMatching(/^[a-zA-Z0-9_-]{1,15}$/);

    /**
     * Generator for file extensions.
     */
    const extension_gen = fc.constantFrom('.do', '.ado', '.doh', '');

    /**
     * Generator for do/run/include command types.
     */
    const command_type_gen = fc.constantFrom<ForwardCallType>('do', 'run', 'include');

    /**
     * Property 6a: Local macro paths are marked as non-static
     * 
     * For any `do`/`run`/`include` command with a path containing a local macro
     * reference (`` `macro' ``), the forward_call SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should mark paths with local macro references as non-static', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                (my_command, my_macro_name) => {
                    // Build document with local macro in path
                    const my_document = `${my_command} "\`${my_macro_name}'"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Should have the correct command type
                    expect(my_result.forward_calls[0].type).toBe(my_command);
                    
                    // Raw path should contain the macro reference
                    expect(my_result.forward_calls[0].raw_path).toContain('`');
                    expect(my_result.forward_calls[0].raw_path).toContain("'");

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6b: Global macro paths are marked as non-static
     * 
     * For any `do`/`run`/`include` command with a path containing a global macro
     * reference (`$macro`), the forward_call SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should mark paths with global macro references as non-static', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                (my_command, my_macro_name) => {
                    // Build document with global macro in path
                    const my_document = `${my_command} "$${my_macro_name}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Should have the correct command type
                    expect(my_result.forward_calls[0].type).toBe(my_command);
                    
                    // Raw path should contain the global macro reference
                    expect(my_result.forward_calls[0].raw_path).toContain('$');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6c: Braced global macro paths are marked as non-static
     * 
     * For any `do`/`run`/`include` command with a path containing a braced global
     * macro reference (`${macro}`), the forward_call SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should mark paths with braced global macro references as non-static', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                (my_command, my_macro_name) => {
                    // Build document with braced global macro in path
                    const my_document = `${my_command} "\${${my_macro_name}}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Should have the correct command type
                    expect(my_result.forward_calls[0].type).toBe(my_command);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6d: Non-static paths have empty resolved path
     * 
     * For any `do`/`run`/`include` command with a path containing a macro reference,
     * the forward_call SHALL have an empty resolved `path` property.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.2
     */
    it('should have empty resolved path for non-static macro paths', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                fc.boolean(), // true = local macro, false = global macro
                (my_command, my_macro_name, my_is_local) => {
                    // Build document with macro in path
                    const my_path = my_is_local 
                        ? `\`${my_macro_name}'` 
                        : `$${my_macro_name}`;
                    const my_document = `${my_command} "${my_path}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Resolved path should be empty for non-static calls
                    expect(my_result.forward_calls[0].path).toBe('');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6e: Static paths are marked as static
     * 
     * For any `do`/`run`/`include` command with a static path (no macro references),
     * the forward_call SHALL be marked as `is_static: true`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1 (contrast case)
     */
    it('should mark static paths as static', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                path_segment_gen,
                extension_gen,
                (my_command, my_path_segment, my_extension) => {
                    // Build document with static path (no macros)
                    const my_path = `${my_path_segment}${my_extension}`;
                    const my_document = `${my_command} "${my_path}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as static
                    expect(my_result.forward_calls[0].is_static).toBe(true);
                    
                    // Should have the correct command type
                    expect(my_result.forward_calls[0].type).toBe(my_command);
                    
                    // Raw path should match the input path
                    expect(my_result.forward_calls[0].raw_path).toBe(my_path);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6f: Embedded local macros in paths are detected
     * 
     * For any `do`/`run`/`include` command with a path containing an embedded
     * local macro reference (e.g., `path/`subdir'/file.do`), the forward_call
     * SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should detect embedded local macros in paths', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                path_segment_gen,
                macro_name_gen,
                path_segment_gen,
                extension_gen,
                (my_command, my_prefix, my_macro_name, my_suffix, my_extension) => {
                    // Build document with embedded local macro in path
                    const my_path = `${my_prefix}/\`${my_macro_name}'/${my_suffix}${my_extension}`;
                    const my_document = `${my_command} "${my_path}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Resolved path should be empty
                    expect(my_result.forward_calls[0].path).toBe('');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6g: Embedded global macros in paths are detected
     * 
     * For any `do`/`run`/`include` command with a path containing an embedded
     * global macro reference (e.g., `path/$subdir/file.do`), the forward_call
     * SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should detect embedded global macros in paths', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                path_segment_gen,
                macro_name_gen,
                path_segment_gen,
                extension_gen,
                (my_command, my_prefix, my_macro_name, my_suffix, my_extension) => {
                    // Build document with embedded global macro in path
                    const my_path = `${my_prefix}/$${my_macro_name}/${my_suffix}${my_extension}`;
                    const my_document = `${my_command} "${my_path}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Resolved path should be empty
                    expect(my_result.forward_calls[0].path).toBe('');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6h: Multiple macro references in path
     * 
     * For any `do`/`run`/`include` command with a path containing multiple
     * macro references (local and/or global), the forward_call SHALL be
     * marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should detect multiple macro references in paths', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                macro_name_gen,
                extension_gen,
                (my_command, my_macro1, my_macro2, my_extension) => {
                    // Build document with multiple macros in path
                    const my_path = `\`${my_macro1}'/$${my_macro2}${my_extension}`;
                    const my_document = `${my_command} "${my_path}"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Resolved path should be empty
                    expect(my_result.forward_calls[0].path).toBe('');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6i: Unquoted paths with macros
     * 
     * For any `do`/`run`/`include` command with an unquoted path containing
     * a macro reference, the forward_call SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should detect macros in unquoted paths', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                (my_command, my_macro_name) => {
                    // Build document with unquoted macro path
                    const my_document = `${my_command} \`${my_macro_name}'`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6j: Mixed static and macro paths in same document
     * 
     * For a document containing both static and macro-containing paths,
     * each forward_call SHALL be correctly classified.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1, 3.2
     */
    it('should correctly classify mixed static and macro paths', () => {
        fc.assert(
            fc.property(
                path_segment_gen,
                macro_name_gen,
                extension_gen,
                (my_static_path, my_macro_name, my_extension) => {
                    // Build document with both static and macro paths
                    const my_document = `do "${my_static_path}${my_extension}"
do "\`${my_macro_name}'"
run "$${my_macro_name}"`;
                    const my_result = analyze_document(my_document);

                    // Should have three forward calls
                    expect(my_result.forward_calls.length).toBe(3);
                    
                    // First call (static path) should be static
                    expect(my_result.forward_calls[0].is_static).toBe(true);
                    expect(my_result.forward_calls[0].path).not.toBe('');
                    
                    // Second call (local macro) should be non-static
                    expect(my_result.forward_calls[1].is_static).toBe(false);
                    expect(my_result.forward_calls[1].path).toBe('');
                    
                    // Third call (global macro) should be non-static
                    expect(my_result.forward_calls[2].is_static).toBe(false);
                    expect(my_result.forward_calls[2].path).toBe('');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6k: Command abbreviations with macro paths
     * 
     * For abbreviated commands (e.g., `ru` for `run`) with macro paths,
     * the forward_call SHALL still be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should handle command abbreviations with macro paths', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (my_macro_name) => {
                    // Test 'ru' abbreviation for 'run'
                    const my_document = `ru "\`${my_macro_name}'"`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);
                    
                    // Should be recognized as 'run' command
                    expect(my_result.forward_calls[0].type).toBe('run');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6l: Paths with only dollar sign (edge case)
     * 
     * For paths that contain a dollar sign followed by valid macro name characters,
     * the forward_call SHALL be marked as `is_static: false`.
     * 
     * Feature: diagnostic-false-positives, Property 6: Macro Path Diagnostic Suppression
     * Validates: Requirements 3.1
     */
    it('should detect dollar sign as macro indicator', () => {
        fc.assert(
            fc.property(
                command_type_gen,
                macro_name_gen,
                (my_command, my_macro_name) => {
                    // Build document with unquoted global macro path
                    const my_document = `${my_command} $${my_macro_name}`;
                    const my_result = analyze_document(my_document);

                    // Should have exactly one forward call
                    expect(my_result.forward_calls.length).toBe(1);
                    
                    // Should be marked as non-static
                    expect(my_result.forward_calls[0].is_static).toBe(false);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
