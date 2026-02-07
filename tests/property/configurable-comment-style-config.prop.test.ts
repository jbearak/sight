import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { validate_comment_formatting_config } from '../../src/utils/config-validator';
import { StataLSPConfig } from '../../src/types';

describe('Configurable Comment Style - Config Validation Property Tests', () => {
    // Feature: configurable-comment-style, Property 2: "line"
    // resolution defers to lineCommentStyle
    // **Validates: Requirements 5.1, 5.3**
    it('should resolve "line" preferredCommentStyle to the lineCommentStyle value', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('//' as const, '*' as const),
                (my_line_comment_style) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            preferredCommentStyle: 'line',
                        } as any,
                        lineCommentStyle: my_line_comment_style,
                    };

                    const my_validated =
                        validate_comment_formatting_config(my_config);

                    // When preferredCommentStyle is 'line', the
                    // resolved style must equal lineCommentStyle
                    expect(
                        my_validated.formatting.preferredCommentStyle
                    ).toBe(my_line_comment_style);
                }
            ),
            { numRuns: 100 }
        );
    });

    // Feature: configurable-comment-style, Property 3: Explicit
    // preferredCommentStyle bypasses lineCommentStyle
    // **Validates: Requirements 5.4**
    it('should use explicit preferredCommentStyle regardless of lineCommentStyle', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    '//' as const,
                    '*' as const,
                    '/* */' as const
                ),
                fc.constantFrom('//' as const, '*' as const),
                (my_preferred_style, my_line_comment_style) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            preferredCommentStyle: my_preferred_style,
                        } as any,
                        lineCommentStyle: my_line_comment_style,
                    };

                    const my_validated =
                        validate_comment_formatting_config(my_config);

                    // When preferredCommentStyle is explicit (not
                    // 'line'), it must be preserved as-is regardless
                    // of lineCommentStyle
                    expect(
                        my_validated.formatting.preferredCommentStyle
                    ).toBe(my_preferred_style);
                }
            ),
            { numRuns: 100 }
        );
    });
});
