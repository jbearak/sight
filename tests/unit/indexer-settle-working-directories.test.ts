/**
 * The workspace index settles the working directory each file inherits
 * from the callers that reach it: after the scan, after a re-index that
 * changes a file's calls or directory, and for a file re-indexed while
 * the scan's own settle runs. A re-index that changes nothing does not
 * walk the workspace again.
 *
 * Layout: main.do sets `sight: cd "work"` and runs jobs/a.do, which
 * runs jobs/b.do. a.do reaches b.do only in the inherited directory.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { wait_until } from '../wait-until';

let tmp_dir: string | undefined;

afterEach(() => {
    if (tmp_dir) {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
        tmp_dir = undefined;
    }
});

function make_workspace(): string {
    tmp_dir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-settle-')));
    const files: Record<string, string> = {
        'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
        'work/jobs/a.do': 'do jobs/b.do\n',
        'work/jobs/b.do': 'display 1\n',
        'other.do': 'display 2\n',
    };
    for (const [my_name, my_text] of Object.entries(files)) {
        const my_path = path.join(tmp_dir, my_name);
        fs.mkdirSync(path.dirname(my_path), { recursive: true });
        fs.writeFileSync(my_path, my_text);
    }
    return tmp_dir;
}

function make_indexer(root: string): {
    indexer: WorkspaceIndexer;
    graph: DependencyGraph;
    resolver: ScopeResolver;
} {
    const graph = new DependencyGraph();
    graph.set_workspace_roots([root]);
    const resolver = new ScopeResolver();
    resolver.set_workspace_roots([root]);
    resolver.set_dependency_graph(graph);
    const indexer = new WorkspaceIndexer();
    indexer.set_dependency_graph(graph);
    indexer.set_scope_resolver(resolver);
    return { indexer, graph, resolver };
}

function b_callers(graph: DependencyGraph, root: string): string[] {
    const b_uri = URI.file(path.join(root, 'work/jobs/b.do')).toString();
    return graph.get_parents(b_uri).map((my_edge) =>
        path.relative(root, URI.parse(my_edge.caller_uri).fsPath));
}

describe('WorkspaceIndexer working-directory settling', () => {
    it('links a grandchild through the directory its caller inherits', async () => {
        const root = make_workspace();
        const { indexer, graph } = make_indexer(root);
        await indexer.initialize([root]);
        expect(b_callers(graph, root)).toEqual([path.join('work', 'jobs', 'a.do')]);
    });

    it('settles a file re-indexed while the scan\'s settle runs', async () => {
        const root = make_workspace();
        const { indexer, graph, resolver } = make_indexer(root);
        const a_path = path.join(root, 'work/jobs/a.do');
        const original = resolver.resolve_document_working_directory
            .bind(resolver);
        let reindexed = false;
        resolver.resolve_document_working_directory = async (...args) => {
            if (!reindexed) {
                reindexed = true;
                // A watcher event lands in the middle of the settle.
                await indexer.index_file(a_path);
            }
            return original(...args);
        };
        await indexer.initialize([root]);
        expect(reindexed).toBe(true);
        // The re-index queues its own settle; nothing else asks for one.
        await wait_until(
            () => b_callers(graph, root).length > 0,
            'the re-indexed caller to be settled');
        expect(b_callers(graph, root)).toEqual([path.join('work', 'jobs', 'a.do')]);
    });

    it('does not walk the workspace again for an unchanged re-index', async () => {
        const root = make_workspace();
        const { indexer, resolver } = make_indexer(root);
        await indexer.initialize([root]);
        let walks = 0;
        const original = resolver.resolve_document_working_directory
            .bind(resolver);
        resolver.resolve_document_working_directory = async (...args) => {
            walks++;
            return original(...args);
        };
        await indexer.index_file(path.join(root, 'other.do'));
        await indexer.settle_working_directories();
        // The re-indexed file's own walk, then the explicit settle's
        // walk of the three files without their own directory.
        expect(walks).toBe(1 + 3);
    });

    it('re-links the grandchild when the top file\'s cd changes', async () => {
        const root = make_workspace();
        const { indexer, graph } = make_indexer(root);
        await indexer.initialize([root]);
        fs.writeFileSync(path.join(root, 'main.do'),
            '// sight: cd "elsewhere"\ndo jobs/a.do\n');
        await indexer.index_file(path.join(root, 'main.do'));
        await indexer.settle_working_directories();
        expect(b_callers(graph, root)).toEqual([]);

        fs.writeFileSync(path.join(root, 'main.do'),
            '// sight: cd "work"\ndo jobs/a.do\n');
        await indexer.index_file(path.join(root, 'main.do'));
        await indexer.settle_working_directories();
        expect(b_callers(graph, root)).toEqual([path.join('work', 'jobs', 'a.do')]);
    });
});
