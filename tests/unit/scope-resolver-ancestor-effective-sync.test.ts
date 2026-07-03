// Issue #286: get_parsed_file's ancestor-level backward-directive sync used
// the RAW variant (sync_backward_directive_dependencies, no auto-synthesis).
// Registration is clear-then-register, so a file whose
// backward_directive_children edges came from auto-discovery (DependencyGraph
// parents, no explicit directives) had those edges WIPED whenever it was read
// from disk as an ancestor of another file's resolution — until its next
// commit re-registered them. Consequence: interface-change revalidation
// fan-out (get_transitive_backward_directive_children) silently skipped the
// wiped file's descendants.
//
// The fix threads the resolution's effective backward_dependencies mode into
// get_parsed_file and switches the ancestor sync to the effective variant
// (apply_backward_directive_registration). Effective ⊇ raw, so the change can
// only ADD edges; an 'explicit'-mode resolution must NOT auto-register graph
// parents for ancestors.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { DependencyGraph } from '../../src/dependency-graph';
import { DirectiveParser } from '../../src/directive-parser';
import { DocumentStore } from '../../src/document-store';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('issue #286 — ancestor-level effective backward-directive sync', () => {
    let temp_dir: string;
    let document_store: DocumentStore;
    let dependency_graph: DependencyGraph;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-286-'));
        document_store = new DocumentStore();
        dependency_graph = new DependencyGraph();
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        const forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        scope_resolver.set_dependency_graph(dependency_graph);
        document_store.set_scope_resolver(scope_resolver);
    });

    afterEach(async () => {
        await document_store.dispose();
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };
    const to_uri = (file_path: string): string =>
        URI.file(file_path).toString();

    /**
     * Seed a dependency-graph edge parent → child, as the workspace scan
     * would after seeing `do child.do` in the parent.
     */
    const seed_auto_parent = (parent_uri: string, child_name: string): void => {
        dependency_graph.update_caller(parent_uri, [{
            type: 'do',
            raw_path: child_name,
            is_static: true,
            call_site_line: 0,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            },
            source: 'command',
        }]);
    };

    it('auto-discovered edges survive a backward ancestor read (regression)', async () => {
        // A --do--> B (auto-discovered, no explicit directives in B).
        const b_path = create_file('b.do', 'display "b on disk"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');
        expect(dependency_graph.get_parents(b_uri)).toHaveLength(1);

        // Open B with buffer content that differs from disk (unsaved edit),
        // so a later ancestor read of B is a file-cache STALE → full parse.
        // Commit-time effective registration (issue #184) adds A → B.
        await document_store.open(b_uri, 'display "b in buffer"\n', 1);
        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(true);

        // Resolve C, whose chain reads B from disk as an ancestor. Before
        // the fix, the RAW clear-then-register sync inside get_parsed_file
        // wiped B's auto edges (B has no explicit directives).
        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        await scope_resolver.resolve(
            c_uri,
            `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
            {}
        );

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(b_uri).has(c_uri)
        ).toBe(true);
        // Fan-out consequence: revalidation from A must reach C through B.
        const the_transitive =
            scope_resolver.get_transitive_backward_directive_children(a_uri);
        expect(the_transitive.has(b_uri)).toBe(true);
        expect(the_transitive.has(c_uri)).toBe(true);
    });

    it('auto-discovered edges survive a forward callee read (regression)', async () => {
        const b_path = create_file('b.do', 'display "b on disk"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');

        await document_store.open(b_uri, 'display "b in buffer"\n', 1);
        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(true);

        // C reads B as a forward callee (do command), which goes through
        // ForwardScopeResolver.get_callee_scope → get_parsed_file.
        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        await scope_resolver.resolve(c_uri, `do "${b_path}"\n`, {});

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(true);
    });

    it('auto-mode resolution registers an ancestor\'s auto parents even when never opened (effective ⊇ raw)', async () => {
        const b_path = create_file('b.do', 'display "b"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');

        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        await scope_resolver.resolve(
            c_uri,
            `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
            {}
        );

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(true);
    });

    it('explicit-mode resolution does NOT auto-register graph parents for ancestors', async () => {
        const b_path = create_file('b.do', 'display "b"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');

        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        await scope_resolver.resolve(
            c_uri,
            `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
            { backward_dependencies: 'explicit' }
        );

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(false);
        // The explicit directive in C itself still registers.
        expect(
            scope_resolver.get_backward_directive_children(b_uri).has(c_uri)
        ).toBe(true);
    });

    it('explicit-mode resolution does NOT auto-register graph parents for forward callees', async () => {
        const b_path = create_file('b.do', 'display "b"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');

        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        await scope_resolver.resolve(
            c_uri,
            `do "${b_path}"\n`,
            { backward_dependencies: 'explicit' }
        );

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(false);
    });

    it('resolve_inherited_working_directory (indexer walk) never auto-registers ancestor graph parents', async () => {
        // The indexer's WD walk forces backward_dependencies: 'explicit' to
        // stay deterministic during a partial scan; the ancestor sync must
        // honor that and not synthesize edges from the half-built graph.
        const b_path = create_file('b.do', 'display "b"\n');
        const a_path = create_file('a.do', 'do b.do\n');
        const a_uri = to_uri(a_path);
        const b_uri = to_uri(b_path);
        seed_auto_parent(a_uri, 'b.do');

        const c_uri = to_uri(path.join(temp_dir, 'c.do'));
        const c_content = `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`;
        const the_directives = new DirectiveParser()
            .parse(c_content, c_uri).directives;
        await scope_resolver.resolve_inherited_working_directory(
            the_directives,
            c_uri
        );

        expect(
            scope_resolver.get_backward_directive_children(a_uri).has(b_uri)
        ).toBe(false);
    });
});
