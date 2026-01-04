/**
 * Property Tests: Formatter Embedded Block Indentation Correctness
 *
 * Feature: mata-block-end-handling
 * Property 3: Formatter embedded block indentation correctness
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * Tests that the formatter correctly recognizes Mata/Python blocks as block
 * structures and applies correct indentation to both the opening delimiter
 * (mata/python) and closing delimiter (end).
 * 
 * IMPORTANT: The opening delimiter (mata/python) and closing delimiter (end)
 * are Stata keywords, NOT part of the embedded language. The formatter MUST
 * apply correct indentation to these delimiters regardless of their original
 * indentation in the source.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from './helpers/document-utils';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Formatter Embedded Block Indentation Properties', () => {
    const formatter = new CodeFormatter();

    // Generator for embedded block language
    const language_arb = fc.constantFrom('mata', 'python');

    // Generator for simple Mata/Python content (single line)
    const embedded_content_arb = fc.constantFrom(
        'x = 1',
        'display("hello")',
        'y = 2 + 3',
        'st_local("result", "value")'
    );

    // Generator for simple Stata statements
    const stata_statement_arb = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'count',
        'clear'
    );

    // Generator for incorrect indentation amounts (0, 8, 12 spaces - not the correct 4)
    const wrong_indent_arb = fc.constantFrom(0, 8, 12);

    /**
     * Helper to count leading spaces in a line.
     */
    function count_leading_spaces(line: string): number {
        const match = line.match(/^(\s*)/);
        if (!match) return 0;
        let count = 0;
        for (const ch of match[1]) {
            if (ch === '\t') {
                count += 4; // Assume 4-space tabs
            } else {
                count += 1;
            }
        }
        return count;
    }

    /**
     * Helper to find a line containing a specific keyword after a given line index.
     */
    function find_line_with_keyword_after(lines: string[], keyword: string, after_index: number): { line: string; index: number } | null {
        for (let i = after_index + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith(keyword)) {
                return { line: lines[i], index: i };
            }
        }
        return null;
    }

    /**
     * Helper to find a line containing a specific keyword.
     */
    function find_line_with_keyword(lines: string[], keyword: string): { line: string; index: number } | null {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith(keyword)) {
                return { line: lines[i], index: i };
            }
        }
        return null;
    }

    /**
     * Helper to make indentation string.
     */
    function make_indent(spaces: number): string {
        return ' '.repeat(spaces);
    }

    /**
     * Property 3: Formatter corrects under-indented opening delimiter
     *
     * For any Mata or Python block inside an if block where the opening
     * delimiter has incorrect (under) indentation, the formatter SHALL
     * correct it to the proper depth (4 spaces for depth 1).
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2
     */
    for_each_formatter_mode_property(
        'Property 3: Formatter corrects under-indented opening delimiter',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            // Opening delimiter has NO indentation (should be 4 spaces)
            const source = `if 1 {
${language}
${content}
end
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits is a failure - the formatter should have corrected the indentation
                return false;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Should be corrected to 4 spaces (depth 1)
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(4);

            return true;
        },
        100
    );

    /**
     * Property 3: Formatter corrects under-indented closing delimiter
     *
     * For any Mata or Python block inside an if block where the closing
     * delimiter (end) has incorrect (under) indentation, the formatter SHALL
     * correct it to the proper depth (4 spaces for depth 1).
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.3
     */
    for_each_formatter_mode_property(
        'Property 3: Formatter corrects under-indented closing delimiter',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            // Closing delimiter has NO indentation (should be 4 spaces)
            const source = `if 1 {
    ${language}
    ${content}
end
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits is a failure - the formatter should have corrected the indentation
                return false;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Find the end line for the embedded block
            let end_line: { line: string; index: number } | null = null;
            for (let i = lang_line!.index + 1; i < lines.length; i++) {
                if (lines[i].trim() === 'end') {
                    end_line = { line: lines[i], index: i };
                    break;
                }
            }
            expect(end_line).not.toBeNull();

            // End should be corrected to 4 spaces (depth 1, same as opening)
            const end_indent = count_leading_spaces(end_line!.line);
            expect(end_indent).toBe(4);

            return true;
        },
        100
    );

    /**
     * Property 3: Formatter corrects over-indented delimiters
     *
     * For any Mata or Python block inside an if block where both delimiters
     * have incorrect (over) indentation, the formatter SHALL correct them
     * to the proper depth (4 spaces for depth 1).
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 3: Formatter corrects over-indented delimiters',
        fc.tuple(language_arb, embedded_content_arb, wrong_indent_arb),
        (mode: FormatterMode, [language, content, wrong_indent]) => {
            // Both delimiters have wrong indentation
            const indent_str = make_indent(wrong_indent);
            const source = `if 1 {
${indent_str}${language}
${indent_str}${content}
${indent_str}end
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            // If wrong_indent is 0, we expect edits. If it's 8 or 12, we also expect edits.
            // The only case where no edits is acceptable is if wrong_indent happens to be 4.
            if (edits.length === 0 && wrong_indent !== 4) {
                return false;
            }

            if (edits.length === 0) {
                return true; // No edits needed if already correct
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Opening delimiter should be at 4 spaces (depth 1)
            const lang_indent = count_leading_spaces(lang_line!.line);
            expect(lang_indent).toBe(4);

            // Find the end line for the embedded block
            let end_line: { line: string; index: number } | null = null;
            for (let i = lang_line!.index + 1; i < lines.length; i++) {
                if (lines[i].trim() === 'end') {
                    end_line = { line: lines[i], index: i };
                    break;
                }
            }
            expect(end_line).not.toBeNull();

            // Closing delimiter should also be at 4 spaces (depth 1)
            const end_indent = count_leading_spaces(end_line!.line);
            expect(end_indent).toBe(4);

            return true;
        },
        100
    );

    /**
     * Property 3: Top-level embedded block has no extra indentation
     *
     * For any Mata or Python block at the top level, the formatter SHALL NOT
     * add extra indentation to the opening delimiter.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2
     */
    for_each_formatter_mode_property(
        'Property 3: Top-level embedded block has no extra indentation',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            const source = `${language}
${content}
end`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits means content unchanged, which is fine
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Top-level: should have 0 indentation
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(0);

            return true;
        },
        100
    );

    /**
     * Property 3: Embedded block inside if has correct indentation
     *
     * For any Mata or Python block inside an if block, the formatter SHALL
     * set the opening delimiter at depth 1 (4 spaces with default settings).
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 3: Embedded block inside if has correct indentation',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            const source = `if 1 {
    ${language}
    ${content}
    end
    ${after_stmt}
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Inside if block: should have 4 spaces (depth 1)
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(4);

            return true;
        },
        100
    );

    /**
     * Property 3: Embedded block end delimiter has same indentation as start
     *
     * For any Mata or Python block, the `end` delimiter SHALL have the same
     * indentation as the opening delimiter.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.3
     */
    for_each_formatter_mode_property(
        'Property 3: Embedded block end delimiter has same indentation as start',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            const source = `if 1 {
    ${language}
    ${content}
    end
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Find the end line for the embedded block (not the closing brace)
            // The end for mata/python should be before the closing brace
            let end_line: { line: string; index: number } | null = null;
            for (let i = lang_line!.index + 1; i < lines.length; i++) {
                if (lines[i].trim() === 'end') {
                    end_line = { line: lines[i], index: i };
                    break;
                }
            }
            expect(end_line).not.toBeNull();

            // Both should have the same indentation
            const lang_indent = count_leading_spaces(lang_line!.line);
            const end_indent = count_leading_spaces(end_line!.line);
            expect(end_indent).toBe(lang_indent);

            return true;
        },
        100
    );

    /**
     * Property 3: Deeply nested embedded block has correct indentation
     *
     * For Mata/Python blocks nested inside multiple control structures,
     * the formatter SHALL set the opening delimiter at the correct cumulative depth.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.3, 4.5
     */
    for_each_formatter_mode_property(
        'Property 3: Deeply nested embedded block has correct indentation',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            // Nested: if > foreach > mata/python
            const source = `if 1 {
    foreach x in a b {
        ${language}
        ${content}
        end
    }
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Inside if > foreach: should have 8 spaces (depth 2)
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(8);

            return true;
        },
        100
    );

    /**
     * Property 3: Embedded block inside program has correct indentation
     *
     * For any Mata or Python block inside a program, the formatter SHALL
     * set the opening delimiter at depth 1.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.5
     */
    for_each_formatter_mode_property(
        'Property 3: Embedded block inside program has correct indentation',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            const source = `program define test
    ${language}
    ${content}
    end
end`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Inside program: should have 4 spaces (depth 1)
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(4);

            return true;
        },
        100
    );

    /**
     * Property 3: Formatter preserves correct indentation of embedded block
     *
     * For any Mata or Python block that is already correctly indented,
     * the formatter SHALL NOT change its indentation. This tests that
     * the IndentationAnalyzer recognizes embedded_block nodes and
     * computes the correct depth.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.4
     */
    for_each_formatter_mode_property(
        'Property 3: Formatter preserves correct indentation of embedded block',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            // Start with correctly indented code (4 spaces for depth 1)
            const source = `if 1 {
    ${language}
    ${content}
    end
    ${after_stmt}
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits means content unchanged, which is correct
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Should remain at 4 spaces (depth 1), not be changed
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(4);

            // Find the end line for the embedded block
            let end_line_index = -1;
            for (let i = lang_line!.index + 1; i < lines.length; i++) {
                if (lines[i].trim() === 'end') {
                    end_line_index = i;
                    break;
                }
            }

            // The statement after the embedded block should also be at depth 1
            // Look for it AFTER the end line to avoid matching content inside the embedded block
            if (end_line_index >= 0) {
                const after_line = find_line_with_keyword_after(lines, after_stmt.split(' ')[0], end_line_index);
                if (after_line) {
                    const after_indent = count_leading_spaces(after_line.line);
                    expect(after_indent).toBe(4);
                }
            }

            return true;
        },
        100
    );

    /**
     * Property 3: Embedded block inside foreach has correct indentation
     *
     * For any Mata or Python block inside a foreach loop, the formatter SHALL
     * set the opening delimiter at depth 1.
     *
     * Feature: mata-block-end-handling, Property 3: Formatter embedded block indentation correctness
     * Validates: Requirements 4.1, 4.2, 4.5
     */
    for_each_formatter_mode_property(
        'Property 3: Embedded block inside foreach has correct indentation',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            const source = `foreach x in a b c {
    ${language}
    ${content}
    end
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const lines = formatted.split('\n');

            // Find the line with the language keyword (mata/python)
            const lang_line = find_line_with_keyword(lines, language);
            expect(lang_line).not.toBeNull();

            // Inside foreach: should have 4 spaces (depth 1)
            const indent = count_leading_spaces(lang_line!.line);
            expect(indent).toBe(4);

            return true;
        },
        100
    );
});
