import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { StataVariant } from './index.js';
import {
    MAC_APP_INSTALL_ROOTS,
    find_installed_variant
} from './stata-install-roots.js';

const VALID_VARIANTS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'
];

let cached_stata_app: StataVariant | null | undefined = undefined;

export async function detect_stata_app(): Promise<StataVariant | null> {
    // Early return for non-macOS platforms since the hardcoded path is macOS-specific
    if (process.platform !== 'darwin') {
        return null;
    }
    
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const setting_value = config.get<string>('stataApp');
    
    // Validate setting_value against allowed variants before using it
    const my_setting = setting_value as StataVariant;
    if (setting_value && VALID_VARIANTS.includes(my_setting)) {
        return my_setting;
    }
    // If setting_value is invalid, fall through to auto-detection
    
    if (cached_stata_app !== undefined) {
        return cached_stata_app;
    }
    
    const my_variant = await find_installed_variant(
        MAC_APP_INSTALL_ROOTS,
        VALID_VARIANTS,
        async (app_path: string) => {
            try {
                await fs.access(app_path);
                return true;
            } catch {
                return false;
            }
        }
    );

    cached_stata_app = my_variant;
    return my_variant;
}

export function clear_stata_cache(): void {
    cached_stata_app = undefined;
}