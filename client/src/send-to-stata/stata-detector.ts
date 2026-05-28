import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { StataVariant } from './index.js';

const VALID_VARIANTS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataIC', 'Stata'
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
    if (setting_value && VALID_VARIANTS.includes(setting_value as StataVariant)) {
        return setting_value as StataVariant;
    }
    // If setting_value is invalid, fall through to auto-detection
    
    if (cached_stata_app !== undefined) {
        return cached_stata_app;
    }
    
    for (const my_variant of VALID_VARIANTS) {
        try {
            await fs.access(`/Applications/Stata/${my_variant}.app`);
            cached_stata_app = my_variant;
            return my_variant;
        } catch {
            continue;
        }
    }
    
    cached_stata_app = null;
    return null;
}

export function clear_stata_cache(): void {
    cached_stata_app = undefined;
}