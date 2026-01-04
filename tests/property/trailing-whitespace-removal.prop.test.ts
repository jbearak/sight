/**
 * Property Tests: Trailing Whitespace Removal
 *
 * Feature: trailing-whitespace-removal
 * Validates: Requirements 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2
 *
 * Tests both formatter modes (source-preserving and AST-based) using dual-mode testing utilities.
 */

import { describe, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';
import { create_document_state } from './helpers/document-utils';

describe('Trailing Whitespace Removal Properties', () => {
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    /**
     * Generator for trailing whitespace (spaces and tabs)
     */
    const trailing_whitespace = fc.stringOf(
        fc.constantFrom(' ', '\t'),
        { minLength: 1, maxLength: 5 }
    );

    /**
     * Generator for simple Stata commands
     */
    const simple_command = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'global z = 3',
        'replace x = 2',
        'drop x',
        'use mydata',
        'save mydata',
        'summarize x',
        'regress y x'
    );

    /**
     * Generator for Stata code with injected trailing whitespace
     */
    const code_with_trailing_whitespace = fc.tuple(
        simple_command,
        trailing_whitespace
    ).map(([cmd, ws]) => `${cmd}${ws}`);

    /**
     * Property 1: No Trailing Whitespace in Output
     *
     * For any valid Stata source code and for any formatter mode,
     * after formatting, no line in the output should end with space or tab characters.
     *
     * **Validates: Requirements 1.1, 1.3, 3.1, 3.2**
     */
    for_each_formatter_mode_property(
        'Property 1: No Trailing Whitespace in Output',
        code_with_trailing_whitespace,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Check that no line ends with trailing whitespace
            for (const my_line of the_lines) {
                expect(my_line).toBe(my_line.trimEnd());
            }

            return true;
        },
        100
    );


    /**
     * Generator for multi-line code with trailing whitespace on each line
     */
    const multiline_code_with_trailing_ws = fc.tuple(
        fc.array(simple_command, { minLength: 1, maxLength: 3 }),
        trailing_whitespace
    ).map(([cmds, ws]) => cmds.map(cmd => `${cmd}${ws}`).join('\n'));

    /**
     * Property 1 (extended): No Trailing Whitespace in Multi-line Output
     *
     * For any multi-line Stata source code with trailing whitespace,
     * after formatting, no line should end with space or tab characters.
     *
     * **Validates: Requirements 1.1, 1.3, 3.1, 3.2**
     */
    for_each_formatter_mode_property(
        'Property 1 (extended): No Trailing Whitespace in Multi-line Output',
        multiline_code_with_trailing_ws,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Check that no line ends with trailing whitespace
            for (const my_line of the_lines) {
                expect(my_line).toBe(my_line.trimEnd());
            }

            return true;
        },
        100
    );

    /**
     * Property 2: Non-Whitespace Content Preservation
     *
     * For any valid Stata source code, after formatting, the non-whitespace
     * content of each line should be preserved.
     *
     * **Validates: Requirements 2.1**
     */
    for_each_formatter_mode_property(
        'Property 2: Non-Whitespace Content Preservation',
        code_with_trailing_whitespace,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // Extract trimmed content from both original and formatted
            // Filter out empty lines to handle trailing newlines added by AST mode
            const original_trimmed = source.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');
            const formatted_trimmed = formatted.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');

            // The trimmed content should be equivalent (ignoring leading indentation changes)
            // For source-preserving mode, content should match exactly after trimming
            // For AST mode, semantic content should be preserved
            if (mode === 'source-preserving') {
                expect(formatted_trimmed).toBe(original_trimmed);
            } else {
                // AST mode may normalize some constructs, but core content should be present
                const original_words = original_trimmed.replace(/\s+/g, ' ').trim();
                const formatted_words = formatted_trimmed.replace(/\s+/g, ' ').trim();
                expect(formatted_words).toBe(original_words);
            }

            return true;
        },
        100
    );


    /**
     * Property 3: Line Count Preservation
     *
     * For any valid Stata source code, after formatting, the number of lines
     * in the output should equal the number of lines in the input.
     *
     * **Validates: Requirements 2.2**
     */
    for_each_formatter_mode_property(
        'Property 3: Line Count Preservation',
        multiline_code_with_trailing_ws,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // Count lines in original and formatted
            const original_line_count = source.split('\n').length;
            const formatted_line_count = formatted.split('\n').length;

            // Line count should be preserved
            // Note: AST mode may add a trailing newline, so we allow +1
            if (mode === 'source-preserving') {
                expect(formatted_line_count).toBe(original_line_count);
            } else {
                // AST mode may add trailing newline
                expect(formatted_line_count).toBeGreaterThanOrEqual(original_line_count);
                expect(formatted_line_count).toBeLessThanOrEqual(original_line_count + 1);
            }

            return true;
        },
        100
    );

    /**
     * Generator for string literals with internal spaces (including trailing spaces within the string)
     */
    const string_content_with_spaces = fc.stringOf(
        fc.constantFrom('a', 'b', 'c', ' ', '1', '2'),
        { minLength: 1, maxLength: 10 }
    ).filter(s => s.includes(' ')); // Ensure at least one space

    const string_literal_with_spaces = string_content_with_spaces.map(s => `"${s}"`);

    /**
     * Property 4: String Literal Content Preservation
     *
     * For any Stata source code containing string literals with internal spaces,
     * after formatting, the string literal content should be unchanged.
     *
     * **Validates: Requirements 1.4**
     */
    for_each_formatter_mode_property(
        'Property 4: String Literal Content Preservation',
        string_literal_with_spaces,
        (mode: FormatterMode, str_lit: string) => {
            const config = create_formatter_config(mode);
            const source = `display ${str_lit}`;
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // String literal should be preserved exactly (including internal spaces)
            expect(formatted).toContain(str_lit);

            return true;
        },
        100
    );


    /**
     * Generator for continuation lines with trailing whitespace after the marker
     */
    const continuation_line_with_trailing_ws = fc.tuple(
        simple_command,
        trailing_whitespace,
        fc.constantFrom('1', '2', 'x', 'y')
    ).map(([cmd, ws, continuation]) => `${cmd} ///${ws}\n    ${continuation}`);

    /**
     * Property 5: Continuation Line Trailing Whitespace Removal
     *
     * For any Stata source code with continuation lines that have trailing
     * whitespace after the continuation marker, after formatting, the trailing
     * whitespace should be removed.
     *
     * **Validates: Requirements 2.3**
     */
    for_each_formatter_mode_property(
        'Property 5: Continuation Line Trailing Whitespace Removal',
        continuation_line_with_trailing_ws,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Check that no line ends with trailing whitespace
            for (const my_line of the_lines) {
                expect(my_line).toBe(my_line.trimEnd());
            }

            // Specifically check that continuation marker line has no trailing whitespace
            const continuation_line = the_lines.find(line => line.includes('///'));
            if (continuation_line) {
                expect(continuation_line.endsWith('///')).toBe(true);
            }

            return true;
        },
        100
    );

    /**
     * Generator for whitespace-only lines
     */
    const whitespace_only_line = fc.stringOf(
        fc.constantFrom(' ', '\t'),
        { minLength: 1, maxLength: 5 }
    );

    const code_with_whitespace_only_lines = fc.tuple(
        simple_command,
        whitespace_only_line,
        simple_command
    ).map(([cmd1, ws_line, cmd2]) => `${cmd1}\n${ws_line}\n${cmd2}`);

    /**
     * Property 1 (whitespace-only lines): Empty Lines Should Have No Whitespace
     *
     * For any Stata source code with whitespace-only lines,
     * after formatting, those lines should be truly empty (no whitespace).
     *
     * **Validates: Requirements 1.3**
     */
    for_each_formatter_mode_property(
        'Property 1 (whitespace-only lines): Empty Lines Should Have No Whitespace',
        code_with_whitespace_only_lines,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Check that no line ends with trailing whitespace
            for (const my_line of the_lines) {
                expect(my_line).toBe(my_line.trimEnd());
            }

            return true;
        },
        100
    );
});
