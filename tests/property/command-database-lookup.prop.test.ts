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

describe('Command Database Property Tests', () => {
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
                    cmd_a.priority ?? get_command_priority(cmd_a.name);
                const priority_b =
                    cmd_b.priority ?? get_command_priority(cmd_b.name);
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
                my_command.priority ?? get_command_priority(normalized_name);
            const min_len = Math.max(1, my_command.min_abbreviation);
            for (let i = min_len; i < normalized_name.length; i++) {
                const abbrev = normalized_name.substring(0, i);
                if (exact_command_names.has(abbrev)) {
                    continue;
                }
                if (
                    !Object.prototype.hasOwnProperty.call(
                        resolved_abbreviations,
                        abbrev
                    )
                ) {
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

                const existing_command = cache.commands[existing_name];
                const existing_priority =
                    existing_command.priority
                    ?? get_command_priority(existing_command.name);
                if (my_priority < existing_priority) {
                    resolved_abbreviations[abbrev] = normalized_name;
                }
            }
        }

        return resolved_abbreviations[normalized] ?? null;
    }

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
        name: fc.string({ minLength: 3, maxLength: 12 }).filter(
            s => /^[a-z]+$/.test(s)
        ),
        syntax: fc.string({ minLength: 5, maxLength: 100 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
        min_abbreviation: fc.integer({ min: 1, max: 12 }),
        options: fc.array(option_info_generator, { minLength: 0, maxLength: 5 }),
    }).map(info => ({
        ...info,
        min_abbreviation: Math.min(info.min_abbreviation, info.name.length),
    }));

    const command_cache_generator: fc.Arbitrary<CommandCache> = fc.array(
        command_info_generator,
        { minLength: 5, maxLength: 15 }
    ).map(the_commands => {
        const unique_commands = new Map<string, CommandInfo>();
        for (const my_command of the_commands) {
            unique_commands.set(my_command.name.toLowerCase(), my_command);
        }

        const commands: Record<string, CommandInfo> = {};
        const abbreviations: Record<string, string> = {};

        for (const [name, info] of unique_commands) {
            commands[name] = info;
            for (let i = info.min_abbreviation; i <= info.name.length; i++) {
                const abbrev = info.name.substring(0, i).toLowerCase();
                abbreviations[abbrev] = name;
            }
        }

        return {
            version: 18 as StataVersion,
            commands,
            abbreviations,
        };
    });

    const overlapping_command_cache_generator: fc.Arbitrary<CommandCache> = fc.array(
        fc.record({
            name: fc.string({ minLength: 3, maxLength: 10 }).filter(
                s => /^[a-z]+$/.test(s)
            ),
            min_abbreviation: fc.integer({ min: 1, max: 5 }),
            priority: fc.integer({ min: 1, max: 3 }),
        }),
        { minLength: 4, maxLength: 8 }
    ).map(the_commands => {
        const commands: Record<string, CommandInfo> = Object.create(null);

        for (const my_command of the_commands) {
            const normalized_name = my_command.name.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(commands, normalized_name)) {
                continue;
            }
            commands[normalized_name] = {
                name: normalized_name,
                syntax: `${normalized_name} syntax`,
                description: `${normalized_name} description`,
                min_abbreviation: Math.min(
                    my_command.min_abbreviation,
                    normalized_name.length
                ),
                options: [],
                priority: my_command.priority as 1 | 2 | 3,
            };
        }

        return {
            version: 18 as StataVersion,
            commands,
            abbreviations: Object.create(null),
        };
    }).filter(cache => Object.keys(cache.commands).length >= 3);

    it('should provide complete info for valid commands and null for invalid ones', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.array(fc.string({ minLength: 2, maxLength: 10 }), {
                    minLength: 3,
                    maxLength: 8,
                }),
                (cache, the_invalid_names) => {
                    my_database.load_cache(cache);

                    for (const [name, info] of Object.entries(cache.commands)) {
                        const result = my_database.lookup_command(name);
                        expect(result).not.toBeNull();
                        if (result !== null) {
                            expect(result.name).toBe(info.name);
                            expect(result.syntax).toBe(info.syntax);
                            expect(result.description).toBe(info.description);
                            expect(result.min_abbreviation).toBe(
                                info.min_abbreviation
                            );
                        }
                    }

                    for (const my_invalid_name of the_invalid_names) {
                        const normalized = my_invalid_name.toLowerCase();
                        if (
                            !cache.commands[normalized]
                            && !cache.abbreviations[normalized]
                        ) {
                            const result =
                                my_database.lookup_command(my_invalid_name);
                            expect(result).toBeNull();
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should correctly expand abbreviations to full command names', () => {
        fc.assert(
            fc.property(command_cache_generator, cache => {
                my_database.load_cache(cache);

                for (const [abbrev, full_name] of Object.entries(cache.abbreviations)) {
                    const result = my_database.lookup_command(abbrev);
                    const expected_name = compute_expected_lookup(cache, abbrev);
                    expect(expected_name).not.toBeNull();
                    expect(result).not.toBeNull();
                    if (result !== null && expected_name !== null) {
                        expect(result.name.toLowerCase()).toBe(
                            expected_name.toLowerCase()
                        );
                    }
                }

                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should return all commands matching a prefix', () => {
        fc.assert(
            fc.property(
                command_cache_generator,
                fc.string({ minLength: 1, maxLength: 3 }).filter(
                    s => /^[a-z]+$/.test(s)
                ),
                (cache, prefix) => {
                    my_database.load_cache(cache);

                    const results = my_database.search(prefix);
                    const expected_matches = Object.values(cache.commands).filter(
                        cmd => cmd.name.toLowerCase().startsWith(prefix.toLowerCase())
                    );

                    expect(results.length).toBe(expected_matches.length);

                    for (const my_result of results) {
                        expect(
                            my_result.name.toLowerCase().startsWith(
                                prefix.toLowerCase()
                            )
                        ).toBe(true);
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should produce consistent results after multiple cache loads', () => {
        fc.assert(
            fc.property(command_cache_generator, cache => {
                my_database.load_cache(cache);
                const first_all = my_database.get_all_commands();

                my_database.load_cache(cache);
                const second_all = my_database.get_all_commands();

                expect(first_all.length).toBe(second_all.length);

                for (let i = 0; i < first_all.length; i++) {
                    expect(first_all[i].name).toBe(second_all[i].name);
                    expect(first_all[i].syntax).toBe(second_all[i].syntax);
                    expect(first_all[i].description).toBe(
                        second_all[i].description
                    );
                }

                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should always resolve exact command names to themselves', () => {
        fc.assert(
            fc.property(overlapping_command_cache_generator, cache => {
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

    it('should match the precedence oracle for overlapping abbreviations', () => {
        fc.assert(
            fc.property(
                overlapping_command_cache_generator,
                fc.string({ minLength: 1, maxLength: 8 }).filter(
                    s => /^[a-z]+$/.test(s)
                ),
                (cache, query) => {
                    my_database.load_cache(cache);

                    const expected_name = compute_expected_lookup(cache, query);
                    const result = my_database.lookup_command(query);

                    if (expected_name === null) {
                        expect(result).toBeNull();
                    } else {
                        expect(result).not.toBeNull();
                        expect(result?.name.toLowerCase()).toBe(
                            expected_name.toLowerCase()
                        );
                    }

                    return true;
                }
            ),
            { numRuns: 200 }
        );
    });
});
