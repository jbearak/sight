import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import { StataVariant } from './index';

/**
 * CLI binary names in priority order, per platform.
 * Windows uses PascalCase names; Unix uses lowercase with hyphens.
 */
const UNIX_CLI_BINARIES: readonly string[] =
    ['stata-mp', 'stata-se', 'stata-ic', 'stata-be', 'stata'];
const WIN_CLI_BINARIES: readonly string[] =
    ['StataMP', 'StataSE', 'StataIC', 'StataBE', 'Stata'];

function get_cli_binaries(): readonly string[] {
    return process.platform === 'win32'
        ? WIN_CLI_BINARIES
        : UNIX_CLI_BINARIES;
}

/**
 * Maps GUI variant names to CLI binary names, per platform.
 * Used when the user has set sight.sendToStata.stataApp.
 */
const UNIX_VARIANT_TO_CLI: Record<StataVariant, string> = {
    'StataMP': 'stata-mp',
    'StataSE': 'stata-se',
    'StataBE': 'stata-be',
    'StataIC': 'stata-ic',
    'Stata': 'stata',
};

const WIN_VARIANT_TO_CLI: Record<StataVariant, string> = {
    'StataMP': 'StataMP',
    'StataSE': 'StataSE',
    'StataBE': 'StataBE',
    'StataIC': 'StataIC',
    'Stata': 'Stata',
};

function get_variant_to_cli(): Record<StataVariant, string> {
    return process.platform === 'win32'
        ? WIN_VARIANT_TO_CLI
        : UNIX_VARIANT_TO_CLI;
}

/**
 * Maps CLI binary names to macOS .app bundle paths.
 * Fallback when the binary is not on PATH.
 */
const CLI_TO_MACOS_PATH: Record<string, string> = {
    'stata-mp': '/Applications/Stata/StataMP.app/Contents/MacOS/stata-mp',
    'stata-se': '/Applications/Stata/StataSE.app/Contents/MacOS/stata-se',
    'stata-ic': '/Applications/Stata/StataIC.app/Contents/MacOS/stata-ic',
    'stata-be': '/Applications/Stata/StataBE.app/Contents/MacOS/stata-be',
    'stata': '/Applications/Stata/Stata.app/Contents/MacOS/stata',
};

let cached_stata_cli: string | null | undefined = undefined;

/**
 * Check if a binary exists on PATH using `which` (Unix) or `where` (Windows).
 */
function is_on_path(binary: string): Promise<boolean> {
    const command = process.platform === 'win32' ? 'where' : 'which';
    return new Promise(resolve => {
        execFile(command, [binary], { timeout: 5000 }, (error) => {
            resolve(error === null);
        });
    });
}

/**
 * Detect the Stata CLI binary. Returns the binary name if found on PATH,
 * the full macOS .app path as fallback, or null if not found.
 *
 * Detection order: PATH first (stata-mp > stata-se > stata-be > stata),
 * then macOS .app/Contents/MacOS/ fallback.
 *
 * If sight.sendToStata.stataApp is set, checks that variant first.
 */
export async function detect_stata_cli(): Promise<string | null> {
    if (cached_stata_cli !== undefined) {
        return cached_stata_cli;
    }

    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const setting_value = config.get<string>('stataApp');

    // Build ordered list: user-configured variant first, then defaults
    const the_variant_map = get_variant_to_cli();
    const the_default_binaries = get_cli_binaries();

    const the_binaries: string[] = [];
    if (setting_value && setting_value in the_variant_map) {
        the_binaries.push(
            the_variant_map[setting_value as StataVariant]
        );
    }
    for (const my_binary of the_default_binaries) {
        if (!the_binaries.includes(my_binary)) {
            the_binaries.push(my_binary);
        }
    }

    // Check PATH
    for (const my_binary of the_binaries) {
        if (await is_on_path(my_binary)) {
            cached_stata_cli = my_binary;
            return my_binary;
        }
    }

    // macOS .app fallback
    if (process.platform === 'darwin') {
        for (const my_binary of the_binaries) {
            const my_path = CLI_TO_MACOS_PATH[my_binary];
            if (my_path) {
                try {
                    await fs.access(my_path);
                    cached_stata_cli = my_path;
                    return my_path;
                } catch {
                    continue;
                }
            }
        }
    }

    cached_stata_cli = null;
    return null;
}

export function clear_stata_cli_cache(): void {
    cached_stata_cli = undefined;
}
