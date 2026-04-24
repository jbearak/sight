/**
 * Core depth color configuration module for Stata nested strings and macros.
 * 
 * This module contains pure functions that can be tested without VS Code.
 * The VS Code-dependent code is in depth-colors.ts.
 */

// Color palettes for dark themes (optimized for dark backgrounds)
export const DARK_STRING_COLORS = [
    '#CE9178',  // Depth 1: Orange (matches VS Code Dark+ default)
    '#D4A373',  // Depth 2: Light Orange
    '#DCDCAA',  // Depth 3: Gold
    '#B5CEA8',  // Depth 4: Yellow-Green
    '#A8D4A8',  // Depth 5: Light Green
    '#8ECDC8'   // Depth 6: Teal
];

export const DARK_MACRO_COLORS = [
    '#9CDCFE',  // Depth 1: Light Blue (matches VS Code Dark+ default)
    '#7DCFEA',  // Depth 2: Sky Blue
    '#6DD4D4',  // Depth 3: Cyan
    '#5DC9B0',  // Depth 4: Teal
    '#B4A7D6',  // Depth 5: Light Purple
    '#C9A7DE'   // Depth 6: Lavender
];

// Color palettes for light themes (optimized for light backgrounds)
export const LIGHT_STRING_COLORS = [
    '#A31515',  // Depth 1: Dark Red (matches VS Code Light+ default)
    '#986801',  // Depth 2: Brown
    '#6B8E23',  // Depth 3: Olive
    '#2E8B57',  // Depth 4: Forest Green
    '#008B8B',  // Depth 5: Teal
    '#4682B4'   // Depth 6: Steel Blue
];

export const LIGHT_MACRO_COLORS = [
    '#001080',  // Depth 1: Dark Blue (matches VS Code Light+ default)
    '#0000CD',  // Depth 2: Navy
    '#4169E1',  // Depth 3: Royal Blue
    '#6A5ACD',  // Depth 4: Slate Blue
    '#8A2BE2',  // Depth 5: Blue Violet
    '#9932CC'   // Depth 6: Dark Orchid
];

// Scope name patterns
export const STRING_SCOPE_PREFIX = 'string.quoted.compound.depth';
export const MACRO_SCOPE_PREFIX = 'variable.other.macro.local.depth';
export const SCOPE_SUFFIX = '.stata';


export interface TextMateRule {
    scope: string;
    settings: {
        foreground: string;
    };
}

export interface ThemeTokenColorCustomizations {
    textMateRules?: TextMateRule[];
}

export interface TokenColorCustomizations {
    '[*Dark*]'?: ThemeTokenColorCustomizations;
    '[*Light*]'?: ThemeTokenColorCustomizations;
    '[*]'?: ThemeTokenColorCustomizations;  // Universal fallback
    textMateRules?: TextMateRule[];
    [key: string]: ThemeTokenColorCustomizations | TextMateRule[] | undefined;
}

/**
 * Check if a TextMateRule is a depth color rule (string or macro depth).
 */
export function isDepthColorRule(rule: TextMateRule): boolean {
    return rule.scope.includes(STRING_SCOPE_PREFIX) || 
           rule.scope.includes(MACRO_SCOPE_PREFIX);
}

/**
 * Check if existing tokenColorCustomizations contains depth color rules.
 */
export function hasDepthColorRules(customizations: TokenColorCustomizations | undefined): boolean {
    if (!customizations) {
        return false;
    }

    const check_rules = (rules: TextMateRule[] | undefined): boolean => {
        if (!rules) return false;
        return rules.some(my_rule => 
            my_rule.scope.includes(STRING_SCOPE_PREFIX) || 
            my_rule.scope.includes(MACRO_SCOPE_PREFIX)
        );
    };

    // Check top-level textMateRules
    if (check_rules(customizations.textMateRules)) {
        return true;
    }

    // Check theme-specific sections
    for (const my_key of Object.keys(customizations)) {
        const my_section = customizations[my_key];
        if (my_section && typeof my_section === 'object' && 'textMateRules' in my_section) {
            if (check_rules((my_section as ThemeTokenColorCustomizations).textMateRules)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Build textMateRules array for a given theme type.
 */
export function buildDepthColorRules(
    string_colors: string[],
    macro_colors: string[]
): TextMateRule[] {
    const the_rules: TextMateRule[] = [];

    // Add string depth rules
    for (let i = 0; i < string_colors.length; i++) {
        the_rules.push({
            scope: `${STRING_SCOPE_PREFIX}${i + 1}${SCOPE_SUFFIX}`,
            settings: { foreground: string_colors[i] }
        });
    }

    // Add macro depth rules
    for (let i = 0; i < macro_colors.length; i++) {
        the_rules.push({
            scope: `${MACRO_SCOPE_PREFIX}${i + 1}${SCOPE_SUFFIX}`,
            settings: { foreground: macro_colors[i] }
        });
    }

    return the_rules;
}

/**
 * Merge depth color rules with existing tokenColorCustomizations.
 * @param existing - Existing token color customizations
 * @param universal_rules - Optional rules for the top-level textMateRules (applies to all themes)
 */
export function mergeDepthColors(
    existing: TokenColorCustomizations | undefined,
    universal_rules?: TextMateRule[]
): TokenColorCustomizations {
    const result: TokenColorCustomizations = existing ? { ...existing } : {};

    // Build rules for dark and light themes
    const dark_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
    const light_rules = buildDepthColorRules(LIGHT_STRING_COLORS, LIGHT_MACRO_COLORS);

    // When a section already has a rule on a Sight depth scope (a preserved
    // user edit that removeSightOwnedDepthRules kept), skip our default for
    // that exact scope. Avoids writing two rules on the same scope, which
    // would rely on undocumented VS Code tie-breaking.
    const skip_covered_defaults = (
        default_rules: TextMateRule[],
        existing_rules: TextMateRule[] | undefined
    ): TextMateRule[] => {
        if (!existing_rules || existing_rules.length === 0) {
            return default_rules;
        }
        const the_covered_scopes = new Set(existing_rules.map(my_rule => my_rule.scope));
        return default_rules.filter(my_rule => !the_covered_scopes.has(my_rule.scope));
    };

    // Merge dark theme rules.
    const existing_dark = result['[*Dark*]'] as ThemeTokenColorCustomizations | undefined;
    result['[*Dark*]'] = {
        ...existing_dark,
        textMateRules: [
            ...(existing_dark?.textMateRules || []),
            ...skip_covered_defaults(dark_rules, existing_dark?.textMateRules),
        ]
    };

    // Merge light theme rules.
    const existing_light = result['[*Light*]'] as ThemeTokenColorCustomizations | undefined;
    result['[*Light*]'] = {
        ...existing_light,
        textMateRules: [
            ...(existing_light?.textMateRules || []),
            ...skip_covered_defaults(light_rules, existing_light?.textMateRules),
        ]
    };

    // Add universal fallback rules to top-level textMateRules (applies to ALL themes).
    // Top-level textMateRules work for themes that don't match [*Dark*] or [*Light*]
    // patterns (e.g., "Monokai", "Dracula", "Nord").
    if (universal_rules && universal_rules.length > 0) {
        const existing_top_level = result.textMateRules || [];
        result.textMateRules = [
            ...existing_top_level,
            ...skip_covered_defaults(universal_rules, existing_top_level),
        ];
    }

    return result;
}

/**
 * Hex values (uppercased) from the four hard-coded palettes.
 * Used to identify rules Sight wrote on activation so we can remove them
 * cleanly when the user disables depth coloring, without touching
 * rules a user may have hand-edited on the same scopes.
 */
export const PALETTE_HEX_VALUES: Set<string> = new Set([
    ...DARK_STRING_COLORS,
    ...DARK_MACRO_COLORS,
    ...LIGHT_STRING_COLORS,
    ...LIGHT_MACRO_COLORS,
].map(my_hex => my_hex.toUpperCase()));

/**
 * True iff a rule targets a Sight depth scope AND its foreground hex
 * belongs to one of the four hard-coded palettes. Hex comparison is
 * case-insensitive. A user-customized color on a depth scope is NOT
 * Sight-owned.
 */
export function isSightOwnedDepthRule(rule: TextMateRule): boolean {
    if (!isDepthColorRule(rule)) {
        return false;
    }
    const the_hex = rule.settings.foreground;
    if (!the_hex) {
        return false;
    }
    return PALETTE_HEX_VALUES.has(the_hex.toUpperCase());
}

/**
 * Returns a shallow copy of the input with Sight-owned depth rules removed
 * from [*Dark*], [*Light*], and top-level textMateRules. Hand-edited rules
 * on depth scopes (i.e., rules whose foreground is not in PALETTE_HEX_VALUES)
 * are preserved. Does not mutate the input.
 *
 * The three sections listed above are exhaustive of where mergeDepthColors
 * writes rules. If a future write path starts touching another section
 * (e.g., `[*]` or a theme-specific key), update this filter in lockstep.
 */
export function removeSightOwnedDepthRules(
    customizations: TokenColorCustomizations | undefined
): TokenColorCustomizations {
    if (!customizations) {
        return {};
    }

    const result: TokenColorCustomizations = { ...customizations };

    const filter_section = (
        section: ThemeTokenColorCustomizations | undefined
    ): ThemeTokenColorCustomizations | undefined => {
        if (!section) return section;
        if (!section.textMateRules) return { ...section };
        return {
            ...section,
            textMateRules: section.textMateRules.filter(
                my_rule => !isSightOwnedDepthRule(my_rule)
            ),
        };
    };

    const existing_dark = result['[*Dark*]'] as
        ThemeTokenColorCustomizations | undefined;
    if (existing_dark !== undefined) {
        result['[*Dark*]'] = filter_section(existing_dark);
    }

    const existing_light = result['[*Light*]'] as
        ThemeTokenColorCustomizations | undefined;
    if (existing_light !== undefined) {
        result['[*Light*]'] = filter_section(existing_light);
    }

    if (result.textMateRules) {
        result.textMateRules = result.textMateRules.filter(
            my_rule => !isSightOwnedDepthRule(my_rule)
        );
    }

    return result;
}
