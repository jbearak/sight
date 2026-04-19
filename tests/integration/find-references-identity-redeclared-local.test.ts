/**
 * Find-references - same-name local redeclarations pool into one identity
 * (issue #135).
 *
 * Two `local fruit ...` declarations in the same file are the same macro
 * from the programmer's perspective; find-references must pool their
 * declarations and references into one result set.
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

describe('Find-references - redeclared local (same file)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-redecl-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools declarations and references across two same-file redeclarations', async () => {
        const file_path = join(test_temp_dir, 'a.do');
        const content = [
            'local fruit apple',          // line 0 (decl 1)
            'di "`fruit\' is apple"',     // line 1 (ref 1)
            'local fruit banana',         // line 2 (decl 2)
            'di "`fruit\' is banana"',    // line 3 (ref 2)
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        // Cursor on `fruit' at line 3
        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: fruit_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        // Must include both decl lines (0, 2) and both ref lines (1, 3).
        expect(lines).toContain(0);
        expect(lines).toContain(1);
        expect(lines).toContain(2);
        expect(lines).toContain(3);
    });

    it('pools references across same-file redeclarations (includeDeclaration=false)', async () => {
        const file_path = join(test_temp_dir, 'b.do');
        const content = [
            'local fruit apple',
            'di "`fruit\' is apple"',
            'local fruit banana',
            'di "`fruit\' is banana"',
        ].join('\n');
        writeFileSync(file_path, content);
        await indexer.initialize([test_temp_dir]);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri)!;

        const fruit_char = content.split('\n')[3].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: fruit_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const ref_lines = locations
            .filter(loc => loc.uri === uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        expect(ref_lines).toContain(1);
        expect(ref_lines).toContain(3);
    });
});

describe('Find-references - in-chain identity (cross-file, ScopeResolver wired)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-redecl-chain-'));
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
        try { scope_resolver?.dispose(); } catch {}
        try { forward_scope_resolver?.dispose(); } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools local macro references across include chain (same name, same identity)', async () => {
        const lib_path = join(test_temp_dir, 'lib.do');
        const lib_content = [
            'local helper = "1"',       // line 0 (decl in lib)
            'di "`helper\' in lib"',    // line 1 (ref in lib)
        ].join('\n');
        writeFileSync(lib_path, lib_content);

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'include "lib.do"',         // line 0
            'local helper = "2"',       // line 1 (decl in main)
            'di "`helper\' in main"',   // line 2 (ref in main)
        ].join('\n');
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);
        const lib_uri = URI.file(lib_path).toString();
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const helper_char = main_content.split('\n')[2].indexOf('helper');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: helper_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // Expect declarations + references from BOTH files.
        const lib_hits = locations
            .filter(loc => loc.uri === lib_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);
        const main_hits = locations
            .filter(loc => loc.uri === main_uri)
            .map(loc => loc.range.start.line)
            .sort((a, b) => a - b);

        expect(lib_hits).toContain(0);  // lib decl
        expect(lib_hits).toContain(1);  // lib ref
        expect(main_hits).toContain(1); // main decl
        expect(main_hits).toContain(2); // main ref
    });
});
