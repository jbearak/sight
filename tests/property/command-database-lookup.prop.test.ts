import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CommandDatabase } from '../../src/command-database';
import type { CommandCache, CommandInfo, OptionInfo, StataVersion } from '../../src/command-database/types';

describe('Command Database Property Tests', () => {
    let my_database: CommandDatabase;

    beforeEach(() => {
        my_database = new CommandDatabase();
    });

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
        name: fc.string({ minLength: 3, maxLength: 12 }).filter(s => /^[a-z]+$/.test(s)),
        syntax: fc.string({ minLength: 5, maxLength: 100 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
        min_abbreviation: fc.integer({ min: 1, max: 12 }),
        options: fc.array(option_info_generator, { minLength: 0, maxLength: 5 })
    }).map(info => ({
        ...info,
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length)
    }));

    // Generator for command cache
    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.array(
        command_info_generator,
        { minLength: 5, maxLength: 15 }
    ).map(the_commands => {
        // Ensure unique command names
        const unique_commands = new Map<string, CommandInfo>();
        for (const my_command of the_commands) {
            unique_commands.set(my_command.name.toLowerCase(), my_command);
        }
        
        const commands: Record<string, CommandInfo> = {};
        const abbreviations: Record<string, string> = {};
        
        for (const [name, info] of unique_commands) {
            commands[name] = info;
            // Add abbreviations based on min_abbreviation
            for (let i = info.min_abbreviation; i <= info.name.length; i++) {
                const abbrev = info.name.substring(0, i).toLowerCase();
                abbreviations[abbrev] = name;
            }
        }
        
        return {
            version: 18 as StataVersion,
            commands,
            abbreviations
        };
    });

    /**
     * Property: Command Lookup Completeness
     * For any valid command name (full or abbreviated) in the loaded cache, 
     * looking up the command should return complete info including syntax 
     * and description. For invalid command names, lookup should return null 
     * without error.
     * Feature: command-database-cleanup, Property 1: Command Lookup Preservation
     * Validates: Requirements 6.1
     */
    it('should provide complete info for valid commands and null for invalid ones', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.array(fc.string({ minLength: 2, maxLength: 10 }), { minLength: 3, maxLength: 8 }),
                (cache, the_invalid_names) => {
                    // Load the cache
                    my_database.load_cache(cache);

                    // Test valid command lookups
                    for (const [name, info] of Object.entries(cache.commands)) {
                        const result = my_database.lookup_command(name);
                        
                        // Should return complete info
                        expect(result).not.toBeNull();
                        if (result !== null) {
                            expect(result.name).toBe(info.name);
                            expect(result.syntax).toBe(info.syntax);
                            expect(result.description).toBe(info.description);
                            expect(result.min_abbreviation).toBe(info.min_abbreviation);
                        }
                    }

                    // Test invalid command lookups
                    for (const my_invalid_name of the_invalid_names) {
                        const normalized = my_invalid_name.toLowerCase();
                        if (!cache.commands[normalized] && !cache.abbreviations[normalized]) {
                            const result = my_database.lookup_command(my_invalid_name);
                            // Should return null for non-existent commands
                            expect(result).toBeNull();
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Abbreviation Expansion
     * For any valid abbreviation in the cache, expanding it should return 
     * the correct full command name (unless the abbreviation is itself a command name).
     * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
     * Validates: Requirements 3.4, 6.2
     */
    it('should correctly expand abbreviations to full command names', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    // Load the cache
                    my_database.load_cache(cache);

                    // Test abbreviation expansion
                    for (const [abbrev, full_name] of Object.entries(cache.abbreviations)) {
                        const result = my_database.lookup_command(abbrev);
                        
                        // Should resolve to some command
                        expect(result).not.toBeNull();
                        if (result !== null) {
                            // If the abbreviation is itself a command name, it should resolve to that command
                            // Otherwise, it should resolve to the abbreviated command
                            const abbrev_is_command = Object.prototype.hasOwnProperty.call(
                                cache.commands,
                                abbrev
                            );

                            if (abbrev_is_command) {
                                expect(result.name.toLowerCase()).toBe(abbrev.toLowerCase());
                            } else {
                                expect(result.name.toLowerCase()).toBe(full_name.toLowerCase());
                            }
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Search Prefix Matching
     * For any prefix, search should return all commands that start with 
     * that prefix.
     * Feature: command-database-cleanup, Property: Search Prefix Matching
     * Validates: Requirements 6.1
     */
    it('should return all commands matching a prefix', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.string({ minLength: 1, maxLength: 3 }).filter(s => /^[a-z]+$/.test(s)),
                (cache, prefix) => {
                    // Load the cache
                    my_database.load_cache(cache);

                    // Get search results
                    const results = my_database.search(prefix);
                    
                    // Count expected matches
                    const expected_matches = Object.values(cache.commands).filter(
                        cmd => cmd.name.toLowerCase().startsWith(prefix.toLowerCase())
                    );

                    // Should return all matching commands
                    expect(results.length).toBe(expected_matches.length);

                    // All results should start with the prefix
                    for (const my_result of results) {
                        expect(my_result.name.toLowerCase().startsWith(prefix.toLowerCase())).toBe(true);
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Cache Loading Idempotence
     * Loading the same cache multiple times should produce the same results.
     * Feature: command-database-cleanup, Property: Cache Loading Idempotence
     * Validates: Requirements 6.1
     */
    it('should produce consistent results after multiple cache loads', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    // Load cache first time
                    my_database.load_cache(cache);
                    const first_all = my_database.get_all_commands();
                    
                    // Load cache second time
                    my_database.load_cache(cache);
                    const second_all = my_database.get_all_commands();

                    // Results should be identical
                    expect(first_all.length).toBe(second_all.length);
                    
                    for (let i = 0; i < first_all.length; i++) {
                        expect(first_all[i].name).toBe(second_all[i].name);
                        expect(first_all[i].syntax).toBe(second_all[i].syntax);
                        expect(first_all[i].description).toBe(second_all[i].description);
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });
});
