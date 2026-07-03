// Issue #270: hover / go-to-definition / find-references / completion
// must resolve local macros through the scoped environment model
// (DocumentState.scopes), not the flat one-representative-per-name
// compatibility view. Mirrors the analyzer-level scenarios in
// tests/unit/scoped-local-macro-identity.test.ts at the provider level.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { DocumentStore } from '../../src/document-store';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import { Location } from 'vscode-languageserver';

const SIBLING_LINES = [
    'program define prog_a',   // 0
    '    local shared 1',      // 1
    'end',                     // 2
    'program define prog_b',   // 3
    '    local shared 2',      // 4
    '    di "`shared\'"',      // 5
    'end',                     // 6
];

function as_locations(
    result: Location | Location[] | null
): Location[] {
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
}

describe('scoped local macros: go-to-definition (#270)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'scoped-def-'));
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

    async function open_document(lines: string[]) {
        const file_path = join(test_temp_dir, 'a.do');
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('reference inside prog_b resolves only to prog_b\'s definition', async () => {
        const { uri, content, document_state } =
            await open_document(SIBLING_LINES);
        const character = content.split('\n')[5].indexOf('shared');
        const result = await provider.get_definition(
            document_state,
            { line: 5, character },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );
        const the_lines = as_locations(result)
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toEqual([4]);
    });

    it('cursor on a losing-flat-slot declaration resolves to itself', async () => {
        const { uri, content, document_state } =
            await open_document(SIBLING_LINES);
        // prog_a's `shared` (earliest) owns the flat slot; prog_b's
        // declaration must still match its own range.
        const character = content.split('\n')[4].indexOf('shared');
        const result = await provider.get_definition(
            document_state,
            { line: 4, character },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );
        const the_lines = as_locations(result)
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toEqual([4]);
    });

    it('top-level reference to a program-only local resolves to nothing', async () => {
        const { document_state, content } = await open_document([
            'program define prog_a',   // 0
            '    local hidden 1',      // 1
            'end',                     // 2
            'di "`hidden\'"',          // 3
        ]);
        const character = content.split('\n')[3].indexOf('hidden');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );
        expect(as_locations(result)).toEqual([]);
    });

    it('program reference still sees do-file locals (permissive)', async () => {
        const { uri, content, document_state } = await open_document([
            'local top_x 5',       // 0
            'program define p',    // 1
            '    di "`top_x\'"',   // 2
            'end',                 // 3
        ]);
        const character = content.split('\n')[2].indexOf('top_x');
        const result = await provider.get_definition(
            document_state,
            { line: 2, character },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );
        const the_lines = as_locations(result)
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toContain(0);
    });
});

describe('scoped local macros: hover (#270)', () => {
    let test_temp_dir: string;
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'scoped-hover-'));
        hover_provider = new HoverProvider(new CommandDatabase());
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    async function open_document(lines: string[]) {
        const file_path = join(test_temp_dir, 'a.do');
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    function hover_value(hover: Awaited<
        ReturnType<HoverProvider['get_hover']>
    >): string {
        const contents = hover?.contents as
            | { kind: string; value: string }
            | undefined;
        return contents?.value ?? '';
    }

    it('hover inside prog_b shows prog_b\'s value, not prog_a\'s', async () => {
        const { content, document_state } =
            await open_document(SIBLING_LINES);
        const character = content.split('\n')[5].indexOf('shared');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 5, character },
        );
        const value = hover_value(hover);
        expect(value).toContain('Local Macro');
        expect(value).toContain('Expansion: `2`');
        expect(value).not.toContain('Expansion: `1`');
    });

    it('hover inside a program shows its value over a same-named do-file local (issue repro)', async () => {
        const { content, document_state } = await open_document([
            'program define myprog',   // 0
            '    local x 1',           // 1
            '    display "`x\'"',      // 2
            'end',                     // 3
            'local x 2',               // 4
        ]);
        const character = content.split('\n')[2].indexOf('x\'');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 2, character },
        );
        const value = hover_value(hover);
        expect(value).toContain('Expansion: `1`');
        expect(value).not.toContain('Expansion: `2`');
    });

    it('top-level hover on a program-only local shows nothing', async () => {
        const { content, document_state } = await open_document([
            'program define prog_a',   // 0
            '    local hidden 1',      // 1
            'end',                     // 2
            'di "`hidden\'"',          // 3
        ]);
        const character = content.split('\n')[3].indexOf('hidden');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 3, character },
        );
        expect(hover_value(hover)).not.toContain('Expansion: `1`');
    });

    it('program hover still sees do-file locals (permissive)', async () => {
        const { content, document_state } = await open_document([
            'local top_x 5',       // 0
            'program define p',    // 1
            '    di "`top_x\'"',   // 2
            'end',                 // 3
        ]);
        const character = content.split('\n')[2].indexOf('top_x');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 2, character },
        );
        expect(hover_value(hover)).toContain('Expansion: `5`');
    });
});
