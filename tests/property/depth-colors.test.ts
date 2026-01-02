import { describe, it, expect } from 'bun:test';
import {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    hasDepthColorRules,
    buildDepthColorRules,
    mergeDepthColors
} from '../../client/src/depth-colors-core';

/**
 * Property tests for depth color customizations.
 * Validates: Requirements 1.4, 1.6, 2.4, 2.5, 2.6
 */
describe('Depth Color Properties', () => {
    // Helper to check if a string is a valid hex color
    const is_valid_hex = (color: string): boolean => {
        return /^#[0-9A-Fa-f]{6}$/.test(color);
    };

    describe('Color Palette Constants', () => {
        it('all dark string colors are valid hex codes', () => {
            for (const my_color of DARK_STRING_COLORS) {
                expect(is_valid_hex(my_color)).toBe(true);
            }
        });

        it('all dark macro colors are valid hex codes', () => {
            for (const my_color of DARK_MACRO_COLORS) {
                expect(is_valid_hex(my_color)).toBe(true);
            }
        });

        it('all light string colors are valid hex codes', () => {
            for (const my_color of LIGHT_STRING_COLORS) {
                expect(is_valid_hex(my_color)).toBe(true);
            }
        });

        it('all light macro colors are valid hex codes', () => {
            for (const my_color of LIGHT_MACRO_COLORS) {
                expect(is_valid_hex(my_color)).toBe(true);
            }
        });

        it('each palette has exactly 6 colors', () => {
            expect(DARK_STRING_COLORS).toHaveLength(6);
            expect(DARK_MACRO_COLORS).toHaveLength(6);
            expect(LIGHT_STRING_COLORS).toHaveLength(6);
            expect(LIGHT_MACRO_COLORS).toHaveLength(6);
        });
    });


    describe('Property 1: All Dark Theme String Depths Have Distinct Colors', () => {
        it('all dark string depth colors are distinct', () => {
            expect(new Set(DARK_STRING_COLORS).size).toBe(DARK_STRING_COLORS.length);
        });
    });

    describe('Property 2: All Dark Theme Macro Depths Have Distinct Colors', () => {
        it('all dark macro depth colors are distinct', () => {
            expect(new Set(DARK_MACRO_COLORS).size).toBe(DARK_MACRO_COLORS.length);
        });
    });

    describe('Property 3: All Light Theme String Depths Have Distinct Colors', () => {
        it('all light string depth colors are distinct', () => {
            expect(new Set(LIGHT_STRING_COLORS).size).toBe(LIGHT_STRING_COLORS.length);
        });
    });

    describe('Property 4: All Light Theme Macro Depths Have Distinct Colors', () => {
        it('all light macro depth colors are distinct', () => {
            expect(new Set(LIGHT_MACRO_COLORS).size).toBe(LIGHT_MACRO_COLORS.length);
        });
    });

    describe('Property 5: Dark Theme String and Macro Color Sets Are Disjoint', () => {
        it('dark string and macro colors do not overlap', () => {
            const the_overlap = DARK_STRING_COLORS.filter(
                (my_color: string) => DARK_MACRO_COLORS.includes(my_color)
            );
            expect(the_overlap).toHaveLength(0);
        });
    });

    describe('Property 6: Light Theme String and Macro Color Sets Are Disjoint', () => {
        it('light string and macro colors do not overlap', () => {
            const the_overlap = LIGHT_STRING_COLORS.filter(
                (my_color: string) => LIGHT_MACRO_COLORS.includes(my_color)
            );
            expect(the_overlap).toHaveLength(0);
        });
    });


    describe('hasDepthColorRules', () => {
        it('returns false for undefined', () => {
            expect(hasDepthColorRules(undefined)).toBe(false);
        });

        it('returns false for empty object', () => {
            expect(hasDepthColorRules({})).toBe(false);
        });

        it('returns false for customizations without depth rules', () => {
            const customizations = {
                textMateRules: [
                    { scope: 'comment.line', settings: { foreground: '#888888' } }
                ]
            };
            expect(hasDepthColorRules(customizations)).toBe(false);
        });

        it('returns true for customizations with string depth rules', () => {
            const customizations = {
                textMateRules: [
                    { scope: 'string.quoted.compound.depth1.stata', settings: { foreground: '#CE9178' } }
                ]
            };
            expect(hasDepthColorRules(customizations)).toBe(true);
        });

        it('returns true for customizations with macro depth rules', () => {
            const customizations = {
                textMateRules: [
                    { scope: 'variable.other.macro.local.depth2.stata', settings: { foreground: '#9CDCFE' } }
                ]
            };
            expect(hasDepthColorRules(customizations)).toBe(true);
        });

        it('returns true for depth rules in theme-specific section', () => {
            const customizations = {
                '[*Dark*]': {
                    textMateRules: [
                        { scope: 'string.quoted.compound.depth1.stata', settings: { foreground: '#CE9178' } }
                    ]
                }
            };
            expect(hasDepthColorRules(customizations)).toBe(true);
        });
    });


    describe('buildDepthColorRules', () => {
        it('generates correct number of rules', () => {
            const the_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
            expect(the_rules).toHaveLength(12); // 6 string + 6 macro
        });

        it('generates correct scope names for strings', () => {
            const the_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
            const the_string_rules = the_rules.filter(r => r.scope.includes('string.quoted.compound'));
            
            for (let i = 0; i < 6; i++) {
                expect(the_string_rules[i].scope).toBe(`string.quoted.compound.depth${i + 1}.stata`);
            }
        });

        it('generates correct scope names for macros', () => {
            const the_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
            const the_macro_rules = the_rules.filter(r => r.scope.includes('variable.other.macro'));
            
            for (let i = 0; i < 6; i++) {
                expect(the_macro_rules[i].scope).toBe(`variable.other.macro.local.depth${i + 1}.stata`);
            }
        });

        it('uses provided colors', () => {
            const the_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
            const the_string_rules = the_rules.filter(r => r.scope.includes('string.quoted.compound'));
            
            for (let i = 0; i < 6; i++) {
                expect(the_string_rules[i].settings.foreground).toBe(DARK_STRING_COLORS[i]);
            }
        });
    });

    describe('mergeDepthColors', () => {
        it('creates Dark and Light sections for empty input', () => {
            const result = mergeDepthColors(undefined);
            expect(result['[*Dark*]']).toBeDefined();
            expect(result['[*Light*]']).toBeDefined();
        });

        it('preserves existing rules in Dark section', () => {
            const existing = {
                '[*Dark*]': {
                    textMateRules: [
                        { scope: 'comment.line', settings: { foreground: '#888888' } }
                    ]
                }
            };
            const result = mergeDepthColors(existing);
            const dark_rules = result['[*Dark*]']?.textMateRules || [];
            
            // Should have the existing rule plus our 12 new rules
            expect(dark_rules.length).toBeGreaterThan(12);
            expect(dark_rules.some(r => r.scope === 'comment.line')).toBe(true);
        });

        it('adds all depth rules to Dark section', () => {
            const result = mergeDepthColors(undefined);
            const dark_rules = result['[*Dark*]']?.textMateRules || [];
            
            expect(dark_rules.some(r => r.scope === 'string.quoted.compound.depth1.stata')).toBe(true);
            expect(dark_rules.some(r => r.scope === 'variable.other.macro.local.depth6.stata')).toBe(true);
        });

        it('adds all depth rules to Light section', () => {
            const result = mergeDepthColors(undefined);
            const light_rules = result['[*Light*]']?.textMateRules || [];
            
            expect(light_rules.some(r => r.scope === 'string.quoted.compound.depth1.stata')).toBe(true);
            expect(light_rules.some(r => r.scope === 'variable.other.macro.local.depth6.stata')).toBe(true);
        });

        it('uses dark colors for Dark section', () => {
            const result = mergeDepthColors(undefined);
            const dark_rules = result['[*Dark*]']?.textMateRules || [];
            const depth1_string = dark_rules.find(r => r.scope === 'string.quoted.compound.depth1.stata');
            
            expect(depth1_string?.settings.foreground).toBe(DARK_STRING_COLORS[0]);
        });

        it('uses light colors for Light section', () => {
            const result = mergeDepthColors(undefined);
            const light_rules = result['[*Light*]']?.textMateRules || [];
            const depth1_string = light_rules.find(r => r.scope === 'string.quoted.compound.depth1.stata');
            
            expect(depth1_string?.settings.foreground).toBe(LIGHT_STRING_COLORS[0]);
        });
    });
});
