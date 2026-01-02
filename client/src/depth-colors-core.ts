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
    textMateRules?: TextMateRule[];
    [key: string]: ThemeTokenColorCustomizations | TextMateRule[] | undefined;
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
 */
export function mergeDepthColors(
    existing: TokenColorCustomizations | undefined
): TokenColorCustomizations {
    const result: TokenColorCustomizations = existing ? { ...existing } : {};

    // Build rules for dark and light themes
    const dark_rules = buildDepthColorRules(DARK_STRING_COLORS, DARK_MACRO_COLORS);
    const light_rules = buildDepthColorRules(LIGHT_STRING_COLORS, LIGHT_MACRO_COLORS);

    // Merge dark theme rules
    const existing_dark = result['[*Dark*]'] as ThemeTokenColorCustomizations | undefined;
    result['[*Dark*]'] = {
        ...existing_dark,
        textMateRules: [
            ...(existing_dark?.textMateRules || []),
            ...dark_rules
        ]
    };

    // Merge light theme rules
    const existing_light = result['[*Light*]'] as ThemeTokenColorCustomizations | undefined;
    result['[*Light*]'] = {
        ...existing_light,
        textMateRules: [
            ...(existing_light?.textMateRules || []),
            ...light_rules
        ]
    };

    return result;
}
