#!/usr/bin/env bun
/**
 * Install script for the Sight LSP binary.
 * 
 * Copies the platform binary to ~/bin/sight and the legacy alias.
 * Provides PATH setup instructions after install.
 * 
 * Usage:
 *   bun scripts/install.ts
 *   bun run install:binary
 */

import { homedir } from 'os';
import { join, resolve } from 'path';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    unlinkSync,
} from 'fs';
import { detect_platform } from './build-binary';
import {
    get_binary_shadow_paths_to_check,
    get_binary_paths_to_install,
} from './binary-names';
import { ensure_sight_binary_target } from './binary-ownership';

export { get_binary_name } from './binary-names';

/**
 * Installation result.
 */
interface InstallResult {
    success: boolean;
    message: string;
    path_in_path: boolean;
}

interface ExistingTarget {
    path: string;
    exists_or_is_symlink: boolean;
    is_symlink: boolean;
}

type ExistingTargetChecker = (
    binary_path: string,
    platform: NodeJS.Platform
) => void;

/**
 * Get the user's bin directory path.
 */
function get_user_bin_path(): string {
    return join(homedir(), 'bin');
}

/**
 * Get all installed binary paths.
 */
export function get_installed_binary_paths(
    user_bin_path: string = get_user_bin_path(),
    platform: NodeJS.Platform = process.platform
): string[] {
    return get_binary_paths_to_install(user_bin_path, platform);
}

function get_existing_target(target_path: string): ExistingTarget {
    try {
        const target_stats = lstatSync(target_path);

        return {
            path: target_path,
            exists_or_is_symlink: true,
            is_symlink: target_stats.isSymbolicLink(),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
                path: target_path,
                exists_or_is_symlink: false,
                is_symlink: false,
            };
        }

        throw error;
    }
}

function ensure_existing_target_is_replaceable(
    target: ExistingTarget,
    platform: NodeJS.Platform,
    check_existing_target: ExistingTargetChecker
): void {
    if (!target.exists_or_is_symlink) {
        return;
    }

    if (target.is_symlink && !existsSync(target.path)) {
        throw new Error(
            `Refusing to overwrite ${target.path}; it is a dangling ` +
            'symlink and cannot be verified as a Sight binary.'
        );
    }

    check_existing_target(target.path, platform);
}

/**
 * Copy the source binary to every supported command name.
 */
export function install_binary_files(
    source_path: string,
    user_bin_path: string,
    platform: NodeJS.Platform = process.platform,
    check_existing_target: ExistingTargetChecker = ensure_sight_binary_target
): string[] {
    const the_target_paths = get_installed_binary_paths(
        user_bin_path,
        platform
    );
    const the_existing_targets = the_target_paths.map(get_existing_target);
    const the_existing_shadow_targets = get_binary_shadow_paths_to_check(
        user_bin_path,
        platform
    ).map(get_existing_target);

    for (const my_target of [
        ...the_existing_targets,
        ...the_existing_shadow_targets,
    ]) {
        ensure_existing_target_is_replaceable(
            my_target,
            platform,
            check_existing_target
        );
    }

    for (const my_target of the_existing_targets) {
        if (
            my_target.exists_or_is_symlink &&
            my_target.is_symlink
        ) {
            unlinkSync(my_target.path);
        }
    }

    for (const my_target of the_existing_shadow_targets) {
        if (my_target.exists_or_is_symlink) {
            unlinkSync(my_target.path);
        }
    }

    for (const my_target_path of the_target_paths) {
        copyFileSync(source_path, my_target_path);
    }

    return the_target_paths;
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
 * Install the Sight binary to ~/bin command names.
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

    // Copy the binary to the primary command and legacy alias.
    let the_target_paths: string[] = [];
    try {
        the_target_paths = install_binary_files(source_path, user_bin);
        for (const my_target_path of the_target_paths) {
            console.log(`Copied ${source_path} to ${my_target_path}`);
        }
    } catch (error) {
        return {
            success: false,
            message: `Failed to copy binary: ${error}`,
            path_in_path: false,
        };
    }

    // Set executable permissions (Unix only)
    if (process.platform !== 'win32') {
        for (const my_target_path of the_target_paths) {
            try {
                chmodSync(my_target_path, 0o755);
            } catch (error) {
                console.warn(
                    `Warning: Could not set executable permissions: ${error}`
                );
            }
        }
    }

    // Check if ~/bin is in PATH
    const path_in_path = is_path_in_env(user_bin);

    return {
        success: true,
        message: `Successfully installed to ${the_target_paths.join(', ')}`,
        path_in_path,
    };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    console.log('Installing Sight...\n');

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
        console.log('\nYou can now use sight from any directory.');
    }
}

// Only run main when executed directly (not when imported)
if (import.meta.main) {
    main().catch((error) => {
        console.error('Installation failed:', error);
        process.exit(1);
    });
}
