import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext, ContextErrorCode } from '../../src/context-tracker/types';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { arbitrary_identifier, arbitrary_command_name } from './generators/primitives';

/**
 * Property tests for valid block terminator acceptance and nested block handling.
 * 
 * Feature: valid-block-terminators
 * Properties: 
 * - Property 1: Valid Block Terminator Acceptance
 * - Property 2: Nested Block Handling
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
 * 
 * These tests verify that the context tracker correctly accepts valid block
 * terminators ('end') for embedded language blocks and handles nested structures
 * without generating false positive diagnostics.
 */
describe('Valid Block Terminators Property Tests', () => {
    let context_tracker: ContextTracker;
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        context_tracker = new ContextTracker();
        lexer = new StataLexer();
        parser = new StataParser();
    });

    /**
     * Property 1: Valid Block Terminator Acceptance
     * 
     * For any valid embedded language block (mata or python) that ends with 'end',
     * the context tracker should accept it without generating diagnostics and
     * correctly identify the block structure.
     * 
     * Feature: valid-block-terminators, Property 1: Valid Block Terminator Acceptance
     * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2
     */
    it('should accept valid embedded blocks ending with end', () => {
        fc.assert(
            fc.property(
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                // Filter out content that would create unclosed block comments
                fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 })
                    .filter(lines => !lines.some(line => line.includes('/*'))),
                (my_block_type, my_content_lines) => {
                    // Build valid embedded block
                    let my_document = `${my_block_type}\n`;
                    for (const my_line of my_content_lines) {
                        my_document += `${my_line}\n`;
                    }
                    my_document += 'end';

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no diagnostics for valid blocks
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify the block
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(1);

                    const my_expected_context = my_block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                    expect(my_ranges[0].context).toBe(my_expected_context);
                    expect(my_ranges[0].end_delimiter?.command).toBe('end');
                    expect(my_ranges[0].is_single_line).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1b: Multiple Sequential Valid Blocks
     * 
     * For any sequence of valid embedded language blocks, each ending with 'end',
     * the context tracker should accept all blocks without generating diagnostics.
     * 
     * Feature: valid-block-terminators, Property 1: Valid Block Terminator Acceptance
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    it('should accept multiple sequential valid blocks', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        type: fc.oneof(fc.constant('mata'), fc.constant('python')),
                        // Filter out content that would create unclosed block comments
                        content: fc.array(
                            fc.string({ minLength: 1, maxLength: 20 })
                                .filter(s => !s.includes('/*')),
                            { minLength: 0, maxLength: 3 }
                        )
                    }),
                    { minLength: 1, maxLength: 4 }
                ),
                (my_blocks) => {
                    // Build multiple sequential blocks
                    const my_block_parts = my_blocks.map((my_block) => {
                        const my_content = my_block.content.join('\n');
                        return `${my_block.type}\n${my_content}\nend`;
                    });

                    const my_document = my_block_parts.join('\n\n');

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no diagnostics for valid blocks
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify all blocks
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(my_blocks.length);

                    // Each block should have correct structure
                    for (let i = 0; i < my_blocks.length; i++) {
                        const my_expected_context = my_blocks[i].type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                        expect(my_ranges[i].context).toBe(my_expected_context);
                        expect(my_ranges[i].end_delimiter?.command).toBe('end');
                        expect(my_ranges[i].is_single_line).toBe(false);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 1c: Valid Blocks with Surrounding Stata Code
     * 
     * For any valid embedded language block surrounded by Stata code,
     * the context tracker should accept the block without generating diagnostics.
     * 
     * Feature: valid-block-terminators, Property 1: Valid Block Terminator Acceptance
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    it('should accept valid blocks surrounded by Stata code', () => {
        fc.assert(
            fc.property(
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                fc.array(
                    fc.string({ minLength: 1, maxLength: 20 })
                        .filter(s => !s.includes('/*')),
                    { minLength: 0, maxLength: 3 }
                ),
                fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 }),
                fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 }),
                (my_block_type, my_content_lines, my_before_commands, my_after_commands) => {
                    const my_before = my_before_commands.join('\n');
                    const my_content = my_content_lines.join('\n');
                    const my_after = my_after_commands.join('\n');

                    const my_document = `${my_before}

${my_block_type}
${my_content}
end

${my_after}`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no diagnostics for valid block
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify the block
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(1);

                    const my_expected_context = my_block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                    expect(my_ranges[0].context).toBe(my_expected_context);
                    expect(my_ranges[0].end_delimiter?.command).toBe('end');
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2: Nested Block Handling
     * 
     * For any document containing program blocks with embedded language blocks,
     * the context tracker should correctly handle the nested structure and
     * accept all valid 'end' terminators without generating false positives.
     * 
     * Feature: valid-block-terminators, Property 2: Nested Block Handling
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should handle nested program and embedded blocks correctly', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 2 }),
                (my_program_name, my_embedded_type, my_embedded_content) => {
                    // Build program block containing embedded language block
                    const my_content = my_embedded_content.join('\n');
                    const my_document = `program define ${my_program_name}
    ${my_embedded_type}
    ${my_content}
    end
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no block-related diagnostics for valid nested structure
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify only the embedded block (program blocks are not tracked as context ranges)
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(1); // Only the embedded block should be tracked

                    const my_expected_context = my_embedded_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                    expect(my_ranges[0].context).toBe(my_expected_context);
                    expect(my_ranges[0].end_delimiter?.command).toBe('end');
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2b: Multiple Nested Structures
     * 
     * For any document containing multiple program blocks, each with embedded
     * language blocks, the context tracker should handle all nested structures
     * correctly without generating false positives.
     * 
     * Feature: valid-block-terminators, Property 2: Nested Block Handling
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should handle multiple nested structures correctly', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        program_name: arbitrary_identifier(),
                        embedded_type: fc.oneof(fc.constant('mata'), fc.constant('python')),
                        content: fc.array(
                            fc.string({ minLength: 1, maxLength: 15 })
                                .filter(s => !s.includes('/*')),
                            { minLength: 0, maxLength: 2 }
                        )
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (my_programs) => {
                    // Build multiple program blocks with embedded language blocks
                    const my_program_parts = my_programs.map((my_prog) => {
                        const my_content = my_prog.content.join('\n');
                        return `program define ${my_prog.program_name}
    ${my_prog.embedded_type}
    ${my_content}
    end
end`;
                    });

                    const my_document = my_program_parts.join('\n\n');

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no block-related diagnostics for valid nested structures
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify all embedded blocks (program blocks are not tracked as context ranges)
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(my_programs.length);

                    // Each embedded block should have correct structure
                    for (let i = 0; i < my_programs.length; i++) {
                        const my_expected_context = my_programs[i].embedded_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                        expect(my_ranges[i].context).toBe(my_expected_context);
                        expect(my_ranges[i].end_delimiter?.command).toBe('end');
                    }
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 2c: Mixed Block Types in Nested Structures
     * 
     * For any document containing program blocks with different types of
     * embedded language blocks (mata and python), the context tracker should
     * handle the mixed nested structure correctly.
     * 
     * Feature: valid-block-terminators, Property 2: Nested Block Handling
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should handle mixed embedded block types in nested structures', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                arbitrary_identifier(),
                // Filter out content that would create unclosed block comments
                fc.string({ minLength: 1, maxLength: 20 })
                    .filter(s => !s.includes('/*')),
                fc.string({ minLength: 1, maxLength: 20 })
                    .filter(s => !s.includes('/*')),
                (my_prog1_name, my_prog2_name, my_mata_content, my_python_content) => {
                    // Build program blocks with different embedded types
                    const my_document = `program define ${my_prog1_name}
    mata
    ${my_mata_content}
    end
end

program define ${my_prog2_name}
    python
    ${my_python_content}
    end
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no block-related diagnostics for valid mixed nested structure
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify both embedded blocks
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(2);

                    // First block should be mata
                    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
                    expect(my_ranges[0].end_delimiter?.command).toBe('end');

                    // Second block should be python
                    expect(my_ranges[1].context).toBe(LanguageContext.PYTHON);
                    expect(my_ranges[1].end_delimiter?.command).toBe('end');
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2d: Context Tracking Accuracy in Nested Structures
     * 
     * For any nested structure with embedded blocks, the context tracker should
     * accurately report the language context at any position within the structure.
     * 
     * Feature: valid-block-terminators, Property 2: Nested Block Handling
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should accurately track context in nested structures', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                // Filter out content that would create unclosed block comments
                fc.array(fc.string({ minLength: 1, maxLength: 15 }), { minLength: 1, maxLength: 3 })
                    .filter(lines => !lines.some(line => line.includes('/*'))),
                (my_program_name, my_embedded_type, my_content_lines) => {
                    // Build program block with embedded language block
                    const my_content = my_content_lines.join('\n');
                    const my_document = `program define ${my_program_name}
    display "before"
    ${my_embedded_type}
    ${my_content}
    end
    display "after"
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);

                    // Check context at various positions
                    // Position before embedded block (should be STATA)
                    const my_before_context = context_tracker.get_context_at_position({
                        line: 1,
                        character: 4
                    });
                    expect(my_before_context).toBe(LanguageContext.STATA);

                    // Position inside embedded block (should be embedded language)
                    const my_inside_context = context_tracker.get_context_at_position({
                        line: 3,
                        character: 4
                    });
                    const my_expected_context = my_embedded_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                    expect(my_inside_context).toBe(my_expected_context);

                    // Position after embedded block but still in program (should be STATA)
                    // The 'end' command is on line 4 + content_lines.length, so after that should be STATA
                    const my_end_line = 4 + my_content_lines.length;
                    const my_after_context = context_tracker.get_context_at_position({
                        line: my_end_line + 1,
                        character: 4
                    });
                    expect(my_after_context).toBe(LanguageContext.STATA);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2e: Single-line Embedded Blocks in Nested Structures
     * 
     * For any nested structure containing single-line embedded blocks (mata:, python:),
     * the context tracker should handle them correctly alongside multi-line blocks.
     * 
     * Feature: valid-block-terminators, Property 2: Nested Block Handling
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should handle single-line embedded blocks in nested structures', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                // Content must have at least one non-whitespace character to be treated as inline
                // (mata:/python: followed by only whitespace is now treated as block start)
                fc.stringMatching(/^[a-zA-Z0-9_ \t\-+=(){}[\]]*$/).filter(s => s.trim().length > 0),
                (my_program_name, my_embedded_type, my_single_line_content) => {
                    // Build program block with single-line embedded block
                    const my_document = `program define ${my_program_name}
    display "before"
    ${my_embedded_type}: ${my_single_line_content}
    display "after"
end`;

                    // Initialize context tracker
                    init_tracker_from_source(context_tracker, my_document);
                    const my_diagnostics = context_tracker.validate_context_structure();

                    // Should have no block-related diagnostics for valid single-line embedded block
                    const my_block_errors = my_diagnostics.filter(
                        (my_diag) => my_diag.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                            my_diag.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK ||
                            my_diag.code === ContextErrorCode.UNEXPECTED_END
                    );
                    expect(my_block_errors.length).toBe(0);

                    // Should correctly identify the single-line embedded block
                    const my_ranges = context_tracker.get_all_context_ranges();
                    expect(my_ranges.length).toBe(1);

                    const my_expected_context = my_embedded_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
                    expect(my_ranges[0].context).toBe(my_expected_context);
                    expect(my_ranges[0].is_single_line).toBe(true);
                    expect(my_ranges[0].start_delimiter.command).toBe(`${my_embedded_type}:`);
                }
            ),
            { numRuns: 50 }
        );
    });
});