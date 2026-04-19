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
});
