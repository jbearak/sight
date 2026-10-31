#!/usr/bin/env bun
/**
 * Checks that a VSIX carries the sight-pty helper for every target
 * (scripts/build-pty-helper.ts) with its executable mode, so the
 * extension doesn't silently fall back to plain Stata after install.
 *
 * Usage: bun scripts/check-vsix-pty-helpers.ts PATH.vsix
 */

import { spawnSync } from 'child_process';
import { HELPER_TARGETS } from './build-pty-helper';

/** `zipinfo` lines: mode first, path last. */
export function find_helper_problems(zipinfo_text: string): string[] {
    const the_modes = new Map<string, string>();
    for (const my_line of zipinfo_text.split('\n')) {
        const the_fields = my_line.trim().split(/\s+/);
        const entry_path = the_fields.at(-1);
        const mode = the_fields[0];
        if (entry_path && mode) {
            the_modes.set(entry_path, mode);
        }
    }
    const the_problems: string[] = [];
    for (const my_target of HELPER_TARGETS) {
        const entry_path =
            `extension/pty-helper/bin/${my_target.directory}/sight-pty`;
        const mode = the_modes.get(entry_path);
        if (!mode) {
            the_problems.push(`${entry_path} is missing`);
        } else if (!/^-rwx/.test(mode)) {
            the_problems.push(`${entry_path} is not executable (${mode})`);
        }
    }
    return the_problems;
}

if (import.meta.main) {
    const vsix_path = process.argv[2];
    if (!vsix_path) {
        console.error('Usage: bun scripts/check-vsix-pty-helpers.ts PATH.vsix');
        process.exit(2);
    }
    const listed = spawnSync('zipinfo', [vsix_path], { encoding: 'utf8' });
    if (listed.status !== 0) {
        console.error(listed.stderr || `zipinfo failed on ${vsix_path}`);
        process.exit(1);
    }
    const the_problems = find_helper_problems(listed.stdout);
    for (const my_problem of the_problems) {
        console.error(`ERROR: ${my_problem}`);
    }
    if (the_problems.length > 0) {
        process.exit(1);
    }
    console.log(`OK: sight-pty for ${HELPER_TARGETS.length} targets, executable`);
}
