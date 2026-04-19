import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Go-to-definition - redeclared same-identity symbols', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'goto-def-redecl-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new DefinitionProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('returns both local macro declarations when redeclared in the same file', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'local fruit apple',         // line 0
            'di "`fruit\' is apple"',    // line 1
            'local fruit banana',        // line 2
            'di "`fruit\' is banana"',   // line 3
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `fruit' in line 3 (the reference inside the string after banana)
        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character: fruit_char },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );

        // LSP Definition can be a single Location or Location[]; normalize.
        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines_in_file = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines_in_file).toEqual([0, 2]);
    });

    it('returns both program declarations when redeclared in the same file', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'program define foo',     // line 0
            '    di "first"',
            'end',                    // line 2
            'foo',                    // line 3 (call site)
            'program define foo',     // line 4
            '    di "second"',
            'end',                    // line 6
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `foo` call at line 3
        const foo_char = content.split('\n')[3].indexOf('foo');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character: foo_char },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines).toEqual([0, 4]);
    });

    it('returns both scalar declarations when redeclared', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'scalar s = 1',        // line 0
            'di s',                // line 1 (reference)
            'scalar s = 2',        // line 2
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        const s_char = content.split('\n')[1].indexOf('s');
        const result = await provider.get_definition(
            document_state,
            { line: 1, character: s_char },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        expect(lines).toEqual([0, 2]);
    });

    it('returns macro declarations from included file AND current file', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local helper = "lib version"',  // line 0
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',              // line 0
            'local helper = "main version"', // line 1
            'di "`helper\'"',                // line 2
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        // Cursor on `helper' at line 2
        const helper_char = main_content.split('\n')[2].indexOf('helper');
        const result = await provider.get_definition(
            document_state,
            { line: 2, character: helper_char },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const same_file = locations
            .filter(loc => loc.uri === main_uri)
            .map(loc => loc.range.start.line);
        const cross_file = locations
            .filter(loc => loc.uri === lib_uri)
            .map(loc => loc.range.start.line);
        expect(same_file).toContain(1);     // main file's `local helper`
        expect(cross_file).toContain(0);    // lib file's `local helper`
    });
});
