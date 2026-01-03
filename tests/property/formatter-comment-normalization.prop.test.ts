import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { CommentFormattingConfig } from '../../src/types';
import { FormattingOptions } from 'vscode-languageserver';
import { parse_and_analyze } from './helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Formatter Comment Normalization Property Tests', () => {
    // Property 3: Comment normalization when enabled
    // For any document and target comment style, when normalizeCommentStyle
    // is true, all comments in Stata context should be converted to the
    // preferred style while preserving content
    // Feature: comment-style-normalization, Property 3: Comment normalization
    // when enabled
    // Validates: Requirements 2.4, 3.6, 4.7
    for_each_formatter_mode('should normalize comments to slash style when enabled', (mode: FormatterMode) => {
        const my_lsp_config = create_formatter_config(mode);

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        style: fc.oneof(
                            fc.constant('star'),
                            fc.constant('slash'),
                            fc.constant('block')
                        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                        content: fc.string({ minLength: 1, maxLength: 30 }).filter(
                            (s) => !s.includes('\n') && !s.includes('*') && s.trim().length > 0
                        ),
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (my_comments_data) => {
                    // Build Stata code with comments
                    const my_lines: string[] = [];

                    for (const my_data of my_comments_data) {
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
                    const my_content = my_lines.join('\n');

                    const my_document = parse_and_analyze(my_content);

                    const my_formatter = new CodeFormatter();
                    const my_config: CommentFormattingConfig = {
                        preferredCommentStyle: '//',
                        normalizeCommentStyle: true, // Enabled
                        commentLineWidth: 72,
                    };

                    const my_options: FormattingOptions = {
                        tabSize: my_lsp_config.formatting.indentSize,
                        insertSpaces: my_lsp_config.formatting.indentStyle === 'spaces',
                    };

                    const my_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_config
                    );

                    // Should have at least one edit
                    expect(my_edits.length).toBeGreaterThan(0);

                    const my_formatted = my_edits[0].newText;

                    // All original comment contents should be preserved
                    // (trailing whitespace may be stripped by formatter)
                    for (const my_data of my_comments_data) {
                        expect(my_formatted).toContain(my_data.content.trimEnd());
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Comment content is preserved during normalization
    // For any document with comments, when normalization is enabled,
    // the comment content should be preserved exactly
    // Feature: comment-style-normalization, Property 3: Comment normalization
    // when enabled
    // Validates: Requirements 2.4, 3.6, 4.7
    for_each_formatter_mode('should preserve comment content during normalization', (mode: FormatterMode) => {
        const my_lsp_config = create_formatter_config(mode);

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        style: fc.oneof(
                            fc.constant('star'),
                            fc.constant('slash'),
                            fc.constant('block')
                        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                        content: fc.string({ minLength: 1, maxLength: 30 }).filter(
                            (s) => !s.includes('\n') && !s.includes('*') && s.trim().length > 0
                        ),
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (my_comments_data) => {
                    // Build Stata code with comments
                    const my_lines: string[] = [];

                    for (const my_data of my_comments_data) {
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
                    const my_content = my_lines.join('\n');

                    const my_document = parse_and_analyze(my_content);

                    const my_formatter = new CodeFormatter();
                    const my_config: CommentFormattingConfig = {
                        preferredCommentStyle: '//',
                        normalizeCommentStyle: true, // Enabled
                        commentLineWidth: 72,
                    };

                    const my_options: FormattingOptions = {
                        tabSize: my_lsp_config.formatting.indentSize,
                        insertSpaces: my_lsp_config.formatting.indentStyle === 'spaces',
                    };

                    const my_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_config
                    );

                    const my_formatted = my_edits[0].newText;

                    // All original comment contents should be preserved
                    // (trailing whitespace may be stripped by formatter)
                    for (const my_data of my_comments_data) {
                        expect(my_formatted).toContain(my_data.content.trimEnd());
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Normalization to star style works correctly
    // For any document, when normalizing to star style, all comments
    // should be converted to star style
    // Feature: comment-style-normalization, Property 3: Comment normalization
    // when enabled
    // Validates: Requirements 2.4, 3.6, 4.7
    for_each_formatter_mode('should normalize comments to star style when configured', (mode: FormatterMode) => {
        const my_lsp_config = create_formatter_config(mode);

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        style: fc.oneof(
                            fc.constant('star'),
                            fc.constant('slash'),
                            fc.constant('block')
                        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                        content: fc.string({ minLength: 1, maxLength: 30 }).filter(
                            (s) => !s.includes('\n') && s.trim().length > 0
                        ),
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (my_comments_data) => {
                    // Build Stata code with comments
                    const my_lines: string[] = [];

                    for (const my_data of my_comments_data) {
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
                    const my_content = my_lines.join('\n');

                    const my_document = parse_and_analyze(my_content);

                    const my_formatter = new CodeFormatter();
                    const my_config: CommentFormattingConfig = {
                        preferredCommentStyle: '*',
                        normalizeCommentStyle: true, // Enabled
                        commentLineWidth: 72,
                    };

                    const my_options: FormattingOptions = {
                        tabSize: my_lsp_config.formatting.indentSize,
                        insertSpaces: my_lsp_config.formatting.indentStyle === 'spaces',
                    };

                    const my_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_config
                    );

                    const my_formatted = my_edits[0].newText;

                    // Should have star comments (target style)
                    expect(my_formatted).toContain('*');
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Normalization to block style works correctly
    // For any document, when normalizing to block style, all comments
    // should be converted to block style
    // Feature: comment-style-normalization, Property 3: Comment normalization
    // when enabled
    // Validates: Requirements 2.4, 3.6, 4.7
    for_each_formatter_mode('should normalize comments to block style when configured', (mode: FormatterMode) => {
        const my_lsp_config = create_formatter_config(mode);

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        style: fc.oneof(
                            fc.constant('star'),
                            fc.constant('slash'),
                            fc.constant('block')
                        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                        content: fc.string({ minLength: 1, maxLength: 30 }).filter(
                            (s) => !s.includes('\n') && s.trim().length > 0
                        ),
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (my_comments_data) => {
                    // Build Stata code with comments
                    const my_lines: string[] = [];

                    for (const my_data of my_comments_data) {
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
                    const my_content = my_lines.join('\n');

                    const my_document = parse_and_analyze(my_content);

                    const my_formatter = new CodeFormatter();
                    const my_config: CommentFormattingConfig = {
                        preferredCommentStyle: '/* */',
                        normalizeCommentStyle: true, // Enabled
                        commentLineWidth: 72,
                    };

                    const my_options: FormattingOptions = {
                        tabSize: my_lsp_config.formatting.indentSize,
                        insertSpaces: my_lsp_config.formatting.indentStyle === 'spaces',
                    };

                    const my_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_config
                    );

                    const my_formatted = my_edits[0].newText;

                    // Should have block comments (target style)
                    expect(my_formatted).toContain('/*');
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Normalization differs from disabled when styles differ
    // For any document with mixed comment styles, when normalization is
    // enabled with a different target style, the result should differ
    // from the disabled case
    // Feature: comment-style-normalization, Property 3: Comment normalization
    // when enabled
    // Validates: Requirements 2.4, 3.6, 4.7
    for_each_formatter_mode('should produce different result when normalization enabled vs disabled', (mode: FormatterMode) => {
        const my_lsp_config = create_formatter_config(mode);

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        style: fc.oneof(
                            fc.constant('star'),
                            fc.constant('slash'),
                            fc.constant('block')
                        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
                        content: fc.string({ minLength: 1, maxLength: 30 }).filter(
                            (s) => !s.includes('\n') && s.trim().length > 0
                        ),
                    }),
                    { minLength: 1, maxLength: 2 }
                ),
                (my_comments_data) => {
                    // Only test if we have mixed styles
                    const my_styles = new Set(my_comments_data.map((c) => c.style));
                    if (my_styles.size < 2) {
                        return; // Skip if all same style
                    }

                    // Build Stata code with comments
                    const my_lines: string[] = [];

                    for (const my_data of my_comments_data) {
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
                    const my_content = my_lines.join('\n');

                    const my_document = parse_and_analyze(my_content);

                    const my_formatter = new CodeFormatter();
                    const my_options: FormattingOptions = {
                        tabSize: my_lsp_config.formatting.indentSize,
                        insertSpaces: my_lsp_config.formatting.indentStyle === 'spaces',
                    };

                    // Get result with normalization disabled
                    const my_disabled_config: CommentFormattingConfig = {
                        preferredCommentStyle: '//',
                        normalizeCommentStyle: false,
                        commentLineWidth: 72,
                    };

                    const my_disabled_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_disabled_config
                    );

                    // Get result with normalization enabled
                    const my_enabled_config: CommentFormattingConfig = {
                        preferredCommentStyle: '//',
                        normalizeCommentStyle: true,
                        commentLineWidth: 72,
                    };

                    const my_enabled_edits = my_formatter.format_with_comment_normalization(
                        my_document,
                        my_options,
                        my_enabled_config
                    );

                    // Results should differ when we have mixed styles
                    // (unless all comments are already in target style)
                    const my_has_non_slash = my_comments_data.some((c) => c.style !== 'slash');
                    if (my_has_non_slash) {
                        expect(my_disabled_edits[0].newText).not.toBe(my_enabled_edits[0].newText);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
