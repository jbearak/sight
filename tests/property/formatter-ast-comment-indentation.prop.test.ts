/**
 * Property tests for AST formatter comment indentation.
 *
 * Feature: ast-formatter-comment-indentation
 *
 * These tests verify that the AST formatter correctly indents leading comments
 * to match their scope depth, while trailing comments remain inline.
 */

import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentStore } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import {
    for_each_formatter_mode_async_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('AST Formatter Comment Indentation Property Tests', () => {
    const my_options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
    };

    // Arbitrary for comment content (safe characters only)
    const comment_content_arbitrary = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,15}$/)
        .filter((s) => s.trim().length > 0);

    // Arbitrary for nesting depth (1-3 levels)
    const nesting_depth_arbitrary = fc.integer({ min: 1, max: 3 });

    // Helper to build code with comment at specified depth
    function build_code_with_comment_at_depth(
        depth: number,
        comment_content: string,
        comment_style: 'star' | 'slash'
    ): string {
        const my_indent = '    '.repeat(depth);
        const my_comment = comment_style === 'star'
            ? `* ${comment_content}`
            : `// ${comment_content}`;

        // Build nested structure
        let my_code = '';
        for (let i = 0; i < depth; i++) {
            const my_block_indent = '    '.repeat(i);
            my_code += `${my_block_indent}if 1 {\n`;
        }

        // Add comment and statement at depth
        my_code += `${my_indent}${my_comment}\n`;
        my_code += `${my_indent}display "test"\n`;

        // Close blocks
        for (let i = depth - 1; i >= 0; i--) {
            const my_block_indent = '    '.repeat(i);
            my_code += `${my_block_indent}}\n`;
        }

        return my_code;
    }

    // Helper to count leading spaces
    function count_leading_spaces(line: string): number {
        const my_match = line.match(/^( *)/);
        return my_match ? my_match[1].length : 0;
    }

    // Helper to find comment line in formatted output
    function find_comment_line(formatted: string, comment_content: string): string | undefined {
        const my_lines = formatted.split('\n');
        const my_trimmed_content = comment_content.trim();
        return my_lines.find((line) => {
            const my_trimmed = line.trimStart();
            return (my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) &&
                   line.includes(my_trimmed_content);
        });
    }

    /**
     * Property 1: Leading Comment Indentation Matches Scope Depth
     *
     * For any AST with comments at nesting depth N, when formatted with the
     * AST formatter, each leading comment SHALL have exactly N levels of
     * indentation applied.
     *
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 4.1
     */
    for_each_formatter_mode_async_property(
        'Property 1: leading comment indentation matches scope depth',
        fc.tuple(
            nesting_depth_arbitrary,
            comment_content_arbitrary,
            fc.constantFrom('star', 'slash') as fc.Arbitrary<'star' | 'slash'>
        ),
        async (mode: FormatterMode, [depth, content, style]) => {
            const my_code = build_code_with_comment_at_depth(depth, content, style);

            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_code, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return; // Skip if parsing failed
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            if (my_edits.length === 0) {
                return; // No edits needed
            }

            const my_formatted = my_edits[0].newText;
            const my_comment_line = find_comment_line(my_formatted, content);

            expect(my_comment_line).toBeDefined();
            if (my_comment_line) {
                const my_expected_spaces = depth * 4;
                const my_actual_spaces = count_leading_spaces(my_comment_line);
                expect(my_actual_spaces).toBe(my_expected_spaces);
            }
        },
        100
    );

    /**
     * Property 2: Trailing Comments Remain Inline
     *
     * For any statement with trailing comments, when formatted with the AST
     * formatter, the trailing comment SHALL appear on the same line as the
     * statement, preceded by a space (not indentation).
     *
     * Validates: Requirements 3.1, 3.2
     */
    for_each_formatter_mode_async_property(
        'Property 2: trailing comments remain inline',
        comment_content_arbitrary,
        async (mode: FormatterMode, content) => {
            const my_trimmed_content = content.trim();
            const my_code = `display "hello" // ${my_trimmed_content}`;

            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_code, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return;
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            if (my_edits.length === 0) {
                return;
            }

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n').filter((l) => l.trim().length > 0);

            // Should be single line with both statement and comment
            const my_line_with_comment = my_lines.find((l) => l.includes(my_trimmed_content));
            expect(my_line_with_comment).toBeDefined();
            if (my_line_with_comment) {
                expect(my_line_with_comment).toContain('display');
                expect(my_line_with_comment).toContain(`// ${my_trimmed_content}`);
            }
        },
        100
    );

    /**
     * Property 3: Cross-Formatter Comment Indentation Consistency
     *
     * For any Stata source code with comments, when formatted with both the
     * AST formatter and source-preserving formatter, the comment indentation
     * levels (number of indent units) SHALL be equivalent.
     *
     * Validates: Requirements 4.2
     */
    for_each_formatter_mode_async_property(
        'Property 3: comment indentation consistent across formatter modes',
        fc.tuple(
            nesting_depth_arbitrary,
            comment_content_arbitrary
        ),
        async (mode: FormatterMode, [depth, content]) => {
            const my_code = build_code_with_comment_at_depth(depth, content, 'slash');

            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_code, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return;
            }

            const my_formatter = new CodeFormatter();

            // Format with source-preserving
            const my_sp_config = create_formatter_config('source-preserving');
            const my_sp_edits = my_formatter.format(my_document, my_options, my_sp_config);

            // Format with AST
            const my_ast_config = create_formatter_config('ast');
            const my_ast_edits = my_formatter.format(my_document, my_options, my_ast_config);

            if (my_sp_edits.length === 0 || my_ast_edits.length === 0) {
                return;
            }

            const my_sp_formatted = my_sp_edits[0].newText;
            const my_ast_formatted = my_ast_edits[0].newText;

            const my_sp_comment_line = find_comment_line(my_sp_formatted, content);
            const my_ast_comment_line = find_comment_line(my_ast_formatted, content);

            if (my_sp_comment_line && my_ast_comment_line) {
                const my_sp_indent = count_leading_spaces(my_sp_comment_line);
                const my_ast_indent = count_leading_spaces(my_ast_comment_line);
                expect(my_ast_indent).toBe(my_sp_indent);
            }
        },
        100
    );

    /**
     * Property 1 (depth 0): Top-level comments have no indentation
     *
     * Validates: Requirement 1.3
     */
    for_each_formatter_mode_async_property(
        'Property 1 (depth 0): top-level comments have no indentation',
        comment_content_arbitrary,
        async (mode: FormatterMode, content) => {
            const my_code = `// ${content}\ndisplay "test"`;

            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_code, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return;
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            if (my_edits.length === 0) {
                return;
            }

            const my_formatted = my_edits[0].newText;
            const my_comment_line = find_comment_line(my_formatted, content);

            expect(my_comment_line).toBeDefined();
            if (my_comment_line) {
                const my_indent = count_leading_spaces(my_comment_line);
                expect(my_indent).toBe(0);
            }
        },
        100
    );

    /**
     * Multiple leading comments: all same indentation
     *
     * Validates: Requirement 1.4
     */
    for_each_formatter_mode_async_property(
        'Property 1 (multiple): multiple leading comments have same indentation',
        fc.tuple(
            nesting_depth_arbitrary,
            fc.array(comment_content_arbitrary, { minLength: 2, maxLength: 3 })
        ),
        async (mode: FormatterMode, [depth, contents]) => {
            // Build code with multiple comments before statement
            let my_code = '';
            for (let i = 0; i < depth; i++) {
                const my_block_indent = '    '.repeat(i);
                my_code += `${my_block_indent}if 1 {\n`;
            }

            const my_indent = '    '.repeat(depth);
            for (const my_content of contents) {
                my_code += `${my_indent}// ${my_content}\n`;
            }
            my_code += `${my_indent}display "test"\n`;

            for (let i = depth - 1; i >= 0; i--) {
                const my_block_indent = '    '.repeat(i);
                my_code += `${my_block_indent}}\n`;
            }

            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_code, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return;
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            if (my_edits.length === 0) {
                return;
            }

            const my_formatted = my_edits[0].newText;
            const my_expected_spaces = depth * 4;

            for (const my_content of contents) {
                const my_comment_line = find_comment_line(my_formatted, my_content);
                expect(my_comment_line).toBeDefined();
                if (my_comment_line) {
                    const my_actual_spaces = count_leading_spaces(my_comment_line);
                    expect(my_actual_spaces).toBe(my_expected_spaces);
                }
            }
        },
        100
    );
});
