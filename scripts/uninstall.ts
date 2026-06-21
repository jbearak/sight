#!/usr/bin/env bun
/**
 * Uninstall script for the Sight LSP binary.
 * 
 * Removes Sight-owned ~/bin/sight command names.
 * Leaves unrelated files with the same names in place.
 * 
 * Usage:
 *   bun scripts/uninstall.ts
 *   bun run uninstall:binary
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, lstatSync, unlinkSync } from 'fs';
import { is_sight_binary } from './binary-ownership';
import {
    get_binary_paths_to_uninstall,
} from './binary-names';

type BinaryOwnershipChecker = (binary_path: string) => boolean;

export {
    get_binary_names_to_uninstall,
} from './binary-names';

/**
 * Uninstallation result.
 */
export interface UninstallResult {
    success: boolean;
    message: string;
}

/**
 * Get the installed binary paths.
 */
export function get_installed_binary_paths(
    user_bin_path: string = join(homedir(), 'bin'),
    platform: NodeJS.Platform = process.platform
): string[] {
    return get_binary_paths_to_uninstall(user_bin_path, platform);
}

function exists_or_is_symlink(target_path: string): boolean {
    try {
        lstatSync(target_path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

/**
 * Uninstall Sight binaries from a bin directory.
 */
export function uninstall_from_bin_dir(
    user_bin_path: string,
    platform: NodeJS.Platform = process.platform,
    is_sight_binary_fn: BinaryOwnershipChecker = is_sight_binary
): UninstallResult {
    const the_target_paths = get_installed_binary_paths(
        user_bin_path,
        platform
    );
    const the_existing_paths = the_target_paths.filter(
        (target_path) => exists_or_is_symlink(target_path)
    );

    if (the_existing_paths.length === 0) {
        return {
            success: true,
            message: 'Nothing to uninstall. sight is not installed.',
        };
    }

    const the_sight_paths: string[] = [];
    const the_skipped_paths: string[] = [];

    for (const my_target_path of the_existing_paths) {
        if (
            existsSync(my_target_path) &&
            is_sight_binary_fn(my_target_path)
        ) {
            the_sight_paths.push(my_target_path);
        } else {
            the_skipped_paths.push(my_target_path);
        }
    }

    if (the_sight_paths.length === 0) {
        return {
            success: true,
            message:
                'No Sight-owned binaries found. Skipped existing files: ' +
                the_skipped_paths.join(', '),
        };
    }

    const removed_paths: string[] = [];

    for (const my_target_path of the_sight_paths) {
        try {
            unlinkSync(my_target_path);
            removed_paths.push(my_target_path);
        } catch (error) {
            return {
                success: false,
                message: `Failed to remove ${my_target_path}: ${error}`,
            };
        }
    }

    if (the_skipped_paths.length > 0) {
        return {
            success: true,
            message:
                `Successfully removed ${removed_paths.join(', ')}. ` +
                `Skipped existing non-Sight files: ${
                    the_skipped_paths.join(', ')
                }`,
        };
    }

    return {
        success: true,
        message: `Successfully removed ${removed_paths.join(', ')}`,
    };
}

/**
 * Uninstall Sight binaries from ~/bin.
 */
async function uninstall(): Promise<UninstallResult> {
    return uninstall_from_bin_dir(join(homedir(), 'bin'));
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    console.log('Uninstalling Sight Language Server...\n');

    const result = await uninstall();

    if (!result.success) {
        console.error(`Error: ${result.message}`);
        process.exit(1);
    }

    console.log(`✓ ${result.message}`);
}

// Only run main when executed directly (not when imported)
if (import.meta.main) {
    main().catch((error) => {
        console.error('Uninstallation failed:', error);
        process.exit(1);
    });
}
