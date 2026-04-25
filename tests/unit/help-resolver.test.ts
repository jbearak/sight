/**
 * Unit tests for the shared `resolve_help_topic` utility.
 *
 * The helper centralizes the multi-step `.sthlp` resolution chain so
 * the LSP handler (`sight/resolveSthlpFile`) and the offline link
 * checker (`scripts/check-help-links.ts`) follow the same logic. The
 * key behaviors covered here are the ones the script was missing
 * before the extraction: command-database `helpFile` redirects and
 * abbreviation expansion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { resolve_help_topic } from '../../src/utils/help-resolver';
import { WorkspaceIndexer } from '../../src/indexer';
import { command_database } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';

describe('resolve_help_topic', () => {
    let temp_dir: string;
    let indexer: WorkspaceIndexer;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-help-resolver-')
        );
        indexer = new WorkspaceIndexer();

        const the_cache: CommandCache = {
            version: 18,
            commands: {
                local: {
                    name: 'local',
                    min_abbreviation: 3,
                    options: [],
                    priority: 1,
                    help_file: 'macro',
                },
                macro: {
                    name: 'macro',
                    min_abbreviation: 2,
                    options: [],
                    priority: 2,
                },
                regress: {
                    name: 'regress',
                    min_abbreviation: 3,
                    options: [],
                    priority: 1,
                },
            },
            abbreviations: {
                loc: 'local',
                reg: 'regress',
            },
        };
        command_database.load_cache(the_cache);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
        command_database.clear();
    });

    it('redirects `local` to macro.sthlp via command-database helpFile', async () => {
        // Stata's actual ado tree has m/macro.sthlp but no l/local.sthlp.
        // Without the helpFile redirect the script's old resolver
        // would fail here.
        const my_macro_dir = path.join(temp_dir, 'ado', 'm');
        const my_macro_path = path.join(my_macro_dir, 'macro.sthlp');
        fs.mkdirSync(my_macro_dir, { recursive: true });
        fs.writeFileSync(my_macro_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const my_path = await resolve_help_topic(indexer, 'local');
        expect(my_path).toBe(my_macro_path);
    });

    it('expands `reg` to regress.sthlp via abbreviation lookup', async () => {
        const my_dir = path.join(temp_dir, 'ado', 'r');
        const my_path = path.join(my_dir, 'regress.sthlp');
        fs.mkdirSync(my_dir, { recursive: true });
        fs.writeFileSync(my_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const my_resolved = await resolve_help_topic(indexer, 'reg');
        expect(my_resolved).toBe(my_path);
    });

    it('falls back to f_ prefix for function topics like float()', async () => {
        const my_dir = path.join(temp_dir, 'ado', 'f');
        const my_path = path.join(my_dir, 'f_float.sthlp');
        fs.mkdirSync(my_dir, { recursive: true });
        fs.writeFileSync(my_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const my_resolved = await resolve_help_topic(indexer, 'float()');
        expect(my_resolved).toBe(my_path);
    });

    it('returns null when no fallback resolves the topic', async () => {
        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const my_resolved = await resolve_help_topic(
            indexer, 'no_such_topic_anywhere'
        );
        expect(my_resolved).toBeNull();
    });

    it(
        'prefers a hyphen+space normalized direct hit over the helpFile parent',
        async () => {
            // Real-world case: `gsem family-and-link options` should
            // resolve to `gsem_family_and_link_options.sthlp` (which
            // exists) rather than to `gsem_command.sthlp` via gsem's
            // `help_file` redirect. The previous chain returned the
            // parent file because the helpFile-with-tail step ran
            // before the hyphen-to-underscore variant was tried.
            const my_dir = path.join(temp_dir, 'ado', 'g');
            fs.mkdirSync(my_dir, { recursive: true });
            const my_command_path = path.join(my_dir, 'gsem_command.sthlp');
            const my_options_path = path.join(
                my_dir, 'gsem_family_and_link_options.sthlp'
            );
            fs.writeFileSync(my_command_path, '{smcl}');
            fs.writeFileSync(my_options_path, '{smcl}');

            const the_cache: CommandCache = {
                version: 18,
                commands: {
                    gsem: {
                        name: 'gsem',
                        min_abbreviation: 4,
                        options: [],
                        priority: 3,
                        help_file: 'gsem_command',
                    },
                },
                abbreviations: {},
            };
            command_database.load_cache(the_cache);

            indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

            const my_resolved = await resolve_help_topic(
                indexer, 'gsem family-and-link options'
            );
            expect(my_resolved).toBe(my_options_path);
        }
    );
});
