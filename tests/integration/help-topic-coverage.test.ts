/**
 * Help-topic coverage test.
 *
 * Runs only on developer machines where a real Stata install is
 * detectable (we skip when `discover_stata_ado_paths()` returns an
 * empty list, so CI boxes and non-Stata contributors are unaffected).
 *
 * For every command in the committed v18 cache and every entry in
 * `STATA_EXPRESSION_FUNCTIONS` (+ aliases) the test drives the real
 * `sight/resolveSthlpFile` handler and asserts that the returned
 * `file_path` is non-null. When something regresses, the failure
 * message lists every unresolved topic so it's obvious what the
 * cache is missing.
 */

import { describe, expect, it, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    create_resolve_sthlp_file_handler,
    HandlerDependencies,
} from '../../src/server-handlers';
import { WorkspaceIndexer } from '../../src/indexer';
import { DocumentStore } from '../../src/document-store';
import { command_database } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';
import {
    STATA_EXPRESSION_FUNCTIONS,
    STATA_EXPRESSION_FUNCTION_ALIASES,
} from '../../src/providers/hover';
import { discover_stata_ado_paths } from '../../src/utils/stata-install-paths';

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

const the_stata_ado_paths = discover_stata_ado_paths();
const stata_is_installed = the_stata_ado_paths.length > 0;

// `describe.skipIf` is Bun-native; we preserve the describe block so
// the skip shows up in the test report (with a helpful reason).
const describe_if_stata = stata_is_installed ? describe : describe.skip;

describe_if_stata('Help topic coverage (local Stata install required)', () => {
    let throwaway_workspace: string;
    let indexer: WorkspaceIndexer;
    let handler: (params: { topic: string }) => Promise<{ file_path: string | null }>;

    beforeAll(async () => {
        if (!stata_is_installed) return;

        throwaway_workspace = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-help-coverage-')
        );

        // Load the committed cache so the resolver exercises the exact
        // `help_file` pointers shipped to users.
        const cache_path = join(
            __dirname,
            '../../src/command-database/caches/v18.json'
        );
        const the_cache = JSON.parse(
            readFileSync(cache_path, 'utf-8')
        ) as CommandCache;
        command_database.load_cache(the_cache);

        indexer = new WorkspaceIndexer();
        await indexer.initialize([throwaway_workspace]);
        indexer.set_help_search_paths(the_stata_ado_paths);

        handler = create_resolve_sthlp_file_handler(make_deps(indexer));
    });

    it('resolves every command in the cache to a .sthlp file', async () => {
        if (!stata_is_installed) return;

        const the_topics = Object.keys(
            (command_database as any).cache?.commands ?? {}
        );
        const the_unresolved: string[] = [];

        for (const my_topic of the_topics) {
            const my_result = await handler({ topic: my_topic });
            if (!my_result.file_path) {
                the_unresolved.push(my_topic);
            }
        }

        if (the_unresolved.length > 0) {
            const my_preview = the_unresolved.slice(0, 50).join(', ');
            const my_suffix = the_unresolved.length > 50
                ? ` ...and ${the_unresolved.length - 50} more`
                : '';
            throw new Error(
                `Could not resolve .sthlp for ${the_unresolved.length} `
                + `cached commands (out of ${the_topics.length}): `
                + `${my_preview}${my_suffix}`
            );
        }

        expect(the_unresolved).toEqual([]);
    }, 60_000);

    it('resolves every expression function (and alias) to a .sthlp file', async () => {
        if (!stata_is_installed) return;

        const the_topics = new Set<string>([
            ...STATA_EXPRESSION_FUNCTIONS,
            ...STATA_EXPRESSION_FUNCTION_ALIASES.keys(),
            ...STATA_EXPRESSION_FUNCTION_ALIASES.values(),
        ]);
        const the_unresolved: string[] = [];

        for (const my_topic of the_topics) {
            const my_result = await handler({ topic: my_topic });
            if (!my_result.file_path) {
                the_unresolved.push(my_topic);
            }
        }

        if (the_unresolved.length > 0) {
            throw new Error(
                `Could not resolve .sthlp for ${the_unresolved.length} `
                + `expression function(s) (out of ${the_topics.size}): `
                + the_unresolved.join(', ')
            );
        }

        expect(the_unresolved).toEqual([]);
    }, 30_000);
});
