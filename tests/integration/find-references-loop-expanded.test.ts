/**
 * Find References must not surface loop-expanded macro DEFINITIONS as
 * references. A constructed name like `local x_`i'` is anchored at the template
 * statement, whose text does not contain the concrete expanded name (e.g.
 * `x_1`), so listing that line would point the user at a location they cannot
 * reconcile with the searched name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find References - loop-expanded macros', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let references_provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-loop-'));
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        references_provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not list the loop-body template line for a fresh expanded name', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `foreach i in a b {\n` +     // line 0
            `    local prefix_\`i' = 1\n` + // line 1 (template)
            `}\n` +                       // line 2
            `display \`prefix_a'\n`;      // line 3 (real reference)
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const ref_line = 3;
        const name_char = main_content
            .split('\n')[ref_line]
            .indexOf('prefix_a') + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // The real reference is present.
        const has_real_ref = locations.some(
            (loc) => loc.uri === main_uri && loc.range.start.line === ref_line
        );
        expect(has_real_ref).toBe(true);

        // The template line (which has no literal `prefix_a`) is NOT surfaced.
        const has_template_line = locations.some(
            (loc) => loc.uri === main_uri && loc.range.start.line === 1
        );
        expect(has_template_line).toBe(false);
    });

    it('does not list the template line when an expanded name collides with a real macro', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `local x_1 = 9\n` +        // line 0 (real definition)
            `foreach i in 1 2 {\n` +   // line 1
            `    local x_\`i' = 1\n` + // line 2 (template; expands to x_1, x_2)
            `}\n` +                    // line 3
            `display \`x_1'\n`;        // line 4 (reference)
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const ref_line = 4;
        const name_char = main_content
            .split('\n')[ref_line]
            .indexOf('x_1') + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // The synthetic loop-template line (2) must never appear.
        const has_template_line = locations.some(
            (loc) => loc.uri === main_uri && loc.range.start.line === 2
        );
        expect(has_template_line).toBe(false);

        // The reference on line 4 is still present.
        const has_real_ref = locations.some(
            (loc) => loc.uri === main_uri && loc.range.start.line === ref_line
        );
        expect(has_real_ref).toBe(true);
    });
});
