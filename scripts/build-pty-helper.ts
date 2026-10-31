#!/usr/bin/env bun
/**
 * Builds the sight-pty helper (client/pty-helper/sight-pty.c) that the
 * VS Code extension uses to run sight console on macOS and Linux, into
 * client/pty-helper/bin/<platform>-<arch>/sight-pty.
 *
 * With Zig (`zig` on PATH, or SIGHT_ZIG), every target is built: Zig
 * cross-compiles from any host and ad-hoc signs macOS arm64 output.
 * Without Zig, only this machine's target is built with `cc`, and the
 * others are reported missing; that fails when CI is set or with
 * --require-all, so a release can't ship without a helper.
 *
 * Usage: bun scripts/build-pty-helper.ts [--require-all]
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface HelperTarget {
    /** Matches the extension's `${process.platform}-${process.arch}`. */
    directory: string;
    zig_target: string;
}

export const HELPER_TARGETS: readonly HelperTarget[] = [
    { directory: 'darwin-arm64', zig_target: 'aarch64-macos' },
    { directory: 'darwin-x64', zig_target: 'x86_64-macos' },
    // Static musl binaries run on any Linux libc.
    { directory: 'linux-x64', zig_target: 'x86_64-linux-musl' },
    { directory: 'linux-arm64', zig_target: 'aarch64-linux-musl' },
];

const ROOT = path.resolve(import.meta.dir, '..');
const SOURCE_PATH = path.join(ROOT, 'client', 'pty-helper', 'sight-pty.c');
const OUTPUT_ROOT = path.join(ROOT, 'client', 'pty-helper', 'bin');
const HELPER_NAME = 'sight-pty';
const COMMON_FLAGS = ['-Os', '-Wall', '-Wextra', '-Werror'];

export function helper_output_path(target: HelperTarget): string {
    return path.join(OUTPUT_ROOT, target.directory, HELPER_NAME);
}

function find_zig(): string | null {
    const from_env = process.env.SIGHT_ZIG;
    if (from_env) {
        return from_env;
    }
    const probe = spawnSync('zig', ['version'], { encoding: 'utf8' });
    return probe.status === 0 ? 'zig' : null;
}

function run(command: string, the_args: string[]): void {
    const result = spawnSync(command, the_args, { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`${command} ${the_args.join(' ')} failed`);
    }
}

function build_target(
    target: HelperTarget,
    compiler: { command: string; prefix: string[]; libraries?: string[] }
): void {
    const output_path = helper_output_path(target);
    fs.mkdirSync(path.dirname(output_path), { recursive: true });
    run(compiler.command, [
        ...compiler.prefix,
        ...COMMON_FLAGS,
        '-o', output_path,
        SOURCE_PATH,
        ...(compiler.libraries ?? []),
    ]);
    fs.chmodSync(output_path, 0o755);
}

export function main(the_args: readonly string[]): number {
    const require_all = the_args.includes('--require-all')
        || Boolean(process.env.CI);
    fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });

    const zig = find_zig();
    if (zig) {
        for (const my_target of HELPER_TARGETS) {
            build_target(my_target, {
                command: zig,
                prefix: ['cc', '-target', my_target.zig_target, '-s'],
            });
        }
        console.log(`Built ${HELPER_NAME} for ${HELPER_TARGETS.length} targets.`);
        return 0;
    }

    const host = `${process.platform}-${process.arch}`;
    const host_target = HELPER_TARGETS.find(
        my_target => my_target.directory === host
    );
    const the_missing = HELPER_TARGETS
        .filter(my_target => my_target !== host_target)
        .map(my_target => my_target.directory);
    if (require_all) {
        console.error(
            `Error: Zig not found; can't build ${HELPER_NAME} for `
            + `${the_missing.join(', ')}. Install Zig or set SIGHT_ZIG.`
        );
        return 1;
    }
    if (host_target) {
        build_target(host_target, {
            command: 'cc',
            prefix: [],
            // glibc before 2.34 keeps openpty in libutil.
            libraries: process.platform === 'linux' ? ['-lutil'] : [],
        });
    }
    console.warn(
        `Warning: Zig not found; built ${HELPER_NAME} only for `
        + `${host_target ? host : 'no target'}. The extension falls back `
        + `to plain Stata on ${the_missing.join(', ')}.`
    );
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
