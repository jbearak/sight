/**
 * Hover, go-to-definition and find references for a caller local that
 * a program sets with a literal `c_local foo …`. The definition is the
 * call: its uri and range both come from the calling file, as for a
 * c_local name taken from an argument (`_getrhs rhs`). The call adds a
 * definition and keeps the earlier ones.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { Location, MarkupContent } from 'vscode-languageserver';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { DocumentStore } from '../../src/document-store';
import { CommandDatabase } from '../../src/command-database';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { ReferencesProvider } from '../../src/providers/references';
import { StataDiagnosticCode } from '../../src/types';

const SETTER_ADO = [
    'program define setfoo',
    '    c_local foo 1',
    'end',
    '',
].join('\n');

// Cross-file: setfoo lives in setfoo.ado.
const MAIN_DO = [
    'local foo 0',
    'display "`foo\'"',
    'setfoo',
    'display "`foo\'"',
    '',
].join('\n');

const FRESH_DO = [
    'setfoo',
    'display "`foo\'"',
    '',
].join('\n');

// Same file: the program is defined above its call.
const SAME_DO = [
    'program define setbar',
    '    c_local bar 1',
    'end',
    'local bar 0',
    'display "`bar\'"',
    'setbar',
    'display "`bar\'"',
    '',
].join('\n');

function as_locations(result: unknown): Location[] {
    if (!result) return [];
    return Array.isArray(result) ? result : [result as Location];
}

describe('literal c_local: navigation', () => {
    let root: string;
    let indexer: WorkspaceIndexer;
    let document_store: DocumentStore;
    const uris: Record<string, string> = {};

    beforeEach(async () => {
        root = mkdtempSync(join(tmpdir(), 'c-local-literal-nav-'));
        writeFileSync(join(root, 'setfoo.ado'), SETTER_ADO);
        const the_files: Array<[string, string]> = [
            ['main.do', MAIN_DO],
            ['fresh.do', FRESH_DO],
            ['same.do', SAME_DO],
        ];
        for (const [my_name, my_text] of the_files) {
            writeFileSync(join(root, my_name), my_text);
        }
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        await indexer.initialize([root]);
        document_store = new DocumentStore();
        for (const [my_name, my_text] of the_files) {
            const my_uri = URI.file(join(root, my_name)).toString();
            uris[my_name] = my_uri;
            await document_store.open(
                my_uri,
                my_text,
                1,
                indexer.get_all_symbols()
            );
        }
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    async function hover_text(name: string, line: number): Promise<string> {
        const document = document_store.get(uris[name])!;
        const hover = await new HoverProvider(new CommandDatabase()).get_hover(
            document,
            { line, character: 10 },
            indexer.get_all_symbols(),
            undefined,
            undefined,
            undefined,
            root,
            indexer
        );
        return (hover?.contents as MarkupContent | undefined)?.value ?? '';
    }

    async function definitions(name: string, line: number): Promise<Location[]> {
        const document = document_store.get(uris[name])!;
        const result = await new DefinitionProvider().get_definition(
            document,
            { line, character: 10 },
            indexer.get_all_symbols(),
            document.context_tracker,
            undefined,
            indexer
        );
        return as_locations(result);
    }

    async function reference_lines(name: string, line: number): Promise<number[]> {
        const document = document_store.get(uris[name])!;
        const locations = await new ReferencesProvider().get_references(
            document,
            { line, character: 10 },
            { includeDeclaration: true },
            indexer,
            document.context_tracker
        );
        expect(locations.every((my_location) => my_location.uri === uris[name]))
            .toBe(true);
        return [...new Set(locations.map((my_location) => my_location.range.start.line))]
            .sort();
    }

    it('hovers the call in this file, not the program file', async () => {
        const text = await hover_text('fresh.do', 1);
        expect(text).toContain('**Local Macro:** `foo`');
        expect(text).not.toContain('setfoo.ado');
        expect(text).toContain('Defined at: this file, line 1');
    });

    it('keeps an earlier definition in hover (cross-file)', async () => {
        const text = await hover_text('main.do', 3);
        expect(text).not.toContain('setfoo.ado');
        expect(text).toContain('Defined at: this file, line 1');
    });

    it('goes to the earlier local and the call (cross-file)', async () => {
        const the_locations = await definitions('main.do', 3);
        expect(the_locations.every((my_location) => my_location.uri === uris['main.do']))
            .toBe(true);
        expect(the_locations.map((my_location) => my_location.range.start.line).sort())
            .toEqual([0, 2]);
    });

    it('goes to the earlier local and the call (same file)', async () => {
        const the_locations = await definitions('same.do', 6);
        expect(the_locations.every((my_location) => my_location.uri === uris['same.do']))
            .toBe(true);
        expect(the_locations.map((my_location) => my_location.range.start.line).sort())
            .toEqual([3, 5]);
    });

    it('finds the earlier local and the call as references', async () => {
        expect(await reference_lines('main.do', 3)).toEqual([0, 1, 2, 3]);
        expect(await reference_lines('same.do', 6)).toEqual([3, 4, 5, 6]);
    });

    it('does not report a use before the call as used before defined', () => {
        for (const my_name of ['main.do', 'same.do']) {
            const the_codes = document_store.get(uris[my_name])!.diagnostics
                .map((my_diagnostic) => my_diagnostic.code);
            expect(the_codes).not.toContain(StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL);
            expect(the_codes).not.toContain(StataDiagnosticCode.UNDEFINED_MACRO);
        }
    });
});
