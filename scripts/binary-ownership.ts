/**
 * Helpers for deciding whether an existing binary belongs to Sight.
 */

import {
    type SpawnSyncOptionsWithStringEncoding,
} from 'child_process';
import { readFileSync } from 'fs';
import { extname } from 'path';
import {
    CLI_DESCRIPTION,
    PRIMARY_BINARY_NAME,
    WINDOWS_SHIM_EXTENSIONS,
} from '../src/cli-binary-names';

const BUNDLED_SERVER_ENTRYPOINT = 'sight-server.js';
const LEGACY_CLI_HELP_BANNER =
    'Sight - Language Server Protocol implementation for Stata';
const CURRENT_STATIC_BINARY_MARKERS = [
    CLI_DESCRIPTION,
    PRIMARY_BINARY_NAME,
].map((my_marker) => Buffer.from(my_marker, 'utf8'));
const LEGACY_STATIC_BINARY_MARKERS = [
    LEGACY_CLI_HELP_BANNER,
    BUNDLED_SERVER_ENTRYPOINT,
].map((my_marker) => Buffer.from(my_marker, 'utf8'));

interface BinarySpawnInvocation {
    command: string;
    args: string[];
    options: SpawnSyncOptionsWithStringEncoding;
}

const BASE_SPAWN_OPTIONS: SpawnSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    timeout: 5000,
};

function has_sight_npm_shim_content(
    binary_path: string,
    platform: NodeJS.Platform
): boolean {
    const extension = extname(binary_path).toLowerCase();
    const the_allowed_extensions = platform === 'win32'
        ? WINDOWS_SHIM_EXTENSIONS
        : [''];

    if (!the_allowed_extensions.includes(extension)) {
        return false;
    }

    let file_content: string;
    try {
        file_content = readFileSync(binary_path, 'utf8');
    } catch {
        return false;
    }

    const normalized_content = file_content.replace(/\\/g, '/');
    if (!normalized_content.includes('sight-server.js')) {
        return false;
    }

    if (extension === '.ps1') {
        return (
            file_content.includes('$basedir=Split-Path') &&
            file_content.includes('$args')
        );
    }

    if (extension === '.cmd' || extension === '.bat') {
        return (
            file_content.includes('CALL :find_dp0') &&
            file_content.includes('%*')
        );
    }

    return (
        file_content.startsWith('#!/bin/sh') &&
        file_content.includes('basedir=$(dirname') &&
        file_content.includes('"$@"')
    );
}

function includes_all_binary_markers(
    file_content: Buffer,
    markers: Buffer[]
): boolean {
    return markers.every((my_marker) => file_content.includes(my_marker));
}

function has_static_sight_binary_markers(binary_path: string): boolean {
    let file_content: Buffer;
    try {
        file_content = readFileSync(binary_path);
    } catch {
        return false;
    }

    return (
        includes_all_binary_markers(
            file_content,
            CURRENT_STATIC_BINARY_MARKERS
        ) ||
        includes_all_binary_markers(
            file_content,
            LEGACY_STATIC_BINARY_MARKERS
        )
    );
}

export function get_sight_binary_spawn_invocation(
    binary_path: string,
    args: string[],
    platform: NodeJS.Platform = process.platform
): BinarySpawnInvocation {
    if (platform === 'win32') {
        const extension = extname(binary_path).toLowerCase();

        if (extension === '.cmd' || extension === '.bat') {
            return {
                command: binary_path,
                args,
                options: {
                    ...BASE_SPAWN_OPTIONS,
                    shell: true,
                },
            };
        }

        if (extension === '.ps1') {
            return {
                command: 'powershell.exe',
                args: [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    binary_path,
                    ...args,
                ],
                options: BASE_SPAWN_OPTIONS,
            };
        }
    }

    return {
        command: binary_path,
        args,
        options: BASE_SPAWN_OPTIONS,
    };
}

/**
 * Check whether a path points to a runnable Sight binary.
 */
export function is_sight_binary(
    binary_path: string,
    platform: NodeJS.Platform = process.platform
): boolean {
    if (has_sight_npm_shim_content(binary_path, platform)) {
        return true;
    }

    return has_static_sight_binary_markers(binary_path);
}

/**
 * Refuse to overwrite unrelated commands such as a pre-existing `sight`.
 */
export function ensure_sight_binary_target(
    binary_path: string,
    platform: NodeJS.Platform = process.platform
): void {
    if (is_sight_binary(binary_path, platform)) {
        return;
    }

    throw new Error(
        `Refusing to overwrite ${binary_path}; it exists but does not ` +
        'look like a Sight binary. Move it aside and retry.'
    );
}
