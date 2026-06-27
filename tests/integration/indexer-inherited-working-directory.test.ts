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
});
