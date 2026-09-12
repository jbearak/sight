import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { DirectiveParser } from '../../src/directive-parser';
import { DependencyGraph } from '../../src/dependency-graph';
import { DocumentStore } from '../../src/document-store';
import type { ScopeResolverConfig } from '../../src/types';

const ROOT = '/tmp/sight-working-directory-probe';
const child_uri = URI.file(`${ROOT}/child.do`).toString();
const parent_uri = URI.file(`${ROOT}/parent.do`).toString();
const grandparent_uri = URI.file(`${ROOT}/grandparent.do`).toString();

function create_resolver(
    files: Map<string, string>,
    auto_edges: Array<[string, string]> = [],
) {
    const reads: string[] = [];
    const resolver = new ScopeResolver(undefined, {
        read_file: async (uri) => {
            reads.push(uri);
            const content = files.get(uri);
            if (content === undefined) throw new Error(`Missing file: ${uri}`);
            return content;
        },
        exists: async (uri) => files.has(uri),
    });
    const graph = new DependencyGraph();
    for (const [caller_uri, callee_uri] of auto_edges) {
        graph.update_caller(caller_uri, [{
            type: 'do',
            raw_path: URI.parse(callee_uri).fsPath,
            is_static: true,
            call_site_line: 0,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
            },
            source: 'command',
        }]);
    }
    resolver.set_dependency_graph(graph);
    return { resolver, reads };
}

describe('Document working-directory probe', () => {
    const the_restorers: Array<() => void> = [];
    afterEach(() => {
        for (const my_restore of the_restorers.splice(0)) my_restore();
    });

    const the_cases: Array<{
        name: string;
        content: string;
        parent: string;
        grandparent?: string;
        config?: Partial<ScopeResolverConfig>;
        auto_edges?: Array<[string, string]>;
        expected?: string;
    }> = [
        {
            name: 'explicit parent',
            content: '* sight: done-by "parent.do"\n',
            parent: '* sight: cd "data"\n',
            expected: `${ROOT}/data`,
        },
        {
            name: 'auto-discovered parent',
            content: 'display 1\n',
            parent: '* sight: cd "data"\n',
            auto_edges: [[parent_uri, child_uri]],
            expected: `${ROOT}/data`,
        },
        {
            name: 'auto-discovered grandparent',
            content: 'display 1\n',
            parent: 'display 2\n',
            grandparent: '* sight: cd "data"\n',
            auto_edges: [
                [parent_uri, child_uri],
                [grandparent_uri, parent_uri],
            ],
            expected: `${ROOT}/data`,
        },
        {
            name: 'explicit mode ignores auto parents',
            content: 'display 1\n',
            parent: '* sight: cd "data"\n',
            auto_edges: [[parent_uri, child_uri]],
            config: { backward_dependencies: 'explicit' },
        },
        {
            name: 'standalone child ignores all parents',
            content: '* sight: standalone\n* sight: done-by "parent.do"\n',
            parent: '* sight: cd "data"\n',
            auto_edges: [[parent_uri, child_uri]],
        },
        {
            name: 'standalone parent lends its own directory',
            content: '* sight: done-by "parent.do"\n',
            parent: '* sight: standalone\n* sight: cd "data"\n',
            expected: `${ROOT}/data`,
        },
        {
            name: 'standalone parent blocks its ancestors',
            content: '* sight: done-by "parent.do"\n',
            parent: '* sight: standalone\n' +
                '* sight: done-by "grandparent.do"\n',
            grandparent: '* sight: cd "data"\n',
        },
        {
            name: 'duplicate mixed directives retain parent precedence',
            content: '* sight: done-by "parent.do"\n' +
                '* sight: done-by "grandparent.do"\n' +
                '* sight: included-by "parent.do"\n',
            parent: '* sight: cd "first"\n',
            grandparent: '* sight: cd "second"\n',
            expected: `${ROOT}/first`,
        },
        ...[0, 1, 2].map(max_backward_depth => ({
            name: `grandparent depth limit ${max_backward_depth}`,
            content: '* sight: done-by "parent.do"\n',
            parent: '* sight: done-by "grandparent.do"\n',
            grandparent: '* sight: cd "data"\n',
            config: { max_backward_depth },
            expected: max_backward_depth >= 2 ? `${ROOT}/data` : undefined,
        })),
    ];

    for (const my_case of the_cases) {
        it(`matches full resolution for ${my_case.name}`, async () => {
            const files = new Map([[parent_uri, my_case.parent]]);
            if (my_case.grandparent !== undefined) {
                files.set(grandparent_uri, my_case.grandparent);
            }
            const { resolver } = create_resolver(files, my_case.auto_edges);
            const full = create_resolver(files, my_case.auto_edges).resolver;
            const directives = new DirectiveParser().parse(
                my_case.content, child_uri,
            );
            const actual = await resolver.resolve_document_working_directory(
                child_uri, directives, my_case.config,
            );
            const reference = await full.resolve(
                child_uri, my_case.content, my_case.config,
            );
            expect(actual).toBe(reference.inherited_working_directory);
            expect(actual).toBe(my_case.expected);
        });
    }

    it('leaves ancestor registrations for genuine scope resolution', async () => {
        const content = '* sight: done-by "parent.do"\n';
        const { resolver } = create_resolver(new Map([
            [parent_uri, '* sight: done-by "grandparent.do"\n'],
            [grandparent_uri, '* sight: cd "data"\n'],
        ]));
        const directives = new DirectiveParser().parse(content, child_uri);
        expect(await resolver.resolve_document_working_directory(
            child_uri, directives,
        )).toBe(`${ROOT}/data`);
        expect(resolver.get_backward_directive_children(parent_uri).size).toBe(0);
        expect(resolver.get_backward_directive_children(grandparent_uri).size)
            .toBe(0);

        await resolver.resolve(child_uri, content);
        expect(resolver.get_backward_directive_children(parent_uri)
            .has(child_uri)).toBe(true);
        expect(resolver.get_backward_directive_children(grandparent_uri)
            .has(parent_uri)).toBe(true);
    });

    it('does not revisit an unsaved root through a backward cycle', async () => {
        const content = '* sight: done-by "parent.do"\n';
        const files = new Map([
            [parent_uri, '* sight: done-by "child.do"\n'],
            [child_uri, '* sight: cd "stale-disk-directory"\n'],
        ]);
        const { resolver, reads } = create_resolver(files);
        const directives = new DirectiveParser().parse(content, child_uri);
        const actual = await resolver.resolve_document_working_directory(
            child_uri, directives,
        );
        const reference = await create_resolver(files).resolver.resolve(
            child_uri, content,
        );
        expect(actual).toBe(reference.inherited_working_directory);
        expect(actual).toBeUndefined();
        expect(reads).not.toContain(child_uri);
    });

    it('cancels during a parent read without registering or reading deeper', async () => {
        const source = new CancellationTokenSource();
        const reads: string[] = [];
        const resolver = new ScopeResolver(undefined, {
            read_file: async (uri) => {
                reads.push(uri);
                source.cancel();
                return '* sight: done-by "grandparent.do"\n';
            },
            exists: async () => true,
        });
        const directives = new DirectiveParser().parse(
            '* sight: done-by "parent.do"\n', child_uri,
        );
        expect(await resolver.resolve_document_working_directory(
            child_uri, directives, {}, source.token,
        )).toBeUndefined();
        expect(reads).toEqual([parent_uri]);
        expect(resolver.get_backward_directive_children(parent_uri).size).toBe(0);
        expect(resolver.get_backward_directive_children(grandparent_uri).size)
            .toBe(0);
        source.dispose();
    });

    it('DocumentStore avoids full scope work and repeated forward scanning', async () => {
        const store = new DocumentStore();
        const { resolver } = create_resolver(new Map());
        store.set_scope_resolver(resolver);
        const full_scope = spyOn(resolver, 'resolve');
        const forward_scan = spyOn(
            DirectiveParser.prototype, 'parse_forward_call_directives',
        );
        the_restorers.push(() => full_scope.mockRestore());
        the_restorers.push(() => forward_scan.mockRestore());
        await store.open(child_uri, '* sight: include "helper.do"\n', 1);
        expect(full_scope).not.toHaveBeenCalled();
        expect(forward_scan).toHaveBeenCalledTimes(1);
        expect(store.get(child_uri)?.forward_calls).toHaveLength(1);
        await store.dispose();
    });

    it('retains forward-directive recovery when full header parsing throws', async () => {
        const store = new DocumentStore();
        const parse = spyOn(DirectiveParser.prototype, 'parse')
            .mockImplementation(() => { throw new Error('header failure'); });
        the_restorers.push(() => parse.mockRestore());
        await store.open(child_uri, '* sight: include "helper.do"\n', 1);
        expect(store.get(child_uri)?.forward_calls).toHaveLength(1);
        expect(store.get(child_uri)?.forward_calls[0]?.source).toBe('directive');
        await store.dispose();
    });
});
