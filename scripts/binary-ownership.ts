/**
 * Helpers for deciding whether an existing binary belongs to Sight.
 */

import {
    spawnSync,
    type SpawnSyncOptionsWithStringEncoding,
} from 'child_process';
import { readFileSync } from 'fs';
import { extname } from 'path';
import {
    CLI_HELP_BANNER,
    PRIMARY_BINARY_NAME,
} from '../src/cli-binary-names';

const VERSION_PATTERN = new RegExp(
    `^${PRIMARY_BINARY_NAME} \\d+\\.\\d+\\.\\d+` +
    '(?:-[0-9A-Za-z.-]+)?$'
);

interface BinarySpawnInvocation {
    command: string;
    args: string[];
    options: SpawnSyncOptionsWithStringEncoding;
}

const BASE_SPAWN_OPTIONS: SpawnSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    timeout: 5000,
};

function has_sight_npm_shim_content(binary_path: string): boolean {
    const extension = extname(binary_path).toLowerCase();
    if (!['', '.cmd', '.bat', '.ps1'].includes(extension)) {
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
    if (platform === 'win32' && has_sight_npm_shim_content(binary_path)) {
        return true;
    }

    const version_invocation = get_sight_binary_spawn_invocation(
        binary_path,
        ['--version'],
        platform
    );
    const version_result = spawnSync(
        version_invocation.command,
        version_invocation.args,
        version_invocation.options
    );

    if (version_result.error || version_result.status !== 0) {
        return false;
    }

    if (!VERSION_PATTERN.test(version_result.stdout.trim())) {
        return false;
    }

    const help_invocation = get_sight_binary_spawn_invocation(
        binary_path,
        ['--help'],
        platform
    );
    const help_result = spawnSync(
        help_invocation.command,
        help_invocation.args,
        help_invocation.options
    );

    if (help_result.error || help_result.status !== 0) {
        return false;
    }

    return help_result.stdout.includes(CLI_HELP_BANNER);
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
