/**
 * Unit tests for the `sight/resolveSthlpFile` handler's ability to
 * redirect a topic whose `.sthlp` file is named for a different
 * command (e.g. `local` \u2192 `macro.sthlp`).
 *
 * The handler consults `command_database.lookup(topic).helpFile` after
 * direct lookup fails, so these tests stub the singleton with a minimal
 * cache and point a real `WorkspaceIndexer` at a temp ado directory
 * that contains only the redirected file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    create_resolve_sthlp_file_handler,
    HandlerDependencies,
} from '../../src/server-handlers';
import { WorkspaceIndexer } from '../../src/indexer';
import { DocumentStore } from '../../src/document-store';
import { command_database } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';

function make_deps(workspace_indexer: WorkspaceIndexer): HandlerDependencies {
    return {
        debounce_manager: null,
        document_store: new DocumentStore(),
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => ({} as any),
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('resolveSthlpFile - help_file redirects', () => {
    let temp_dir: string;
    let indexer: WorkspaceIndexer;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-resolve-sthlp-'));
        indexer = new WorkspaceIndexer();

        // Load a minimal cache that mirrors the generator output:
        // `local` and `global` are documented in `macro.sthlp`, so they
        // carry a `help_file` pointer. `macro` itself is a regular
        // entry whose name matches its file.
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
                global: {
                    name: 'global',
                    min_abbreviation: 2,
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
                loca: 'local',
                gl: 'global',
                glo: 'global',
                glob: 'global',
                globa: 'global',
                reg: 'regress',
            },
        };
        command_database.load_cache(the_cache);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
        command_database.clear();
    });

    it('redirects `local` to macro.sthlp via helpFile', async () => {
        // Temp ado dir contains only m/macro.sthlp (no l/local.sthlp),
        // simulating the actual Stata layout.
        const my_macro_dir = path.join(temp_dir, 'ado', 'm');
        const my_macro_path = path.join(my_macro_dir, 'macro.sthlp');
        fs.mkdirSync(my_macro_dir, { recursive: true });
        fs.writeFileSync(my_macro_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'local' });

        expect(result.file_path).toBe(my_macro_path);
    });

    it('redirects `global` to macro.sthlp via helpFile', async () => {
        const my_macro_dir = path.join(temp_dir, 'ado', 'm');
        const my_macro_path = path.join(my_macro_dir, 'macro.sthlp');
        fs.mkdirSync(my_macro_dir, { recursive: true });
        fs.writeFileSync(my_macro_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'global' });

        expect(result.file_path).toBe(my_macro_path);
    });

    it('resolves `macro` itself directly without redirect', async () => {
        const my_macro_dir = path.join(temp_dir, 'ado', 'm');
        const my_macro_path = path.join(my_macro_dir, 'macro.sthlp');
        fs.mkdirSync(my_macro_dir, { recursive: true });
        fs.writeFileSync(my_macro_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'macro' });

        expect(result.file_path).toBe(my_macro_path);
    });

    it('still resolves commands whose .sthlp file matches the name', async () => {
        // Direct lookup path: `regress` \u2192 `regress.sthlp`.
        const my_regress_dir = path.join(temp_dir, 'ado', 'r');
        const my_regress_path = path.join(my_regress_dir, 'regress.sthlp');
        fs.mkdirSync(my_regress_dir, { recursive: true });
        fs.writeFileSync(my_regress_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'regress' });

        expect(result.file_path).toBe(my_regress_path);
    });

    it('returns null when neither direct nor redirected topic resolves', async () => {
        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'local' });

        expect(result.file_path).toBeNull();
    });

    it('falls back to the parent help page for subcommand topics without their own file', async () => {
        // `macro dir` has no dedicated `macro_dir.sthlp`; the handler
        // should open `macro.sthlp` as the parent fallback.
        const my_macro_dir = path.join(temp_dir, 'ado', 'm');
        const my_macro_path = path.join(my_macro_dir, 'macro.sthlp');
        fs.mkdirSync(my_macro_dir, { recursive: true });
        fs.writeFileSync(my_macro_path, '{smcl}');

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'macro dir' });

        expect(result.file_path).toBe(my_macro_path);
    });

    it('follows a help_alias.maint redirect (operators → operator)', async () => {
        // operators.sthlp does not exist; Stata ships a redirect in
        // ohelp_alias.maint that the resolver must follow.
        const my_op_dir = path.join(temp_dir, 'ado', 'o');
        const my_op_path = path.join(my_op_dir, 'operator.sthlp');
        fs.mkdirSync(my_op_dir, { recursive: true });
        fs.writeFileSync(my_op_path, '{smcl}');
        fs.writeFileSync(
            path.join(my_op_dir, 'ohelp_alias.maint'),
            'operators\t\toperator\n'
        );

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'operators' });

        expect(result.file_path).toBe(my_op_path);
    });

    it('returns null when a help-alias chain cycles back on itself', async () => {
        // Malformed `.maint` files that alias a → b and b → a must not
        // hang the resolver. The first filesystem lookup misses, the
        // alias lookup points to `b`, that also has no file and aliases
        // back to `a`, and the visited set breaks the loop.
        const my_dir = path.join(temp_dir, 'ado', 'o');
        fs.mkdirSync(my_dir, { recursive: true });
        fs.writeFileSync(
            path.join(my_dir, 'ohelp_alias.maint'),
            'operators\toperators2\noperators2\toperators\n'
        );

        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_sthlp_file_handler(make_deps(indexer));
        const result = await handler({ topic: 'operators' });

        expect(result.file_path).toBeNull();
    });
});
