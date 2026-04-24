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

        for (const command_name of Object.keys(cache.commands)) {
            const lookup_command = database.lookup_command(command_name);
            const lookup = database.lookup(command_name);
            const get_command = database.get_command(command_name);

            if (
                lookup_command?.name.toLowerCase() !== command_name
                || lookup?.name.toLowerCase() !== command_name
                || get_command?.name.toLowerCase() !== command_name
            ) {
                the_failures.push(command_name);
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
});
