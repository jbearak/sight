import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    validate_comment_formatting_config,
    is_valid_comment_style,
    is_valid_comment_line_width,
} from '../../src/utils/config-validator';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataLSPConfig } from '../../src/types';

describe('Configuration Validation Property Tests', () => {
    // Property 1: Configuration validation and fallback
    // For any configuration input, invalid preferredCommentStyle values
    // should fall back to the default "//" style, and valid values should
    // be accepted
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should validate and fallback invalid comment styles', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant('//'),
                    fc.constant('*'),
                    fc.constant('/* */'),
                    fc.constant('line'),
                    fc.string({ minLength: 1 }).filter(
                        (s) => s !== '//' && s !== '*' && s !== '/* */' && s !== 'line'
                    ),
                    fc.integer(),
                    fc.boolean(),
                    fc.constant(null)
                ),
                (my_style) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            preferredCommentStyle: my_style as any,
                        } as any,
                    };

                    const my_validated = validate_comment_formatting_config(
                        my_config
                    );

                    // Valid explicit styles should be preserved
                    if (
                        my_style === '//' ||
                        my_style === '*' ||
                        my_style === '/* */'
                    ) {
                        expect(my_validated.formatting.preferredCommentStyle).toBe(
                            my_style
                        );
                    } else if (my_style === 'line') {
                        // 'line' resolves to '//' (default lineCommentStyle)
                        expect(my_validated.formatting.preferredCommentStyle).toBe(
                            '//'
                        );
                    } else {
                        // Invalid styles should fall back to default
                        // ('line' resolved to '//')
                        expect(my_validated.formatting.preferredCommentStyle).toBe(
                            '//'
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Configuration preserves valid values
    // For any valid configuration input, all valid values should be
    // preserved exactly as provided
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should preserve all valid configuration values', () => {
        fc.assert(
            fc.property(
                fc.record({
                    preferredCommentStyle: fc.oneof(
                        fc.constant('//'),
                        fc.constant('*'),
                        fc.constant('/* */')
                    ),
                    normalizeCommentStyle: fc.boolean(),
                    commentLineWidth: fc.integer({ min: 1, max: 200 }),
                    indentSize: fc.integer({ min: 1, max: 8 }),
                }),
                (my_values) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            preferredCommentStyle: my_values.preferredCommentStyle,
                            normalizeCommentStyle: my_values.normalizeCommentStyle,
                            commentLineWidth: my_values.commentLineWidth,
                            indentSize: my_values.indentSize,
                            indentStyle: 'spaces',
                        },
                    };

                    const my_validated = validate_comment_formatting_config(
                        my_config
                    );

                    // All valid values should be preserved
                    expect(
                        my_validated.formatting.preferredCommentStyle
                    ).toBe(my_values.preferredCommentStyle);
                    expect(
                        my_validated.formatting.normalizeCommentStyle
                    ).toBe(my_values.normalizeCommentStyle);
                    expect(my_validated.formatting.commentLineWidth).toBe(
                        my_values.commentLineWidth
                    );
                    expect(my_validated.formatting.indentSize).toBe(
                        my_values.indentSize
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Invalid numeric values fall back to defaults
    // For any invalid numeric configuration value (negative, zero, non-number),
    // the validator should fall back to the default value
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should fallback invalid numeric values to defaults', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.integer({ max: 0 }),
                    fc.float({ noNaN: true, noInfinity: true }).filter(
                        (n) => n <= 0
                    ),
                    fc.string(),
                    fc.boolean(),
                    fc.constant(null)
                ),
                (my_invalid_value) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            commentLineWidth: my_invalid_value as any,
                            indentSize: my_invalid_value as any,
                        } as any,
                    };

                    const my_validated = validate_comment_formatting_config(
                        my_config
                    );

                    // Invalid values should fall back to defaults
                    expect(my_validated.formatting.commentLineWidth).toBe(
                        DEFAULT_SETTINGS.formatting.commentLineWidth
                    );
                    expect(my_validated.formatting.indentSize).toBe(
                        DEFAULT_SETTINGS.formatting.indentSize
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Boolean values are validated correctly
    // For any boolean configuration value, valid booleans should be
    // preserved and non-booleans should fall back to defaults
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should validate boolean configuration values', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.boolean(),
                    fc.string(),
                    fc.integer(),
                    fc.constant(null)
                ),
                (my_value) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {
                            normalizeCommentStyle: my_value as any,
                        } as any,
                    };

                    const my_validated = validate_comment_formatting_config(
                        my_config
                    );

                    // Valid booleans should be preserved
                    if (typeof my_value === 'boolean') {
                        expect(
                            my_validated.formatting.normalizeCommentStyle
                        ).toBe(my_value);
                    } else {
                        // Invalid values should fall back to defaults
                        expect(
                            my_validated.formatting.normalizeCommentStyle
                        ).toBe(
                            DEFAULT_SETTINGS.formatting.normalizeCommentStyle
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Undefined config returns defaults
    // For any undefined or null configuration, the validator should return
    // the default configuration
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should return defaults for undefined config', () => {
        fc.assert(
            fc.property(fc.oneof(fc.constant(undefined), fc.constant(null)), (my_config) => {
                const my_validated = validate_comment_formatting_config(
                    my_config as any
                );

                // Should match defaults exactly
                expect(my_validated.formatting.preferredCommentStyle).toBe(
                    DEFAULT_SETTINGS.formatting.preferredCommentStyle
                );
                expect(my_validated.formatting.normalizeCommentStyle).toBe(
                    DEFAULT_SETTINGS.formatting.normalizeCommentStyle
                );
                expect(my_validated.formatting.commentLineWidth).toBe(
                    DEFAULT_SETTINGS.formatting.commentLineWidth
                );
            }),
            { numRuns: 10 }
        );
    });

    // Property: Partial config merges with defaults
    // For any partial configuration, missing properties should be filled
    // with defaults while provided properties are preserved
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should merge partial config with defaults', () => {
        fc.assert(
            fc.property(
                fc.record({
                    hasPreferredStyle: fc.boolean(),
                    hasNormalize: fc.boolean(),
                    hasLineWidth: fc.boolean(),
                }),
                (my_flags) => {
                    const my_config: Partial<StataLSPConfig> = {
                        formatting: {} as any,
                    };

                    if (my_flags.hasPreferredStyle) {
                        (my_config.formatting as any).preferredCommentStyle =
                            '//';
                    }
                    if (my_flags.hasNormalize) {
                        (my_config.formatting as any).normalizeCommentStyle =
                            true;
                    }
                    if (my_flags.hasLineWidth) {
                        (my_config.formatting as any).commentLineWidth = 80;
                    }

                    const my_validated = validate_comment_formatting_config(
                        my_config
                    );

                    // Provided values should be preserved
                    if (my_flags.hasPreferredStyle) {
                        expect(
                            my_validated.formatting.preferredCommentStyle
                        ).toBe('//');
                    } else {
                        // Default is 'line' which resolves to '//'
                        // when no lineCommentStyle is provided
                        expect(
                            my_validated.formatting.preferredCommentStyle
                        ).toBe('//');
                    }

                    if (my_flags.hasNormalize) {
                        expect(
                            my_validated.formatting.normalizeCommentStyle
                        ).toBe(true);
                    } else {
                        expect(
                            my_validated.formatting.normalizeCommentStyle
                        ).toBe(
                            DEFAULT_SETTINGS.formatting.normalizeCommentStyle
                        );
                    }

                    if (my_flags.hasLineWidth) {
                        expect(my_validated.formatting.commentLineWidth).toBe(
                            80
                        );
                    } else {
                        expect(my_validated.formatting.commentLineWidth).toBe(
                            DEFAULT_SETTINGS.formatting.commentLineWidth
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Helper functions validate correctly
    // For any input value, the helper functions should correctly identify
    // valid comment styles and line widths
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should validate comment styles with helper function', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant('//'),
                    fc.constant('*'),
                    fc.constant('/* */'),
                    fc.constant('line'),
                    fc.string({ minLength: 1 }).filter(
                        (s) =>
                            s !== '//' &&
                            s !== '*' &&
                            s !== '/* */' &&
                            s !== 'line'
                    ),
                    fc.integer(),
                    fc.constant(null)
                ),
                (my_style) => {
                    const my_is_valid = is_valid_comment_style(my_style);

                    if (
                        my_style === 'line' ||
                        my_style === '//' ||
                        my_style === '*' ||
                        my_style === '/* */'
                    ) {
                        expect(my_is_valid).toBe(true);
                    } else {
                        expect(my_is_valid).toBe(false);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Property: Line width validation helper
    // For any input value, the line width helper should correctly identify
    // valid positive numbers
    // Feature: comment-style-normalization, Property 1: Configuration
    // validation and fallback
    // Validates: Requirements 1.2, 1.4, 11.2
    it('should validate line width with helper function', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.integer({ min: 1, max: 200 }),
                    fc.integer({ max: 0 }),
                    fc.float({ noNaN: true, noInfinity: true }),
                    fc.string(),
                    fc.constant(null)
                ),
                (my_width) => {
                    const my_is_valid = is_valid_comment_line_width(my_width);

                    if (typeof my_width === 'number' && my_width > 0) {
                        expect(my_is_valid).toBe(true);
                    } else {
                        expect(my_is_valid).toBe(false);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('validate_comment_formatting_config — cross_file.diagnostics.case_mismatch', () => {
    it('defaults case_mismatch to "auto" when absent', () => {
        const my_validated = validate_comment_formatting_config({});
        expect(my_validated.cross_file.diagnostics.case_mismatch).toBe('auto');
    });

    it('accepts "auto" for case_mismatch', () => {
        const my_validated = validate_comment_formatting_config({
            cross_file: {
                diagnostics: { case_mismatch: 'auto' },
            } as any,
        });
        expect(my_validated.cross_file.diagnostics.case_mismatch).toBe('auto');
    });

    it('accepts all valid case_mismatch severities', () => {
        const the_valid_values = [
            'error', 'warning', 'information', 'off',
        ] as const;
        for (const my_value of the_valid_values) {
            const my_validated = validate_comment_formatting_config({
                cross_file: {
                    diagnostics: { case_mismatch: my_value },
                } as any,
            });
            expect(my_validated.cross_file.diagnostics.case_mismatch).toBe(
                my_value
            );
        }
    });

    it('normalizes "info" alias to "information" for case_mismatch', () => {
        const my_validated = validate_comment_formatting_config({
            cross_file: {
                diagnostics: { case_mismatch: 'info' as any },
            } as any,
        });
        expect(my_validated.cross_file.diagnostics.case_mismatch).toBe(
            'information'
        );
    });

    it('falls back to "auto" and warns on invalid case_mismatch', () => {
        const the_warnings: string[] = [];
        const my_validated = validate_comment_formatting_config(
            {
                cross_file: {
                    diagnostics: { case_mismatch: 'bogus' as any },
                } as any,
            },
            (msg) => the_warnings.push(msg)
        );
        expect(my_validated.cross_file.diagnostics.case_mismatch).toBe('auto');
        expect(the_warnings.length).toBeGreaterThan(0);
    });

    it('"auto" is NOT accepted as a valid missing_file severity', () => {
        // "auto" is only valid for case_mismatch, not for the other
        // cross-file severity fields. The validator must keep them separate.
        const my_validated = validate_comment_formatting_config(
            {
                cross_file: {
                    diagnostics: { missing_file: 'auto' as any },
                } as any,
            }
        );
        // missing_file must not be set to 'auto'; default 'warning' is kept
        expect(my_validated.cross_file.diagnostics.missing_file).toBe('warning');
        expect(my_validated.cross_file.diagnostics.missing_file).not.toBe('auto');
    });
});
