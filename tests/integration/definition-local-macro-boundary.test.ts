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

function build_pipeline() {
    const the_indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    the_indexer.set_dependency_graph(the_dep_graph);

    const the_scope_resolver = new ScopeResolver();
    the_scope_resolver.set_dependency_graph(the_dep_graph);

    const the_forward_scope_resolver = new ForwardScopeResolver(
        the_scope_resolver,
        { max_forward_depth: 10 }
    );
    the_scope_resolver.set_forward_scope_resolver(
        the_forward_scope_resolver
    );

    return {
        indexer: the_indexer,
        provider: new DefinitionProvider(),
        document_store: new DocumentStore(),
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_scope_resolver,
    };
}

function as_locations(
    result: Awaited<ReturnType<DefinitionProvider['get_definition']>>
) {
    return Array.isArray(result) ? result : (result ? [result] : []);
}

describe('Go-to-definition - local macro do/run boundary', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'def-local-boundary-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try { pipeline?.scope_resolver?.dispose(); } catch (_err) { /* ignore cleanup error */ }
        try { pipeline?.forward_scope_resolver?.dispose(); } catch (_err) { /* ignore cleanup error */ }
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    async function prepare_main_document(
        call_type: 'do' | 'run',
        embedded: boolean
    ) {
        const lib_path = join(test_temp_dir, 'lib.do');
        writeFileSync(lib_path, 'local helper = "lib"\n');

        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(
            child_path,
            [
                'local helper = "child"',
                'di "`helper\'"',
            ].join('\n')
        );

        const main_path = join(test_temp_dir, 'main.do');
        const main_lines = embedded
            ? [
                'include "lib.do"',
                `${call_type} "child.do"`,
                'local helper = "main"',
                'mata',
                'st_local("x", "`helper\'")',
                'end',
            ]
            : [
                'include "lib.do"',
                `${call_type} "child.do"`,
                'local helper = "main"',
                'di "`helper\'"',
            ];
        const main_content = main_lines.join('\n');
        writeFileSync(main_path, main_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const lib_uri = URI.file(lib_path).toString();
        const child_uri = URI.file(child_path).toString();
        const main_uri = URI.file(main_path).toString();

        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const reference_line = embedded ? 4 : 3;
        const helper_char = main_lines[reference_line].indexOf('helper');

        return {
            lib_uri,
            child_uri,
            main_uri,
            document_state,
            reference_position: { line: reference_line, character: helper_char },
        };
    }

    async function prepare_pre_include_document(
        call_type: 'do' | 'run',
        embedded: boolean
    ) {
        const lib_path = join(test_temp_dir, 'lib.do');
        writeFileSync(lib_path, 'local helper = "lib"\n');

        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(
            child_path,
            [
                'local helper = "child"',
                'di "`helper\'"',
            ].join('\n')
        );

        const main_path = join(test_temp_dir, 'main.do');
        const main_lines = embedded
            ? [
                'local helper = "main"',
                `${call_type} "child.do"`,
                'mata',
                'st_local("x", "`helper\'")',
                'end',
                'include "lib.do"',
            ]
            : [
                'local helper = "main"',
                `${call_type} "child.do"`,
                'di "`helper\'"',
                'include "lib.do"',
            ];
        const main_content = main_lines.join('\n');
        writeFileSync(main_path, main_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const lib_uri = URI.file(lib_path).toString();
        const child_uri = URI.file(child_path).toString();
        const main_uri = URI.file(main_path).toString();

        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const reference_line = embedded ? 3 : 2;
        const helper_char = main_lines[reference_line].indexOf('helper');

        return {
            lib_uri,
            child_uri,
            main_uri,
            document_state,
            reference_position: { line: reference_line, character: helper_char },
        };
    }

    for (const my_call_type of ['do', 'run'] as const) {
        it(
            `only pools local macros through include chains across ${my_call_type}`,
            async () => {
                const prepared = await prepare_main_document(
                    my_call_type,
                    false
                );

                const result = await pipeline.provider.get_definition(
                    prepared.document_state,
                    prepared.reference_position,
                    pipeline.indexer.get_all_symbols(),
                    prepared.document_state.context_tracker,
                    pipeline.scope_resolver,
                    pipeline.indexer,
                );

                const locations = as_locations(result);
                const uris = new Set(locations.map(my_loc => my_loc.uri));

                expect(uris.has(prepared.main_uri)).toBe(true);
                expect(uris.has(prepared.lib_uri)).toBe(true);
                expect(uris.has(prepared.child_uri)).toBe(false);
            }
        );
    }

    for (const my_call_type of ['do', 'run'] as const) {
        it(
            `does not pull in later include or ${my_call_type} locals before the call site`,
            async () => {
                const prepared = await prepare_pre_include_document(
                    my_call_type,
                    false
                );

                const result = await pipeline.provider.get_definition(
                    prepared.document_state,
                    prepared.reference_position,
                    pipeline.indexer.get_all_symbols(),
                    prepared.document_state.context_tracker,
                    pipeline.scope_resolver,
                    pipeline.indexer,
                );

                const locations = as_locations(result);
                const uris = new Set(locations.map(my_loc => my_loc.uri));

                expect(uris.has(prepared.main_uri)).toBe(true);
                expect(uris.has(prepared.lib_uri)).toBe(false);
                expect(uris.has(prepared.child_uri)).toBe(false);
            }
        );
    }

    for (const my_call_type of ['do', 'run'] as const) {
        it(
            `embedded-language local macro lookup stays inside include chains across ${my_call_type}`,
            async () => {
                const prepared = await prepare_main_document(
                    my_call_type,
                    true
                );

                const result = await pipeline.provider.get_definition(
                    prepared.document_state,
                    prepared.reference_position,
                    pipeline.indexer.get_all_symbols(),
                    prepared.document_state.context_tracker,
                    pipeline.scope_resolver,
                    pipeline.indexer,
                );

                const locations = as_locations(result);
                const uris = new Set(locations.map(my_loc => my_loc.uri));

                expect(uris.has(prepared.main_uri)).toBe(true);
                expect(uris.has(prepared.lib_uri)).toBe(true);
                expect(uris.has(prepared.child_uri)).toBe(false);
            }
        );
    }

    for (const my_call_type of ['do', 'run'] as const) {
        it(
            `embedded-language lookup does not pull in later include or ${my_call_type} locals before the call site`,
            async () => {
                const prepared = await prepare_pre_include_document(
                    my_call_type,
                    true
                );

                const result = await pipeline.provider.get_definition(
                    prepared.document_state,
                    prepared.reference_position,
                    pipeline.indexer.get_all_symbols(),
                    prepared.document_state.context_tracker,
                    pipeline.scope_resolver,
                    pipeline.indexer,
                );

                const locations = as_locations(result);
                const uris = new Set(locations.map(my_loc => my_loc.uri));

                expect(uris.has(prepared.main_uri)).toBe(true);
                expect(uris.has(prepared.lib_uri)).toBe(false);
                expect(uris.has(prepared.child_uri)).toBe(false);
            }
        );
    }
});
