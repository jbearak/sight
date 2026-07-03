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
import { ReferencesProvider } from '../../src/providers/references';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { CommandDatabase } from '../../src/command-database';
import { CompletionProvider } from '../../src/providers/completion';
import { SymbolProvider } from '../../src/providers/symbols';
import { as_locations } from '../property/helpers/document-utils';

const SIBLING_LINES = [
    'program define prog_a',   // 0
    '    local shared 1',      // 1
    'end',                     // 2
    'program define prog_b',   // 3
    '    local shared 2',      // 4
    '    di "`shared\'"',      // 5
    'end',                     // 6
];


interface ScopedTestHarness {
    test_temp_dir: string;
    indexer: WorkspaceIndexer;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    document_store: DocumentStore;
    dispose(): void;
}

/**
 * One fully-wired pipeline per test: temp workspace, indexer +
 * dependency graph, scope/forward resolvers, document store, and a
 * single dispose. Shared by every describe block so the wiring and
 * teardown cannot drift between the per-round regression suites
 * (blocks that don't need the resolver simply don't use it).
 */
function create_scoped_test_harness(prefix: string): ScopedTestHarness {
    const test_temp_dir = mkdtempSync(join(tmpdir(), prefix));
    const indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    indexer.set_dependency_graph(the_dep_graph);
    const scope_resolver = new ScopeResolver();
    scope_resolver.set_dependency_graph(the_dep_graph);
    const forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
        max_forward_depth: 10,
    });
    scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    return {
        test_temp_dir,
        indexer,
        scope_resolver,
        forward_scope_resolver,
        document_store: new DocumentStore(),
        dispose(): void {
            try { scope_resolver.dispose(); } catch { /* disposed */ }
            try { forward_scope_resolver.dispose(); } catch { /* disposed */ }
            if (existsSync(test_temp_dir)) {
                rmSync(test_temp_dir, { recursive: true, force: true });
            }
        },
    };
}

describe('scoped local macros: go-to-definition (#270)', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-def-');
        ({ test_temp_dir, indexer, document_store } = harness);
        provider = new DefinitionProvider();
    });

    afterEach(() => {
        harness.dispose();
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
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-hover-');
        ({ test_temp_dir, document_store } = harness);
        hover_provider = new HoverProvider(new CommandDatabase());
    });

    afterEach(() => {
        harness.dispose();
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

describe('scoped local macros: find-references (#270)', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let references_provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-refs-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
        references_provider = new ReferencesProvider(scope_resolver);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        return { uri, content, file_path };
    }

    it('references inside prog_b exclude prog_a\'s same-named local (issue repro)', async () => {
        const { uri, content } = await open_file('a.do', [
            'program define a',        // 0
            '    local shared 1',      // 1
            '    di "`shared\'"',      // 2
            'end',                     // 3
            'program define b',        // 4
            '    local shared 2',      // 5
            '    display `shared\'',   // 6
            'end',                     // 7
        ]);
        await indexer.initialize([test_temp_dir]);
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[6].indexOf('shared');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 6, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line)
            .sort((a, b) => a - b);
        expect(the_lines).toEqual([5, 6]);
    });

    it('do-file target excludes occurrences inside a shadowing program', async () => {
        const { uri, content } = await open_file('a.do', [
            'local x top',             // 0
            'di "`x\'"',               // 1
            'program define shadow',   // 2
            '    local x body',        // 3
            '    di "`x\'"',           // 4
            'end',                     // 5
            'program define open_p',   // 6
            '    di "`x\'"',           // 7 (permissive: sees do-file x)
            'end',                     // 8
        ]);
        await indexer.initialize([test_temp_dir]);
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[1].indexOf('x');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 1, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line)
            .sort((a, b) => a - b);
        expect(the_lines).toEqual([0, 1, 7]);
    });

    it('top-level reference to a program-only local never pools the program\'s sites', async () => {
        // The out-of-scope reference's identity class is "resolves to
        // no same-file symbol" (a cross-file inherited local, or plain
        // undefined) — its own occurrence is included, the sibling
        // program's declaration and occurrences never are.
        const { uri, content } = await open_file('a.do', [
            'program define prog_a',   // 0
            '    local hidden 1',      // 1
            '    di "`hidden\'"',      // 2
            'end',                     // 3
            'di "`hidden\'"',          // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[4].indexOf('hidden');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 4, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line)
            .sort((a, b) => a - b);
        expect(the_lines).toEqual([4]);
    });

    it('program-scoped target skips the cross-file scan entirely', async () => {
        await open_file('lib.do', [
            'local helper lib',    // 0
            'di "`helper\'"',      // 1
        ]);
        const { uri, content } = await open_file('main.do', [
            'include "lib.do"',        // 0
            'program define p',        // 1
            '    local helper 1',      // 2
            '    di "`helper\'"',      // 3
            'end',                     // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[3].indexOf('helper');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 3, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_uris = new Set(the_locations.map(my_loc => my_loc.uri));
        expect(the_uris).toEqual(new Set([uri]));
        const the_lines = the_locations
            .map(my_loc => my_loc.range.start.line)
            .sort((a, b) => a - b);
        expect(the_lines).toEqual([2, 3]);
    });

    it('do-file target keeps the include-chain scan (regression guard)', async () => {
        const lib = await open_file('lib.do', [
            'local helper lib',    // 0
            'di "`helper\'"',      // 1
        ]);
        const { uri, content } = await open_file('main.do', [
            'include "lib.do"',        // 0
            'local helper main',       // 1
            'di "`helper\'"',          // 2
        ]);
        await indexer.initialize([test_temp_dir]);
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[2].indexOf('helper');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 2, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_uris = new Set(the_locations.map(my_loc => my_loc.uri));
        expect(the_uris.has(uri)).toBe(true);
        expect(the_uris.has(lib.uri)).toBe(true);
    });
});

describe('scoped local macros: completion (#270)', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let completion_provider: CompletionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-comp-');
        ({ test_temp_dir, document_store } = harness);
        completion_provider = new CompletionProvider(new CommandDatabase());
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_document(lines: string[]) {
        const file_path = join(test_temp_dir, 'a.do');
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        await document_store.wait_for_update(uri);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('offers prog_b\'s local even when prog_a\'s owns the flat slot (lost-completion regression)', async () => {
        const { document_state } = await open_document([
            'program define prog_a',   // 0
            '    local shared 1',      // 1
            'end',                     // 2
            'program define prog_b',   // 3
            '    local shared 2',      // 4
            '    di "`s',              // 5 — cursor after the prefix
            'end',                     // 6
        ]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 5, character: 10 },
            '`',
        );
        const the_shared = the_completions.find(
            my_item => my_item.label === 'shared'
        );
        expect(the_shared).toBeDefined();
        expect(the_shared!.documentation).toBe('Value: 2');
    });

    it('does not offer a sibling program\'s local', async () => {
        const { document_state } = await open_document([
            'program define prog_a',   // 0
            '    local only_a 1',      // 1
            'end',                     // 2
            'program define prog_b',   // 3
            '    di "`o',              // 4
            'end',                     // 5
        ]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 4, character: 10 },
            '`',
        );
        expect(
            the_completions.map(my_item => my_item.label)
        ).not.toContain('only_a');
    });

    it('offers do-file locals inside a program (permissive)', async () => {
        const { document_state } = await open_document([
            'local top_x 5',       // 0
            'program define p',    // 1
            '    di "`t',          // 2
            'end',                 // 3
        ]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 2, character: 10 },
            '`',
        );
        expect(
            the_completions.map(my_item => my_item.label)
        ).toContain('top_x');
    });

    it('does not offer program-only locals at top level', async () => {
        const { document_state } = await open_document([
            'local top_ok 1',          // 0
            'program define prog_a',   // 1
            '    local hidden 1',      // 2
            'end',                     // 3
            'di "`',                   // 4
        ]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 4, character: 5 },
            '`',
        );
        const the_labels = the_completions.map(my_item => my_item.label);
        // Positive baseline: the bare-signature top-level surface is
        // alive (a broken empty list would make the exclusion below
        // pass vacuously).
        expect(the_labels).toContain('top_ok');
        expect(the_labels).not.toContain('hidden');
    });
});

describe('scoped local macros: document symbols / workspace search (#270)', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let symbol_provider: SymbolProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-syms-');
        ({ test_temp_dir, document_store } = harness);
        symbol_provider = new SymbolProvider();
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_document(lines: string[]) {
        const file_path = join(test_temp_dir, 'a.do');
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('outline lists every scope\'s same-named local, nested correctly', async () => {
        const { document_state } = await open_document(SIBLING_LINES);
        const the_symbols =
            symbol_provider.get_document_symbols(document_state);
        const prog_a = the_symbols.find(my_sym => my_sym.name === 'prog_a');
        const prog_b = the_symbols.find(my_sym => my_sym.name === 'prog_b');
        expect(prog_a?.children?.map(my_child => my_child.name))
            .toContain("`shared'");
        expect(prog_b?.children?.map(my_child => my_child.name))
            .toContain("`shared'");
    });

    it('workspace symbol search surfaces both same-named locals', async () => {
        const { document_state } = await open_document(SIBLING_LINES);
        const the_symbols = symbol_provider.get_workspace_symbols(
            'shared',
            [document_state],
        );
        const the_local_lines = the_symbols
            .filter(my_sym => my_sym.name === "`shared'")
            .map(my_sym => my_sym.location.range.start.line)
            .sort((a, b) => a - b);
        expect(the_local_lines).toEqual([1, 4]);
    });
});

describe('scoped local macros: definition ignores cross-file hits for program locals (#270)', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-def-xfile-');
        ({ test_temp_dir, indexer, document_store } = harness);
        provider = new DefinitionProvider();
    });

    afterEach(() => {
        harness.dispose();
    });

    it('program-scoped target returns only its own declaration', async () => {
        writeFileSync(
            join(test_temp_dir, 'lib.do'),
            'local helper lib\n'
        );
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',        // 0
            'program define p',        // 1
            '    local helper 1',      // 2
            '    di "`helper\'"',      // 3
            'end',                     // 4
        ].join('\n');
        writeFileSync(main_path, main_content);
        await indexer.initialize([test_temp_dir]);
        const uri = URI.file(main_path).toString();
        await document_store.open(uri, main_content, 1);
        const character = main_content.split('\n')[3].indexOf('helper');
        const result = await provider.get_definition(
            document_store.get(uri)!,
            { line: 3, character },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );
        const the_locations = as_locations(result);
        expect(new Set(the_locations.map(my_loc => my_loc.uri)))
            .toEqual(new Set([uri]));
        expect(the_locations.map(my_loc => my_loc.range.start.line))
            .toEqual([2]);
    });
});

// Round-1 gate regressions (#270 review findings).
describe('scoped local macros: round-1 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate-');
        ({ test_temp_dir, document_store } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('hover before a program-local definition shows the do-file value (forward order)', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        const { content, document_state } = await open_file('a.do', [
            'local x top',         // 0
            'program define p',    // 1
            '    di "`x\'"',       // 2 — before the program definition
            '    local x body',    // 3
            'end',                 // 4
        ]);
        const character = content.split('\n')[2].indexOf('x\'');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 2, character },
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `top`');
        expect(value).not.toContain('Expansion: `body`');
    });

    it('completion before a program-local definition offers the do-file symbol', async () => {
        const completion_provider =
            new CompletionProvider(new CommandDatabase());
        const { document_state } = await open_file('a.do', [
            'local x top',         // 0
            'program define p',    // 1
            '    di "`',           // 2 — cursor after the backtick
            '    local x body',    // 3
            'end',                 // 4
        ]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 2, character: 9 },
            '`',
        );
        const the_item = the_completions.find(
            my_item => my_item.label === 'x'
        );
        expect(the_item).toBeDefined();
        expect(the_item!.documentation).toBe('Value: top');
    });

    it('program-scoped hover footer never cites cross-file same-name locals', async () => {
        const indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local helper lib\n');
        const { content, document_state } = await open_file('main.do', [
            'include "lib.do"',        // 0
            'program define p',        // 1
            '    local helper 1',      // 2
            '    di "`helper\'"',      // 3
            'end',                     // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[3].indexOf('helper');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 3, character },
            undefined,
            undefined,
            undefined,
            undefined,
            test_temp_dir,
            indexer,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `1`');
        expect(value).not.toContain('Redefined');
        expect(value).not.toContain('other file');
    });

    it('redeclared program bodies each nest their own locals in the outline', async () => {
        const symbol_provider = new SymbolProvider();
        const { document_state } = await open_file('a.do', [
            'program define p',    // 0
            '    local a 1',       // 1
            'end',                 // 2
            'program define p',    // 3
            '    local b 2',       // 4
            'end',                 // 5
        ]);
        const the_symbols =
            symbol_provider.get_document_symbols(document_state);
        const the_program_nodes = the_symbols.filter(
            my_sym => my_sym.name === 'p' && my_sym.detail === 'Program'
        );
        expect(the_program_nodes).toHaveLength(2);
        const the_nested_names = the_program_nodes.flatMap(
            my_node => (my_node.children ?? []).map(my_child => my_child.name)
        );
        expect(the_nested_names).toContain("`a'");
        expect(the_nested_names).toContain("`b'");
        // Neither local floats to the top level.
        const the_top_level_names = the_symbols.map(my_sym => my_sym.name);
        expect(the_top_level_names).not.toContain("`a'");
        expect(the_top_level_names).not.toContain("`b'");
    });

    it('a program\'s own local wins completion over a cross-file merged slot', async () => {
        const indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        const completion_provider =
            new CompletionProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local helper lib\n');
        const { document_state } = await open_file('main.do', [
            'include "lib.do"',        // 0
            'program define p',        // 1
            '    local helper 1',      // 2
            '    di "`h',              // 3
            'end',                     // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 3, character: 10 },
            '`',
            undefined,
            indexer.get_all_symbols(),
        );
        const the_item = the_completions.find(
            my_item => my_item.label === 'helper'
        );
        expect(the_item).toBeDefined();
        expect(the_item!.documentation).toBe('Value: 1');
    });
});

// Round-2 gate regressions (#270): an out-of-scope same-file name must
// still resolve to a cross-file INHERITED do-file local (the analyzer's
// cross-file suppression treats it as defined), and a visible
// program-scoped local must pre-empt the out-of-scope hover display.
describe('scoped local macros: round-2 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate2-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    const PARENT_LINES = [
        'local flag 1',        // 0
        'include "child.do"',  // 1
    ];
    const CHILD_LINES = [
        'program define foo',  // 0
        '    local flag 9',    // 1
        'end',                 // 2
        'display `flag\'',     // 3
    ];

    it('hover: sibling program name does not suppress an inherited do-file local', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        const parent_path = join(test_temp_dir, 'parent.do');
        writeFileSync(parent_path, PARENT_LINES.join('\n'));
        const { content, document_state } =
            await open_file('child.do', CHILD_LINES);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[3].indexOf('flag');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 3, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `1`');
        expect(value).not.toContain('Expansion: `9`');
    });

    it('definition: inherited do-file local resolves cross-file, never to the sibling program', async () => {
        const definition_provider = new DefinitionProvider();
        const parent_path = join(test_temp_dir, 'parent.do');
        writeFileSync(parent_path, PARENT_LINES.join('\n'));
        const { uri, content, document_state } =
            await open_file('child.do', CHILD_LINES);
        await indexer.initialize([test_temp_dir]);
        const parent_uri = URI.file(parent_path).toString();
        const character = content.split('\n')[3].indexOf('flag');
        const result = await definition_provider.get_definition(
            document_state,
            { line: 3, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        const the_locations = as_locations(result);
        expect(
            the_locations.some(
                my_loc => my_loc.uri === parent_uri &&
                    my_loc.range.start.line === 0
            )
        ).toBe(true);
        expect(
            the_locations.some(my_loc => my_loc.uri === uri)
        ).toBe(false);
    });

    it('references: inherited do-file local pools cross-file sites, never the sibling program\'s', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        const parent_path = join(test_temp_dir, 'parent.do');
        writeFileSync(parent_path, PARENT_LINES.join('\n'));
        const { uri, content, document_state } =
            await open_file('child.do', CHILD_LINES);
        await indexer.initialize([test_temp_dir]);
        const parent_uri = URI.file(parent_path).toString();
        const character = content.split('\n')[3].indexOf('flag');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 3, character },
            { includeDeclaration: true },
            indexer,
        );
        const child_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        const parent_lines = the_locations
            .filter(my_loc => my_loc.uri === parent_uri)
            .map(my_loc => my_loc.range.start.line);
        expect(child_lines).toEqual([3]);
        expect(parent_lines).toContain(0);
        expect(child_lines).not.toContain(1);
    });

    it('completion: forward-included do-file local offered despite a sibling program reusing the name', async () => {
        const completion_provider =
            new CompletionProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local hidden lib\n');
        const { document_state } = await open_file('main.do', [
            'include "lib.do"',        // 0
            'program define p',        // 1
            '    local hidden prog',   // 2
            'end',                     // 3
            'di "`h',                  // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 4, character: 6 },
            '`',
            scope_resolver,
            indexer.get_all_symbols(),
        );
        const the_item = the_completions.find(
            my_item => my_item.label === 'hidden'
        );
        expect(the_item).toBeDefined();
        expect(the_item!.documentation).toBe('Value: lib');
    });

    it('hover: visible program local pre-empts the out-of-scope display', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        const parent_path = join(test_temp_dir, 'parent.do');
        writeFileSync(parent_path, [
            'local x 5',          // 0
            'do "child.do"',      // 1
        ].join('\n'));
        const { content, document_state } = await open_file('child.do', [
            'program define p',    // 0
            '    local x 1',       // 1
            '    di "`x\'"',       // 2
            'end',                 // 3
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[2].indexOf('x\'');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 2, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `1`');
        expect(value).not.toContain('(out of scope)');
    });
});

// Round-3 gate regressions (#270): inherited-local lookups must apply
// effective-scope precedence (last executed include wins and overrides
// the backward chain; nearer parents beat farther ancestors), and an
// out-of-scope cursor with NO inherited target must not surface
// same-named program-body usages from include-related files.
describe('scoped local macros: round-3 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate3-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('hover: the LAST executed include wins for an out-of-scope name', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'a.do'), 'local flag A\n');
        writeFileSync(join(test_temp_dir, 'b.do'), 'local flag B\n');
        const { content, document_state } = await open_file('main.do', [
            'include "a.do"',          // 0
            'include "b.do"',          // 1
            'program define p',        // 2
            '    local flag prog',     // 3
            'end',                     // 4
            'di "`flag\'"',            // 5
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[5].indexOf('flag');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 5, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `B`');
        expect(value).not.toContain('Expansion: `A`');
    });

    it('hover: the nearer included-by parent wins over the grandparent', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'grandparent.do'), [
            'local flag G',
            'include "parent.do"',
        ].join('\n'));
        writeFileSync(join(test_temp_dir, 'parent.do'), [
            'local flag P',
            'include "child.do"',
        ].join('\n'));
        const { content, document_state } = await open_file('child.do', [
            'program define foo',   // 0
            '    local flag 9',     // 1
            'end',                  // 2
            'di "`flag\'"',         // 3
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[3].indexOf('flag');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 3, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `P`');
        expect(value).not.toContain('Expansion: `G`');
    });

    it('references: no inherited target means no cross-file usages of a different macro', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        writeFileSync(join(test_temp_dir, 'child.do'), [
            'program define b',     // 0
            '    local foo 1',      // 1
            '    di "`foo\'"',      // 2
            'end',                  // 3
        ].join('\n'));
        const { uri, content, document_state } = await open_file('main.do', [
            'include "child.do"',   // 0
            'program define a',     // 1
            '    local foo 2',      // 2
            'end',                  // 3
            'di "`foo\'"',          // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[4].indexOf('foo');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 4, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_uris = new Set(the_locations.map(my_loc => my_loc.uri));
        expect(the_uris).toEqual(new Set([uri]));
        expect(
            the_locations.map(my_loc => my_loc.range.start.line)
        ).toEqual([4]);
    });
});

// Round-4 gate regressions (#270): definition's out-of-scope path must
// return exactly the call-line-gated inherited winner (no multi-include
// pooling, no not-yet-executed includes), and backward inheritance must
// follow the EFFECTIVE call type, not the written directive type.
describe('scoped local macros: round-4 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate4-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('definition: out-of-scope name resolves to the single last-include winner', async () => {
        const definition_provider = new DefinitionProvider();
        const a_path = join(test_temp_dir, 'a.do');
        const b_path = join(test_temp_dir, 'b.do');
        writeFileSync(a_path, 'local flag A\n');
        writeFileSync(b_path, 'local flag B\n');
        const { content, document_state } = await open_file('main.do', [
            'include "a.do"',          // 0
            'include "b.do"',          // 1
            'program define p',        // 2
            '    local flag prog',     // 3
            'end',                     // 4
            'di "`flag\'"',            // 5
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[5].indexOf('flag');
        const result = await definition_provider.get_definition(
            document_state,
            { line: 5, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        const the_locations = as_locations(result);
        expect(new Set(the_locations.map(my_loc => my_loc.uri)))
            .toEqual(new Set([URI.file(b_path).toString()]));
    });

    it('definition: an include AFTER the reference is not yet inherited', async () => {
        const definition_provider = new DefinitionProvider();
        writeFileSync(join(test_temp_dir, 'has_x.do'), 'local x lib\n');
        const { content, document_state } = await open_file('main.do', [
            'program define p',    // 0
            '    di "`x\'"',       // 1 — before the include executes
            '    local x own',     // 2 (makes p shadow later; keep simple)
            'end',                 // 3
            'di "`x\'"',           // 4 — still before the include
            'include "has_x.do"',  // 5
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[4].indexOf('x\'');
        const result = await definition_provider.get_definition(
            document_state,
            { line: 4, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        expect(as_locations(result)).toEqual([]);
    });

    it('hover: a done-by directive whose parent actually includes inherits locals (effective type)', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'parent.do'), [
            'local flag P',
            'include "child.do"',
        ].join('\n'));
        const { content, document_state } = await open_file('child.do', [
            '// @lsp-done-by: "parent.do"',  // 0
            'program define foo',            // 1
            '    local flag 9',              // 2
            'end',                           // 3
            'di "`flag\'"',                  // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[4].indexOf('flag');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 4, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `P`');
    });
});

// Round-5 gate regressions (#270): exclude-mode occurrences must share
// the cursor's per-line inherited identity (pre-include occurrences are
// a different resolution class), and the inherited hover footer must
// not present the out-of-scope sibling program-local as a redefinition.
describe('scoped local macros: round-5 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate5-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    const PRE_POST_INCLUDE_LINES = [
        'program define a',     // 0
        '    local x own',      // 1
        'end',                  // 2
        'di "`x\'"',            // 3 — before the include: plain undefined
        'include "lib.do"',     // 4
        'di "`x\'"',            // 5 — after the include: lib's x
    ];

    it('references: a pre-include occurrence is not grouped with post-include references', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local x lib\n');
        const { uri, content, document_state } =
            await open_file('main.do', PRE_POST_INCLUDE_LINES);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[5].indexOf('x\'');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 5, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toContain(5);
        expect(the_lines).not.toContain(3);
        expect(the_lines).not.toContain(1);
    });

    it('references: a plain-undefined cursor excludes post-include occurrences', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local x lib\n');
        const { uri, content, document_state } =
            await open_file('main.do', PRE_POST_INCLUDE_LINES);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[3].indexOf('x\'');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 3, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toContain(3);
        expect(the_lines).not.toContain(5);
    });

    it('hover: inherited footer never cites the out-of-scope sibling program-local', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'parent.do'), [
            'local flag P',
            'include "child.do"',
        ].join('\n'));
        const { content, document_state } = await open_file('child.do', [
            'program define foo',   // 0
            '    local flag 9',     // 1
            'end',                  // 2
            'di "`flag\'"',         // 3
        ]);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[3].indexOf('flag');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 3, character },
            undefined,
            scope_resolver,
            undefined,
            undefined,
            test_temp_dir,
            indexer,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `P`');
        expect(value).not.toContain('Redefined');
    });
});

// Round-6 gate regression (#270): in exclude-mode with an inherited
// winner, includeDeclaration must surface exactly the winner's
// declaration — never a superseded earlier include's.
describe('scoped local macros: round-6 gate regression', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate6-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    it('references: out-of-scope pooling is winner-only', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        const a_path = join(test_temp_dir, 'a.do');
        const b_path = join(test_temp_dir, 'b.do');
        writeFileSync(a_path, 'local flag A\n');
        writeFileSync(b_path, 'local flag B\n');
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "a.do"',          // 0
            'include "b.do"',          // 1
            'program define p',        // 2
            '    local flag prog',     // 3
            'end',                     // 4
            'di "`flag\'"',            // 5
        ].join('\n');
        writeFileSync(main_path, main_content);
        await indexer.initialize([test_temp_dir]);
        const uri = URI.file(main_path).toString();
        await document_store.open(uri, main_content, 1);
        const character = main_content.split('\n')[5].indexOf('flag');
        const the_locations = await references_provider.get_references(
            document_store.get(uri)!,
            { line: 5, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_uris = the_locations.map(my_loc => my_loc.uri);
        expect(the_uris).toContain(URI.file(b_path).toString());
        expect(the_uris).not.toContain(URI.file(a_path).toString());
        const main_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(main_lines).toEqual([5]);
    });
});

// Round-8 gate regression (#270): outline PLACEMENT is geometric (the
// DocumentSymbol tree is a range-containment view — a top-level entry
// ranged inside a program container would overlap a sibling on the
// wire), while ENUMERATION stays ownership-based.
describe('scoped local macros: round-8 gate regression', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate8-');
        ({ test_temp_dir, document_store } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    it('a directive-declared do-file local inside a program body nests geometrically', async () => {
        const symbol_provider = new SymbolProvider();
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'program define p',        // 0
            '    // @lsp-local ghost', // 1 — do-file-owned, ranged in p
            '    local x 1',           // 2
            'end',                     // 3
        ].join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const the_symbols = symbol_provider.get_document_symbols(
            document_store.get(uri)!
        );
        const program_node = the_symbols.find(
            my_sym => my_sym.name === 'p' && my_sym.detail === 'Program'
        );
        const the_children = (program_node?.children ?? []).map(
            my_child => my_child.name
        );
        expect(the_children).toContain("`ghost'");
        expect(the_children).toContain("`x'");
        // Wire-shape invariant: no top-level local sits inside the
        // program container's range.
        const the_top_level_locals = the_symbols.filter(
            my_sym => my_sym.detail === 'Local Macro'
        );
        expect(the_top_level_locals).toEqual([]);
    });
});

// Round-9 gate regressions (#270): a cross-file INHERITED do-file
// local outranks a same-scope FORWARD identity target — the analyzer's
// cross-file suppression treats the pre-definition reference as
// defined via the inherited symbol.
describe('scoped local macros: round-9 gate regressions', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate9-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    async function open_file(name: string, lines: string[]) {
        const file_path = join(test_temp_dir, name);
        const content = lines.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    const FORWARD_VS_INHERITED = [
        'include "lib.do"',     // 0
        'program define p',     // 1
        '    display "`x\'"',   // 2 — before the program-local def
        '    local x body',     // 3
        '    display "`x\'"',   // 4 — after: the program local
        'end',                  // 5
    ];

    it('hover: inherited do-file local outranks the not-yet-defined program local', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local x lib\n');
        const { content, document_state } =
            await open_file('main.do', FORWARD_VS_INHERITED);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[2].indexOf('x\'');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 2, character },
            undefined,
            scope_resolver,
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Expansion: `lib`');
        expect(value).not.toContain('Expansion: `body`');
    });

    it('definition: pre-definition reference resolves to the inherited declaration', async () => {
        const definition_provider = new DefinitionProvider();
        const lib_path = join(test_temp_dir, 'lib.do');
        writeFileSync(lib_path, 'local x lib\n');
        const { uri, content, document_state } =
            await open_file('main.do', FORWARD_VS_INHERITED);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[2].indexOf('x\'');
        const result = await definition_provider.get_definition(
            document_state,
            { line: 2, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        const the_locations = as_locations(result);
        expect(new Set(the_locations.map(my_loc => my_loc.uri)))
            .toEqual(new Set([URI.file(lib_path).toString()]));
        expect(
            the_locations.some(my_loc => my_loc.uri === uri)
        ).toBe(false);
    });

    it('references: pre-definition reference groups with the inherited local, not the program\'s', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        const lib_path = join(test_temp_dir, 'lib.do');
        writeFileSync(lib_path, 'local x lib\n');
        const { uri, content, document_state } =
            await open_file('main.do', FORWARD_VS_INHERITED);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[2].indexOf('x\'');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 2, character },
            { includeDeclaration: true },
            indexer,
        );
        const main_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(main_lines).toEqual([2]);
        expect(
            the_locations.some(
                my_loc => my_loc.uri === URI.file(lib_path).toString()
            )
        ).toBe(true);
    });

    it('references: post-definition reference stays with the program local', async () => {
        const references_provider = new ReferencesProvider(scope_resolver);
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local x lib\n');
        const { uri, content, document_state } =
            await open_file('main.do', FORWARD_VS_INHERITED);
        await indexer.initialize([test_temp_dir]);
        const character = content.split('\n')[4].indexOf('x\'');
        const the_locations = await references_provider.get_references(
            document_state,
            { line: 4, character },
            { includeDeclaration: true },
            indexer,
        );
        const the_uris = new Set(the_locations.map(my_loc => my_loc.uri));
        expect(the_uris).toEqual(new Set([uri]));
        const main_lines = the_locations
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line)
            .sort((a, b) => a - b);
        expect(main_lines).toEqual([3, 4]);
    });

    it('completion: inherited do-file local offered before the program-local definition', async () => {
        const completion_provider =
            new CompletionProvider(new CommandDatabase());
        writeFileSync(join(test_temp_dir, 'lib.do'), 'local x lib\n');
        const { document_state } = await open_file('main.do', [
            'include "lib.do"',     // 0
            'program define p',     // 1
            '    di "`',            // 2 — before the program-local def
            '    local x body',     // 3
            'end',                  // 4
        ]);
        await indexer.initialize([test_temp_dir]);
        const the_completions = await completion_provider.get_completions(
            document_state,
            { line: 2, character: 9 },
            '`',
            scope_resolver,
        );
        const the_item = the_completions.find(
            my_item => my_item.label === 'x'
        );
        expect(the_item).toBeDefined();
        expect(the_item!.documentation).toBe('Value: lib');
    });
});

// Round-10 gate regression (#270): a FORWARD do-file local (defined
// after the cursor) also defers to the inherited winner — definition
// must return only the last include's declaration, not pool every
// prior include.
describe('scoped local macros: round-10 gate regression', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate10-');
        ({
            test_temp_dir, indexer, scope_resolver,
            forward_scope_resolver, document_store,
        } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    it('definition: forward do-file local defers to the single inherited winner', async () => {
        const definition_provider = new DefinitionProvider();
        const a_path = join(test_temp_dir, 'a.do');
        const b_path = join(test_temp_dir, 'b.do');
        writeFileSync(a_path, 'local x A\n');
        writeFileSync(b_path, 'local x B\n');
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "a.do"',   // 0
            'include "b.do"',   // 1
            'di "`x\'"',        // 2 — before the same-file def
            'local x own',      // 3
        ].join('\n');
        writeFileSync(main_path, main_content);
        await indexer.initialize([test_temp_dir]);
        const uri = URI.file(main_path).toString();
        await document_store.open(uri, main_content, 1);
        const character = main_content.split('\n')[2].indexOf('x\'');
        const result = await definition_provider.get_definition(
            document_store.get(uri)!,
            { line: 2, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        const the_locations = as_locations(result);
        expect(new Set(the_locations.map(my_loc => my_loc.uri)))
            .toEqual(new Set([URI.file(b_path).toString()]));
    });

    it('definition: forward do-file local with no includes keeps identity navigation', async () => {
        const definition_provider = new DefinitionProvider();
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'di "`x\'"',        // 0 — before the def
            'local x own',      // 1
        ].join('\n');
        writeFileSync(main_path, main_content);
        await indexer.initialize([test_temp_dir]);
        const uri = URI.file(main_path).toString();
        await document_store.open(uri, main_content, 1);
        const character = main_content.split('\n')[0].indexOf('x\'');
        const result = await definition_provider.get_definition(
            document_store.get(uri)!,
            { line: 0, character },
            undefined,
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );
        const the_lines = as_locations(result)
            .filter(my_loc => my_loc.uri === uri)
            .map(my_loc => my_loc.range.start.line);
        expect(the_lines).toEqual([1]);
    });
});

// Round-13 gate regression (#270): embedded-language macro paths must
// preserve delimiter intent — an explicit local reference whose local
// resolution is rejected must not fall through to the GLOBAL namespace.
describe('scoped local macros: round-13 gate regression', () => {
    let harness: ScopedTestHarness;
    let test_temp_dir: string;
    let document_store: DocumentStore;

    beforeEach(() => {
        harness = create_scoped_test_harness('scoped-gate13-');
        ({ test_temp_dir, document_store } = harness);
    });

    afterEach(() => {
        harness.dispose();
    });

    const MATA_LINES = [
        'global x 42',           // 0
        'program define sibling',// 1
        '    local x 7',         // 2
        'end',                   // 3
        'mata:',                 // 4
        'y = `x\'',              // 5 — explicit LOCAL ref, out of scope
        'end',                   // 6
    ];

    async function open_document() {
        const file_path = join(test_temp_dir, 'a.do');
        const content = MATA_LINES.join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        return { uri, content, document_state: document_store.get(uri)! };
    }

    it('hover: an out-of-scope local ref in Mata never shows the global', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        const { content, document_state } = await open_document();
        const character = content.split('\n')[5].indexOf('x\'');
        const hover = await hover_provider.get_hover(
            document_state,
            { line: 5, character },
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).not.toContain('Global Macro');
        expect(value).not.toContain('42');
    });

    it('definition: an out-of-scope local ref in Mata never jumps to the global', async () => {
        const definition_provider = new DefinitionProvider();
        const { content, document_state } = await open_document();
        const character = content.split('\n')[5].indexOf('x\'');
        const result = await definition_provider.get_definition(
            document_state,
            { line: 5, character },
        );
        expect(as_locations(result)).toEqual([]);
    });

    it('hover: an explicit GLOBAL ref in Mata still resolves', async () => {
        const hover_provider = new HoverProvider(new CommandDatabase());
        const file_path = join(test_temp_dir, 'b.do');
        const content = [
            'global x 42',   // 0
            'mata:',         // 1
            'y = $x',        // 2
            'end',           // 3
        ].join('\n');
        writeFileSync(file_path, content);
        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const character = content.split('\n')[2].indexOf('x');
        const hover = await hover_provider.get_hover(
            document_store.get(uri)!,
            { line: 2, character },
        );
        const value = (hover?.contents as { value?: string })?.value ?? '';
        expect(value).toContain('Global Macro');
    });
});
