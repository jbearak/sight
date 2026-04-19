/**
 * Go-to-definition should prefer a forward include's callee when the current
 * file brings the macro into scope via `include`, even if another unrelated
 * file in the workspace also defines a local with the same name.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Definition — forward include brings macro into scope', () => {
    const test_temp_dir = join(process.cwd(), 'temp_definition_forward_include');
    let indexer: WorkspaceIndexer;
    let definition_provider: DefinitionProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        indexer = new WorkspaceIndexer();
        definition_provider = new DefinitionProvider();
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('navigates to the included file, not to an unrelated same-name local in the workspace', async () => {
        // 1.do includes 2.do, then references `fruit'.
        const file_1_path = join(test_temp_dir, '1.do');
        const file_1_content = 'include 2.do\ndi "`fruit\'"';
        writeFileSync(file_1_path, file_1_content);

        // 2.do defines local fruit — this is the real definition.
        const file_2_path = join(test_temp_dir, '2.do');
        const file_2_content = 'local fruit apple';
        writeFileSync(file_2_path, file_2_content);

        // A workspace neighbor that ALSO defines a local named `fruit`.
        // Historically the workspace-indexer fallback returned this too, which
        // produced a multi-result peek instead of a direct jump to 2.do.
        const callee_path = join(test_temp_dir, 'callee.do');
        const callee_content =
            '// @lsp-included-by: caller.do\nlocal fruit apple\n';
        writeFileSync(callee_path, callee_content);

        const caller_path = join(test_temp_dir, 'caller.do');
        writeFileSync(
            caller_path,
            'local espresso double\ninclude callee.do\ndi "`fruit\'"'
        );

        await indexer.initialize([test_temp_dir]);

        const file_1_uri = URI.file(file_1_path).toString();
        await document_store.open(file_1_uri, file_1_content, 1);
        const document_state = document_store.get(file_1_uri)!;

        // Cursor on `fruit' on line 1 (0-indexed) of 1.do — the backtick is
        // at col 5 inside `di "`fruit'"`, so the identifier starts at col 6.
        const definition = await definition_provider.get_definition(
            document_state,
            { line: 1, character: 7 },
            indexer.get_all_symbols(),
            undefined,
            scope_resolver,
            indexer
        );

        expect(definition).not.toBeNull();
        // Should be a single location, pointing at 2.do.
        expect(Array.isArray(definition)).toBe(false);
        const def_uri = Array.isArray(definition)
            ? definition[0].uri
            : (definition as { uri: string }).uri;
        expect(def_uri).toContain('2.do');
        expect(def_uri).not.toContain('callee.do');
    });
});
