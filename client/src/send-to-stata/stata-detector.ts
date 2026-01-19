import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { StataVariant } from './index';

let cached_stata_app: StataVariant | null | undefined = undefined;

export async function detect_stata_app(): Promise<StataVariant | null> {
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const setting_value = config.get<string>('stataApp');
    
    if (setting_value) {
        return setting_value as StataVariant;
    }
    
    if (cached_stata_app !== undefined) {
        return cached_stata_app;
    }
    
    const the_variants: StataVariant[] = ['StataMP', 'StataSE', 'StataIC', 'Stata'];
    
    for (const my_variant of the_variants) {
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