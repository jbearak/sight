#!/usr/bin/env bun
/**
 * Install script for the Sight LSP binary.
 * 
 * Copies the appropriate platform binary to ~/bin/sight-language-server
 * and provides PATH setup instructions if needed.
 * 
 * Usage:
 *   bun scripts/install.ts
 *   bun run install
 */

import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { detect_platform } from './build-binary';

/**
 * Installation result.
 */
interface InstallResult {
    success: boolean;
    message: string;
    path_in_path: boolean;
}

/**
 * Get the user's bin directory path.
 */
function get_user_bin_path(): string {
    return join(homedir(), 'bin');
}

/**
 * Get the installed binary name (with .exe on Windows).
 */
function get_binary_name(): string {
    return process.platform === 'win32' ? 'sight-language-server.exe' : 'sight-language-server';
}

/**
 * Get the installed binary path.
 */
function get_installed_binary_path(): string {
    return join(get_user_bin_path(), get_binary_name());
}

/**
 * Check if a directory is in the PATH environment variable.
 * Handles:
 * - Colon-separated paths (Unix)
 * - Semicolon-separated paths (Windows)
 * - Paths with trailing slashes
 * - Paths using $HOME, ~, or %USERPROFILE% notation
 */
export function is_path_in_env(target_dir: string): boolean {
    const path_env = process.env.PATH || '';
    const home = homedir();
    
    // Normalize the target directory (strip trailing slashes and backslashes)
    const normalized_target = resolve(target_dir).replace(/[/\\]+$/, '');
    
    // Determine separator based on platform
    const separator = process.platform === 'win32' ? ';' : ':';
    const the_paths = path_env.split(separator);
    
    for (const my_path of the_paths) {
        if (!my_path) continue;
        
        // Expand ~ and $HOME and ${HOME} and %USERPROFILE%
        let expanded_path = my_path
            .replace(/^~/, home)
            .replace(/\$\{HOME\}/g, home)
            .replace(/\$HOME/g, home)
            .replace(/%USERPROFILE%/gi, home);
        
        // Normalize and remove trailing slashes/backslashes
        expanded_path = resolve(expanded_path).replace(/[/\\]+$/, '');
        
        if (expanded_path === normalized_target) {
            return true;
        }
    }
    
    return false;
}


/**
 * Get PATH setup instructions for a specific shell.
 */
function get_path_instructions(shell: string): string {
    const user_bin = get_user_bin_path();
    
    switch (shell) {
        case 'bash':
            return `Add to ~/.bashrc:\n  export PATH="$HOME/bin:$PATH"`;
        case 'zsh':
            return `Add to ~/.zshrc:\n  export PATH="$HOME/bin:$PATH"`;
        case 'fish':
            return `Add to ~/.config/fish/config.fish:\n  set -gx PATH $HOME/bin $PATH`;
        default:
            return `Add ${user_bin} to your PATH`;
    }
}

/**
 * Detect the user's shell.
 */
function detect_shell(): string {
    const shell_env = process.env.SHELL || '';
    if (shell_env.includes('zsh')) return 'zsh';
    if (shell_env.includes('fish')) return 'fish';
    if (shell_env.includes('bash')) return 'bash';
    return 'unknown';
}

/**
 * Install the Sight binary to ~/bin/sight-language-server.
 */
async function install(): Promise<InstallResult> {
    // Detect platform
    const platform_info = detect_platform();
    if (!platform_info) {
        return {
            success: false,
            message: `Unsupported platform: ${process.platform}-${process.arch}`,
            path_in_path: false,
        };
    }

    // Find the source binary
    const source_path = join('bin', platform_info.binary_name);
    if (!existsSync(source_path)) {
        return {
            success: false,
            message: `Binary not found: ${source_path}\n\nRun 'bun run build:current' first to build the binary.`,
            path_in_path: false,
        };
    }

    // Smoke test the binary
    try {
        const { spawnSync } = await import('child_process');
        const result = spawnSync(source_path, ['--version'], { timeout: 5000 });
        if (result.status !== 0) {
            throw new Error(`Binary returned exit code ${result.status}`);
        }
        console.log('✓ Binary smoke test passed');
    } catch (error) {
        return {
            success: false,
            message: `Binary smoke test failed: ${error}\n\nThe binary exists but is not functional.`,
            path_in_path: false,
        };
    }

    // Create ~/bin if it doesn't exist
    const user_bin = get_user_bin_path();
    if (!existsSync(user_bin)) {
        try {
            mkdirSync(user_bin, { recursive: true });
            console.log(`Created directory: ${user_bin}`);
        } catch (error) {
            return {
                success: false,
                message: `Failed to create directory ${user_bin}: ${error}`,
                path_in_path: false,
            };
        }
    }

    // Copy the binary
    const target_path = get_installed_binary_path();
    try {
        copyFileSync(source_path, target_path);
        console.log(`Copied ${source_path} to ${target_path}`);
    } catch (error) {
        return {
            success: false,
            message: `Failed to copy binary: ${error}`,
            path_in_path: false,
        };
    }

    // Set executable permissions (Unix only)
    if (process.platform !== 'win32') {
        try {
            chmodSync(target_path, 0o755);
        } catch (error) {
            console.warn(`Warning: Could not set executable permissions: ${error}`);
        }
    }

    // Check if ~/bin is in PATH
    const path_in_path = is_path_in_env(user_bin);

    return {
        success: true,
        message: `Successfully installed to ${target_path}`,
        path_in_path,
    };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    console.log('Installing Sight Language Server...\n');

    const result = await install();

    if (!result.success) {
        console.error(`Error: ${result.message}`);
        process.exit(1);
    }

    console.log(`\n✓ ${result.message}`);

    if (!result.path_in_path) {
        const shell = detect_shell();
        console.log('\n⚠ ~/bin is not in your PATH.');
        console.log('\nTo add it, run one of the following:\n');
        console.log(`  ${get_path_instructions('bash')}\n`);
        console.log(`  ${get_path_instructions('zsh')}\n`);
        console.log(`  ${get_path_instructions('fish')}\n`);
        console.log('Then restart your shell or run: source ~/.bashrc (or ~/.zshrc)');
    } else {
        console.log('\n✓ ~/bin is already in your PATH.');
        console.log('\nYou can now use sight-language-server from any directory.');
    }
}

// Only run main when executed directly (not when imported)
if (import.meta.main) {
    main().catch((error) => {
        console.error('Installation failed:', error);
        process.exit(1);
    });
}
