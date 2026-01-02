import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentStore } from '../../src/document-store';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Cross-file Navigation Integration', () => {
    const test_temp_dir = join(process.cwd(), 'temp_test_workspace');
    let indexer: WorkspaceIndexer;
    let definition_provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        // Setup a temporary workspace
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        indexer = new WorkspaceIndexer();
        definition_provider = new DefinitionProvider();
        document_store = new DocumentStore();
    });

    // Cleanup
    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('should find program definition in another file', async () => {
        const file1_path = join(test_temp_dir, 'helper.ado');
        const file1_content = 'program define myhelper\n  display "hello"\nend\n';
        writeFileSync(file1_path, file1_content);

        const file2_path = join(test_temp_dir, 'main.do');
        const file2_content = 'myhelper\n';
        writeFileSync(file2_path, file2_content);

        // Index the workspace
        await indexer.initialize([test_temp_dir]);

        // Open the main file in document store
        const file2_uri = URI.file(file2_path).toString();
        await document_store.open(file2_uri, file2_content, 1);
        const document_state = document_store.get(file2_uri)!;

        // Try to get definition of 'myhelper' at line 0, col 0
        const workspace_symbols = indexer.get_all_symbols();
        const definition = await definition_provider.get_definition(
            document_state,
            { line: 0, character: 2 },
            workspace_symbols
        );

        expect(definition).toBeDefined();
        if (Array.isArray(definition)) {
            expect(definition.length).toBe(1);
            expect(definition[0].uri).toContain('helper.ado');
        } else if (definition) {
            expect((definition as any).uri).toContain('helper.ado');
        } else {
            throw new Error('Definition not found');
        }
    });

    it('should find global macro definition in another file', async () => {
        const file1_path = join(test_temp_dir, 'globals.do');
        const file1_content = 'global MY_GLOBAL "value"\n';
        writeFileSync(file1_path, file1_content);

        const file2_path = join(test_temp_dir, 'use_global.do');
        const file2_content = 'display $MY_GLOBAL\n';
        writeFileSync(file2_path, file2_content);

        // Initialize is async, need to await it
        await indexer.initialize([test_temp_dir]);

        const file2_uri = URI.file(file2_path).toString();
        await document_store.open(file2_uri, file2_content, 1);
        const document_state = document_store.get(file2_uri)!;

        const workspace_symbols = indexer.get_all_symbols();
        const definition = await definition_provider.get_definition(
            document_state,
            { line: 0, character: 10 }, // $MY_GLOBAL
            workspace_symbols
        );

        expect(definition).toBeDefined();
        const def_uri = Array.isArray(definition) ? definition[0].uri : (definition as any).uri;
        expect(def_uri).toContain('globals.do');
    });

    // Cleanup
    afterAll(() => {
        if (require('fs').existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });
});


