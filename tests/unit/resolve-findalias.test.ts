/**
 * Unit tests for the `sight/resolveFindalias` handler.
 *
 * Points a real `WorkspaceIndexer` at a temp ado directory with a
 * synthetic `*smcl_alias.maint` and asserts the handler surfaces the
 * alias's SMCL substitution (or null) as expected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    create_resolve_findalias_handler,
    HandlerDependencies,
} from '../../src/server-handlers';
import { WorkspaceIndexer } from '../../src/indexer';
import { DocumentStore } from '../../src/document-store';

function make_deps(workspace_indexer: WorkspaceIndexer | null): HandlerDependencies {
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

describe('resolveFindalias', () => {
    let temp_dir: string;
    let indexer: WorkspaceIndexer;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-resolve-findalias-')
        );
        indexer = new WorkspaceIndexer();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_maint(letter: string, lines: string[]): string {
        const my_dir = path.join(temp_dir, 'ado', letter);
        fs.mkdirSync(my_dir, { recursive: true });
        const my_path = path.join(my_dir, `${letter}smcl_alias.maint`);
        fs.writeFileSync(my_path, lines.join('\n') + '\n');
        return my_path;
    }

    it('returns the SMCL substitution for a known alias', async () => {
        write_maint('f', [
            'frexp                    {manlink U 13 Functions and expressions}',
        ]);
        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_findalias_handler(make_deps(indexer));
        const result = await handler({ alias: 'frexp' });

        expect(result.smcl).toBe(
            '{manlink U 13 Functions and expressions}'
        );
    });

    it('returns null for an unknown alias', async () => {
        write_maint('f', ['frexp payload']);
        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);

        const handler = create_resolve_findalias_handler(make_deps(indexer));
        const result = await handler({ alias: 'not_a_real_alias' });

        expect(result.smcl).toBeNull();
    });

    it('returns null when workspace_indexer is absent', async () => {
        const handler = create_resolve_findalias_handler(make_deps(null));
        const result = await handler({ alias: 'frexp' });
        expect(result.smcl).toBeNull();
    });

    it('returns null for an empty alias', async () => {
        indexer.set_help_search_paths([path.join(temp_dir, 'ado')]);
        const handler = create_resolve_findalias_handler(make_deps(indexer));
        const result = await handler({ alias: '' });
        expect(result.smcl).toBeNull();
    });
});
