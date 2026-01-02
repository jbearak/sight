import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CommandDatabase } from '../../src/command-database';
import type { CommandCache, CommandInfo, OptionInfo, StataVersion } from '../../src/command-database/types';

/**
 * Property Test: Abbreviation Expansion Preservation
 * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
 * Validates: Requirements 3.4, 6.2
 * 
 * This test verifies that for any abbreviation in the cache's abbreviation dictionary,
 * expanding that abbreviation returns the correct full command name.
 */
describe('Abbreviation Expansion Preservation Property Tests', () => {
    let my_database: CommandDatabase;

    beforeEach(() => {
        my_database = new CommandDatabase();
    });

    // Generator for valid command names (lowercase alphabetic)
    const command_name_generator: fc.Arbitrary<string> = fc.string({
        minLength: 3,
        maxLength: 12
    }).filter(s => /^[a-z]+$/.test(s));

    // Generator for option info
    const option_info_generator: fc.Arbitrary<OptionInfo> = fc.record({
        name: fc.string({ minLength: 2, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
        min_abbreviation: fc.integer({ min: 1, max: 10 }),
        description: fc.string({ minLength: 5, maxLength: 50 }),
        has_argument: fc.boolean()
    }).map(info => ({
        ...info,
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length)
    }));

    // Generator for command info (minimal type)
    const command_info_generator: fc.Arbitrary<CommandInfo> = fc.record({
        name: command_name_generator,
        syntax: fc.string({ minLength: 5, maxLength: 100 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
        min_abbreviation: fc.integer({ min: 1, max: 12 }),
        options: fc.array(option_info_generator, { minLength: 0, maxLength: 5 })
    }).map(info => ({
        ...info,
        // Ensure min_abbreviation doesn't exceed name length
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length)
    }));

    // Generator for command cache with proper abbreviation mappings
    // Uses distinct prefixes to avoid abbreviation conflicts
    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.tuple(
        fc.constantFrom('reg', 'sum', 'tab', 'gen', 'des', 'lis', 'mer', 'app', 'sor', 'dro'),
        fc.constantFrom('ress', 'marize', 'ulate', 'erate', 'cribe', 't', 'ge', 'end', 't', 'p')
    ).chain(([prefix1, suffix1]) => {
        // Generate commands with distinct prefixes to avoid conflicts
        const the_prefixes = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
        return fc.array(
            fc.tuple(
                fc.constantFrom(...the_prefixes),
                fc.string({ minLength: 2, maxLength: 6 }).filter(s => /^[a-z]+$/.test(s)),
                fc.string({ minLength: 5, maxLength: 50 }),
                fc.string({ minLength: 10, maxLength: 50 }),
                fc.integer({ min: 2, max: 5 })
            ),
            { minLength: 3, maxLength: 5 }
        ).map(the_tuples => {
            const commands: Record<string, CommandInfo> = {};
            const abbreviations: Record<string, string> = {};
            const used_names = new Set<string>();

            for (let idx = 0; idx < the_tuples.length; idx++) {
                const [prefix, suffix, syntax, description, min_abbrev_base] = the_tuples[idx];
                // Create unique name by appending index
                const name = `${prefix}${suffix}${idx}`.toLowerCase();
                
                if (used_names.has(name)) continue;
                used_names.add(name);

                const min_abbreviation = Math.min(min_abbrev_base, name.length);
                
                commands[name] = {
                    name,
                    syntax,
                    description,
                    min_abbreviation,
                    options: []
                };

                // Generate abbreviations - only add if not conflicting
                for (let i = min_abbreviation; i < name.length; i++) {
                    const abbrev = name.substring(0, i);
                    // Only add if not already used as a command or abbreviation
                    if (!commands[abbrev] && !abbreviations[abbrev]) {
                        abbreviations[abbrev] = name;
                    }
                }
            }

            return {
                version: 18 as StataVersion,
                commands,
                abbreviations
            };
        });
    });

    /**
     * Property 2: Abbreviation Expansion Preservation
     * 
     * For any abbreviation in the cache's abbreviation dictionary,
     * expanding that abbreviation SHALL return the correct full command name.
     * 
     * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
     * Validates: Requirements 3.4, 6.2
     */
    it('should expand every abbreviation to its correct full command name', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    // Load the cache
                    my_database.load_cache(cache);

                    // For every abbreviation in the cache
                    for (const [abbrev, expected_full_name] of Object.entries(cache.abbreviations)) {
                        // Expand the abbreviation via lookup
                        const result = my_database.lookup_command(abbrev);

                        // The result should not be null
                        expect(result).not.toBeNull();

                        if (result !== null) {
                            // The expanded command name should match the expected full name
                            expect(result.name.toLowerCase()).toBe(expected_full_name.toLowerCase());

                            // The result should have all required fields
                            expect(result.name).toBeDefined();
                            expect(result.syntax).toBeDefined();
                            expect(result.description).toBeDefined();
                            expect(result.min_abbreviation).toBeDefined();
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Abbreviation Length Validity
     * 
     * For any command, all abbreviations from min_abbreviation length up to
     * full name length should resolve to that command (when no conflicts exist).
     * 
     * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
     * Validates: Requirements 3.4, 6.2
     */
    it('should resolve all valid abbreviation lengths to the correct command', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    my_database.load_cache(cache);

                    // For each abbreviation in the cache, verify it resolves correctly
                    for (const [abbrev, expected_cmd] of Object.entries(cache.abbreviations)) {
                        const result = my_database.lookup_command(abbrev);

                        // Should resolve to some command
                        expect(result).not.toBeNull();

                        if (result !== null) {
                            // Should resolve to the expected command
                            expect(result.name.toLowerCase()).toBe(expected_cmd.toLowerCase());
                        }
                    }

                    // Also verify full command names resolve to themselves
                    for (const [cmd_name, cmd_info] of Object.entries(cache.commands)) {
                        const result = my_database.lookup_command(cmd_name);
                        expect(result).not.toBeNull();
                        if (result !== null) {
                            expect(result.name.toLowerCase()).toBe(cmd_name.toLowerCase());
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Abbreviation Expansion Consistency
     * 
     * For any abbreviation, expanding it multiple times should always
     * return the same result (deterministic behavior).
     * 
     * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
     * Validates: Requirements 3.4, 6.2
     */
    it('should consistently expand the same abbreviation to the same command', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    my_database.load_cache(cache);

                    // For every abbreviation in the cache
                    for (const abbrev of Object.keys(cache.abbreviations)) {
                        // Expand multiple times
                        const result_1 = my_database.lookup_command(abbrev);
                        const result_2 = my_database.lookup_command(abbrev);
                        const result_3 = my_database.lookup_command(abbrev);

                        // All results should be identical
                        if (result_1 !== null && result_2 !== null && result_3 !== null) {
                            expect(result_1.name).toBe(result_2.name);
                            expect(result_2.name).toBe(result_3.name);
                            expect(result_1.syntax).toBe(result_2.syntax);
                            expect(result_2.syntax).toBe(result_3.syntax);
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Invalid Abbreviation Rejection
     * 
     * For any string that is not in the abbreviations dictionary and not
     * a command name, lookup should return null.
     * 
     * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
     * Validates: Requirements 3.4, 6.2
     */
    it('should return null for invalid abbreviations', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.array(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
                    { minLength: 5, maxLength: 10 }
                ),
                (cache, the_random_strings) => {
                    my_database.load_cache(cache);

                    // Test random strings that are not valid commands or abbreviations
                    for (const my_str of the_random_strings) {
                        const is_command = cache.commands[my_str] !== undefined;
                        const is_abbreviation = cache.abbreviations[my_str] !== undefined;

                        const result = my_database.lookup_command(my_str);

                        if (!is_command && !is_abbreviation) {
                            // Should return null for invalid lookups
                            expect(result).toBeNull();
                        } else {
                            // Should return a valid result for valid lookups
                            expect(result).not.toBeNull();
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
