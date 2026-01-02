#!/usr/bin/env bun
/// <reference path="./types.d.ts" />
/**
 * Uninstall script for the Sight LSP binary.
 * 
 * Removes ~/bin/sight-language-server if it exists.
 * 
 * Usage:
 *   bun scripts/uninstall.ts
 *   bun run uninstall
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

/**
 * Uninstallation result.
 */
interface UninstallResult {
    success: boolean;
    message: string;
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
    return join(homedir(), 'bin', get_binary_name());
}

/**
 * Uninstall the Sight binary from ~/bin/sight-language-server.
 */
async function uninstall(): Promise<UninstallResult> {
    const target_path = get_installed_binary_path();

    if (!existsSync(target_path)) {
        return {
            success: true,
            message: 'Nothing to uninstall. sight-language-server is not installed.',
        };
    }

    try {
        unlinkSync(target_path);
        return {
            success: true,
            message: `Successfully removed ${target_path}`,
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to remove ${target_path}: ${error}`,
        };
    }
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
