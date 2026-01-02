import * as vscode from 'vscode';
import { window, ColorThemeKind } from 'vscode';
import {
    hasDepthColorRules,
    mergeDepthColors,
    buildDepthColorRules,
    isDepthColorRule,
    TokenColorCustomizations,
    ThemeTokenColorCustomizations,
    TextMateRule,
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS
} from './depth-colors-core';

// Re-export core functions for convenience
export {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    hasDepthColorRules,
    buildDepthColorRules,
    mergeDepthColors,
    isDepthColorRule
} from './depth-colors-core';

/**
 * Determines if the current theme is a dark theme.
 * Includes both regular dark themes and high contrast dark themes.
 */
export function isDarkTheme(): boolean {
    const theme_kind = window.activeColorTheme.kind;
    return theme_kind === ColorThemeKind.Dark || 
           theme_kind === ColorThemeKind.HighContrast;
}

/**
 * Gets the appropriate color palette based on current theme.
 */
export function getThemeColorPalette(): {
    string_colors: string[];
    macro_colors: string[];
} {
    if (isDarkTheme()) {
        return {
            string_colors: DARK_STRING_COLORS,
            macro_colors: DARK_MACRO_COLORS
        };
    }
    return {
        string_colors: LIGHT_STRING_COLORS,
        macro_colors: LIGHT_MACRO_COLORS
    };
}

/**
 * Build universal depth color rules based on current theme detection.
 */
export function buildUniversalDepthColorRules(): TextMateRule[] {
    const palette = getThemeColorPalette();
    return buildDepthColorRules(palette.string_colors, palette.macro_colors);
}

/**
 * Configure depth colors in user settings if not already present.
 * 
 * This function checks if depth color rules actually exist in user settings,
 * and adds them if missing. This ensures colors are always configured,
 * even if the user's settings were reset or the extension was reinstalled.
 */
export async function configureDepthColors(
    _context: vscode.ExtensionContext,
    output_channel?: vscode.OutputChannel
): Promise<void> {
    // Use provided output channel or create a fallback (for testing)
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    try {
        const config = vscode.workspace.getConfiguration('editor');
        const current_customizations = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        log(`Current customizations: ${JSON.stringify(current_customizations)}`);

        // Check if depth color rules actually exist in settings
        if (hasDepthColorRules(current_customizations)) {
            log('Depth color rules already exist in settings, skipping');
            return;
        }

        // Add our default colors with universal fallback
        log('Adding default depth colors...');
        const universal_rules = buildUniversalDepthColorRules();
        const new_customizations = mergeDepthColors(current_customizations, universal_rules);
        log(`New customizations: ${JSON.stringify(new_customizations)}`);
        
        await config.update(
            'tokenColorCustomizations',
            new_customizations,
            vscode.ConfigurationTarget.Global
        );
        log('Successfully updated configuration');
    } catch (error) {
        // Log error but don't fail extension activation
        log(`Error: ${error}`);
        console.error('Failed to configure depth colors:', error);
    }
}

/**
 * Reset depth colors by removing existing rules and reapplying defaults.
 * 
 * Useful if the user wants to restore default colors after customizing.
 */
export async function resetDepthColors(
    _context: vscode.ExtensionContext,
    output_channel?: vscode.OutputChannel
): Promise<void> {
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    log('Resetting depth colors configuration...');
    
    // Remove existing depth color rules from user settings
    try {
        const config = vscode.workspace.getConfiguration('editor');
        const current_customizations = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        
        if (current_customizations) {
            // Remove our depth color rules from dark theme
            const dark_section = current_customizations['[*Dark*]'];
            if (dark_section?.textMateRules) {
                dark_section.textMateRules = dark_section.textMateRules.filter(
                    rule => !rule.scope.includes('depth') || !rule.scope.includes('.stata')
                );
            }
            
            // Remove our depth color rules from light theme
            const light_section = current_customizations['[*Light*]'];
            if (light_section?.textMateRules) {
                light_section.textMateRules = light_section.textMateRules.filter(
                    rule => !rule.scope.includes('depth') || !rule.scope.includes('.stata')
                );
            }
            
            // Remove our depth color rules from universal fallback
            const universal_section = current_customizations['[*]'];
            if (universal_section?.textMateRules) {
                universal_section.textMateRules = universal_section.textMateRules.filter(
                    rule => !rule.scope.includes('depth') || !rule.scope.includes('.stata')
                );
            }
            
            await config.update(
                'tokenColorCustomizations',
                current_customizations,
                vscode.ConfigurationTarget.Global
            );
            log('Removed existing depth color rules');
        }
    } catch (error) {
        log(`Error removing existing rules: ${error}`);
    }
    
    // Re-run configuration to add fresh rules
    await configureDepthColors(_context, output_channel);
    log('Reset complete');
}

/**
 * Register handler for theme changes to update depth colors.
 * Only updates when theme kind changes (dark <-> light).
 */
export function registerThemeChangeHandler(
    output_channel?: vscode.OutputChannel
): vscode.Disposable {
    let previous_is_dark = isDarkTheme();
    
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };
    
    return vscode.window.onDidChangeActiveColorTheme(async (_theme) => {
        const current_is_dark = isDarkTheme();
        
        // Only update if theme kind changed (dark <-> light)
        if (current_is_dark !== previous_is_dark) {
            log(`Theme kind changed: ${previous_is_dark ? 'dark' : 'light'} -> ${current_is_dark ? 'dark' : 'light'}`);
            previous_is_dark = current_is_dark;
            
            // Update the universal fallback colors
            await updateUniversalFallbackColors(output_channel);
        }
    });
}

/**
 * Update only the universal fallback colors based on current theme.
 * Removes existing universal depth rules and adds new ones.
 */
export async function updateUniversalFallbackColors(
    output_channel?: vscode.OutputChannel
): Promise<void> {
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    try {
        const config = vscode.workspace.getConfiguration('editor');
        const current = config.get<TokenColorCustomizations>('tokenColorCustomizations') || {};
        
        // Remove existing universal depth rules
        const universal_section = current['[*]'] as ThemeTokenColorCustomizations | undefined;
        let filtered_rules: TextMateRule[] = [];
        if (universal_section?.textMateRules) {
            filtered_rules = universal_section.textMateRules.filter(
                rule => !isDepthColorRule(rule)
            );
        }
        
        // Add new rules based on current theme
        const new_rules = buildUniversalDepthColorRules();
        current['[*]'] = {
            ...universal_section,
            textMateRules: [
                ...filtered_rules,
                ...new_rules
            ]
        };
        
        await config.update(
            'tokenColorCustomizations',
            current,
            vscode.ConfigurationTarget.Global
        );
        
        log('Updated universal fallback colors');
    } catch (error) {
        log(`Error updating universal fallback colors: ${error}`);
        console.error('Failed to update universal fallback colors:', error);
    }
}
