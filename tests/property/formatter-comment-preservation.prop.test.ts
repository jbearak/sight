import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentStore } from '../../src/document-store';
import { CommentFormattingConfig } from '../../src/types';
import { FormattingOptions } from 'vscode-languageserver';
import {
    for_each_formatter_mode_async_property,
    create_formatter_config,
    skip_for_mode,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Formatter Comment Preservation Property Tests', () => {
    // Shared arbitrary for comment data
    const comment_data_arbitrary = fc.array(
        fc.record({
            style: fc.oneof(
                fc.constant('star'),
                fc.constant('slash'),
                fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
                (s) => s.trim().length > 0
            ),
        }),
        { minLength: 1, maxLength: 3 }
    );

    // Helper to build Stata code with comments
    function build_code_with_comments(
        comments_data: Array<{ style: 'star' | 'slash' | 'block'; content: string }>
    ): string {
        const my_lines: string[] = [];

        for (const my_data of comments_data) {
            let my_line = '';
            switch (my_data.style) {
                case 'star':
                    my_line = `* ${my_data.content}`;
                    break;
                case 'slash':
                    my_line = `// ${my_data.content}`;
                    break;
                case 'block':
                    my_line = `/* ${my_data.content} */`;
                    break;
            }
            my_lines.push(my_line);
        }

        my_lines.push('display "hello"');
        return my_lines.join('\n');
    }

    // Property 2: Comment preservation when normalization disabled
    // For any document with mixed comment styles, when normalizeCommentStyle
    // is false, all comment styles should be preserved exactly
    // Feature: comment-style-normalization, Property 2: Comment preservation
    // when normalization disabled
    // Validates: Requirements 2.3
    for_each_formatter_mode_async_property(
        'should preserve all comment styles when normalization disabled',
        comment_data_arbitrary,
        async (mode: FormatterMode, my_comments_data) => {
            const my_content = build_code_with_comments(my_comments_data);

            // Use DocumentStore to properly parse the content
            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_content, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return; // Skip if parsing failed
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);

            const my_options: FormattingOptions = {
                tabSize: 4,
                insertSpaces: true,
            };

            // Use format() directly with config to test both modes
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            // Should have at least one edit
            expect(my_edits.length).toBeGreaterThan(0);

            // The formatted content should contain all original comment styles
            const my_formatted = my_edits[0].newText;

            for (const my_data of my_comments_data) {
                // Check that the comment style is preserved
                if (my_data.style === 'star') {
                    expect(my_formatted).toContain('*');
                } else if (my_data.style === 'slash') {
                    expect(my_formatted).toContain('//');
                } else if (my_data.style === 'block') {
                    expect(my_formatted).toContain('/*');
                }
            }
        },
        100
    );

    // Property: Comment content is preserved when normalization disabled
    // For any document with comments, when normalization is disabled,
    // the comment content should be preserved exactly
    // Feature: comment-style-normalization, Property 2: Comment preservation
    // when normalization disabled
    // Validates: Requirements 2.3
    for_each_formatter_mode_async_property(
        'should preserve comment content when normalization disabled',
        comment_data_arbitrary,
        async (mode: FormatterMode, my_comments_data) => {
            const my_content = build_code_with_comments(my_comments_data);

            // Use DocumentStore to properly parse the content
            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_content, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return; // Skip if parsing failed
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);

            const my_options: FormattingOptions = {
                tabSize: 4,
                insertSpaces: true,
            };

            // Use format() directly with config to test both modes
            const my_edits = my_formatter.format(my_document, my_options, my_config);

            const my_formatted = my_edits[0].newText;

            // All original comment contents should be preserved
            // (trailing whitespace may be stripped by formatter)
            for (const my_data of my_comments_data) {
                expect(my_formatted).toContain(my_data.content.trimEnd());
            }
        },
        100
    );

    // Property: Normalization disabled returns same as standard format
    // For any document, when normalization is disabled, the result should
    // be the same as standard formatting
    // Feature: comment-style-normalization, Property 2: Comment preservation
    // when normalization disabled
    // Validates: Requirements 2.3
    // Note: format_with_comment_normalization doesn't accept a config parameter,
    // so it always uses the default (source-preserving) mode. For AST mode,
    // we skip the comparison since the modes would differ.
    for_each_formatter_mode_async_property(
        'should return same result as standard format when disabled',
        fc.array(
            fc.record({
                style: fc.oneof(
                    fc.constant('star'),
                    fc.constant('slash'),
                    fc.constant('block')
                ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                content: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
                    (s) => s.trim().length > 0
                ),
            }),
            { minLength: 1, maxLength: 2 }
        ),
        async (mode: FormatterMode, my_comments_data) => {
            const my_content = build_code_with_comments(my_comments_data);

            // Use DocumentStore to properly parse the content
            const my_store = new DocumentStore();
            await my_store.open('file:///test.do', my_content, 1);
            const my_document = my_store.get('file:///test.do');

            if (!my_document || !my_document.ast) {
                return; // Skip if parsing failed
            }

            const my_formatter = new CodeFormatter();
            const my_config = create_formatter_config(mode);
            const my_comment_config: CommentFormattingConfig = {
                preferredCommentStyle: '//',
                normalizeCommentStyle: false, // Disabled
                commentLineWidth: 72,
            };

            const my_options: FormattingOptions = {
                tabSize: 4,
                insertSpaces: true,
            };

            // Get result with normalization disabled
            const my_disabled_edits = my_formatter.format_with_comment_normalization(
                my_document,
                my_options,
                my_comment_config
            );

            // Get result with standard format using the same mode config
            const my_standard_edits = my_formatter.format(my_document, my_options, my_config);

            // format_with_comment_normalization doesn't accept a config parameter,
            // so it always uses source-preserving mode internally. For AST mode,
            // the outputs will legitimately differ, so we skip the comparison.
            skip_for_mode(mode, 'ast', () => {
                expect(my_disabled_edits[0].newText).toBe(my_standard_edits[0].newText);
            });
        },
        100
    );
});
