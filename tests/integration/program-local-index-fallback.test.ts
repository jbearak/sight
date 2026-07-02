/**
 * Integration tests for issue #271, indexer-fallback surface: the
 * workspace-indexer paths in definition / references / hover must not
 * surface program-body locals from include-related files. These paths
 * bypass the scope resolvers (they read the indexer's flat symbol
 * tables directly), so they need their own containingScope gate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { ReferencesProvider } from '../../src/providers/references';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { Location, MarkupContent } from 'vscode-languageserver';

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

    return {
        indexer: the_indexer,
        dependency_graph: the_dep_graph,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        definition_provider: new DefinitionProvider(),
        references_provider: new ReferencesProvider(the_scope_resolver),
        hover_provider: new HoverProvider(new CommandDatabase()),
        document_store: new DocumentStore(),
    };
}

function as_locations(
    result: Location | Location[] | null
): Location[] {
    return Array.isArray(result) ? result : (result ? [result] : []);
}

function hover_text(contents: unknown): string {
    if (typeof contents === 'string') return contents;
    if (contents && typeof contents === 'object' && 'value' in contents) {
        return String((contents as MarkupContent).value);
    }
    return JSON.stringify(contents);
}

describe('Indexer fallbacks - program-body locals in include-related files (issue #271)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'prog-local-fallback-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try { pipeline?.scope_resolver?.dispose(); } catch { /* ignore */ }
        try { pipeline?.forward_scope_resolver?.dispose(); } catch { /* ignore */ }
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    async function open_main(main_path: string, main_content: string) {
        await pipeline.indexer.initialize([test_temp_dir]);
        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        return pipeline.document_store.get(main_uri)!;
    }

    describe('go-to-definition', () => {
        it('does not navigate to a program-body local in an included file', async () => {
            const child_path = join(test_temp_dir, 'child.do');
            writeFileSync(child_path, `program define p
    local hidden 1
end`);

            const main_path = join(test_temp_dir, 'main.do');
            const main_content = `include "child.do"
di \`hidden'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const hidden_char = main_content.split('\n')[1].indexOf('hidden');

            const result = await pipeline.definition_provider.get_definition(
                document_state,
                { line: 1, character: hidden_char },
                pipeline.indexer.get_all_symbols(),
                document_state.context_tracker,
                pipeline.scope_resolver,
                pipeline.indexer,
            );

            const child_uri = URI.file(child_path).toString();
            const uris = new Set(as_locations(result).map(loc => loc.uri));
            expect(uris.has(child_uri)).toBe(false);
        });

        it('still navigates to a dofile-level local in an included file (control)', async () => {
            const child_path = join(test_temp_dir, 'child_ok.do');
            writeFileSync(child_path, 'local visible 1');

            const main_path = join(test_temp_dir, 'main_ok.do');
            const main_content = `include "child_ok.do"
di \`visible'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const visible_char = main_content.split('\n')[1].indexOf('visible');

            const result = await pipeline.definition_provider.get_definition(
                document_state,
                { line: 1, character: visible_char },
                pipeline.indexer.get_all_symbols(),
                document_state.context_tracker,
                pipeline.scope_resolver,
                pipeline.indexer,
            );

            const child_uri = URI.file(child_path).toString();
            const uris = new Set(as_locations(result).map(loc => loc.uri));
            expect(uris.has(child_uri)).toBe(true);
        });
    });

    describe('find references', () => {
        it('does not pool a program-body local declaration from an include-related file', async () => {
            // The child contains ONLY the program-body declaration (no
            // backtick references), so any child location in the result
            // can only come from the cross-file declaration pooling path.
            const child_path = join(test_temp_dir, 'child_refs.do');
            writeFileSync(child_path, `program define p
    local hidden 1
end`);

            const main_path = join(test_temp_dir, 'main_refs.do');
            const main_content = `include "child_refs.do"
di \`hidden'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const line1 = main_content.split('\n')[1];
            const hidden_char = line1.indexOf('hidden');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: 1, character: hidden_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker
            );

            const child_uri = URI.file(child_path).toString();
            expect(locations.some(loc => loc.uri === child_uri)).toBe(false);
        });

        it('still pools a dofile-level local declaration from an included file (control)', async () => {
            const child_path = join(test_temp_dir, 'child_refs_ok.do');
            writeFileSync(child_path, 'local visible 1');

            const main_path = join(test_temp_dir, 'main_refs_ok.do');
            const main_content = `include "child_refs_ok.do"
di \`visible'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const visible_char = main_content.split('\n')[1].indexOf('visible');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: 1, character: visible_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker
            );

            const child_uri = URI.file(child_path).toString();
            expect(locations.some(loc => loc.uri === child_uri)).toBe(true);
        });
    });

    describe('same-file program-body locals (control)', () => {
        // The cross-file gate must not block ordinary navigation for a
        // program-body local declared and used in the SAME document.
        const same_file_content = `program define p
    local hidden 1
    di "\`hidden'"
end`;

        it('go-to-definition still resolves within the defining file', async () => {
            const main_path = join(test_temp_dir, 'same_def.do');
            writeFileSync(main_path, same_file_content);

            const document_state = await open_main(main_path, same_file_content);
            const hidden_char = same_file_content.split('\n')[2].indexOf('hidden');

            const result = await pipeline.definition_provider.get_definition(
                document_state,
                { line: 2, character: hidden_char },
                pipeline.indexer.get_all_symbols(),
                document_state.context_tracker,
                pipeline.scope_resolver,
                pipeline.indexer,
            );

            const main_uri = URI.file(main_path).toString();
            const locations = as_locations(result);
            expect(locations.some(
                loc => loc.uri === main_uri && loc.range.start.line === 1
            )).toBe(true);
        });

        it('find references still works within the defining file', async () => {
            const main_path = join(test_temp_dir, 'same_refs.do');
            writeFileSync(main_path, same_file_content);

            const document_state = await open_main(main_path, same_file_content);
            const hidden_char = same_file_content.split('\n')[2].indexOf('hidden');

            const locations = await pipeline.references_provider.get_references(
                document_state,
                { line: 2, character: hidden_char },
                { includeDeclaration: true },
                pipeline.indexer,
                document_state.context_tracker
            );

            const main_uri = URI.file(main_path).toString();
            // The declaration (line 1) is pooled and the reference
            // (line 2) is found — the gate only hides cross-file hits.
            expect(locations.some(
                loc => loc.uri === main_uri && loc.range.start.line === 1
            )).toBe(true);
            expect(locations.some(
                loc => loc.uri === main_uri && loc.range.start.line === 2
            )).toBe(true);
        });

        it('hover still works within the defining file', async () => {
            const main_path = join(test_temp_dir, 'same_hover.do');
            writeFileSync(main_path, same_file_content);

            const document_state = await open_main(main_path, same_file_content);
            const hidden_char = same_file_content.split('\n')[2].indexOf('hidden');

            const hover = await pipeline.hover_provider.get_hover(
                document_state,
                { line: 2, character: hidden_char },
                pipeline.indexer.get_all_symbols(),
                pipeline.scope_resolver,
                undefined,
                undefined,
                test_temp_dir,
                pipeline.indexer,
            );

            expect(hover).not.toBeNull();
            expect(hover_text(hover!.contents)).toContain('hidden');
        });
    });

    describe('hover redefinition footer', () => {
        it('omits program-body locals from include-related files', async () => {
            const child_path = join(test_temp_dir, 'child_hover.do');
            writeFileSync(child_path, `program define p
    local shared 2
end`);

            const main_path = join(test_temp_dir, 'main_hover.do');
            const main_content = `local shared 1
include "child_hover.do"
di \`shared'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const shared_char = main_content.split('\n')[2].indexOf('shared');

            const hover = await pipeline.hover_provider.get_hover(
                document_state,
                { line: 2, character: shared_char },
                pipeline.indexer.get_all_symbols(),
                pipeline.scope_resolver,
                undefined,
                undefined,
                test_temp_dir,
                pipeline.indexer,
            );

            expect(hover).not.toBeNull();
            expect(hover_text(hover!.contents)).not.toContain('child_hover.do');
        });

        it('still lists dofile-level redefinitions from included files (control)', async () => {
            const child_path = join(test_temp_dir, 'child_hover_ok.do');
            writeFileSync(child_path, 'local shared 2');

            const main_path = join(test_temp_dir, 'main_hover_ok.do');
            const main_content = `local shared 1
include "child_hover_ok.do"
di \`shared'`;
            writeFileSync(main_path, main_content);

            const document_state = await open_main(main_path, main_content);
            const shared_char = main_content.split('\n')[2].indexOf('shared');

            const hover = await pipeline.hover_provider.get_hover(
                document_state,
                { line: 2, character: shared_char },
                pipeline.indexer.get_all_symbols(),
                pipeline.scope_resolver,
                undefined,
                undefined,
                test_temp_dir,
                pipeline.indexer,
            );

            expect(hover).not.toBeNull();
            expect(hover_text(hover!.contents)).toContain('child_hover_ok.do');
        });
    });
});
