/**
 * Property Tests: Formatter Else Block with Macro Command
 *
 * Feature: else-block-indentation-false-positive
 * Property 5: Formatter indentation correctness
 * Validates: Requirements 3.1, 3.2
 *
 * Tests that the formatter correctly preserves indentation for else blocks
 * containing macro-reference commands.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    for_each_formatter_mode_property,
    for_each_formatter_mode,
    create_formatter_config,
    skip_for_mode,
    FormatterMode,
    DEFAULT_FORMATTING_OPTIONS,
} from './helpers/formatter-test-utils';
import { create_document_state } from './helpers/document-utils';

describe('Formatter Else Block with Macro Command Properties', () => {
    const formatter = new CodeFormatter();
    const options = DEFAULT_FORMATTING_OPTIONS;

    // Generator for valid Stata macro names
    const macro_name_arb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,8}$/);

    // Generator for simple string arguments
    const string_arg_arb = fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/).map(s => `"${s}"`);

    // Generator for macro command statements (the bug case)
    const macro_command_arb = fc.tuple(
        macro_name_arb,
        fc.array(string_arg_arb, { minLength: 0, maxLength: 2 })
    ).map(([name, args]) => {
        const arg_str = args.length > 0 ? ' ' + args.join(' ') : '';
        return `\`${name}'${arg_str}`;
    });

    /**
     * Property 5: Formatter indentation correctness
     * 
     * For any line inside an else block, the formatter SHALL produce
     * indentation equal to (nesting_depth + 1) × indent_size spaces.
     * 
     * Feature: else-block-indentation-false-positive, Property 5: Formatter indentation correctness
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode_property(
        'Property 5: Formatter preserves correct indentation for else block with macro command',
        macro_command_arb,
        (mode: FormatterMode, macro_cmd: string) => {
            // Create source with correctly indented else block containing macro command
            const source = `if 1 {
    display "then"
}
else {
    ${macro_cmd}
}`;
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            if (!formatted_doc.ast || !formatted_doc.tokens) {
                return false;
            }

            // For source-preserving mode, verify indentation is preserved
            skip_for_mode(mode, 'ast', () => {
                // Line 4 (else block body) should have 4 spaces indentation (depth 1)
                const body_line = the_lines[4];
                if (body_line && body_line.trim()) {
                    const leading_spaces = body_line.length - body_line.trimStart().length;
                    expect(leading_spaces).toBe(4);
                }
            });

            return true;
        },
        100
    );

    /**
     * Property 5 (continued): Nested structures with macro commands
     * 
     * For nested else blocks inside programs, the formatter SHALL compute
     * correct cumulative indentation.
     * 
     * Feature: else-block-indentation-false-positive, Property 5: Formatter indentation correctness
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode_property(
        'Property 5: Formatter preserves correct indentation for nested else block with macro command',
        macro_command_arb,
        (mode: FormatterMode, macro_cmd: string) => {
            // Create source with else block inside a program
            const source = `program define test
    if 1 {
        display "then"
    }
    else {
        ${macro_cmd}
    }
end`;
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            if (!formatted_doc.ast || !formatted_doc.tokens) {
                return false;
            }

            // For source-preserving mode, verify indentation is preserved
            skip_for_mode(mode, 'ast', () => {
                // Line 5 (else block body inside program) should have 8 spaces (depth 2)
                const body_line = the_lines[5];
                if (body_line && body_line.trim()) {
                    const leading_spaces = body_line.length - body_line.trimStart().length;
                    expect(leading_spaces).toBe(8);
                }
            });

            return true;
        },
        100
    );

    /**
     * Unit test: Original bug reproduction case
     * 
     * Tests the exact scenario from the bug report where the formatter
     * was incorrectly removing indentation from else block content.
     * 
     * Feature: else-block-indentation-false-positive
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode(
        'should preserve indentation in original bug reproduction case',
        (mode: FormatterMode) => {
            const source = `capture program drop _loop_execute_survey
program define _loop_execute_survey
    args custom_arg is_script country_name survey_year
    if \`is_script' == 1 {
        do "\`custom_arg'" "\`country_name'" "\`survey_year'"
    }
    else {
        \`custom_arg' "\`country_name'" "\`survey_year'"
    }
end`;

            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            expect(formatted_doc.ast).toBeDefined();
            expect(formatted_doc.tokens).toBeDefined();

            // For source-preserving mode, verify the else block body line has correct indentation
            skip_for_mode(mode, 'ast', () => {
                // Line 7 (0-indexed) is the macro command inside else block
                // It should have 8 spaces indentation (depth 2: program > else)
                const body_line = the_lines[7];
                expect(body_line).toBeDefined();
                if (body_line && body_line.trim()) {
                    const leading_spaces = body_line.length - body_line.trimStart().length;
                    expect(leading_spaces).toBe(8);
                }
            });
        }
    );

    /**
     * Unit test: Global macro reference as command name
     * 
     * Tests that global macro references at the start of statements
     * are correctly handled by the formatter.
     * 
     * Feature: else-block-indentation-false-positive
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode(
        'should preserve indentation for global macro command in else block',
        (mode: FormatterMode) => {
            const source = `if 1 {
    display "hello"
}
else {
    \${global_cmd} "arg1" "arg2"
}`;

            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            expect(formatted_doc.ast).toBeDefined();
            expect(formatted_doc.tokens).toBeDefined();

            // For source-preserving mode, verify indentation is preserved
            skip_for_mode(mode, 'ast', () => {
                // Line 4 (else block body) should have 4 spaces indentation (depth 1)
                const body_line = the_lines[4];
                expect(body_line).toBeDefined();
                if (body_line && body_line.trim()) {
                    const leading_spaces = body_line.length - body_line.trimStart().length;
                    expect(leading_spaces).toBe(4);
                }
            });
        }
    );

    /**
     * Unit test: Nested if/else with macro commands
     * 
     * Tests that deeply nested structures with macro commands
     * maintain correct indentation levels.
     * 
     * Feature: else-block-indentation-false-positive
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode(
        'should preserve indentation for nested if/else with macro commands',
        (mode: FormatterMode) => {
            const source = `program define test
    if 1 {
        if 2 {
            display "nested"
        }
        else {
            \`inner_cmd' "arg"
        }
    }
    else {
        \`outer_cmd' "arg"
    }
end`;

            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            expect(formatted_doc.ast).toBeDefined();
            expect(formatted_doc.tokens).toBeDefined();

            // For source-preserving mode, verify indentation levels
            skip_for_mode(mode, 'ast', () => {
                // Line 6 (inner else body): depth 3 = 12 spaces
                const inner_body_line = the_lines[6];
                if (inner_body_line && inner_body_line.trim()) {
                    const leading_spaces = inner_body_line.length - inner_body_line.trimStart().length;
                    expect(leading_spaces).toBe(12);
                }

                // Line 10 (outer else body): depth 2 = 8 spaces
                const outer_body_line = the_lines[10];
                if (outer_body_line && outer_body_line.trim()) {
                    const leading_spaces = outer_body_line.length - outer_body_line.trimStart().length;
                    expect(leading_spaces).toBe(8);
                }
            });
        }
    );

    /**
     * Unit test: Else block inside foreach loop
     * 
     * Tests that else blocks inside foreach loops maintain
     * correct cumulative indentation.
     * 
     * Feature: else-block-indentation-false-positive
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode(
        'should preserve indentation for else block inside foreach',
        (mode: FormatterMode) => {
            const source = `foreach x in a b c {
    if 1 {
        display "then"
    }
    else {
        \`cmd' "arg"
    }
}`;

            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return;
            }

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Verify the formatted output is parseable
            const formatted_doc = create_document_state(formatted);
            expect(formatted_doc.ast).toBeDefined();
            expect(formatted_doc.tokens).toBeDefined();

            // For source-preserving mode, verify indentation
            skip_for_mode(mode, 'ast', () => {
                // Line 5 (else block body inside foreach): depth 2 = 8 spaces
                const body_line = the_lines[5];
                if (body_line && body_line.trim()) {
                    const leading_spaces = body_line.length - body_line.trimStart().length;
                    expect(leading_spaces).toBe(8);
                }
            });
        }
    );
});
