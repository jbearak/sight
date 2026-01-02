import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    hasDepthColorRules,
    buildDepthColorRules,
    mergeDepthColors,
    isDepthColorRule,
    TokenColorCustomizations,
    TextMateRule,
    STRING_SCOPE_PREFIX,
    MACRO_SCOPE_PREFIX,
    SCOPE_SUFFIX
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

    // Generator for valid hex colors
    const arbitrary_hex_color = fc.hexaString({ minLength: 6, maxLength: 6 })
        .map(s => `#${s.toUpperCase()}`);

    // Generator for non-depth TextMate rules (for testing preservation)
    const arbitrary_non_depth_rule = fc.record({
        scope: fc.stringOf(fc.constantFrom('a', 'b', 'c', '.', '-'), { minLength: 5, maxLength: 20 })
            .filter(s => !s.includes('depth') && !s.includes('stata')),
        settings: fc.record({
            foreground: arbitrary_hex_color
        })
    });

    // Generator for depth TextMate rules (string or macro depth rules)
    const arbitrary_depth_rule = fc.oneof(
        // String depth rules
        fc.record({
            scope: fc.integer({ min: 1, max: 6 }).map(
                depth => `${STRING_SCOPE_PREFIX}${depth}${SCOPE_SUFFIX}`
            ),
            settings: fc.record({
                foreground: arbitrary_hex_color
            })
        }),
        // Macro depth rules
        fc.record({
            scope: fc.integer({ min: 1, max: 6 }).map(
                depth => `${MACRO_SCOPE_PREFIX}${depth}${SCOPE_SUFFIX}`
            ),
            settings: fc.record({
                foreground: arbitrary_hex_color
            })
        })
    );

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

    describe('Property: Universal Color Application (Task 2.2)', () => {
        // Property 1: Universal Color Application
        // For any VS Code theme (regardless of name), when the extension activates
        // and no existing depth color rules are present, the Depth_Color_System
        // should add depth color rules that will be applied to that theme.
        it('Property 1: universal selector receives depth color rules when provided', () => {
            fc.assert(
                fc.property(
                    // Generate random existing customizations (possibly empty)
                    fc.option(
                        fc.record({
                            '[*Dark*]': fc.option(fc.record({
                                textMateRules: fc.array(arbitrary_non_depth_rule, { maxLength: 5 })
                            })),
                            '[*Light*]': fc.option(fc.record({
                                textMateRules: fc.array(arbitrary_non_depth_rule, { maxLength: 5 })
                            }))
                        }),
                        { nil: undefined }
                    ),
                    (existing) => {
                        // Build universal rules (simulating what buildUniversalDepthColorRules does)
                        const universal_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
                        
                        const result = mergeDepthColors(existing, universal_rules);
                        
                        // Universal selector should have depth color rules
                        const universal_section = result['[*]'];
                        expect(universal_section).toBeDefined();
                        expect(universal_section?.textMateRules).toBeDefined();
                        expect(universal_section?.textMateRules?.length).toBeGreaterThan(0);
                        
                        // All universal rules should be depth color rules
                        const has_depth_rules = universal_section?.textMateRules?.some(
                            rule => isDepthColorRule(rule)
                        );
                        expect(has_depth_rules).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property: Theme-Kind-Appropriate Palette Selection (Task 3.2)', () => {
        // Property 2: Theme-Kind-Appropriate Palette Selection
        // For any theme with a known ColorThemeKind, the selected color palette
        // should match the theme's kind: dark themes should receive dark palette
        // colors, and light themes should receive light palette colors.
        it('Property 2: dark palette produces rules with dark colors', () => {
            fc.assert(
                fc.property(
                    fc.constant(null), // No input needed, just run multiple times
                    () => {
                        const dark_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
                        
                        // All string rules should have dark string colors
                        const string_rules = dark_rules.filter(r => r.scope.includes('string.quoted.compound.depth'));
                        for (let i = 0; i < string_rules.length; i++) {
                            expect(string_rules[i].settings.foreground).toBe(DARK_STRING_COLORS[i]);
                        }
                        
                        // All macro rules should have dark macro colors
                        const macro_rules = dark_rules.filter(r => r.scope.includes('variable.other.macro.local.depth'));
                        for (let i = 0; i < macro_rules.length; i++) {
                            expect(macro_rules[i].settings.foreground).toBe(DARK_MACRO_COLORS[i]);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Property 2: light palette produces rules with light colors', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const light_rules = buildDepthColorRules(LIGHT_STRING_COLORS, LIGHT_MACRO_COLORS);
                        
                        // All string rules should have light string colors
                        const string_rules = light_rules.filter(r => r.scope.includes('string.quoted.compound.depth'));
                        for (let i = 0; i < string_rules.length; i++) {
                            expect(string_rules[i].settings.foreground).toBe(LIGHT_STRING_COLORS[i]);
                        }
                        
                        // All macro rules should have light macro colors
                        const macro_rules = light_rules.filter(r => r.scope.includes('variable.other.macro.local.depth'));
                        for (let i = 0; i < macro_rules.length; i++) {
                            expect(macro_rules[i].settings.foreground).toBe(LIGHT_MACRO_COLORS[i]);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Property 3: Dynamic Theme Change Handling (Task 4.3)
    // For any theme change event where the theme kind changes (dark to light or
    // vice versa), the universal fallback colors should be updated to match the
    // new theme kind.
    describe('Property 3: Dynamic Theme Change Handling (Task 4.3)', () => {
        it('theme change from dark to light updates universal rules to light colors', () => {
            fc.assert(
                fc.property(
                    // Generate random existing universal rules (simulating dark theme state)
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 12 }),
                    (existing_universal_rules) => {
                        // Start with dark theme universal rules
                        const existing: TokenColorCustomizations = {
                            '[*]': { textMateRules: existing_universal_rules }
                        };
                        
                        // Simulate theme change: filter out depth rules
                        const filtered_rules = existing_universal_rules.filter(
                            rule => !isDepthColorRule(rule)
                        );
                        
                        // Add new light theme rules (simulating what updateUniversalFallbackColors does)
                        const light_rules = buildDepthColorRules(LIGHT_STRING_COLORS, LIGHT_MACRO_COLORS);
                        const updated: TokenColorCustomizations = {
                            '[*]': {
                                textMateRules: [...filtered_rules, ...light_rules]
                            }
                        };
                        
                        // Verify light colors are now present
                        const result_rules = updated['[*]']?.textMateRules || [];
                        const string_rules = result_rules.filter(r => r.scope.includes('string.quoted.compound.depth'));
                        
                        // At least some string rules should have light colors
                        const has_light_colors = string_rules.some(
                            r => LIGHT_STRING_COLORS.includes(r.settings.foreground)
                        );
                        expect(has_light_colors).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('theme change from light to dark updates universal rules to dark colors', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 12 }),
                    (existing_universal_rules) => {
                        // Start with light theme universal rules
                        const existing: TokenColorCustomizations = {
                            '[*]': { textMateRules: existing_universal_rules }
                        };
                        
                        // Simulate theme change: filter out depth rules
                        const filtered_rules = existing_universal_rules.filter(
                            rule => !isDepthColorRule(rule)
                        );
                        
                        // Add new dark theme rules
                        const dark_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
                        const updated: TokenColorCustomizations = {
                            '[*]': {
                                textMateRules: [...filtered_rules, ...dark_rules]
                            }
                        };
                        
                        // Verify dark colors are now present
                        const result_rules = updated['[*]']?.textMateRules || [];
                        const string_rules = result_rules.filter(r => r.scope.includes('string.quoted.compound.depth'));
                        
                        // At least some string rules should have dark colors
                        const has_dark_colors = string_rules.some(
                            r => DARK_STRING_COLORS.includes(r.settings.foreground)
                        );
                        expect(has_dark_colors).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('isDepthColorRule correctly identifies all depth color rules', () => {
            fc.assert(
                fc.property(
                    arbitrary_depth_rule,
                    (rule) => {
                        // All generated depth rules should be identified as depth rules
                        expect(isDepthColorRule(rule)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('isDepthColorRule correctly rejects non-depth rules', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_depth_rule,
                    (rule) => {
                        // Non-depth rules should not be identified as depth rules
                        expect(isDepthColorRule(rule)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });


    // =========================================================================
    // Task 8: Property Tests for User Customization and Reset
    // =========================================================================

    describe('Property 5: User Customization Preservation (Task 8.1)', () => {
        /**
         * Property 5: For any existing tokenColorCustomizations that contain
         * depth color rules, calling mergeDepthColors should not modify or
         * remove those existing rules.
         *
         * This ensures user customizations are preserved when the extension
         * adds or updates depth color rules.
         */
        it('preserves existing depth color rules in Dark section when merging', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 10 }),
                    (existing_rules) => {
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: existing_rules }
                        };

                        const result = mergeDepthColors(existing);
                        const result_rules = result['[*Dark*]']?.textMateRules || [];

                        // All original rules should still be present
                        for (const my_rule of existing_rules) {
                            const found = result_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('preserves existing depth color rules in Light section when merging', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 10 }),
                    (existing_rules) => {
                        const existing: TokenColorCustomizations = {
                            '[*Light*]': { textMateRules: existing_rules }
                        };

                        const result = mergeDepthColors(existing);
                        const result_rules = result['[*Light*]']?.textMateRules || [];

                        // All original rules should still be present
                        for (const my_rule of existing_rules) {
                            const found = result_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('preserves existing non-depth rules when merging depth colors', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_non_depth_rule, { minLength: 1, maxLength: 10 }),
                    (existing_rules) => {
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: existing_rules },
                            '[*Light*]': { textMateRules: existing_rules }
                        };

                        const result = mergeDepthColors(existing);
                        const dark_rules = result['[*Dark*]']?.textMateRules || [];
                        const light_rules = result['[*Light*]']?.textMateRules || [];

                        // All original non-depth rules should still be present
                        for (const my_rule of existing_rules) {
                            const found_in_dark = dark_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            const found_in_light = light_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found_in_dark).toBe(true);
                            expect(found_in_light).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('preserves mixed depth and non-depth rules when merging', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.oneof(arbitrary_depth_rule, arbitrary_non_depth_rule),
                        { minLength: 1, maxLength: 15 }
                    ),
                    (existing_rules) => {
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: existing_rules },
                            '[*Light*]': { textMateRules: existing_rules }
                        };

                        const result = mergeDepthColors(existing);
                        const dark_rules = result['[*Dark*]']?.textMateRules || [];
                        const light_rules = result['[*Light*]']?.textMateRules || [];

                        // All original rules should still be present
                        for (const my_rule of existing_rules) {
                            const found_in_dark = dark_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            const found_in_light = light_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found_in_dark).toBe(true);
                            expect(found_in_light).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('preserves rules in both theme sections independently', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 5 }),
                    fc.array(arbitrary_depth_rule, { minLength: 1, maxLength: 5 }),
                    (dark_existing_rules, light_existing_rules) => {
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: dark_existing_rules },
                            '[*Light*]': { textMateRules: light_existing_rules }
                        };

                        const result = mergeDepthColors(existing);
                        const dark_rules = result['[*Dark*]']?.textMateRules || [];
                        const light_rules = result['[*Light*]']?.textMateRules || [];

                        // Dark section should preserve dark existing rules
                        for (const my_rule of dark_existing_rules) {
                            const found = dark_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }

                        // Light section should preserve light existing rules
                        for (const my_rule of light_existing_rules) {
                            const found = light_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });


    describe('Property 6: Reset Functionality (Task 8.2)', () => {
        /**
         * Property 6: For any existing tokenColorCustomizations (with or
         * without depth color rules), invoking the reset function should
         * result in only the default depth color rules being present.
         *
         * Since resetDepthColors uses VS Code APIs, we test the underlying
         * logic: filter out depth rules, then add defaults via mergeDepthColors.
         */
        it('reset results in only default depth color rules for Dark section', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 0, maxLength: 10 }),
                    (custom_rules) => {
                        // Start with custom depth rules
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: custom_rules }
                        };

                        // Simulate reset: filter out depth rules
                        const filtered: TokenColorCustomizations = {
                            '[*Dark*]': {
                                textMateRules: custom_rules.filter(
                                    r => !isDepthColorRule(r)
                                )
                            }
                        };

                        // Add defaults
                        const result = mergeDepthColors(filtered);
                        const result_rules = result['[*Dark*]']?.textMateRules || [];

                        // Build expected default rules
                        const default_dark = buildDepthColorRules(
                            DARK_STRING_COLORS,
                            DARK_MACRO_COLORS
                        );

                        // All default rules should be present
                        for (const my_default_rule of default_dark) {
                            const found = result_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }

                        // No custom depth rules should remain (only defaults)
                        // Since we filtered out all depth rules before merging,
                        // only the default rules should be present
                        const depth_rules_in_result = result_rules.filter(
                            r => isDepthColorRule(r)
                        );
                        
                        // Each depth scope should have exactly the default color
                        for (const my_default_rule of default_dark) {
                            const matching_rules = depth_rules_in_result.filter(
                                r => r.scope === my_default_rule.scope
                            );
                            // Should have exactly one rule with the default color
                            expect(matching_rules.length).toBe(1);
                            expect(matching_rules[0].settings.foreground).toBe(
                                my_default_rule.settings.foreground
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('reset results in only default depth color rules for Light section', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_depth_rule, { minLength: 0, maxLength: 10 }),
                    (custom_rules) => {
                        // Start with custom depth rules
                        const existing: TokenColorCustomizations = {
                            '[*Light*]': { textMateRules: custom_rules }
                        };

                        // Simulate reset: filter out depth rules
                        const filtered: TokenColorCustomizations = {
                            '[*Light*]': {
                                textMateRules: custom_rules.filter(
                                    r => !isDepthColorRule(r)
                                )
                            }
                        };

                        // Add defaults
                        const result = mergeDepthColors(filtered);
                        const result_rules = result['[*Light*]']?.textMateRules || [];

                        // Build expected default rules
                        const default_light = buildDepthColorRules(
                            LIGHT_STRING_COLORS,
                            LIGHT_MACRO_COLORS
                        );

                        // All default rules should be present
                        for (const my_default_rule of default_light) {
                            const found = result_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }

                        // Each depth scope should have exactly the default color
                        const depth_rules_in_result = result_rules.filter(
                            r => isDepthColorRule(r)
                        );
                        for (const my_default_rule of default_light) {
                            const matching_rules = depth_rules_in_result.filter(
                                r => r.scope === my_default_rule.scope
                            );
                            expect(matching_rules.length).toBe(1);
                            expect(matching_rules[0].settings.foreground).toBe(
                                my_default_rule.settings.foreground
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('reset preserves non-depth rules while resetting depth rules', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_non_depth_rule, { minLength: 1, maxLength: 10 }),
                    fc.array(arbitrary_depth_rule, { minLength: 0, maxLength: 10 }),
                    (non_depth_rules, custom_depth_rules) => {
                        // Start with mixed rules
                        const all_rules = [...non_depth_rules, ...custom_depth_rules];
                        const existing: TokenColorCustomizations = {
                            '[*Dark*]': { textMateRules: all_rules },
                            '[*Light*]': { textMateRules: all_rules }
                        };

                        // Simulate reset: filter out depth rules, keep non-depth
                        const filtered: TokenColorCustomizations = {
                            '[*Dark*]': {
                                textMateRules: all_rules.filter(
                                    r => !isDepthColorRule(r)
                                )
                            },
                            '[*Light*]': {
                                textMateRules: all_rules.filter(
                                    r => !isDepthColorRule(r)
                                )
                            }
                        };

                        // Add defaults
                        const result = mergeDepthColors(filtered);
                        const dark_rules = result['[*Dark*]']?.textMateRules || [];
                        const light_rules = result['[*Light*]']?.textMateRules || [];

                        // All non-depth rules should still be present
                        for (const my_rule of non_depth_rules) {
                            const found_in_dark = dark_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            const found_in_light = light_rules.some(
                                r => r.scope === my_rule.scope &&
                                     r.settings.foreground === my_rule.settings.foreground
                            );
                            expect(found_in_dark).toBe(true);
                            expect(found_in_light).toBe(true);
                        }

                        // Default depth rules should be present
                        const default_dark = buildDepthColorRules(
                            DARK_STRING_COLORS,
                            DARK_MACRO_COLORS
                        );
                        const default_light = buildDepthColorRules(
                            LIGHT_STRING_COLORS,
                            LIGHT_MACRO_COLORS
                        );

                        for (const my_default_rule of default_dark) {
                            const found = dark_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }

                        for (const my_default_rule of default_light) {
                            const found = light_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('reset with empty customizations results in only default rules', () => {
            fc.assert(
                fc.property(
                    fc.constant(null), // No input needed
                    () => {
                        // Start with empty/undefined customizations
                        const result = mergeDepthColors(undefined);
                        
                        const dark_rules = result['[*Dark*]']?.textMateRules || [];
                        const light_rules = result['[*Light*]']?.textMateRules || [];

                        // Build expected default rules
                        const default_dark = buildDepthColorRules(
                            DARK_STRING_COLORS,
                            DARK_MACRO_COLORS
                        );
                        const default_light = buildDepthColorRules(
                            LIGHT_STRING_COLORS,
                            LIGHT_MACRO_COLORS
                        );

                        // Dark section should have exactly the default rules
                        expect(dark_rules.length).toBe(default_dark.length);
                        for (const my_default_rule of default_dark) {
                            const found = dark_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }

                        // Light section should have exactly the default rules
                        expect(light_rules.length).toBe(default_light.length);
                        for (const my_default_rule of default_light) {
                            const found = light_rules.some(
                                r => r.scope === my_default_rule.scope &&
                                     r.settings.foreground === my_default_rule.settings.foreground
                            );
                            expect(found).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
