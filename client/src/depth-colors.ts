import * as vscode from 'vscode';
import {
    hasDepthColorRules,
    mergeDepthColors,
    TokenColorCustomizations
} from './depth-colors-core';

// Re-export core functions for convenience
export {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    hasDepthColorRules,
    buildDepthColorRules,
    mergeDepthColors
} from './depth-colors-core';

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

        // Add our default colors
        log('Adding default depth colors...');
        const new_customizations = mergeDepthColors(current_customizations);
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
