import { describe, it, expect } from 'bun:test';
import {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    STRING_SCOPE_PREFIX,
    MACRO_SCOPE_PREFIX,
    SCOPE_SUFFIX,
    PALETTE_HEX_VALUES,
    isSightOwnedDepthRule,
    removeSightOwnedDepthRules,
    TextMateRule,
    TokenColorCustomizations
} from '../../client/src/depth-colors-core';

describe('PALETTE_HEX_VALUES', () => {
    it('contains every hex from all four palettes, uppercased', () => {
        const the_expected = [
            ...DARK_STRING_COLORS,
            ...DARK_MACRO_COLORS,
            ...LIGHT_STRING_COLORS,
            ...LIGHT_MACRO_COLORS,
        ].map(h => h.toUpperCase());
        for (const my_hex of the_expected) {
            expect(PALETTE_HEX_VALUES.has(my_hex)).toBe(true);
        }
    });

    it('has 24 distinct hexes (no cross-palette duplicates)', () => {
        expect(PALETTE_HEX_VALUES.size).toBe(24);
    });
});

describe('isSightOwnedDepthRule', () => {
    const make_rule = (scope: string, foreground: string): TextMateRule => ({
        scope,
        settings: { foreground },
    });

    it('returns true for every palette hex on a depth-1 string scope', () => {
        const the_scope = `${STRING_SCOPE_PREFIX}1${SCOPE_SUFFIX}`;
        for (const my_hex of DARK_STRING_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
        for (const my_hex of LIGHT_STRING_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
    });

    it('returns true for every palette hex on a depth-1 macro scope', () => {
        const the_scope = `${MACRO_SCOPE_PREFIX}1${SCOPE_SUFFIX}`;
        for (const my_hex of DARK_MACRO_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
        for (const my_hex of LIGHT_MACRO_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
    });

    it('matches hex values case-insensitively', () => {
        const the_rule = make_rule(
            `${STRING_SCOPE_PREFIX}1${SCOPE_SUFFIX}`,
            DARK_STRING_COLORS[0].toLowerCase()
        );
        expect(isSightOwnedDepthRule(the_rule)).toBe(true);
    });

    it('returns false for a depth scope with a non-palette hex', () => {
        const the_rule = make_rule(
            `${STRING_SCOPE_PREFIX}3${SCOPE_SUFFIX}`,
            '#FF00FF'
        );
        expect(isSightOwnedDepthRule(the_rule)).toBe(false);
    });

    it('returns false for a non-depth scope even with a palette hex', () => {
        const the_rule = make_rule('comment.line.stata', DARK_STRING_COLORS[0]);
        expect(isSightOwnedDepthRule(the_rule)).toBe(false);
    });
});

describe('removeSightOwnedDepthRules', () => {
    const depth_rule = (prefix: string, depth: number, foreground: string): TextMateRule => ({
        scope: `${prefix}${depth}${SCOPE_SUFFIX}`,
        settings: { foreground },
    });

    const non_depth_rule: TextMateRule = {
        scope: 'comment.line.stata',
        settings: { foreground: '#808080' },
    };

    it('returns an empty object for undefined input', () => {
        expect(removeSightOwnedDepthRules(undefined)).toEqual({});
    });

    it('removes Sight-owned rules from [*Dark*], [*Light*], and top-level', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                    depth_rule(MACRO_SCOPE_PREFIX, 2, DARK_MACRO_COLORS[1]),
                ],
            },
            '[*Light*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, LIGHT_STRING_COLORS[0]),
                ],
            },
            textMateRules: [
                depth_rule(MACRO_SCOPE_PREFIX, 1, DARK_MACRO_COLORS[0]),
            ],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']?.textMateRules).toEqual([]);
        expect(the_result['[*Light*]']?.textMateRules).toEqual([]);
        expect(the_result.textMateRules).toEqual([]);
    });

    it('preserves hand-edited rules on depth scopes', () => {
        const the_custom_rule = depth_rule(STRING_SCOPE_PREFIX, 1, '#FF00FF');
        const the_input: TokenColorCustomizations = {
            textMateRules: [
                depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                the_custom_rule,
            ],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result.textMateRules).toEqual([the_custom_rule]);
    });

    it('preserves all non-depth rules', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    non_depth_rule,
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                ],
            },
            textMateRules: [non_depth_rule],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']?.textMateRules).toEqual([non_depth_rule]);
        expect(the_result.textMateRules).toEqual([non_depth_rule]);
    });

    it('is idempotent', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                    non_depth_rule,
                ],
            },
            textMateRules: [
                depth_rule(MACRO_SCOPE_PREFIX, 1, DARK_MACRO_COLORS[0]),
            ],
        };

        const the_once = removeSightOwnedDepthRules(the_input);
        const the_twice = removeSightOwnedDepthRules(the_once);
        expect(the_twice).toEqual(the_once);
    });

    it('does not mutate the input object', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                ],
            },
        };
        const the_snapshot = JSON.parse(JSON.stringify(the_input));

        removeSightOwnedDepthRules(the_input);

        expect(the_input).toEqual(the_snapshot);
    });

    it('preserves sections that have no textMateRules array', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {},
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']).toEqual({});
    });
});
