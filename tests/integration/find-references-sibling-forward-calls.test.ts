/**
 * Find-references: sibling forward calls (issue #132).
 *
 * Each scenario runs in two modes:
 * - 'explicit': fixture files carry @lsp-done-by / @lsp-included-by /
 *   @lsp-do / @lsp-include / @lsp-run directives as appropriate.
 * - 'auto':     no directives; DependencyGraph auto-discovers relationships.
 *
 * Both modes must produce identical reference results.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

type DirectiveMode = 'explicit' | 'auto';
const THE_MODES: readonly DirectiveMode[] = ['explicit', 'auto'] as const;

interface FixtureFile {
    name: string;
    explicit: string;
    auto: string;
}

function build_pipeline() {
    const the_indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    the_indexer.set_dependency_graph(the_dep_graph);

    const the_scope_resolver = new ScopeResolver();
    the_scope_resolver.set_dependency_graph(the_dep_graph);

    const the_forward_resolver = new ForwardScopeResolver(the_scope_resolver, {
        max_forward_depth: 10,
    });
    the_scope_resolver.set_forward_scope_resolver(the_forward_resolver);

    const the_references_provider = new ReferencesProvider(the_scope_resolver);
    const the_document_store = new DocumentStore();

    return {
        indexer: the_indexer,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        references_provider: the_references_provider,
        document_store: the_document_store,
        dependency_graph: the_dep_graph,
    };
}

function write_fixture(
    temp_dir: string,
    mode: DirectiveMode,
    the_files: FixtureFile[],
): void {
    for (const my_file of the_files) {
        writeFileSync(
            join(temp_dir, my_file.name),
            mode === 'explicit' ? my_file.explicit : my_file.auto,
        );
    }
}

for (const my_mode of THE_MODES) {
    describe(`Find-references sibling forward calls (${my_mode} mode)`, () => {
        let test_temp_dir: string;
        let pipeline: ReturnType<typeof build_pipeline>;

        beforeEach(() => {
            test_temp_dir = mkdtempSync(
                join(tmpdir(), `find-refs-sibling-${my_mode}-`),
            );
            pipeline = build_pipeline();
        });

        afterEach(() => {
            try { pipeline?.scope_resolver?.dispose(); } catch {}
            try { pipeline?.forward_scope_resolver?.dispose(); } catch {}
            if (existsSync(test_temp_dir)) {
                rmSync(test_temp_dir, { recursive: true, force: true });
            }
        });

        it('scenario 1: local referenced by sibling include after callee (direct)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `include callee.do\n` +
                        `include other.do\n`,
                    auto:
                        `include callee.do\n` +
                        `include other.do\n`,
                },
                {
                    name: 'callee.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'other.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `di "\`fruit'"\n`,
                    auto:
                        `di "\`fruit'"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);

            await pipeline.indexer.initialize([test_temp_dir]);

            const callee_path = join(test_temp_dir, 'callee.do');
            const callee_content =
                the_files.find(f => f.name === 'callee.do')![my_mode];
            const callee_uri = URI.file(callee_path).toString();
            await pipeline.document_store.open(callee_uri, callee_content, 1);
            const document_state = pipeline.document_store.get(callee_uri)!;

            // Cursor on `fruit` in `local fruit apple`. In explicit mode the
            // line is 1 (after the directive comment); in auto mode line 0.
            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = callee_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const other_uri =
                URI.file(join(test_temp_dir, 'other.do')).toString();
            const has_other_ref = locations.some(
                loc => loc.uri === other_uri && loc.range.start.line >= 0,
            );
            expect(has_other_ref).toBe(true);
        });

        it('scenario 2: program referenced by sibling do after definer (direct)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `do "defs.do"\n` +
                        `do "consumer.do"\n`,
                    auto:
                        `do "defs.do"\n` +
                        `do "consumer.do"\n`,
                },
                {
                    name: 'defs.do',
                    explicit:
                        `// @lsp-done-by: caller.do\n` +
                        `program define shared_prog\n` +
                        `  di "hello"\n` +
                        `end\n`,
                    auto:
                        `program define shared_prog\n` +
                        `  di "hello"\n` +
                        `end\n`,
                },
                {
                    name: 'consumer.do',
                    explicit:
                        `// @lsp-done-by: caller.do\n` +
                        `shared_prog\n`,
                    auto:
                        `shared_prog\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const defs_path = join(test_temp_dir, 'defs.do');
            const defs_content =
                the_files.find(f => f.name === 'defs.do')![my_mode];
            const defs_uri = URI.file(defs_path).toString();
            await pipeline.document_store.open(defs_uri, defs_content, 1);
            const document_state = pipeline.document_store.get(defs_uri)!;

            const prog_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = defs_content
                .split('\n')[prog_line]
                .indexOf('shared_prog');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: prog_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const consumer_uri =
                URI.file(join(test_temp_dir, 'consumer.do')).toString();
            expect(locations.some(loc => loc.uri === consumer_uri)).toBe(true);
        });

        it('scenario 3: global referenced by sibling do after include definer (direct, mixed)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `include a.do\n` +
                        `do "b.do"\n`,
                    auto:
                        `include a.do\n` +
                        `do "b.do"\n`,
                },
                {
                    name: 'a.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `global shared_path "/tmp/x"\n`,
                    auto:
                        `global shared_path "/tmp/x"\n`,
                },
                {
                    name: 'b.do',
                    explicit:
                        `// @lsp-done-by: caller.do\n` +
                        `di "$shared_path"\n`,
                    auto:
                        `di "$shared_path"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const a_path = join(test_temp_dir, 'a.do');
            const a_content =
                the_files.find(f => f.name === 'a.do')![my_mode];
            const a_uri = URI.file(a_path).toString();
            await pipeline.document_store.open(a_uri, a_content, 1);
            const document_state = pipeline.document_store.get(a_uri)!;

            const def_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = a_content
                .split('\n')[def_line]
                .indexOf('shared_path');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: def_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const b_uri = URI.file(join(test_temp_dir, 'b.do')).toString();
            expect(locations.some(loc => loc.uri === b_uri)).toBe(true);
        });

        it('scenario 4: local referenced by sibling uncle via grandparent include chain (transitive)', async () => {
            // In both modes: grandparent → parent → child, and uncle is a
            // sibling of parent at the grandparent level.
            const the_files: FixtureFile[] = [
                {
                    name: 'grandparent.do',
                    explicit:
                        `include parent.do\n` +
                        `include uncle.do\n`,
                    auto:
                        `include parent.do\n` +
                        `include uncle.do\n`,
                },
                {
                    name: 'parent.do',
                    explicit:
                        `// @lsp-included-by: grandparent.do\n` +
                        `include child.do\n`,
                    auto:
                        `include child.do\n`,
                },
                {
                    name: 'child.do',
                    explicit:
                        `// @lsp-included-by: parent.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'uncle.do',
                    explicit:
                        `// @lsp-included-by: grandparent.do\n` +
                        `di "\`fruit'"\n`,
                    auto:
                        `di "\`fruit'"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                the_files.find(f => f.name === 'child.do')![my_mode];
            const child_uri = URI.file(child_path).toString();
            await pipeline.document_store.open(child_uri, child_content, 1);
            const document_state = pipeline.document_store.get(child_uri)!;

            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = child_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const uncle_uri =
                URI.file(join(test_temp_dir, 'uncle.do')).toString();
            expect(locations.some(loc => loc.uri === uncle_uri)).toBe(true);
        });

        it('scenario 5: local blocked by done-by at grandparent boundary (transitive)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'grandparent.do',
                    explicit:
                        `do "parent.do"\n` +
                        `include uncle.do\n`,
                    auto:
                        `do "parent.do"\n` +
                        `include uncle.do\n`,
                },
                {
                    name: 'parent.do',
                    explicit:
                        `// @lsp-done-by: grandparent.do\n` +
                        `include child.do\n`,
                    auto:
                        `include child.do\n`,
                },
                {
                    name: 'child.do',
                    explicit:
                        `// @lsp-included-by: parent.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'uncle.do',
                    explicit:
                        `// @lsp-included-by: grandparent.do\n` +
                        `di "\`fruit'"\n`,
                    auto:
                        `di "\`fruit'"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                the_files.find(f => f.name === 'child.do')![my_mode];
            const child_uri = URI.file(child_path).toString();
            await pipeline.document_store.open(child_uri, child_content, 1);
            const document_state = pipeline.document_store.get(child_uri)!;

            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = child_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const uncle_uri =
                URI.file(join(test_temp_dir, 'uncle.do')).toString();
            // Locals do not propagate through the do boundary at grandparent →
            // parent.
            expect(locations.some(loc => loc.uri === uncle_uri)).toBe(false);
        });

        it('scenario 6: program propagates through done-by boundary to sibling uncle (transitive)', async () => {
            // In both modes: grandparent → parent → child, and uncle is a
            // sibling of parent at the grandparent level.
            const the_files: FixtureFile[] = [
                {
                    name: 'grandparent.do',
                    explicit:
                        `do "parent.do"\n` +
                        `do "uncle.do"\n`,
                    auto:
                        `do "parent.do"\n` +
                        `do "uncle.do"\n`,
                },
                {
                    name: 'parent.do',
                    explicit:
                        `// @lsp-done-by: grandparent.do\n` +
                        `do "child.do"\n`,
                    auto:
                        `do "child.do"\n`,
                },
                {
                    name: 'child.do',
                    explicit:
                        `// @lsp-done-by: parent.do\n` +
                        `program define shared_prog\n` +
                        `  di "hello"\n` +
                        `end\n`,
                    auto:
                        `program define shared_prog\n` +
                        `  di "hello"\n` +
                        `end\n`,
                },
                {
                    name: 'uncle.do',
                    explicit:
                        `// @lsp-done-by: grandparent.do\n` +
                        `shared_prog\n`,
                    auto:
                        `shared_prog\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const child_path = join(test_temp_dir, 'child.do');
            const child_content =
                the_files.find(f => f.name === 'child.do')![my_mode];
            const child_uri = URI.file(child_path).toString();
            await pipeline.document_store.open(child_uri, child_content, 1);
            const document_state = pipeline.document_store.get(child_uri)!;

            const prog_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = child_content
                .split('\n')[prog_line]
                .indexOf('shared_prog');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: prog_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const uncle_uri =
                URI.file(join(test_temp_dir, 'uncle.do')).toString();
            expect(locations.some(loc => loc.uri === uncle_uri)).toBe(true);
        });

        it('scenario 7a: sibling earlier.do redeclares same-name program without inheriting (excluded)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'current.do',
                    explicit:
                        `do "earlier.do"\n` +
                        `do "later.do"\n` +
                        `shared_prog\n`,
                    auto:
                        `do "earlier.do"\n` +
                        `do "later.do"\n` +
                        `shared_prog\n`,
                },
                {
                    name: 'earlier.do',
                    explicit:
                        `// @lsp-done-by: current.do\n` +
                        `program define shared_prog\n` +
                        `  di "earlier"\n` +
                        `end\n`,
                    auto:
                        `program define shared_prog\n` +
                        `  di "earlier"\n` +
                        `end\n`,
                },
                {
                    name: 'later.do',
                    explicit:
                        `// @lsp-done-by: current.do\n` +
                        `program define shared_prog\n` +
                        `  di "later"\n` +
                        `end\n` +
                        `shared_prog\n`,
                    auto:
                        `program define shared_prog\n` +
                        `  di "later"\n` +
                        `end\n` +
                        `shared_prog\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const current_path = join(test_temp_dir, 'current.do');
            const current_content =
                the_files.find(f => f.name === 'current.do')![my_mode];
            const current_uri = URI.file(current_path).toString();
            await pipeline.document_store.open(current_uri, current_content, 1);
            const document_state = pipeline.document_store.get(current_uri)!;

            // Cursor on `shared_prog` invocation (line 2 of current.do):
            // active = later.do's program (lattermost forward call defines
            // it). earlier.do's own shared_prog is a different identity.
            const invoke_line = 2;
            const name_char = current_content
                .split('\n')[invoke_line]
                .indexOf('shared_prog');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: invoke_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const earlier_uri =
                URI.file(join(test_temp_dir, 'earlier.do')).toString();
            const later_uri =
                URI.file(join(test_temp_dir, 'later.do')).toString();
            expect(locations.some(loc => loc.uri === earlier_uri)).toBe(false);
            expect(locations.some(loc => loc.uri === later_uri)).toBe(true);
        });

        it('scenario 8: includeDeclaration=true returns declaration plus sibling references without duplicates', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `include callee.do\n` +
                        `include other.do\n`,
                    auto:
                        `include callee.do\n` +
                        `include other.do\n`,
                },
                {
                    name: 'callee.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'other.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `di "\`fruit'"\n`,
                    auto:
                        `di "\`fruit'"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const callee_path = join(test_temp_dir, 'callee.do');
            const callee_content =
                the_files.find(f => f.name === 'callee.do')![my_mode];
            const callee_uri = URI.file(callee_path).toString();
            await pipeline.document_store.open(callee_uri, callee_content, 1);
            const document_state = pipeline.document_store.get(callee_uri)!;

            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = callee_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const other_uri =
                URI.file(join(test_temp_dir, 'other.do')).toString();
            const declaration_hits = locations.filter(
                loc =>
                    loc.uri === callee_uri &&
                    loc.range.start.line === decl_line,
            );
            expect(declaration_hits.length).toBe(1);
            expect(locations.some(loc => loc.uri === other_uri)).toBe(true);
        });

        it('scenario 9: variables reach sibling do regardless of directive mode (workspace-wide baseline)', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `do "defs.do"\n` +
                        `do "consumer.do"\n`,
                    auto:
                        `do "defs.do"\n` +
                        `do "consumer.do"\n`,
                },
                {
                    name: 'defs.do',
                    explicit:
                        `// @lsp-done-by: caller.do\n` +
                        `// @lsp-variables: analysis_sample\n` +
                        `gen analysis_sample = 1\n`,
                    auto:
                        `// @lsp-variables: analysis_sample\n` +
                        `gen analysis_sample = 1\n`,
                },
                {
                    name: 'consumer.do',
                    explicit:
                        `// @lsp-done-by: caller.do\n` +
                        `// @lsp-variables: analysis_sample\n` +
                        `tab analysis_sample\n`,
                    auto:
                        `// @lsp-variables: analysis_sample\n` +
                        `tab analysis_sample\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const defs_path = join(test_temp_dir, 'defs.do');
            const defs_content =
                the_files.find(f => f.name === 'defs.do')![my_mode];
            const defs_uri = URI.file(defs_path).toString();
            await pipeline.document_store.open(defs_uri, defs_content, 1);
            const document_state = pipeline.document_store.get(defs_uri)!;

            const gen_line = my_mode === 'explicit' ? 2 : 1;
            const name_char = defs_content
                .split('\n')[gen_line]
                .indexOf('analysis_sample');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: gen_line, character: name_char },
                { includeDeclaration: false },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const consumer_uri =
                URI.file(join(test_temp_dir, 'consumer.do')).toString();
            expect(locations.some(loc => loc.uri === consumer_uri)).toBe(true);
        });

        it('scenario 7b: inheriting sibling with same-file redeclare yields pre-redeclare references only', async () => {
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `include first.do\n` +
                        `include second.do\n`,
                    auto:
                        `include first.do\n` +
                        `include second.do\n`,
                },
                {
                    name: 'first.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'second.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `display "\`fruit' one"\n` +
                        `local fruit orange\n` +
                        `display "\`fruit' two"\n`,
                    auto:
                        `display "\`fruit' one"\n` +
                        `local fruit orange\n` +
                        `display "\`fruit' two"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const first_path = join(test_temp_dir, 'first.do');
            const first_content =
                the_files.find(f => f.name === 'first.do')![my_mode];
            const first_uri = URI.file(first_path).toString();
            await pipeline.document_store.open(first_uri, first_content, 1);
            const document_state = pipeline.document_store.get(first_uri)!;

            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = first_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const second_uri =
                URI.file(join(test_temp_dir, 'second.do')).toString();
            // Line offsets within second.do: 0 = pre-redeclare display, 1 =
            // local redeclaration, 2 = post-redeclare display. Directive mode
            // shifts lines only in files that carry a header comment; second.do's
            // explicit variant adds one line for the directive.
            const pre_redeclare_line = my_mode === 'explicit' ? 1 : 0;
            const redeclare_line = my_mode === 'explicit' ? 2 : 1;
            const post_redeclare_line = my_mode === 'explicit' ? 3 : 2;

            const in_second = locations.filter(loc => loc.uri === second_uri);
            const second_ref_lines =
                in_second.map(loc => loc.range.start.line).sort();

            expect(second_ref_lines).toContain(pre_redeclare_line);
            expect(second_ref_lines).not.toContain(post_redeclare_line);
            // second.do's `local fruit orange` is a different identity, so it
            // must NOT appear in the includeDeclaration output.
            expect(second_ref_lines).not.toContain(redeclare_line);
        });

        it('scenario 7c: same-line RHS reference on redeclaration line is included', async () => {
            // A Stata pattern like `local fruit = "\`fruit'"` has a
            // MACRO_REF_LOCAL token on the RHS on the same line as the
            // redeclaration. That token references the pre-shadow value and
            // must appear in find-references results for the pre-shadow symbol.
            const the_files: FixtureFile[] = [
                {
                    name: 'caller.do',
                    explicit:
                        `include first.do\n` +
                        `include second.do\n`,
                    auto:
                        `include first.do\n` +
                        `include second.do\n`,
                },
                {
                    name: 'first.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `local fruit apple\n`,
                    auto:
                        `local fruit apple\n`,
                },
                {
                    name: 'second.do',
                    explicit:
                        `// @lsp-included-by: caller.do\n` +
                        `display "\`fruit' one"\n` +
                        `local fruit = "\`fruit' shadow"\n` +
                        `display "\`fruit' two"\n`,
                    auto:
                        `display "\`fruit' one"\n` +
                        `local fruit = "\`fruit' shadow"\n` +
                        `display "\`fruit' two"\n`,
                },
            ];
            write_fixture(test_temp_dir, my_mode, the_files);
            await pipeline.indexer.initialize([test_temp_dir]);

            const first_path = join(test_temp_dir, 'first.do');
            const first_content =
                the_files.find(f => f.name === 'first.do')![my_mode];
            const first_uri = URI.file(first_path).toString();
            await pipeline.document_store.open(first_uri, first_content, 1);
            const document_state = pipeline.document_store.get(first_uri)!;

            const decl_line = my_mode === 'explicit' ? 1 : 0;
            const name_char = first_content
                .split('\n')[decl_line]
                .indexOf('fruit') + 1;

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: decl_line, character: name_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker,
            );

            const second_uri =
                URI.file(join(test_temp_dir, 'second.do')).toString();
            // Line offsets within second.do:
            //   explicit: 0=directive, 1=pre-redeclare, 2=redeclare, 3=post
            //   auto:                  0=pre-redeclare, 1=redeclare, 2=post
            const pre_redeclare_line = my_mode === 'explicit' ? 1 : 0;
            const redeclare_line = my_mode === 'explicit' ? 2 : 1;
            const post_redeclare_line = my_mode === 'explicit' ? 3 : 2;

            const in_second = locations.filter(loc => loc.uri === second_uri);
            const second_ref_lines =
                in_second.map(loc => loc.range.start.line).sort();

            // Pre-redeclare reference must be present.
            expect(second_ref_lines).toContain(pre_redeclare_line);
            // RHS `fruit' on the redeclaration line references pre-shadow
            // value — must be included.
            expect(second_ref_lines).toContain(redeclare_line);
            // Post-redeclare references the shadow symbol — must not appear.
            expect(second_ref_lines).not.toContain(post_redeclare_line);
        });
    });
}
