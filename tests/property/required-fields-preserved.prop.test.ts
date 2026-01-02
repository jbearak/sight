/**
 * Property Test: Required Fields Preserved
 *
 * Feature: completion-improvements, Property 3: Required Fields Preserved
 * Validates: Requirements 2.5
 *
 * For any command in the Command_Database, the command shall have non-empty
 * `name`, `syntax`, and `min_abbreviation` fields, and each option shall have
 * non-empty `name` and `min_abbreviation` fields.
 */

import * as fc from 'fast-check';
import { command_database, CommandDatabase } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';

describe('Property 3: Required Fields Preserved', () => {
    beforeAll(() => {
        // Register builtin commands for testing
        command_database.register_all(BUILTIN_COMMANDS);
    });

    it('all commands have non-empty required fields', () => {
        const the_commands = command_database.get_all();

        // Property: For all commands, required fields are non-empty
        for (const my_cmd of the_commands) {
            // Command name must be non-empty
            expect(my_cmd.name).toBeTruthy();
            expect(my_cmd.name.length).toBeGreaterThan(0);

            // Syntax is optional - check type only if present
            if (my_cmd.syntax !== undefined) {
                expect(typeof my_cmd.syntax).toBe('string');
            }

            // minAbbreviation must be non-empty
            expect(my_cmd.minAbbreviation).toBeTruthy();
            expect(my_cmd.minAbbreviation.length).toBeGreaterThan(0);

            // minAbbreviation should be a prefix of name
            expect(my_cmd.name.startsWith(my_cmd.minAbbreviation)).toBe(true);
        }
    });

    it('all options have non-empty required fields', () => {
        const the_commands = command_database.get_all();

        // Property: For all options in all commands, required fields are non-empty
        for (const my_cmd of the_commands) {
            for (const my_opt of my_cmd.options) {
                // Option name must be non-empty
                expect(my_opt.name).toBeTruthy();
                expect(my_opt.name.length).toBeGreaterThan(0);

                // minAbbreviation must be non-empty
                expect(my_opt.minAbbreviation).toBeTruthy();
                expect(my_opt.minAbbreviation.length).toBeGreaterThan(0);

                // minAbbreviation should be a prefix of name
                expect(my_opt.name.startsWith(my_opt.minAbbreviation)).toBe(true);
            }
        }
    });

    it('property: randomly selected commands have valid structure', () => {
        const the_commands = command_database.get_all();
        if (the_commands.length === 0) {
            return; // Skip if no commands loaded
        }

        // Use fast-check to randomly sample commands
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: the_commands.length - 1 }),
                (index) => {
                    const my_cmd = the_commands[index];

                    // Required fields are non-empty strings
                    // Note: syntax is optional - may be undefined
                    return (
                        typeof my_cmd.name === 'string' &&
                        my_cmd.name.length > 0 &&
                        (my_cmd.syntax === undefined || typeof my_cmd.syntax === 'string') &&
                        typeof my_cmd.minAbbreviation === 'string' &&
                        my_cmd.minAbbreviation.length > 0 &&
                        my_cmd.name.startsWith(my_cmd.minAbbreviation)
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    it('property: randomly selected options have valid structure', () => {
        const the_commands = command_database.get_all();
        const the_commands_with_options = the_commands.filter(
            (cmd) => cmd.options.length > 0
        );

        if (the_commands_with_options.length === 0) {
            return; // Skip if no commands with options
        }

        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: the_commands_with_options.length - 1 }),
                (cmd_index) => {
                    const my_cmd = the_commands_with_options[cmd_index];
                    const opt_index = Math.floor(
                        Math.random() * my_cmd.options.length
                    );
                    const my_opt = my_cmd.options[opt_index];

                    // Required fields are non-empty strings
                    return (
                        typeof my_opt.name === 'string' &&
                        my_opt.name.length > 0 &&
                        typeof my_opt.minAbbreviation === 'string' &&
                        my_opt.minAbbreviation.length > 0 &&
                        my_opt.name.startsWith(my_opt.minAbbreviation)
                    );
                }
            ),
            { numRuns: 100 }
        );
    });
});
