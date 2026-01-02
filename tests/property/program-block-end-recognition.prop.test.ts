import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext, ContextErrorCode } from '../../src/context-tracker/types';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { arbitrary_identifier, arbitrary_command_name } from './generators/primitives';

/**
 * Property tests for program block end recognition.
 * 
 * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
 * Validates: Requirements 1.2, 1.4
 * 
 * These tests verify that the context tracker does NOT emit false positive
 * "Unexpected end command - not in a mata block" errors for valid program
 * block terminators.
 */
describe('Program Block End Recognition Property Tests', () => {
    let context_tracker: ContextTracker;
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        context_tracker = new ContextTracker();
        lexer = new StataLexer();
        parser = new StataParser();
    });

    /**
     * Property 1: Program Block End Recognition
     * 
     * For any valid `program define name ... end` block, the diagnostic provider
     * should NOT emit "Unexpected end command - not in a mata block" for the
     * `end` command that terminates the program.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4
     */
    it('should not flag end commands in program blocks as errors', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.array(arbitrary_command_name(), { minLength: 0, maxLength: 3 }),
                (my_program_name, my_commands) => {
                    // Build a valid program block
                    const my_body = my_commands.length > 0
                        ? my_commands.map((my_cmd) => `    ${my_cmd}`).join('\n')
                        : '    display "hello"';
                    
                    const my_document = `program define ${my_program_name}
${my_body}
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Filter for UNEXPECTED_END errors
                    const my_unexpected_end_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );

                    // Should NOT have any "Unexpected end command" errors
                    // because 'end' is a valid terminator for program blocks
                    expect(my_unexpected_end_errors.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1b: Multiple Program Blocks
     * 
     * For any document with multiple valid program blocks, none of the `end`
     * commands should be flagged as errors.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4
     */
    it('should not flag end commands in multiple program blocks', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_identifier(), { minLength: 1, maxLength: 3 }),
                (my_program_names) => {
                    // Build multiple program blocks
                    const my_programs = my_program_names.map((my_name) => 
                        `program define ${my_name}\n    display "hello"\nend`
                    );
                    
                    const my_document = my_programs.join('\n\n');

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Filter for UNEXPECTED_END errors
                    const my_unexpected_end_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );

                    // Should NOT have any "Unexpected end command" errors
                    expect(my_unexpected_end_errors.length).toBe(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 1c: Program Blocks with Stata Code Before and After
     * 
     * For any document with Stata code before and after a program block,
     * the `end` command should not be flagged as an error.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4
     */
    it('should not flag end in program blocks surrounded by Stata code', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 2 }),
                fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 2 }),
                (my_program_name, my_before_commands, my_after_commands) => {
                    const my_before = my_before_commands.join('\n');
                    const my_after = my_after_commands.join('\n');
                    
                    const my_document = `${my_before}

program define ${my_program_name}
    display "hello"
end

${my_after}`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Filter for UNEXPECTED_END errors
                    const my_unexpected_end_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );

                    // Should NOT have any "Unexpected end command" errors
                    expect(my_unexpected_end_errors.length).toBe(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 1d: Standalone End Commands Should Be Flagged
     * 
     * For any standalone `end` command in Stata context (not inside mata or program),
     * the context tracker should flag it as an error since orphan ends are now
     * considered errors.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4
     */
    it('should flag standalone end commands outside any block', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_command_name(), { minLength: 0, maxLength: 3 }),
                (my_commands) => {
                    // Build a document with standalone 'end' command (no program block)
                    const my_before = my_commands.length > 0
                        ? my_commands.join('\n') + '\n'
                        : '';
                    
                    const my_document = `${my_before}end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Filter for UNEXPECTED_END errors
                    const my_unexpected_end_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );

                    // Should have an "Unexpected end command" error
                    // because orphan ends are now considered errors
                    expect(my_unexpected_end_errors.length).toBe(1);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 1e: End Python Still Flagged Outside Python Context
     * 
     * While standalone `end` commands should not be flagged (could be program
     * block terminators), `end python` commands outside python blocks should
     * still be flagged as errors.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4 (ensuring we don't over-suppress)
     */
    it('should still flag end python outside python context', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_command_name(), { minLength: 0, maxLength: 2 }),
                (my_commands) => {
                    // Build a document with 'end python' outside python context
                    const my_before = my_commands.length > 0
                        ? my_commands.join('\n') + '\n'
                        : '';
                    
                    const my_document = `${my_before}end python`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Filter for MISMATCHED_END_PYTHON errors
                    const my_mismatched_end_python_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.MISMATCHED_END_PYTHON
                    );

                    // SHOULD have a "Misplaced end python" error
                    expect(my_mismatched_end_python_errors.length).toBe(1);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 1f: Mata Blocks Still Work Correctly
     * 
     * Ensure that valid mata blocks with `end` commands still work correctly
     * and don't produce false positives.
     * 
     * Feature: diagnostic-false-positives, Property 1: Program Block End Recognition
     * Validates: Requirements 1.2, 1.4 (ensuring mata still works)
     */
    it('should correctly handle end in mata blocks', () => {
        fc.assert(
            fc.property(
                fc.array(fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/), { minLength: 0, maxLength: 2 }),
                (my_mata_vars) => {
                    // Build a valid mata block
                    const my_mata_body = my_mata_vars.length > 0
                        ? my_mata_vars.map((my_var) => `    ${my_var} = 1`).join('\n')
                        : '    x = 1';
                    
                    const my_document = `mata
${my_mata_body}
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Get diagnostics
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should NOT have any errors for valid mata block
                    expect(my_diagnostics.length).toBe(0);

                    // Verify context is correctly detected
                    const my_context_inside = context_tracker.get_context_at_position({
                        line: 1,
                        character: 0,
                    });
                    expect(my_context_inside).toBe(LanguageContext.MATA);
                }
            ),
            { numRuns: 50 }
        );
    });
});
