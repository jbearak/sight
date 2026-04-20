import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

type NormalizedDefinitionLocation = {
    uri: string;
    range: { start: { line: number } };
};

function normalize_locations(
    result: Awaited<ReturnType<DefinitionProvider['get_definition']>>
): NormalizedDefinitionLocation[] {
    if (!result) {
        return [];
    }
    const the_locations = Array.isArray(result) ? result : [result];
    return the_locations.map((my_loc) => ({
        uri: my_loc.uri,
        range: { start: { line: my_loc.range.start.line } },
    }));
}

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

    it('fallback path keeps local macros restricted to include chains', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        writeFileSync(lib_path, 'local helper = "lib"\n');

        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(child_path, 'local helper = "child"\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',
            'do "child.do"',
            'local helper = "main"',
            'di "`helper\'"',
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);

        const lib_uri = URI.file(lib_path).toString();
        const child_uri = URI.file(child_path).toString();
        const main_uri = URI.file(main_path).toString();

        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const helper_char = main_content.split('\n')[3].indexOf('helper');
        const result = await provider.get_definition(
            document_state,
            { line: 3, character: helper_char },
            undefined,
            undefined,
            undefined,
            indexer,
            undefined,
        );

        expect(Array.isArray(result)).toBe(true);
        const locations = normalize_locations(result);
        const uris = new Set(locations.map(loc => loc.uri));
        expect(uris.has(main_uri)).toBe(true);
        expect(uris.has(lib_uri)).toBe(true);
        expect(uris.has(child_uri)).toBe(false);
    });

    it('fallback path excludes disjoint program redeclarations', async () => {
        const shared_path = join(test_temp_dir, 'shared.do');
        writeFileSync(
            shared_path,
            'program define helper_prog\n    di "shared"\nend\n'
        );

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        writeFileSync(
            unrelated_path,
            'program define helper_prog\n    di "unrelated"\nend\n'
        );

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'do "shared.do"',
            'helper_prog',
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);

        const shared_uri = URI.file(shared_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();
        const main_uri = URI.file(main_path).toString();

        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const helper_char = main_content.split('\n')[1].indexOf('helper_prog');
        const result = await provider.get_definition(
            document_state,
            { line: 1, character: helper_char },
            indexer.get_all_symbols(),
            undefined,
            undefined,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const uris = new Set(locations.map(loc => loc.uri));
        expect(uris.has(shared_uri)).toBe(true);
        expect(uris.has(unrelated_uri)).toBe(false);
    });
});

describe('Go-to-definition - cross-file chain walking', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: DefinitionProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'goto-def-chain-'));
        indexer = new WorkspaceIndexer();
        const dep_graph = new DependencyGraph();
        indexer.set_dependency_graph(dep_graph);
        provider = new DefinitionProvider();
        document_store = new DocumentStore();

        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        scope_resolver.set_dependency_graph(dep_graph);
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    // Test A: backward directive (@lsp-done-by) — exercises resolved_scope.chain
    //
    // parent.do defines `program say`.
    // child.do re-defines it and carries an @lsp-done-by: "parent.do" directive.
    // Go-to-def from the `say` call in child.do should surface both files.
    it('chain-walk via @lsp-done-by: returns program definitions from parent AND child', async () => {
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'program define say',   // line 0
            '    di "parent"',
            'end',                  // line 2
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            '// @lsp-done-by: "parent.do"', // line 0
            'program define say',            // line 1
            '    di "child"',
            'end',                           // line 3
            'say',                           // line 4 — cursor here
        ].join('\n');
        writeFileSync(child_path, child_content);

        await indexer.initialize([test_temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();

        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        // Cursor on `say` at line 4
        const say_char = child_content.split('\n')[4].indexOf('say');
        const result = await provider.get_definition(
            document_state,
            { line: 4, character: say_char },
            indexer.get_all_symbols(),
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const child_lines = locations
            .filter(loc => loc.uri === child_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        const parent_lines = locations
            .filter(loc => loc.uri === parent_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        // child.do:1 is the child's `program define say`
        expect(child_lines).toContain(1);
        // parent.do:0 is the parent's `program define say`
        expect(parent_lines).toContain(0);
    });

    // Test B: forward include — exercises resolved_scope.forward_call_symbols
    // with effective_type === 'include'.
    //
    // lib.do defines `local helper`.
    // main.do includes lib.do then re-defines `local helper`.
    // Go-to-def from the `` `helper' `` reference should surface both files.
    it('forward-include chain-walk: returns local macro from lib AND main', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local helper = "lib"',  // line 0
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',              // line 0
            'local helper = "main"',         // line 1
            'di "`helper\'"',                // line 2 — cursor here
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
            indexer.get_all_symbols(),
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const main_lines = locations
            .filter(loc => loc.uri === main_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        const lib_lines = locations
            .filter(loc => loc.uri === lib_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        // main.do:1 is the main file's `local helper`
        expect(main_lines).toContain(1);
        // lib.do:0 is the lib file's `local helper`
        expect(lib_lines).toContain(0);
    });

    // Test D: variables follow the same pool rule as programs.
    //
    // Reproduces the fertility_surveys scenario: `cm_birth.do` references
    // `ever_given_birth` and has two dep-graph parents —
    //   (a) `synthetic.do` which directly `gen`s the variable (test harness);
    //   (b) `bh_vars.do` whose own parent `survey.do` also forward-includes
    //       `wm_vars.do`, which forward-calls `ever_given_birth.do` (the real
    //       production chain that defines the variable).
    // Go-to-def should return BOTH dep-graph-reachable declarations, not
    // just the nearer synthetic parent.
    it('sibling callers: go-to-definition pools reachable variable redeclarations across the dep graph', async () => {
        // Production chain: ever_given_birth.do (defines var) is forward-
        // called by wm_vars.do, which is included by survey.do. survey.do
        // then includes bh_vars.do, which does cm_birth.do.
        const var_def_path = join(test_temp_dir, 'ever_given_birth.do');
        writeFileSync(var_def_path, 'gen ever_given_birth = .\n');

        const wm_vars_path = join(test_temp_dir, 'wm_vars.do');
        writeFileSync(wm_vars_path, 'do "ever_given_birth.do"\n');

        const bh_vars_path = join(test_temp_dir, 'bh_vars.do');
        writeFileSync(bh_vars_path, 'do "cm_birth.do"\n');

        const survey_path = join(test_temp_dir, 'survey.do');
        const survey_content = [
            'include "wm_vars.do"',
            'include "bh_vars.do"',
        ].join('\n');
        writeFileSync(survey_path, survey_content);

        // Test harness chain: synthetic.do generates the variable locally
        // and then runs cm_birth.do.
        const synthetic_path = join(test_temp_dir, 'synthetic.do');
        const synthetic_content = [
            'gen ever_given_birth = 1',
            'do "cm_birth.do"',
        ].join('\n');
        writeFileSync(synthetic_path, synthetic_content);

        // Target file with the reference.
        const cm_birth_path = join(test_temp_dir, 'cm_birth.do');
        const cm_birth_content = [
            'replace cm_birth = .a if ever_given_birth == 0',
        ].join('\n');
        writeFileSync(cm_birth_path, cm_birth_content);

        await indexer.initialize([test_temp_dir]);

        const cm_birth_uri = URI.file(cm_birth_path).toString();
        const synthetic_uri = URI.file(synthetic_path).toString();
        const var_def_uri = URI.file(var_def_path).toString();

        await document_store.open(cm_birth_uri, cm_birth_content, 1);
        const document_state = document_store.get(cm_birth_uri)!;

        const egb_char = cm_birth_content.indexOf('ever_given_birth');
        const result = await provider.get_definition(
            document_state,
            { line: 0, character: egb_char },
            indexer.get_all_symbols(),
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );

        const locations = Array.isArray(result) ? result : (result ? [result] : []);
        const uris = new Set(locations.map(loc => loc.uri));
        // Both dep-graph-reachable declarations should be included.
        expect(uris.has(var_def_uri)).toBe(true);
        expect(uris.has(synthetic_uri)).toBe(true);
    });

    // Test C: sibling callers in the dep graph. Earlier and later both reach
    // the same child, so same-name program declarations pool into one
    // identity across the connected component.
    it('sibling callers: go-to-definition pools reachable program redeclarations across the dep graph', async () => {
        const earlier_path = join(test_temp_dir, 'earlier.do');
        const earlier_content = [
            'program define shared_prog', // line 0
            '    di "earlier"',
            'end',                        // line 2
            'do "child.do"',             // line 3
            'shared_prog',                // line 4 — cursor here
        ].join('\n');
        writeFileSync(earlier_path, earlier_content);

        const later_path = join(test_temp_dir, 'later.do');
        const later_content = [
            'program define shared_prog', // line 0
            '    di "later"',
            'end',                       // line 2
            'do "child.do"',            // line 3
        ].join('\n');
        writeFileSync(later_path, later_content);

        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(child_path, 'di "child"\n');

        await indexer.initialize([test_temp_dir]);

        const earlier_uri = URI.file(earlier_path).toString();
        const later_uri = URI.file(later_path).toString();

        await document_store.open(earlier_uri, earlier_content, 1);
        const document_state = document_store.get(earlier_uri)!;

        const shared_char = earlier_content.split('\n')[4].indexOf('shared_prog');
        const result = await provider.get_definition(
            document_state,
            { line: 4, character: shared_char },
            indexer.get_all_symbols(),
            undefined,
            scope_resolver,
            indexer,
            undefined,
        );

        expect(Array.isArray(result)).toBe(true);
        const locations = normalize_locations(result);
        const uris = new Set(locations.map(loc => loc.uri));
        expect(uris.has(earlier_uri)).toBe(true);
        expect(uris.has(later_uri)).toBe(true);
    });
});
