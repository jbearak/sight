/**
 * Find-references - symmetric reachability (issue #135, Task 12).
 *
 * If file A `include`s (or `do`s/`run`s) file B, find-references from INSIDE
 * the child file B must reach upward to the parent file A. The dep graph's
 * `callee_to_callers` reverse index (exposed via `get_related_uris`, which
 * already walks both directions) is the source of truth. This guard pins the
 * end-to-end behavior so future refactors can't silently drop upward walks.
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

describe('Find-references - symmetric reachability', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-symmetric-'));
        indexer = new WorkspaceIndexer();
        const dep_graph = new DependencyGraph();
        indexer.set_dependency_graph(dep_graph);
        document_store = new DocumentStore();

        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        scope_resolver.set_dependency_graph(dep_graph);

        provider = new ReferencesProvider(scope_resolver);
    });

    afterEach(() => {
        try { scope_resolver?.dispose(); } catch (_err) { /* ignore disposal error */ }
        try { forward_scope_resolver?.dispose(); } catch (_err) { /* ignore disposal error */ }
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('include chain: query from the included file reaches upward to the includer (local)', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local shared = "1"',         // line 0 decl
            'di "`shared\'"',             // line 1 ref
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',           // line 0
            'di "`shared\' in main"',     // line 1 ref (post-include)
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        // Query from INSIDE lib.do (the included end).
        await document_store.open(lib_uri, lib_content, 1);
        const document_state = document_store.get(lib_uri)!;

        const shared_char = lib_content.split('\n')[1].indexOf('shared');
        const locations = await provider.get_references(
            document_state,
            { line: 1, character: shared_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        // Must include the main.do reference (line 1 of main.do).
        const main_lines = locations
            .filter(l => l.uri === main_uri)
            .map(l => l.range.start.line);
        expect(main_lines).toContain(1);
    });

    it('do chain: global refs queried from child file reach upward to parent', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'global shared = "1"',       // line 0 decl
            'di "$shared"',              // line 1 ref
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'do "child.do"',             // line 0
            'di "$shared in parent"',    // line 1 ref (post-do)
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const child_uri = URI.file(child_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const shared_char = child_content.split('\n')[1].indexOf('shared');
        const locations = await provider.get_references(
            document_state,
            { line: 1, character: shared_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        const parent_lines = locations
            .filter(l => l.uri === parent_uri)
            .map(l => l.range.start.line);
        expect(parent_lines).toContain(1);
    });

    it('include chain (3 levels): query from leaf reaches both intermediate and root', async () => {
        // a.do -include-> b.do -include-> c.do
        // Declaration lives in c.do; references live in every file.
        // Query from c.do must report refs in both b.do and a.do.
        const c_path = join(test_temp_dir, 'c.do');
        const c_content = [
            'local shared = "1"',        // line 0 decl
            'di "`shared\' in c"',       // line 1 ref
        ].join('\n');
        writeFileSync(c_path, c_content);

        const b_path = join(test_temp_dir, 'b.do');
        const b_content = [
            'include "c.do"',            // line 0
            'di "`shared\' in b"',       // line 1 ref
        ].join('\n');
        writeFileSync(b_path, b_content);

        const a_path = join(test_temp_dir, 'a.do');
        const a_content = [
            'include "b.do"',            // line 0
            'di "`shared\' in a"',       // line 1 ref
        ].join('\n');
        writeFileSync(a_path, a_content);

        await indexer.initialize([test_temp_dir]);
        const a_uri = URI.file(a_path).toString();
        const b_uri = URI.file(b_path).toString();
        const c_uri = URI.file(c_path).toString();
        await document_store.open(c_uri, c_content, 1);
        const document_state = document_store.get(c_uri)!;

        const shared_char = c_content.split('\n')[1].indexOf('shared');
        const locations = await provider.get_references(
            document_state,
            { line: 1, character: shared_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        const b_lines = locations
            .filter(l => l.uri === b_uri)
            .map(l => l.range.start.line);
        const a_lines = locations
            .filter(l => l.uri === a_uri)
            .map(l => l.range.start.line);
        expect(b_lines).toContain(1);
        expect(a_lines).toContain(1);
    });

    it('do chain: program refs queried from child file reach upward to parent', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'program define helper',     // line 0
            '    di "helper"',           // line 1
            'end',                       // line 2
            'helper',                    // line 3 call in child
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'do "child.do"',             // line 0
            'helper',                    // line 1 call in parent (post-do)
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const child_uri = URI.file(child_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        // Cursor on the `helper` call at line 3 in child.do.
        const helper_char = child_content.split('\n')[3].indexOf('helper');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: helper_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        const parent_lines = locations
            .filter(l => l.uri === parent_uri)
            .map(l => l.range.start.line);
        expect(parent_lines).toContain(1);
    });

    /**
     * Sibling-callers scenario (issue #135, Rule 1 across the reachable chain):
     *
     *   earlier.do:  program define shared_prog / end / do "child.do"
     *   later.do:    program define shared_prog / end / do "child.do"
     *   child.do:    shared_prog                    (the reference)
     *
     * No explicit directives. Auto-discovery produces the dep-graph:
     *   earlier.do -> child.do   and   later.do -> child.do
     *
     * Under Rule 1, both parent declarations of `shared_prog` pool into a
     * single identity (same name + same kind within the reachable chain).
     * Rule 2 is not triggered: earlier.do and later.do are connected via
     * child.do, so they live in the same branch of the dep graph.
     *
     * Query-position-invariance: find-references must return the same set of
     * files regardless of which of the three files the cursor sits in.
     */
    describe('sibling-callers: both parents of a shared child define the same name', () => {
        const build_workspace = async (): Promise<{
            earlier_uri: string;
            later_uri: string;
            child_uri: string;
            earlier_content: string;
            later_content: string;
            child_content: string;
        }> => {
            const earlier_content = [
                'program define shared_prog',  // line 0
                'end',                          // line 1
                'do "child.do"',                // line 2
            ].join('\n');
            const later_content = [
                'program define shared_prog',  // line 0
                'end',                          // line 1
                'do "child.do"',                // line 2
            ].join('\n');
            const child_content = 'shared_prog\n'; // line 0 ref

            const earlier_path = join(test_temp_dir, 'earlier.do');
            const later_path = join(test_temp_dir, 'later.do');
            const child_path = join(test_temp_dir, 'child.do');
            writeFileSync(earlier_path, earlier_content);
            writeFileSync(later_path, later_content);
            writeFileSync(child_path, child_content);

            await indexer.initialize([test_temp_dir]);

            return {
                earlier_uri: URI.file(earlier_path).toString(),
                later_uri: URI.file(later_path).toString(),
                child_uri: URI.file(child_path).toString(),
                earlier_content,
                later_content,
                child_content,
            };
        };

        it('cursor in child.do: reaches both parent declarations', async () => {
            const ws = await build_workspace();
            await document_store.open(ws.child_uri, ws.child_content, 1);
            const document_state = document_store.get(ws.child_uri)!;

            const shared_char = ws.child_content.split('\n')[0].indexOf('shared_prog');
            const locations = await provider.get_references(
                document_state,
                { line: 0, character: shared_char },
                { includeDeclaration: true },
                indexer,
                document_state.context_tracker,
            );

            const uris = new Set(locations.map(l => l.uri));
            expect(uris.has(ws.earlier_uri)).toBe(true);
            expect(uris.has(ws.later_uri)).toBe(true);
            expect(uris.has(ws.child_uri)).toBe(true);
        });

        it('cursor in later.do: reaches sibling caller earlier.do via the shared child', async () => {
            const ws = await build_workspace();
            await document_store.open(ws.later_uri, ws.later_content, 1);
            const document_state = document_store.get(ws.later_uri)!;

            // Cursor on the `shared_prog` name in `program define shared_prog`.
            const shared_char = ws.later_content.split('\n')[0].indexOf('shared_prog');
            const locations = await provider.get_references(
                document_state,
                { line: 0, character: shared_char },
                { includeDeclaration: true },
                indexer,
                document_state.context_tracker,
            );

            const uris = new Set(locations.map(l => l.uri));
            expect(uris.has(ws.earlier_uri)).toBe(true);
            expect(uris.has(ws.later_uri)).toBe(true);
            expect(uris.has(ws.child_uri)).toBe(true);
        });

        it('cursor in earlier.do: reaches sibling caller later.do via the shared child', async () => {
            const ws = await build_workspace();
            await document_store.open(ws.earlier_uri, ws.earlier_content, 1);
            const document_state = document_store.get(ws.earlier_uri)!;

            const shared_char = ws.earlier_content.split('\n')[0].indexOf('shared_prog');
            const locations = await provider.get_references(
                document_state,
                { line: 0, character: shared_char },
                { includeDeclaration: true },
                indexer,
                document_state.context_tracker,
            );

            const uris = new Set(locations.map(l => l.uri));
            expect(uris.has(ws.earlier_uri)).toBe(true);
            expect(uris.has(ws.later_uri)).toBe(true);
            expect(uris.has(ws.child_uri)).toBe(true);
        });
    });
});
