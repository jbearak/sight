/**
 * Property-Based Tests for Command Database Superset Validation
 *
 * Property 1: Legacy Database Superset
 * For any command that exists in the legacy database, that command SHALL also
 * exist in the new command database.
 *
 * **Feature: command-database-integration, Property 1: Legacy Database Superset**
 * **Validates: Requirements 1.2, 2.1**
 */

import { describe, it, beforeAll } from 'bun:test';
import * as fc from 'fast-check';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { CommandDatabase } from '../../src/command-database';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Command Database Superset Property Tests', () => {
    let new_database: CommandDatabase;
    let legacy_command_names: string[];

    beforeAll(() => {
        // Load legacy commands
        legacy_command_names = BUILTIN_COMMANDS.map(cmd => cmd.name.toLowerCase());

        // Load new command database from cache
        new_database = new CommandDatabase();
        const cache_path = join(__dirname, '../../src/command-database/caches/v18.json');
        const cache_content = readFileSync(cache_path, 'utf-8');
        const cache = JSON.parse(cache_content);
        new_database.load_cache(cache);
    });

    /**
     * Property 1: Legacy Database Superset
     * For any command that exists in the legacy database, that command SHALL also
     * exist in the new command database.
     *
     * Feature: command-database-integration, Property 1: Legacy Database Superset
     * Validates: Requirements 1.2, 2.1
     */
    it('should contain every legacy command in the new database (property test)', () => {
        // Some legacy commands are graph subcommands (e.g., "bar") that
        // Stata's `which` doesn't recognize as standalone commands.
        const KNOWN_LEGACY_EXCLUSIONS = new Set(['bar']);
        const the_valid_legacy = legacy_command_names.filter(
            name => !KNOWN_LEGACY_EXCLUSIONS.has(name)
        );
        const legacy_command_arb = fc.constantFrom(...the_valid_legacy);

        fc.assert(
            fc.property(
                legacy_command_arb,
                (legacy_command_name) => {
                    // Property: For any legacy command, it should exist in the new database
                    const lookup_result = new_database.lookup(legacy_command_name);
                    const has_command = new_database.has(legacy_command_name);

                    // The command should be found via lookup OR has check
                    // (lookup returns provider format, has checks existence)
                    return lookup_result !== undefined || has_command;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Legacy command lookup returns valid metadata
     * For any command from the legacy database that exists in the new database,
     * the lookup should return valid command metadata with name.
     * Note: syntax field is now optional after SMCL syntax cleanup.
     *
     * Feature: command-database-integration, Property: Legacy command metadata completeness
     * Validates: Requirements 1.2, 2.1
     */
    it('should return valid metadata for legacy commands that exist', () => {
        // Filter to only commands that exist in the new database
        const the_existing_legacy_commands = legacy_command_names.filter(
            name => new_database.has(name)
        );

        if (the_existing_legacy_commands.length === 0) {
            // Skip if no legacy commands exist in new database
            return;
        }

        const existing_command_arb = fc.constantFrom(...the_existing_legacy_commands);

        fc.assert(
            fc.property(
                existing_command_arb,
                (command_name) => {
                    const result = new_database.lookup(command_name);

                    if (!result) {
                        return false; // Should have found the command
                    }

                    // Verify metadata completeness (syntax is now optional after SMCL cleanup)
                    const has_name = typeof result.name === 'string' && result.name.length > 0;
                    // syntax is optional - may be undefined or empty string
                    const has_valid_syntax = result.syntax === undefined || typeof result.syntax === 'string';

                    return has_name && has_valid_syntax;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: New database size exceeds legacy database
     * The new command database should have significantly more commands than
     * the legacy database (thousands vs ~100).
     *
     * Feature: command-database-integration, Property: Database size comparison
     * Validates: Requirements 1.3
     */
    it('should have more commands in new database than legacy database', () => {
        fc.assert(
            fc.property(
                fc.constant(null), // No input needed, just verify the invariant
                () => {
                    const legacy_count = legacy_command_names.length;
                    const new_count = new_database.size;

                    // New database should have significantly more commands
                    // than legacy (864 validated vs ~148 hardcoded)
                    return new_count > legacy_count * 5;
                }
            ),
            { numRuns: 1 }
        );
    });
});
