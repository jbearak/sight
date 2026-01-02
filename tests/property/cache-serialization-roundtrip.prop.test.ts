/**
 * Property Tests: Cache Serialization Round-Trip
 * 
 * Feature: command-database-cleanup
 * Property: For any valid CommandCache object, serializing to JSON and then 
 * deserializing SHALL produce an object equivalent to the original (all fields 
 * preserved with correct types and values).
 */

import * as fc from 'fast-check';
import { CommandCache, CommandInfo, StataVersion } from '../../src/command-database/types';

describe('Property Tests: Cache Serialization Round-Trip', () => {
    
    // Generator for Stata versions
    const stata_version_generator = fc.constantFrom(15, 16, 17, 18) as fc.Arbitrary<StataVersion>;
    
    // Generator for command info (minimal type)
    const command_info_generator: fc.Arbitrary<CommandInfo> = fc.record({
        name: fc.string({ minLength: 1, maxLength: 20 }),
        syntax: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        description: fc.string({ minLength: 1, maxLength: 200 }),
        min_abbreviation: fc.integer({ min: 1, max: 20 })
    });
    
    // Generator for commands dictionary
    const commands_dict_generator = fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }),
        command_info_generator
    );
    
    // Generator for abbreviations dictionary (simple Record<string, string>)
    const abbreviations_dict_generator = fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 20 })
    );
    
    // Generator for command cache (minimal type)
    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.record({
        version: stata_version_generator,
        commands: commands_dict_generator,
        abbreviations: abbreviations_dict_generator
    });
    
    test('Property: Cache serialization round-trip preserves all data', () => {
        fc.assert(
            fc.property(command_cache_generator, (original_cache) => {
                // Serialize to JSON
                const json_string = JSON.stringify(original_cache);
                
                // Deserialize from JSON
                const deserialized_cache = JSON.parse(json_string) as CommandCache;
                
                // Check top-level fields
                expect(deserialized_cache.version).toBe(original_cache.version);
                
                // Check commands object
                expect(Object.keys(deserialized_cache.commands)).toEqual(
                    Object.keys(original_cache.commands)
                );
                
                for (const [command_name, original_command] of Object.entries(original_cache.commands)) {
                    const deserialized_command = deserialized_cache.commands[command_name];
                    expect(deserialized_command).toBeDefined();
                    
                    // Check all command info fields
                    expect(deserialized_command.name).toBe(original_command.name);
                    // syntax is optional - check if both have it or both don't
                    if (original_command.syntax !== undefined) {
                        expect(deserialized_command.syntax).toBe(original_command.syntax);
                    } else {
                        expect(deserialized_command.syntax).toBeUndefined();
                    }
                    expect(deserialized_command.description).toBe(original_command.description);
                    expect(deserialized_command.min_abbreviation).toBe(original_command.min_abbreviation);
                }
                
                // Check abbreviations
                expect(Object.keys(deserialized_cache.abbreviations)).toEqual(
                    Object.keys(original_cache.abbreviations)
                );
                
                for (const [abbrev, full_name] of Object.entries(original_cache.abbreviations)) {
                    expect(deserialized_cache.abbreviations[abbrev]).toBe(full_name);
                }
            }),
            { 
                numRuns: 100,
                verbose: false
            }
        );
    });
    
    test('Property: JSON serialization preserves field types', () => {
        fc.assert(
            fc.property(command_cache_generator, (original_cache) => {
                const json_string = JSON.stringify(original_cache);
                const deserialized = JSON.parse(json_string);
                
                // Check types of top-level fields
                expect(typeof deserialized.version).toBe('number');
                expect(typeof deserialized.commands).toBe('object');
                expect(typeof deserialized.abbreviations).toBe('object');
                
                // Check that version is a valid Stata version
                expect([15, 16, 17, 18]).toContain(deserialized.version);
                
                // Check command info types
                for (const [command_name, command_data] of Object.entries(deserialized.commands)) {
                    expect(typeof command_name).toBe('string');
                    expect(typeof command_data).toBe('object');
                    
                    const cmd = command_data as CommandInfo;
                    expect(typeof cmd.name).toBe('string');
                    // syntax is optional - check type only if present
                    if (cmd.syntax !== undefined) {
                        expect(typeof cmd.syntax).toBe('string');
                    }
                    expect(typeof cmd.description).toBe('string');
                    expect(typeof cmd.min_abbreviation).toBe('number');
                }
                
                // Check abbreviations types
                for (const [abbrev, full_name] of Object.entries(deserialized.abbreviations)) {
                    expect(typeof abbrev).toBe('string');
                    expect(typeof full_name).toBe('string');
                }
            }),
            { 
                numRuns: 100,
                verbose: false
            }
        );
    });
    
    test('Property: Large cache serialization performance', () => {
        // Generate a large cache to test performance
        const large_commands_generator = fc.array(
            fc.tuple(
                fc.string({ minLength: 3, maxLength: 15 }),
                command_info_generator
            ),
            { minLength: 50, maxLength: 60 }
        ).map(entries => Object.fromEntries(entries));

        const large_cache_generator: fc.Arbitrary<CommandCache> = fc.record({
            version: stata_version_generator,
            commands: large_commands_generator,
            abbreviations: abbreviations_dict_generator
        });
        
        fc.assert(
            fc.property(large_cache_generator, (large_cache) => {
                const start_time = Date.now();
                
                // Serialize
                const json_string = JSON.stringify(large_cache);
                const serialize_time = Date.now() - start_time;
                
                // Deserialize
                const deserialize_start = Date.now();
                const deserialized = JSON.parse(json_string);
                const deserialize_time = Date.now() - deserialize_start;
                
                // Performance assertions (reasonable thresholds)
                expect(serialize_time).toBeLessThan(1000); // < 1 second
                expect(deserialize_time).toBeLessThan(1000); // < 1 second
                
                // Correctness assertion - check structure
                expect(typeof deserialized.version).toBe('number');
                expect(typeof deserialized.commands).toBe('object');
                expect(typeof deserialized.abbreviations).toBe('object');
                
                // Size assertion (JSON should be reasonable size)
                expect(json_string.length).toBeGreaterThan(100); // Non-trivial size
                expect(json_string.length).toBeLessThan(10_000_000); // < 10MB
            }),
            { 
                numRuns: 10, // Fewer runs for performance test
                verbose: false
            }
        );
    });
});
