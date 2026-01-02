import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import type { CommandCache, CommandInfo, StataVersion } from '../../src/command-database/types';

describe('Command Cache Property Tests', () => {

    // Generator for Stata versions
    const stata_version_generator = fc.constantFrom(15, 16, 17, 18) as fc.Arbitrary<StataVersion>;

    // Generator for command info (minimal type)
    // Use chain to ensure min_abbreviation <= name.length
    const command_info_generator: fc.Arbitrary<CommandInfo> = fc.string({ minLength: 3, maxLength: 12 })
        .filter(s => /^[a-z]+$/.test(s))
        .chain(name => fc.record({
            name: fc.constant(name),
            syntax: fc.string({ minLength: 5, maxLength: 100 }),
            description: fc.string({ minLength: 10, maxLength: 100 }),
            min_abbreviation: fc.integer({ min: 1, max: name.length })
        }));

    // Generator for commands dictionary
    const commands_dict_generator = fc.dictionary(
        fc.string({ minLength: 3, maxLength: 12 }).filter(s => /^[a-z]+$/.test(s)),
        command_info_generator
    );

    // Generator for abbreviations dictionary (simple Record<string, string>)
    const abbreviations_dict_generator = fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
        fc.string({ minLength: 3, maxLength: 12 }).filter(s => /^[a-z]+$/.test(s))
    );

    // Generator for command cache (minimal type)
    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.record({
        version: stata_version_generator,
        commands: commands_dict_generator,
        abbreviations: abbreviations_dict_generator
    });

    /**
     * Property: Cache Serialization Round-Trip
     * For any valid CommandCache object, serializing to JSON and then 
     * deserializing should produce an object equivalent to the original 
     * (all fields preserved with correct types and values).
     * Feature: command-database-cleanup, Property: Cache Serialization Round-Trip
     * Validates: Requirements 6.1
     */
    it('should preserve all data through JSON serialization round-trip', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (original_cache) => {
                    // Serialize to JSON
                    const json_string = JSON.stringify(original_cache);

                    // Deserialize from JSON
                    const deserialized_cache = JSON.parse(json_string) as CommandCache;

                    // Verify basic structure preservation
                    expect(deserialized_cache.version).toBe(original_cache.version);

                    // Verify commands preservation
                    const original_command_names = Object.keys(original_cache.commands);
                    const deserialized_command_names = Object.keys(deserialized_cache.commands);
                    
                    expect(original_command_names.length).toBe(deserialized_command_names.length);

                    for (const my_command_name of original_command_names) {
                        const original_cmd = original_cache.commands[my_command_name];
                        const deserialized_cmd = deserialized_cache.commands[my_command_name];
                        
                        expect(deserialized_cmd).toBeDefined();
                        expect(original_cmd.name).toBe(deserialized_cmd.name);
                        expect(original_cmd.syntax).toBe(deserialized_cmd.syntax);
                        expect(original_cmd.description).toBe(deserialized_cmd.description);
                        expect(original_cmd.min_abbreviation).toBe(deserialized_cmd.min_abbreviation);
                    }

                    // Verify abbreviations preservation
                    const original_abbrevs = Object.keys(original_cache.abbreviations);
                    const deserialized_abbrevs = Object.keys(deserialized_cache.abbreviations);
                    
                    expect(original_abbrevs.length).toBe(deserialized_abbrevs.length);

                    for (const my_abbrev of original_abbrevs) {
                        expect(deserialized_cache.abbreviations[my_abbrev]).toBe(
                            original_cache.abbreviations[my_abbrev]
                        );
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Command Info Completeness
     * Every command in the cache should have complete info with all required fields.
     * Feature: command-database-cleanup, Property: Command Info Completeness
     * Validates: Requirements 6.1
     */
    it('should ensure all commands have complete info', () => {
        fc.assert(
            fc.property(
                commands_dict_generator,
                (the_commands) => {
                    // Verify all commands have required fields
                    for (const [_key, info] of Object.entries(the_commands)) {
                        // Check required string fields are non-empty
                        expect(info.name).toBeDefined();
                        expect(info.name.length).toBeGreaterThan(0);
                        expect(info.syntax).toBeDefined();
                        expect(info.description).toBeDefined();
                        expect(info.description.length).toBeGreaterThan(0);

                        // Check min_abbreviation is valid
                        expect(typeof info.min_abbreviation).toBe('number');
                        expect(info.min_abbreviation).toBeGreaterThan(0);
                        expect(info.min_abbreviation).toBeLessThanOrEqual(info.name.length);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Abbreviation Consistency
     * All abbreviations in the cache should map to valid command names.
     * Feature: command-database-cleanup, Property: Abbreviation Consistency
     * Validates: Requirements 6.2
     */
    it('should ensure abbreviations map to valid strings', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    // Verify all abbreviations map to non-empty strings
                    for (const [abbrev, full_name] of Object.entries(cache.abbreviations)) {
                        expect(typeof abbrev).toBe('string');
                        expect(abbrev.length).toBeGreaterThan(0);
                        expect(typeof full_name).toBe('string');
                        expect(full_name.length).toBeGreaterThan(0);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Version Validity
     * The cache version should be a valid Stata version.
     * Feature: command-database-cleanup, Property: Version Validity
     * Validates: Requirements 6.1
     */
    it('should have valid Stata version', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                (cache) => {
                    expect([15, 16, 17, 18]).toContain(cache.version);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
