/**
 * Integration test for #218: the workspace indexer must stamp a file's
 * INHERITED working directory (from a backward-directive parent), so its
 * dependency-graph callee keys match the open-document path.
 *
 * Layout:
 *   parent.do      `// @lsp-cd: "data"`        (sets WD => temp_dir/data)
 *   child.do       `// @lsp-done-by: "parent.do"` + `do sub.do`
 *   data/sub.do    exists ONLY under the inherited WD
 *
 * `do sub.do` in child.do resolves to temp_dir/data/sub.do only when the
 * inherited WD is applied; without it, resolution misses (script-relative
 * temp_dir/sub.do does not exist). Indexing child.do (without opening it)
 * must therefore record the edge child.do -> data/sub.do.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';

describe('Indexer inherited working directory (#218)', () => {
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-inherit-wd-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_file(rel_path: string, content: string): string {
        const full_path = path.join(temp_dir, rel_path);
        fs.mkdirSync(path.dirname(full_path), { recursive: true });
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    it('keys child -> sub.do edge by the inherited-WD path', async () => {
        write_file('parent.do', '// @lsp-cd: "data"\nglobal g = 1\n');
        write_file('child.do', '// @lsp-done-by: "parent.do"\ndo sub.do\n');
        write_file('data/sub.do', 'global from_sub = 1\n');

        const indexer = new WorkspaceIndexer();
        const graph = new DependencyGraph();
        graph.set_workspace_roots([temp_dir]);
        indexer.set_dependency_graph(graph);

        const scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([temp_dir]);
        indexer.set_scope_resolver(scope_resolver);

        // Bulk scan (child.do is indexed, never opened). Must not hang or
        // recurse — the inherited-WD walk reads parents via the resolver's
        // own cache, never re-entering the indexer.
        await indexer.initialize([temp_dir]);

        const child_uri = URI.file(path.join(temp_dir, 'child.do')).toString();
        const expected_callee = URI.file(
            path.join(temp_dir, 'data', 'sub.do'),
        ).toString();
        const wrong_callee = URI.file(
            path.join(temp_dir, 'sub.do'),
        ).toString();

        const the_callees = graph.get_callees(child_uri);
        expect(the_callees.has(expected_callee)).toBe(true);
        expect(the_callees.has(wrong_callee)).toBe(false);
    });

    it('respects the configured max_backward_depth for inherited WD', async () => {
        // Only the GRANDPARENT sets @lsp-cd; reaching it requires depth > 0.
        write_file('grandparent.do', '// @lsp-cd: "data"\nglobal g = 1\n');
        write_file(
            'parent.do',
            '// @lsp-done-by: "grandparent.do"\n',
        );
        write_file('child.do', '// @lsp-done-by: "parent.do"\ndo sub.do\n');
        write_file('data/sub.do', 'global from_sub = 1\n');

        const indexer = new WorkspaceIndexer();
        // max_backward_depth 0 excludes the grandparent, so the child must
        // NOT inherit its @lsp-cd (matching the open-document path under the
        // same setting). With the default depth the grandparent WD would
        // leak in — this pins that the indexer honors the active config.
        indexer.configure({ cross_file: { max_backward_depth: 0 } });
        const graph = new DependencyGraph();
        graph.set_workspace_roots([temp_dir]);
        indexer.set_dependency_graph(graph);

        const scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([temp_dir]);
        indexer.set_scope_resolver(scope_resolver);

        await indexer.initialize([temp_dir]);

        const child_uri = URI.file(path.join(temp_dir, 'child.do')).toString();
        const inherited_callee = URI.file(
            path.join(temp_dir, 'data', 'sub.do'),
        ).toString();

        const the_callees = graph.get_callees(child_uri);
        // Grandparent WD was depth-excluded, so the edge is NOT keyed by it.
        expect(the_callees.has(inherited_callee)).toBe(false);
    });

    it('does not inherit WD via an auto-discovered grandparent (deterministic)', async () => {
        // grandparent.do auto-`do`es parent.do (a dependency-graph edge, not
        // an explicit directive) and sets @lsp-cd. child.do explicitly
        // @lsp-done-by parent.do, which has no directive of its own. The
        // indexer walk forces EXPLICIT resolution, so it must NOT follow the
        // auto-discovered grandparent — otherwise the result would depend on
        // scan order (the dep graph is only partially built mid-scan). The
        // grandparent WD is resolved authoritatively when child.do is opened.
        write_file('grandparent.do', '// @lsp-cd: "data"\ndo parent.do\n');
        write_file('parent.do', 'global p = 1\n');
        write_file('child.do', '// @lsp-done-by: "parent.do"\ndo sub.do\n');
        write_file('data/sub.do', 'global from_sub = 1\n');

        const indexer = new WorkspaceIndexer();
        const graph = new DependencyGraph();
        graph.set_workspace_roots([temp_dir]);
        indexer.set_dependency_graph(graph);

        const scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([temp_dir]);
        indexer.set_scope_resolver(scope_resolver);

        await indexer.initialize([temp_dir]);

        const child_uri = URI.file(path.join(temp_dir, 'child.do')).toString();
        const auto_inherited_callee = URI.file(
            path.join(temp_dir, 'data', 'sub.do'),
        ).toString();

        // Auto-discovered grandparent WD is NOT inherited during indexing,
        // regardless of which order the files were scanned.
        expect(graph.get_callees(child_uri).has(auto_inherited_callee))
            .toBe(false);
    });
});
