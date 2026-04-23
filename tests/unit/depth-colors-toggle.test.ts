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
    TextMateRule
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
        expect(PALETTE_HEX_VALUES.size).toBe(new Set(the_expected).size);
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
