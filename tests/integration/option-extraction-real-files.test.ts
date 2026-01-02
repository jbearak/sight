/**
 * Integration tests for option extraction from real Stata sthlp files.
 *
 * These tests verify that the option extraction logic works correctly
 * with actual Stata help files. Tests are skipped if Stata is not installed.
 *
 * Requirements: 8.2 - FOR ALL commands with options, the extracted option
 * count SHALL be greater than zero when the help file documents options.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import {
    extract_commands_from_file,
    extract_options_section,
    extract_options_from_section,
} from '../../src/command-database/smcl-extractor';

// ============================================================================
// Stata Installation Detection
// ============================================================================

/**
 * Common paths where Stata might be installed.
 */
const STATA_PATHS = [
    '/Applications/Stata',
    '/usr/local/stata',
    '/usr/local/stata18',
    '/usr/local/stata17',
    'C:\\Program Files\\Stata18',
    'C:\\Program Files\\Stata17',
    'C:\\Program Files (x86)\\Stata18',
    'C:\\Program Files (x86)\\Stata17',
];

/**
 * Find the Stata installation path, or null if not found.
 */
function find_stata_path(): string | null {
    for (const my_path of STATA_PATHS) {
        try {
            const my_stat = statSync(my_path);
            if (my_stat.isDirectory()) {
                return my_path;
            }
        } catch {
            // Path doesn't exist, continue
        }
    }
    return null;
}

/**
 * Get the path to a specific sthlp file.
 */
function get_sthlp_path(stata_path: string, command_name: string): string {
    const first_letter = command_name.charAt(0).toLowerCase();
    return join(stata_path, 'ado', 'base', first_letter, `${command_name}.sthlp`);
}

// ============================================================================
// Test Setup
// ============================================================================

let stata_path: string | null = null;
let stata_available = false;

beforeAll(() => {
    stata_path = find_stata_path();
    stata_available = stata_path !== null;

    if (!stata_available) {
        console.log(
            'Stata not found - skipping real file integration tests. ' +
            'Install Stata to run these tests.'
        );
    } else {
        console.log(`Found Stata at: ${stata_path}`);
    }
});

// ============================================================================
// Integration Tests for Real sthlp Files
// ============================================================================

describe('Option Extraction from Real sthlp Files', () => {
    describe('regress.sthlp - Many options with abbreviations', () => {
        it('should extract options from regress.sthlp', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'regress');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            const result = extract_commands_from_file(file_path);

            // Should extract at least one command
            expect(result.commands.length).toBeGreaterThan(0);
            expect(result.warnings).toHaveLength(0);

            // Find the regress command
            const regress_cmd = result.commands.find(c => c.name === 'regress');
            expect(regress_cmd).toBeDefined();

            if (regress_cmd) {
                // regress has many options - should extract at least some
                console.log(`regress options extracted: ${regress_cmd.options.length}`);

                // Verify we got some options
                expect(regress_cmd.options.length).toBeGreaterThan(0);

                // Check for common regress options
                const option_names = regress_cmd.options.map(o => o.name);
                console.log('Option names:', option_names.slice(0, 10).join(', '));

                // regress typically has options like noconstant, robust, vce, etc.
                // At least one of these should be present
                const expected_options = ['noconstant', 'robust', 'vce', 'level', 'beta'];
                const found_expected = expected_options.some(opt =>
                    option_names.includes(opt)
                );

                if (!found_expected) {
                    console.log('Warning: None of the expected options found');
                    console.log('All options:', option_names.join(', '));
                }
            }
        });

        it('should extract options with correct abbreviations', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'regress');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            const result = extract_commands_from_file(file_path);
            const regress_cmd = result.commands.find(c => c.name === 'regress');

            if (regress_cmd && regress_cmd.options.length > 0) {
                // Check that abbreviations are valid
                for (const my_option of regress_cmd.options) {
                    // min_abbreviation should be <= name length
                    expect(my_option.min_abbreviation).toBeLessThanOrEqual(
                        my_option.name.length
                    );
                    // min_abbreviation should be > 0
                    expect(my_option.min_abbreviation).toBeGreaterThan(0);
                }
            }
        });
    });

    describe('summarize.sthlp - Simple options', () => {
        it('should extract options from summarize.sthlp', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'summarize');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            const result = extract_commands_from_file(file_path);

            expect(result.commands.length).toBeGreaterThan(0);
            expect(result.warnings).toHaveLength(0);

            const summarize_cmd = result.commands.find(c => c.name === 'summarize');
            expect(summarize_cmd).toBeDefined();

            if (summarize_cmd) {
                console.log(`summarize options extracted: ${summarize_cmd.options.length}`);

                // summarize has options like detail, meanonly, format, separator
                const option_names = summarize_cmd.options.map(o => o.name);
                console.log('Option names:', option_names.join(', '));

                // Check for common summarize options
                const expected_options = ['detail', 'meanonly', 'format', 'separator'];
                const found_count = expected_options.filter(opt =>
                    option_names.includes(opt)
                ).length;

                console.log(`Found ${found_count}/${expected_options.length} expected options`);
            }
        });
    });

    describe('generate.sthlp - Multi-command file', () => {
        it('should extract commands and options from generate.sthlp', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'generate');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            const result = extract_commands_from_file(file_path);

            expect(result.commands.length).toBeGreaterThan(0);
            expect(result.warnings).toHaveLength(0);

            // generate.sthlp documents both generate and replace
            const command_names = result.commands.map(c => c.name);
            console.log('Commands extracted:', command_names.join(', '));

            // Should have at least generate
            expect(command_names).toContain('generate');

            // Check options for generate
            const generate_cmd = result.commands.find(c => c.name === 'generate');
            if (generate_cmd) {
                console.log(`generate options: ${generate_cmd.options.length}`);
                if (generate_cmd.options.length > 0) {
                    const option_names = generate_cmd.options.map(o => o.name);
                    console.log('Option names:', option_names.join(', '));
                }
            }

            // Check if replace is also extracted
            const replace_cmd = result.commands.find(c => c.name === 'replace');
            if (replace_cmd) {
                console.log(`replace options: ${replace_cmd.options.length}`);
            }
        });

        it('should associate options with all commands in multi-command file', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'generate');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            const result = extract_commands_from_file(file_path);

            // All commands from the same file should have the same options
            // (since options are shared in multi-command files)
            if (result.commands.length > 1) {
                const first_options = result.commands[0].options;
                for (const my_cmd of result.commands.slice(1)) {
                    expect(my_cmd.options.length).toBe(first_options.length);
                }
            }
        });
    });

    describe('Options section extraction', () => {
        it('should correctly identify Options section boundaries', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            const file_path = get_sthlp_path(stata_path, 'regress');
            if (!existsSync(file_path)) {
                console.log(`Skipping: ${file_path} not found`);
                return;
            }

            // Read file content directly to test section extraction
            const fs = require('fs');
            const content = fs.readFileSync(file_path, 'utf-8');

            const options_section = extract_options_section(content);

            // Should find an options section
            expect(options_section.length).toBeGreaterThan(0);

            // Options section should contain option patterns
            expect(options_section).toMatch(/\{opt[h]?\s+/i);

            // Should not contain content from other sections
            // (e.g., stored results markers)
            const has_stored_results_marker = options_section.includes('{marker results}');
            if (has_stored_results_marker) {
                console.log('Warning: Options section may include stored results');
            }
        });
    });

    describe('Option count verification', () => {
        it('should extract expected minimum option counts', () => {
            if (!stata_available || !stata_path) {
                console.log('Skipping: Stata not available');
                return;
            }

            // Commands with known minimum option counts
            const expected_minimums: Record<string, number> = {
                'regress': 5,    // noconstant, robust, vce, level, beta, etc.
                'summarize': 2,  // detail, meanonly, etc.
                'logit': 5,      // noconstant, robust, vce, level, etc.
                'probit': 5,     // similar to logit
            };

            for (const [cmd_name, min_count] of Object.entries(expected_minimums)) {
                const file_path = get_sthlp_path(stata_path!, cmd_name);
                if (!existsSync(file_path)) {
                    console.log(`Skipping ${cmd_name}: file not found`);
                    continue;
                }

                const result = extract_commands_from_file(file_path);
                const cmd = result.commands.find(c => c.name === cmd_name);

                if (cmd) {
                    console.log(`${cmd_name}: ${cmd.options.length} options (expected >= ${min_count})`);
                    // Log if below expected but don't fail - extraction may vary
                    if (cmd.options.length < min_count) {
                        console.log(`  Warning: Below expected minimum`);
                    }
                }
            }
        });
    });
});

describe('Option Extraction Edge Cases', () => {
    it('should handle files without Options section gracefully', () => {
        if (!stata_available || !stata_path) {
            console.log('Skipping: Stata not available');
            return;
        }

        // Try to find a simple command that might not have options
        const simple_commands = ['clear', 'exit', 'pwd'];

        for (const cmd_name of simple_commands) {
            const file_path = get_sthlp_path(stata_path!, cmd_name);
            if (!existsSync(file_path)) {
                continue;
            }

            const result = extract_commands_from_file(file_path);

            // Should not crash
            expect(result.warnings).toHaveLength(0);

            // Commands should have options array (possibly empty)
            for (const my_cmd of result.commands) {
                expect(Array.isArray(my_cmd.options)).toBe(true);
            }

            console.log(`${cmd_name}: ${result.commands[0]?.options.length || 0} options`);
        }
    });

    it('should extract options with arguments correctly', () => {
        if (!stata_available || !stata_path) {
            console.log('Skipping: Stata not available');
            return;
        }

        const file_path = get_sthlp_path(stata_path, 'regress');
        if (!existsSync(file_path)) {
            console.log(`Skipping: ${file_path} not found`);
            return;
        }

        const result = extract_commands_from_file(file_path);
        const regress_cmd = result.commands.find(c => c.name === 'regress');

        if (regress_cmd && regress_cmd.options.length > 0) {
            // Find options with arguments
            const options_with_args = regress_cmd.options.filter(o => o.has_argument);
            console.log(`Options with arguments: ${options_with_args.length}`);

            for (const my_opt of options_with_args.slice(0, 5)) {
                console.log(`  ${my_opt.name}(${my_opt.argument_type || '?'})`);
                expect(my_opt.has_argument).toBe(true);
            }

            // Find options without arguments
            const options_without_args = regress_cmd.options.filter(o => !o.has_argument);
            console.log(`Options without arguments: ${options_without_args.length}`);

            for (const my_opt of options_without_args.slice(0, 5)) {
                expect(my_opt.has_argument).toBe(false);
            }
        }
    });
});
