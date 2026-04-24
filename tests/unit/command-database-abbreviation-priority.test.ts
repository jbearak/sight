import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CommandDatabase } from '../../src/command-database';
import { get_command_priority } from '../../src/command-database/priority-tiers';
import type { CommandCache } from '../../src/command-database/types';

function load_v18_database(): { db: CommandDatabase; cache: CommandCache } {
    const cache_path = join(
        __dirname,
        '../../src/command-database/caches/v18.json'
    );
    const cache = JSON.parse(readFileSync(cache_path, 'utf-8')) as CommandCache;
    const db = new CommandDatabase();
    db.load_cache(cache);
    return { db, cache };
}

function collect_all_abbreviations(
    cache: CommandCache
): Map<string, string[]> {
    const the_abbreviations = new Map<string, string[]>();

    for (const my_info of Object.values(cache.commands)) {
        const my_name = my_info.name;
        const my_name_lower = my_name.toLowerCase();
        const my_min = my_info.min_abbreviation;

        for (let i = my_min; i <= my_name_lower.length; i++) {
            const my_abbrev = my_name_lower.substring(0, i);
            const the_matches = the_abbreviations.get(my_abbrev);
            if (the_matches) {
                the_matches.push(my_name);
            } else {
                the_abbreviations.set(my_abbrev, [my_name]);
            }
        }
    }

    return the_abbreviations;
}

describe('CommandDatabase abbreviation priority resolution', () => {
    let database: CommandDatabase;
    let cache: CommandCache;

    beforeAll(() => {
        const loaded = load_v18_database();
        database = loaded.db;
        cache = loaded.cache;
    });

    it('lookup APIs agree on key real-cache abbreviations and exact names', () => {
        const the_expected_resolutions: Array<[string, string]> = [
            ['di', 'display'],
            ['l', 'list'],
            ['li', 'list'],
            ['sca', 'scalar'],
            ['display', 'display'],
            ['label', 'label'],
            ['local', 'local'],
        ];

        for (const [my_abbrev, my_expected_name] of the_expected_resolutions) {
            expect(database.lookup(my_abbrev)?.name).toBe(my_expected_name);
            expect(database.lookup_command(my_abbrev)?.name).toBe(
                my_expected_name
            );
            expect(database.get_command(my_abbrev)?.name).toBe(
                my_expected_name
            );
        }
    });

    it('direct names win over any abbreviation-table collision for every command', () => {
        const the_failures: string[] = [];
        for (const my_command_name of Object.keys(cache.commands)) {
            const lookup_command_result =
                database.lookup_command(my_command_name);
            const lookup_result = database.lookup(my_command_name);
            const get_command_result = database.get_command(my_command_name);

            if (
                lookup_command_result?.name.toLowerCase() !== my_command_name
                || lookup_result?.name.toLowerCase() !== my_command_name
                || get_command_result?.name.toLowerCase() !== my_command_name
            ) {
                the_failures.push(my_command_name);
            }
        }

        expect(the_failures).toEqual([]);
    });

    it('every ambiguous abbreviation resolves to the highest-priority candidate', () => {
        const the_all_abbrevs = collect_all_abbreviations(cache);
        const the_failures: string[] = [];

        for (const [my_abbrev, the_candidates] of the_all_abbrevs) {
            if (the_candidates.length < 2) continue;
            if (cache.commands[my_abbrev]) continue;

            const the_best_tier = Math.min(
                ...the_candidates.map(my_name => get_command_priority(my_name))
            );
            const the_result = database.lookup(my_abbrev);
            const the_result_tier = the_result
                ? get_command_priority(the_result.name)
                : 3;

            if (!the_result || the_result_tier !== the_best_tier) {
                the_failures.push(
                    `${my_abbrev} -> ${the_result?.name ?? 'undefined'} `
                    + `(tier ${the_result_tier}; best tier ${the_best_tier}; `
                    + `candidates: ${the_candidates.join(', ')})`
                );
            }
        }

        expect(the_failures).toEqual([]);
    });

    it('cache preserves and exposes expected prefix subcommands', () => {
        expect(database.get_subcommands('file')?.map(sub => sub.name)).toEqual([
            'open',
            'read',
            'write',
            'close',
            'seek',
            'query',
            'set',
        ]);
        expect(database.get_subcommands('frame')?.map(sub => sub.name)).toEqual([
            'create',
            'change',
            'copy',
            'drop',
            'rename',
            'put',
            'post',
            'dir',
            'reset',
            'list',
            'prefix',
        ]);
        expect(database.get_subcommands('mi')?.map(sub => sub.name)).toEqual([
            'set',
            'describe',
            'estimate',
            'impute',
            'register',
            'unregister',
            'passive',
            'varying',
            'convert',
            'export',
            'import',
            'merge',
            'append',
            'expand',
            'reshape',
            'update',
            'xeq',
        ]);
    });

    it('register_all preserves lookup semantics after batched registration', () => {
        const db = new CommandDatabase();
        db.register_all([
            {
                name: 'display',
                minAbbreviation: 'di',
                options: [],
                category: 'builtin',
                isBuiltin: true,
                priority: 1,
            },
            {
                name: 'dir',
                minAbbreviation: 'd',
                options: [],
                category: 'builtin',
                isBuiltin: true,
                priority: 3,
            },
            {
                name: 'scalar',
                minAbbreviation: 'sca',
                options: [],
                category: 'builtin',
                isBuiltin: true,
                priority: 1,
            },
        ]);

        expect(db.lookup('di')?.name).toBe('display');
        expect(db.lookup('dir')?.name).toBe('dir');
        expect(db.lookup('sca')?.name).toBe('scalar');
    });

    it('same-priority seeded abbreviations preserve curated cache mappings', () => {
        const db = new CommandDatabase();
        db.load_cache({
            version: 18,
            commands: {
                alpha: {
                    name: 'alpha',
                    min_abbreviation: 1,
                    options: [],
                    priority: 3,
                },
                alpine: {
                    name: 'alpine',
                    min_abbreviation: 1,
                    options: [],
                    priority: 3,
                },
            },
            abbreviations: {
                al: 'alpine',
            },
        });
        expect(db.lookup('al')?.name).toBe('alpine');
        expect(db.lookup_command('al')?.name).toBe('alpine');
        expect(db.get_command('al')?.name).toBe('alpine');
    });

    it('later low-priority registration does not displace a higher-priority abbreviation winner', () => {
        const db = new CommandDatabase();
        db.register({
            name: 'display',
            minAbbreviation: 'di',
            options: [],
            category: 'builtin',
            isBuiltin: true,
            priority: 1,
        });
        db.register({
            name: 'dir',
            minAbbreviation: 'd',
            options: [],
            category: 'builtin',
            isBuiltin: true,
            priority: 3,
        });

        expect(db.lookup('di')?.name).toBe('display');
        expect(db.lookup_command('di')?.name).toBe('display');
        expect(db.get_command('di')?.name).toBe('display');
    });
});
