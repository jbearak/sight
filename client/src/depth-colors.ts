import * as vscode from 'vscode';
import { window, ColorThemeKind } from 'vscode';
import {
    hasDepthColorRules,
    mergeDepthColors,
    buildDepthColorRules,
    isDepthColorRule,
    removeSightOwnedDepthRules,
    TokenColorCustomizations,
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
    isDepthColorRule,
    removeSightOwnedDepthRules
} from './depth-colors-core';

/**
 * Determines if the current theme is a dark theme.
 * Includes both regular dark themes and high contrast dark themes.
 * Returns true (dark) as fallback if theme detection fails.
 */
export function isDarkTheme(): boolean {
    try {
        const theme_kind = window.activeColorTheme?.kind;
        if (theme_kind === undefined || theme_kind === null) {
            return true;
        }
        return theme_kind === ColorThemeKind.Dark || 
               theme_kind === ColorThemeKind.HighContrast;
    } catch {
        return true;
    }
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
 * Check if the top-level textMateRules has depth color rules.
 * Top-level rules apply to all themes (universal fallback).
 */
function hasTopLevelDepthColorRules(customizations: TokenColorCustomizations | undefined): boolean {
    if (!customizations) return false;
    const top_level_rules = customizations.textMateRules;
    if (!top_level_rules) return false;
    return top_level_rules.some(rule => isDepthColorRule(rule));
}

/**
 * True iff the user has enabled Sight's depth coloring of nested strings
 * and local macros. Default: true (preserves historical behavior on
 * upgrade). Read synchronously from the workspace configuration.
 */
export function isDepthColorsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('sight')
        .get<boolean>('depthColors.enabled', true);
}

/**
 * Configure depth colors in user settings if not already present.
 *
 * This function checks if depth color rules actually exist in user settings,
 * and adds them if missing. This ensures colors are always configured,
 * even if the user's settings were reset or the extension was reinstalled.
 *
 * It also ensures the top-level textMateRules has rules for themes that don't
 * match [*Dark*] or [*Light*] patterns.
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
        if (!isDepthColorsEnabled()) {
            log('Depth colors disabled via sight.depthColors.enabled, skipping');
            return;
        }
        const config = vscode.workspace.getConfiguration('editor');
        const current_customizations = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        log(`Current customizations: ${JSON.stringify(current_customizations)}`);

        const has_any_depth_rules = hasDepthColorRules(current_customizations);
        const has_top_level_rules = hasTopLevelDepthColorRules(current_customizations);
        
        // If we have depth rules but no top-level rules, we need to add top-level rules
        // This handles the case where user has old config with only [*Dark*]/[*Light*]
        if (has_any_depth_rules && !has_top_level_rules) {
            log('Depth rules exist but no top-level rules, adding universal fallback...');
            const universal_rules = buildUniversalDepthColorRules();
            const updated = { ...current_customizations } as TokenColorCustomizations;
            updated.textMateRules = [
                ...(updated.textMateRules || []),
                ...universal_rules
            ];
            await config.update(
                'tokenColorCustomizations',
                updated,
                vscode.ConfigurationTarget.Global
            );
            log('Added top-level universal fallback rules');
            return;
        }

        // Check if depth color rules actually exist in settings
        if (has_any_depth_rules) {
            log('Depth color rules already exist in settings (including top-level), skipping');
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
                    rule => !isDepthColorRule(rule)
                );
            }
            
            // Remove our depth color rules from light theme
            const light_section = current_customizations['[*Light*]'];
            if (light_section?.textMateRules) {
                light_section.textMateRules = light_section.textMateRules.filter(
                    rule => !isDepthColorRule(rule)
                );
            }
            
            // Remove our depth color rules from top-level textMateRules (universal fallback)
            if (current_customizations.textMateRules) {
                current_customizations.textMateRules = current_customizations.textMateRules.filter(
                    rule => !isDepthColorRule(rule)
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
    logger?: { appendLine(message: string): void }
): vscode.Disposable {
    let previous_is_dark = isDarkTheme();

    const log = (msg: string) => {
        logger?.appendLine(`[DepthColors] ${msg}`);
    };

    return vscode.window.onDidChangeActiveColorTheme(async (_theme) => {
        const current_is_dark = isDarkTheme();

        // Only update if theme kind changed (dark <-> light)
        if (current_is_dark !== previous_is_dark) {
            log(`Theme kind changed: ${previous_is_dark ? 'dark' : 'light'} -> ${current_is_dark ? 'dark' : 'light'}`);
            previous_is_dark = current_is_dark;

            // Update the universal fallback colors
            await updateUniversalFallbackColors(logger);
        }
    });
}

/**
 * Update only the universal fallback colors based on current theme.
 * Removes existing top-level depth rules and adds new ones.
 */
export async function updateUniversalFallbackColors(
    logger?: { appendLine(message: string): void }
): Promise<void> {
    const log = (msg: string) => {
        logger?.appendLine(`[DepthColors] ${msg}`);
    };

    try {
        if (!isDepthColorsEnabled()) {
            log('Depth colors disabled via sight.depthColors.enabled, skipping fallback update');
            return;
        }
        const config = vscode.workspace.getConfiguration('editor');
        const current = config.get<TokenColorCustomizations>('tokenColorCustomizations') || {};
        
        // Remove existing top-level depth rules
        let filtered_rules: TextMateRule[] = [];
        if (current.textMateRules) {
            filtered_rules = current.textMateRules.filter(
                rule => !isDepthColorRule(rule)
            );
        }
        
        // Add new rules based on current theme
        const new_rules = buildUniversalDepthColorRules();
        current.textMateRules = [
            ...filtered_rules,
            ...new_rules
        ];
        
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

/**
 * Remove Sight-owned depth color rules from the user's
 * editor.tokenColorCustomizations. Hand-edited rules on depth scopes
 * (non-palette colors) are preserved. Called when the user flips
 * sight.depthColors.enabled to false.
 *
 * Errors are logged to the output channel; the function does not throw,
 * so it is safe to call during activation or configuration-change handlers.
 */
export async function disableDepthColors(
    _context: vscode.ExtensionContext,
    output_channel?: vscode.OutputChannel
): Promise<void> {
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    try {
        const config = vscode.workspace.getConfiguration('editor');
        const current = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        if (!current) {
            log('No editor.tokenColorCustomizations to clean up');
            return;
        }
        const cleaned = removeSightOwnedDepthRules(current);
        await config.update(
            'tokenColorCustomizations',
            cleaned,
            vscode.ConfigurationTarget.Global
        );
        log('Removed Sight-owned depth color rules');
    } catch (error) {
        log(`Error disabling depth colors: ${error}`);
        console.error('Failed to disable depth colors:', error);
    }
}
