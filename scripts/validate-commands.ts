#!/usr/bin/env bun

/**
 * Validate commands in the v18 cache using Stata's `which` command.
 *
 * For each command in the cache:
 *   1. `capture which <full_name>` — validates the command exists
 *   2. `capture which <min_abbreviation>` — validates the abbreviation works
 *
 * Usage:
 *   bun scripts/validate-commands.ts              # report only
 *   bun scripts/validate-commands.ts --fix        # remove invalid, fix abbreviations
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { CommandCache } from '../src/command-database/types';

const CACHE_PATH = 'src/command-database/caches/v18.json';
const TMP_DIR = '/tmp/sight-validate';
const BATCH_SIZE = 200; // commands per .do file (avoid Stata line limits)

function find_stata_executable(): string {
    const candidates = [
        '/Applications/Stata/StataMP.app/Contents/MacOS/stata-mp',
        '/Applications/Stata/StataSE.app/Contents/MacOS/stata-se',
        '/Applications/Stata/StataBE.app/Contents/MacOS/stata-be',
        '/Applications/Stata/Stata.app/Contents/MacOS/stata',
        '/usr/local/stata/stata-mp',
        '/usr/local/stata/stata-se',
        '/usr/local/stata/stata',
    ];
    for (const my_path of candidates) {
        try {
            execSync(`test -x "${my_path}"`, { stdio: 'ignore' });
            return my_path;
        } catch { continue; }
    }
    throw new Error('Stata executable not found');
}

interface ValidationResult {
    invalid_commands: string[];
    invalid_abbreviations: Array<{
        name: string;
        abbreviation: string;
        min_abbreviation: number;
    }>;
}

function generate_do_file(
    the_commands: Array<{ name: string; abbrev: string | null }>,
    batch_index: number
): string {
    const do_path = join(TMP_DIR, `validate_${batch_index}.do`);
    const the_lines: string[] = [];

    for (const my_cmd of the_commands) {
        // Validate full command name
        the_lines.push(`capture which ${my_cmd.name}`);
        the_lines.push(
            `display "CMD:${my_cmd.name}:rc=" _rc`
        );
        // Validate abbreviation if different from full name
        if (my_cmd.abbrev) {
            the_lines.push(`capture which ${my_cmd.abbrev}`);
            the_lines.push(
                `display "ABBREV:${my_cmd.name}:${my_cmd.abbrev}:rc=" _rc`
            );
        }
    }

    writeFileSync(do_path, the_lines.join('\n') + '\n');
    return do_path;
}

function parse_log(log_content: string): {
    cmd_results: Map<string, number>;
    abbrev_results: Map<string, { abbrev: string; rc: number }>;
} {
    const cmd_results = new Map<string, number>();
    const abbrev_results = new Map<string, { abbrev: string; rc: number }>();

    for (const my_line of log_content.split('\n')) {
        const cmd_match = my_line.match(/^CMD:([^:]+):rc=\s*(\d+)/);
        if (cmd_match) {
            cmd_results.set(cmd_match[1], parseInt(cmd_match[2]));
            continue;
        }
        const abbrev_match = my_line.match(
            /^ABBREV:([^:]+):([^:]+):rc=\s*(\d+)/
        );
        if (abbrev_match) {
            abbrev_results.set(abbrev_match[1], {
                abbrev: abbrev_match[2],
                rc: parseInt(abbrev_match[3]),
            });
        }
    }

    return { cmd_results, abbrev_results };
}

async function main(): Promise<void> {
    const fix_mode = process.argv.includes('--fix');
    const stata = find_stata_executable();
    console.log(`Using Stata: ${stata}`);

    const cache: CommandCache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    const the_command_entries = Object.values(cache.commands);
    console.log(`Validating ${the_command_entries.length} commands...`);

    mkdirSync(TMP_DIR, { recursive: true });

    // Build command list with abbreviations
    const the_all_checks: Array<{ name: string; abbrev: string | null }> = [];
    for (const my_cmd of the_command_entries) {
        const abbrev =
            my_cmd.min_abbreviation < my_cmd.name.length
                ? my_cmd.name.substring(0, my_cmd.min_abbreviation)
                : null;
        the_all_checks.push({ name: my_cmd.name, abbrev });
    }

    // Run in batches
    const result: ValidationResult = {
        invalid_commands: [],
        invalid_abbreviations: [],
    };

    for (let i = 0; i < the_all_checks.length; i += BATCH_SIZE) {
        const my_batch = the_all_checks.slice(i, i + BATCH_SIZE);
        const batch_index = Math.floor(i / BATCH_SIZE);
        const do_path = generate_do_file(my_batch, batch_index);
        const log_path = do_path.replace('.do', '.log');

        console.log(
            `  Batch ${batch_index + 1}/${Math.ceil(the_all_checks.length / BATCH_SIZE)}...`
        );

        try {
            execSync(`"${stata}" -b do "${do_path}"`, {
                cwd: TMP_DIR,
                stdio: 'ignore',
                timeout: 120_000,
            });
        } catch {
            // Stata returns non-zero on some errors, but log is still written
        }

        let log_content: string;
        try {
            log_content = readFileSync(log_path, 'utf-8');
        } catch {
            console.warn(`  Warning: Could not read log for batch ${batch_index}`);
            continue;
        }

        const { cmd_results, abbrev_results } = parse_log(log_content);

        if (cmd_results.size < my_batch.length) {
            console.warn(
                `  Warning: Only ${cmd_results.size}/${my_batch.length} ` +
                `commands produced results in batch ${batch_index}`
            );
        }

        for (const [my_name, my_rc] of cmd_results) {
            if (my_rc !== 0) {
                result.invalid_commands.push(my_name);
            }
        }

        for (const [my_name, my_info] of abbrev_results) {
            if (my_info.rc !== 0) {
                const cmd = cache.commands[my_name.toLowerCase()];
                if (cmd) {
                    result.invalid_abbreviations.push({
                        name: my_name,
                        abbreviation: my_info.abbrev,
                        min_abbreviation: cmd.min_abbreviation,
                    });
                }
            }
        }
    }

    // Report results
    console.log(`\n=== Validation Results ===`);
    console.log(`Invalid commands: ${result.invalid_commands.length}`);
    if (result.invalid_commands.length > 0) {
        for (const my_name of result.invalid_commands.sort()) {
            const cmd = cache.commands[my_name.toLowerCase()];
            const help_file = cmd?.help_file || '(same)';
            console.log(`  ✗ ${my_name} (help_file: ${help_file})`);
        }
    }

    console.log(`\nInvalid abbreviations: ${result.invalid_abbreviations.length}`);
    if (result.invalid_abbreviations.length > 0) {
        for (const my_entry of result.invalid_abbreviations) {
            console.log(
                `  ✗ ${my_entry.name}: "${my_entry.abbreviation}" ` +
                `(min_abbreviation: ${my_entry.min_abbreviation})`
            );
        }
    }

    if (fix_mode && (result.invalid_commands.length > 0 || result.invalid_abbreviations.length > 0)) {
        console.log(`\n--- Applying fixes ---`);

        // Remove invalid commands
        for (const my_name of result.invalid_commands) {
            const key = my_name.toLowerCase();
            delete cache.commands[key];
            console.log(`  Removed command: ${my_name}`);
        }

        // Fix invalid abbreviations: set min_abbreviation to full name length
        for (const my_entry of result.invalid_abbreviations) {
            const key = my_entry.name.toLowerCase();
            const cmd = cache.commands[key];
            if (cmd) {
                cmd.min_abbreviation = cmd.name.length;
                console.log(
                    `  Fixed abbreviation: ${my_entry.name} ` +
                    `(${my_entry.min_abbreviation} → ${cmd.name.length})`
                );
            }
        }

        // Rebuild abbreviations map
        const { build_abbreviations } = await import('./generate-cache');
        cache.abbreviations = build_abbreviations(cache.commands);

        writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
        console.log(`\nCache updated: ${CACHE_PATH}`);
        console.log(`Commands remaining: ${Object.keys(cache.commands).length}`);
    } else if (!fix_mode && (result.invalid_commands.length > 0 || result.invalid_abbreviations.length > 0)) {
        console.log(`\nRun with --fix to apply corrections.`);
    } else {
        console.log(`\nAll commands and abbreviations are valid!`);
    }
}

main().catch(err => {
    console.error(`Error: ${err}`);
    process.exit(1);
});
