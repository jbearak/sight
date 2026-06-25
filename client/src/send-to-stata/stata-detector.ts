import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { StataVariant } from './index.js';
import {
    MACOS_VARIANT_PRIORITY,
    find_installed_stata_app,
} from './stata-paths.js';

let cached_stata_app: StataVariant | null | undefined = undefined;

async function bundle_exists(bundle_path: string): Promise<boolean> {
    try {
        await fs.access(bundle_path);
        return true;
    } catch {
        return false;
    }
}

export async function detect_stata_app(): Promise<StataVariant | null> {
    // Early return for non-macOS platforms since the hardcoded path is macOS-specific
    if (process.platform !== 'darwin') {
        return null;
    }

    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const setting_value = config.get<string>('stataApp');

    // Validate setting_value against allowed variants before using it
    if (setting_value && MACOS_VARIANT_PRIORITY.includes(setting_value as StataVariant)) {
        return setting_value as StataVariant;
    }
    // If setting_value is invalid, fall through to auto-detection

    if (cached_stata_app !== undefined) {
        return cached_stata_app;
    }

    // Probe each variant across every known install directory
    // (/Applications/Stata and /Applications/StataNow).
    cached_stata_app = await find_installed_stata_app(bundle_exists);
    return cached_stata_app;
}

export function clear_stata_cache(): void {
    cached_stata_app = undefined;
}
