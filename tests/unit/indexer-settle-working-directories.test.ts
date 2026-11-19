/**
 * `sight check` turns on settling in the workspace index: after the scan,
 * each file with no directory of its own is given the one the backward
 * walk would give it once the graph is complete, and its calls are
 * registered again. The language server leaves settling off.
 *
 * Settling passes a directory on only through calls the caller makes in
 * the directory it starts in, follows the walk's caller order and depth
 * limit, and costs time linear in the graph's edges per round.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';

let tmp_dir: string | undefined;

afterEach(() => {
    if (tmp_dir) {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
        tmp_dir = undefined;
    }
});

function make_workspace(files: Record<string, string>): string {
    tmp_dir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-settle-')));
    for (const [my_name, my_text] of Object.entries(files)) {
        const my_path = path.join(tmp_dir, my_name);
        fs.mkdirSync(path.dirname(my_path), { recursive: true });
        fs.writeFileSync(my_path, my_text);
    }
    return tmp_dir;
}

async function index(
    root: string,
    options: { settle?: boolean; backward_mode?: 'auto' | 'explicit' } = {},
): Promise<{ graph: DependencyGraph; parent_lookups: () => number }> {
    const graph = new DependencyGraph();
    graph.set_workspace_roots([root]);
    let parent_lookups = 0;
    const get_parents = graph.get_parents.bind(graph);
    graph.get_parents = (uri) => {
        parent_lookups++;
        return get_parents(uri);
    };
    const resolver = new ScopeResolver();
    resolver.set_workspace_roots([root]);
    resolver.set_dependency_graph(graph);
    const indexer = new WorkspaceIndexer();
    if (options.backward_mode) {
        indexer.configure({
            cross_file: { backward_dependencies: options.backward_mode },
        } as Parameters<WorkspaceIndexer['configure']>[0]);
    }
    indexer.set_dependency_graph(graph);
    indexer.set_scope_resolver(resolver);
    if (options.settle ?? true) {
        indexer.enable_working_directory_settle();
    }
    await indexer.initialize([root]);
    return { graph, parent_lookups: () => parent_lookups };
}

function callers(
    graph: DependencyGraph, root: string, callee: string,
): string[] {
    const uri = URI.file(path.join(root, callee)).toString();
    return graph.get_parents(uri).map((my_edge) =>
        path.relative(root, URI.parse(my_edge.caller_uri).fsPath)
            .split(path.sep).join('/'));
}

function callees(
    graph: DependencyGraph, root: string, caller: string,
): string[] {
    const uri = URI.file(path.join(root, caller)).toString();
    return [...graph.get_callees(uri)].map((my_uri) =>
        path.relative(root, URI.parse(my_uri).fsPath)
            .split(path.sep).join('/')).sort();
}

const CHAIN = {
    'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
    'work/jobs/a.do': 'do jobs/b.do\n',
    'work/jobs/b.do': 'do jobs/c.do\n',
    'work/jobs/c.do': 'do d.do\n',
    'work/d.do': 'display 1\n',
};

describe('WorkspaceIndexer working-directory settling', () => {
    it('links the third and fourth levels through inherited directories', async () => {
        const root = make_workspace(CHAIN);
        const { graph } = await index(root);
        expect(callers(graph, root, 'work/jobs/b.do')).toEqual(['work/jobs/a.do']);
        expect(callers(graph, root, 'work/jobs/c.do')).toEqual(['work/jobs/b.do']);
        expect(callers(graph, root, 'work/d.do')).toEqual(['work/jobs/c.do']);
    });

    it('leaves the language server index as it was without settling', async () => {
        const root = make_workspace(CHAIN);
        const { graph } = await index(root, { settle: false });
        expect(callers(graph, root, 'work/jobs/a.do')).toEqual(['main.do']);
        expect(callers(graph, root, 'work/jobs/b.do')).toEqual([]);
    });

    it('does not settle in explicit backward mode', async () => {
        const root = make_workspace(CHAIN);
        const { graph } = await index(root, { backward_mode: 'explicit' });
        expect(callers(graph, root, 'work/jobs/b.do')).toEqual([]);
    });

    it('passes nothing on through a call made after a literal cd', async () => {
        // Stata runs a.do in good/, so bad/branch/b.do is unreachable.
        // The walk would give a.do main.do's `bad`, so a.do keeps the
        // registration it had, and b.do gains no caller.
        const root = make_workspace({
            'main.do': '// sight: cd "bad"\ncd "../good"\ndo sub/a.do\n',
            'good/sub/a.do': 'do branch/b.do\n',
            'good/branch/b.do': 'display 1\n',
            'bad/branch/b.do': 'do lost.do\n',
            'bad/lost.do': 'display 1\n',
        });
        const { graph } = await index(root);
        expect(callers(graph, root, 'good/sub/a.do')).toEqual(['main.do']);
        expect(callers(graph, root, 'bad/branch/b.do')).toEqual([]);
        expect(callers(graph, root, 'good/branch/b.do')).toEqual([]);
    });

    it('blocks the files below a blocked caller as well', async () => {
        // a.do moves with a literal cd before calling b.do; b.do and
        // everything it calls keep their unsettled registrations.
        const root = make_workspace({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'cd "sub"\ndo b.do\n',
            'work/sub/b.do': 'do jobs/c.do\n',
            'work/jobs/c.do': 'display 1\n',
            'work/sub/jobs/c.do': 'display 1\n',
        });
        const { graph } = await index(root);
        expect(callees(graph, root, 'work/jobs/a.do')).toEqual(['work/sub/b.do']);
        expect(callees(graph, root, 'work/sub/b.do')).toEqual(['work/sub/jobs/c.do']);
    });

    it('takes the first caller\'s chain in parent order, as the walk does', async () => {
        // leaf.do's callers, in order: shared/aa.do (whose caller sets
        // w1) and shared/z.do (which sets w2 itself). The walk follows
        // aa.do's chain first.
        const root = make_workspace({
            'z.do': '// sight: cd w1\ndo ../shared/aa.do\n',
            'shared/z.do': '// sight: cd /w2\ndo ../shared/leaf.do\n',
            'shared/aa.do': 'do ../shared/leaf.do\n',
            'shared/leaf.do': 'do done.do\n',
            'w1/done.do': 'display 1\n',
            'w2/done.do': 'display 2\n',
        });
        const { graph } = await index(root);
        expect(callees(graph, root, 'shared/leaf.do')).toEqual(['w1/done.do']);
    });

    it('stops at the backward depth limit', async () => {
        const the_files: Record<string, string> = {
            'main.do': '// sight: cd "work"\ndo sub/a1.do\n',
        };
        for (let i = 1; i <= 15; i++) {
            the_files[`work/sub/a${i}.do`] =
                i === 15 ? 'display 1\n' : `do sub/a${i + 1}.do\n`;
        }
        const root = make_workspace(the_files);
        const { graph } = await index(root);
        // a10 is ten callers below main.do and inherits `work`; a11
        // would be eleven, past the default limit of ten.
        expect(callees(graph, root, 'work/sub/a10.do')).toEqual(['work/sub/a11.do']);
        expect(callees(graph, root, 'work/sub/a11.do'))
            .not.toContain('work/sub/a12.do');
    });

    it('costs a bounded number of parent lookups on a dense cycle', async () => {
        // Fourteen files that each call all fourteen, beside one file
        // with a directory: each round looks up each file's parents once.
        const size = 14;
        const the_files: Record<string, string> = {
            'unrelated.do': '// sight: cd "."\ndisplay 1\n',
        };
        for (let i = 0; i < size; i++) {
            the_files[`f${i}.do`] = Array.from(
                { length: size }, (_, j) => `do f${j}.do`).join('\n') + '\n';
        }
        const root = make_workspace(the_files);
        const start_ms = performance.now();
        const { graph, parent_lookups } = await index(root);
        const elapsed_ms = performance.now() - start_ms;
        expect(parent_lookups()).toBeLessThanOrEqual(size * (10 + 2));
        expect(elapsed_ms).toBeLessThan(5000);
        expect(callers(graph, root, 'f0.do')).toHaveLength(size);
    });

    it('settles a dense cycle reached from a directory, the same each run', async () => {
        const size = 12;
        const the_files: Record<string, string> = {
            'main.do': '// sight: cd "work"\ndo f0.do\n',
        };
        for (let i = 0; i < size; i++) {
            the_files[`f${i}.do`] = Array.from(
                { length: size }, (_, j) => `do f${j}.do`).join('\n') +
                '\ndo lib.do\n';
        }
        the_files['work/lib.do'] = 'display 1\n';
        const root = make_workspace(the_files);
        const first = await index(root);
        const second = await index(root);
        for (let i = 0; i < size; i++) {
            const my_callees = callees(first.graph, root, `f${i}.do`);
            expect(my_callees).toContain('work/lib.do');
            expect(callees(second.graph, root, `f${i}.do`)).toEqual(my_callees);
        }
        expect(first.parent_lookups()).toBeLessThanOrEqual(size * (10 + 2) + 1);
    });
});
