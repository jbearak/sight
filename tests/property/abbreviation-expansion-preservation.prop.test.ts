import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CommandDatabase } from '../../src/command-database';
import { get_command_priority } from '../../src/command-database/priority-tiers';
import type {
    CommandCache,
    CommandInfo,
    OptionInfo,
    StataVersion,
} from '../../src/command-database/types';

/**
 * Property Test: Abbreviation Expansion Preservation
 * Feature: command-database-cleanup, Property 2: Abbreviation Expansion Preservation
 * Validates: Requirements 3.4, 6.2
 */
describe('Abbreviation Expansion Preservation Property Tests', () => {
    let my_database: CommandDatabase;

    beforeEach(() => {
        my_database = new CommandDatabase();
    });

    function compute_expected_lookup(
        cache: CommandCache,
        query: string
    ): string | null {
        const normalized = query.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(cache.commands, normalized)) {
            return cache.commands[normalized].name;
        }

        const exact_command_names = new Set(Object.keys(cache.commands));
        const resolved_abbreviations: Record<string, string> = Object.create(null);

        for (const [abbrev, full_name] of Object.entries(cache.abbreviations)) {
            if (exact_command_names.has(abbrev)) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(cache.commands, full_name)) {
                resolved_abbreviations[abbrev] = full_name;
            }
        }

        const the_sorted_commands = Object.values(cache.commands).sort(
            (cmd_a, cmd_b) => {
                const priority_a =
                    cmd_a.priority || get_command_priority(cmd_a.name);
                const priority_b =
                    cmd_b.priority || get_command_priority(cmd_b.name);
                if (priority_a !== priority_b) {
                    return priority_a - priority_b;
                }
                if (cmd_a.min_abbreviation !== cmd_b.min_abbreviation) {
                    return cmd_a.min_abbreviation - cmd_b.min_abbreviation;
                }
                if (cmd_a.name.length !== cmd_b.name.length) {
                    return cmd_a.name.length - cmd_b.name.length;
                }
                return cmd_a.name.localeCompare(cmd_b.name);
            }
        );

        for (const my_command of the_sorted_commands) {
            const normalized_name = my_command.name.toLowerCase();
            const my_priority =
                my_command.priority || get_command_priority(normalized_name);
            const min_len = Math.max(1, my_command.min_abbreviation);
            for (let i = min_len; i < normalized_name.length; i++) {
                const abbrev = normalized_name.substring(0, i);
                if (exact_command_names.has(abbrev)) {
                    continue;
                }
                if (!Object.prototype.hasOwnProperty.call(resolved_abbreviations, abbrev)) {
                    resolved_abbreviations[abbrev] = normalized_name;
                    continue;
                }

                const existing_name = resolved_abbreviations[abbrev];
                if (
                    !Object.prototype.hasOwnProperty.call(
                        cache.commands,
                        existing_name
                    )
                ) {
                    resolved_abbreviations[abbrev] = normalized_name;
                    continue;
                }

                const existing_priority =
                    cache.commands[existing_name].priority
                    || get_command_priority(existing_name);
                if (my_priority < existing_priority) {
                    resolved_abbreviations[abbrev] = normalized_name;
                }
            }
        }

        return resolved_abbreviations[normalized] ?? null;
    }

    const command_name_generator: fc.Arbitrary<string> = fc.string({
        minLength: 3,
        maxLength: 12,
    }).filter(s => /^[a-z]+$/.test(s));

    const option_info_generator: fc.Arbitrary<OptionInfo> = fc.record({
        name: fc.string({ minLength: 2, maxLength: 10 }).filter(
            s => /^[a-z]+$/.test(s)
        ),
        min_abbreviation: fc.integer({ min: 1, max: 10 }),
        description: fc.string({ minLength: 5, maxLength: 50 }),
        has_argument: fc.boolean(),
    }).map(info => ({
        ...info,
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length),
    }));

    const command_info_generator: fc.Arbitrary<CommandInfo> = fc.record({
        name: command_name_generator,
        syntax: fc.string({ minLength: 5, maxLength: 100 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
        min_abbreviation: fc.integer({ min: 1, max: 12 }),
        options: fc.array(option_info_generator, { minLength: 0, maxLength: 5 }),
        priority: fc.option(fc.integer({ min: 1, max: 3 })),
    }).map(info => ({
        ...info,
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length),
    }));

    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.array(
        command_info_generator,
        { minLength: 3, maxLength: 6 }
    ).map(the_commands => {
        const commands: Record<string, CommandInfo> = Object.create(null);
        const abbreviations: Record<string, string> = Object.create(null);

        for (let i = 0; i < the_commands.length; i++) {
            const my_command = the_commands[i];
            const normalized_name = `${my_command.name}${i}`.toLowerCase();
            commands[normalized_name] = {
                ...my_command,
                name: normalized_name,
                min_abbreviation: Math.min(
                    my_command.min_abbreviation,
                    normalized_name.length
                ),
            };

            for (
                let j = commands[normalized_name].min_abbreviation;
                j < normalized_name.length;
                j++
            ) {
                const abbrev = normalized_name.substring(0, j);
                if (!Object.prototype.hasOwnProperty.call(abbreviations, abbrev)) {
                    abbreviations[abbrev] = normalized_name;
                }
            }
        }

        return {
            version: 18 as StataVersion,
            commands,
            abbreviations,
        };
    });

    it('should resolve abbreviations according to the precedence oracle', () => {
        fc.assert(
            fc.property(command_cache_generator, cache => {
                my_database.load_cache(cache);

                for (const abbrev of Object.keys(cache.abbreviations)) {
                    const result = my_database.lookup_command(abbrev);
                    const expected_name = compute_expected_lookup(cache, abbrev);

                    expect(expected_name).not.toBeNull();
                    expect(result).not.toBeNull();
                    expect(result?.name.toLowerCase()).toBe(
                        expected_name!.toLowerCase()
                    );
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should resolve exact command names to themselves even with overlapping abbreviations', () => {
        fc.assert(
            fc.property(command_cache_generator, cache => {
                my_database.load_cache(cache);

                for (const cmd_name of Object.keys(cache.commands)) {
                    const result = my_database.lookup_command(cmd_name);
                    expect(result).not.toBeNull();
                    expect(result?.name.toLowerCase()).toBe(cmd_name);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should consistently expand the same abbreviation to the same command', () => {
        fc.assert(
            fc.property(command_cache_generator, cache => {
                my_database.load_cache(cache);

                for (const abbrev of Object.keys(cache.abbreviations)) {
                    const result_1 = my_database.lookup_command(abbrev);
                    const result_2 = my_database.lookup_command(abbrev);
                    const result_3 = my_database.lookup_command(abbrev);

                    if (result_1 !== null && result_2 !== null && result_3 !== null) {
                        expect(result_1.name).toBe(result_2.name);
                        expect(result_2.name).toBe(result_3.name);
                        expect(result_1.syntax).toBe(result_2.syntax);
                        expect(result_2.syntax).toBe(result_3.syntax);
                    }
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should return null for invalid abbreviations', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.array(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(
                        s => /^[a-z]+$/.test(s)
                    ),
                    { minLength: 5, maxLength: 10 }
                ),
                (cache, the_random_strings) => {
                    my_database.load_cache(cache);

                    for (const my_str of the_random_strings) {
                        const expected_name = compute_expected_lookup(cache, my_str);
                        const result = my_database.lookup_command(my_str);
                        if (expected_name === null) {
                            expect(result).toBeNull();
                        } else {
                            expect(result).not.toBeNull();
                            expect(result?.name).toBe(expected_name);
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
