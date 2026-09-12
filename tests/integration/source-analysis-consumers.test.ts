import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import type { ForwardCall } from '../../src/types';
import type { RichResolveFs } from '../../src/utils/file-path-utils';

class RecordingGraph extends DependencyGraph {
    readonly calls = new Map<string, ForwardCall[]>();

    override update_caller(uri: string, calls: ForwardCall[]) {
        this.calls.set(uri, calls);
        return super.update_caller(uri, calls);
    }
}

describe('Source-analysis consumers', () => {
    let temp_dir: string;
    const the_stores: DocumentStore[] = [];
    const the_indexers: WorkspaceIndexer[] = [];

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-projections-'));
    });

    afterEach(async () => {
        for (const my_store of the_stores.splice(0)) await my_store.dispose();
        for (const my_indexer of the_indexers.splice(0)) my_indexer.cancel();
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_file(relative_path: string, content: string): string {
        const file_path = path.join(temp_dir, relative_path);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    for (const inherited of [false, true]) {
        it(`shares ${inherited ? 'inherited' : 'own'} directory projections`, async () => {
            const content = [
                inherited
                    ? '* sight: done-by "parent.do"'
                    : '* sight: cd "data"',
                '* sight: include "header.do"',
                'do "first.do"',
                'cd "sub"',
                'include "second.do"',
                '* sight: do "tail.do"',
                'Cd "ignored-directory"',
                'Do "ignored-command.do"',
                'run "third.do"',
                '',
            ].join('\n');
            write_file('parent.do', '* sight: cd "data"\n');
            const child_path = write_file('child.do', content);
            const child_uri = URI.file(child_path).toString();
            const the_targets = [
                'data/header.do', 'data/first.do', 'data/tail.do',
                'data/sub/second.do', 'data/sub/third.do',
            ];
            for (const my_target of the_targets) {
                write_file(my_target, 'display 1\n');
            }

            const resolver = new ScopeResolver();
            resolver.set_workspace_roots([temp_dir]);
            const indexer = new WorkspaceIndexer();
            the_indexers.push(indexer);
            const indexed_graph = new RecordingGraph();
            indexed_graph.set_workspace_roots([temp_dir]);
            indexer.set_dependency_graph(indexed_graph);
            indexer.set_scope_resolver(resolver);
            await indexer.initialize([temp_dir]);

            const store = new DocumentStore();
            the_stores.push(store);
            store.set_workspace_roots([temp_dir]);
            store.set_scope_resolver(resolver);
            await store.open(child_uri, content, 1);
            const document = store.get(child_uri);
            if (!document) throw new Error('Document failed to open');
            const parsed = await resolver.get_parsed_file(
                child_uri,
                child_path,
                { working_directory: document.working_directory },
            );
            if ('error' in parsed) throw new Error(parsed.error);

            expect(document.working_directory).toBe(path.join(temp_dir, 'data'));
            expect(parsed.forward_calls).toEqual(document.forward_calls);
            expect(indexed_graph.calls.get(child_uri)).toEqual(
                [...document.forward_calls].sort(
                    (a, b) => a.call_site_line - b.call_site_line,
                ),
            );
            expect(document.forward_calls.map(call => [
                call.raw_path, call.working_directory,
            ])).toEqual([
                ['first.do', path.join(temp_dir, 'data')],
                ['second.do', path.join(temp_dir, 'data/sub')],
                ['third.do', path.join(temp_dir, 'data/sub')],
                ['header.do', path.join(temp_dir, 'data')],
                ['tail.do', path.join(temp_dir, 'data')],
            ]);

            const expected_callees = new Set(the_targets.map(
                target => URI.file(path.join(temp_dir, target)).toString(),
            ));
            expect(indexed_graph.get_callees(child_uri)).toEqual(expected_callees);
            for (const my_calls of [document.forward_calls, parsed.forward_calls]) {
                const graph = new DependencyGraph();
                graph.set_workspace_roots([temp_dir]);
                graph.update_caller(child_uri, my_calls);
                expect(graph.get_callees(child_uri)).toEqual(expected_callees);
                for (const my_callee of expected_callees) {
                    expect(graph.get_parents(my_callee)).toEqual(
                        indexed_graph.get_parents(my_callee),
                    );
                }
            }
        });
    }

    it('keeps the resolver filesystem adapter in directory projection', async () => {
        const child_path = write_file('child.do', 'cd "virtual"\ndo "child.do"\n');
        const child_uri = URI.file(child_path).toString();
        const virtual_dir = path.join(temp_dir, 'Virtual');
        const resolve_fs: RichResolveFs = {
            readdirSync: (dir, options) => dir === temp_dir
                ? [...fs.readdirSync(dir, options), {
                    name: 'Virtual',
                    isFile: () => false,
                    isDirectory: () => true,
                    isSymbolicLink: () => false,
                }]
                : fs.readdirSync(dir, options),
            existsSync: file_path => file_path === virtual_dir ||
                fs.existsSync(file_path),
            statSync: file_path => file_path === virtual_dir
                ? { isFile: () => false, isDirectory: () => true }
                : fs.statSync(file_path),
        };
        const resolver = new ScopeResolver();
        resolver.set_workspace_roots([temp_dir]);
        resolver.set_resolve_fs(resolve_fs);
        const parsed = await resolver.get_parsed_file(child_uri, child_path);
        if ('error' in parsed) throw new Error(parsed.error);
        expect(parsed.forward_calls[0]?.working_directory).toBe(virtual_dir);
        expect(fs.existsSync(virtual_dir)).toBe(false);
    });

    it('keeps native Mata indexing separate from Stata call extraction', async () => {
        const mata_path = write_file('native.MATA', [
            'function NativeHelper(x) {',
            '    return(x)',
            '}',
            '// sight: include "ignored.do"',
            '',
        ].join('\n'));
        write_file('ignored.do', 'display 1\n');
        const indexer = new WorkspaceIndexer();
        the_indexers.push(indexer);
        const graph = new RecordingGraph();
        indexer.set_dependency_graph(graph);
        await indexer.initialize([temp_dir]);
        const mata_uri = URI.file(mata_path).toString();
        expect(indexer.get_all_symbols().programs.has('NativeHelper')).toBe(true);
        expect(indexer.get_all_symbols().programs.has('nativehelper')).toBe(false);
        expect(graph.calls.has(mata_uri)).toBe(false);
        expect(graph.get_callees(mata_uri).size).toBe(0);
    });
});
