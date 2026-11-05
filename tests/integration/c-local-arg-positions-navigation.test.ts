/**
 * Completion, go-to-definition and find references for a caller local
 * that a program creates with `c_local` from a positional argument
 * (`_getrhs rhs`). The definition is the argument word at the call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { Location } from 'vscode-languageserver';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { DocumentStore } from '../../src/document-store';
import { DefinitionProvider } from '../../src/providers/definition';
import { ReferencesProvider } from '../../src/providers/references';
import { CompletionProvider } from '../../src/providers/completion';

const SETTER_ADO = [
    'program define _getrhs',
    '    args where',
    '    c_local `where\' "x1 x2"',
    'end',
    '',
].join('\n');

const MAIN_DO = [
    'program define avplot',
    '    quietly _getrhs rhs',
    '    regress y `rhs\'',
    '    display "`rhs\'"',
    '    display "`',
    'end',
    '',
].join('\n');

function as_locations(result: unknown): Location[] {
    if (!result) return [];
    return Array.isArray(result) ? result : [result as Location];
}

describe('c_local from a positional argument: navigation', () => {
    let root: string;
    let indexer: WorkspaceIndexer;
    let document_store: DocumentStore;
    let main_uri: string;

    beforeEach(async () => {
        root = mkdtempSync(join(tmpdir(), 'c-local-args-nav-'));
        writeFileSync(join(root, '_getrhs.ado'), SETTER_ADO);
        const main_path = join(root, 'main.do');
        writeFileSync(main_path, MAIN_DO);
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        await indexer.initialize([root]);
        document_store = new DocumentStore();
        main_uri = URI.file(main_path).toString();
        await document_store.open(
            main_uri,
            MAIN_DO,
            1,
            indexer.get_all_symbols()
        );
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('goes to the argument word at the call', async () => {
        const document = document_store.get(main_uri)!;
        const result = await new DefinitionProvider().get_definition(
            document,
            { line: 2, character: 16 },
            indexer.get_all_symbols(),
            document.context_tracker,
            undefined,
            indexer
        );
        expect(as_locations(result)).toContainEqual({
            uri: main_uri,
            range: {
                start: { line: 1, character: 20 },
                end: { line: 1, character: 23 },
            },
        });
    });

    it('finds the uses from the argument word', async () => {
        const document = document_store.get(main_uri)!;
        const locations = await new ReferencesProvider().get_references(
            document,
            { line: 1, character: 21 },
            { includeDeclaration: true },
            indexer,
            document.context_tracker
        );
        const lines = locations
            .filter((my_location) => my_location.uri === main_uri)
            .map((my_location) => my_location.range.start.line)
            .sort();
        expect(lines).toEqual([1, 2, 3]);
    });

    it('offers the local in completion after the call', async () => {
        const document = document_store.get(main_uri)!;
        const items = await new CompletionProvider().get_completions(
            document,
            { line: 4, character: 14 },
            '`',
            undefined,
            indexer.get_all_symbols()
        );
        expect(items.map((my_item) => my_item.label)).toContain('rhs');
    });
});
