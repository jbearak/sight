/**
 * Integration Tests for Command Database Superset Validation
 *
 * Validates that the new command database is a superset of the legacy database.
 * This ensures no commands are lost during the migration from hardcoded commands
 * to the JSON cache-based system.
 *
 * **Validates: Requirements 1.2, 2.1, 2.2, 2.3**
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { CommandDatabase } from '../../src/command-database';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Command Database Superset Validation', () => {
    let new_database: CommandDatabase;
    let legacy_command_names: string[];
    let new_command_names: Set<string>;

    beforeAll(() => {
        // Load legacy commands
        legacy_command_names = BUILTIN_COMMANDS.map(cmd => cmd.name.toLowerCase());

        // Load new command database from cache
        new_database = new CommandDatabase();
        const cache_path = join(__dirname, '../../src/command-database/caches/v18.json');
        const cache_content = readFileSync(cache_path, 'utf-8');
        const cache = JSON.parse(cache_content);
        new_database.load_cache(cache);

        // Get all command names from new database
        new_command_names = new Set(
            new_database.get_all_commands().map(cmd => cmd.name.toLowerCase())
        );
    });

    it('should have more commands in new database than legacy database', () => {
        const legacy_count = legacy_command_names.length;
        const new_count = new_command_names.size;

        expect(new_count).toBeGreaterThan(legacy_count);

        if (process.env.SIGHT_TEST_LOG) {
            console.log(`Legacy database: ${legacy_count} commands`);
            console.log(`New database: ${new_count} commands`);
        }
    });

    it('should contain every legacy command in the new database', () => {
        const the_missing_commands: string[] = [];

        for (const my_legacy_name of legacy_command_names) {
            if (!new_command_names.has(my_legacy_name)) {
                the_missing_commands.push(my_legacy_name);
            }
        }

        if (the_missing_commands.length > 0) {
            console.error('Missing commands in new database:');
            for (const my_cmd of the_missing_commands) {
                console.error(`  - ${my_cmd}`);
            }
        }

        expect(the_missing_commands).toEqual([]);
    });

    it('should be able to look up each legacy command by name', () => {
        const the_lookup_failures: string[] = [];

        for (const my_legacy_name of legacy_command_names) {
            const result = new_database.lookup(my_legacy_name);
            if (!result) {
                the_lookup_failures.push(my_legacy_name);
            }
        }

        if (the_lookup_failures.length > 0) {
            console.error('Commands that failed lookup:');
            for (const my_cmd of the_lookup_failures) {
                console.error(`  - ${my_cmd}`);
            }
        }

        expect(the_lookup_failures).toEqual([]);
    });

    it('should have thousands of commands (not just 50)', () => {
        // The cache should have thousands of commands, not the test limit of 50
        expect(new_command_names.size).toBeGreaterThan(1000);
    });
});
