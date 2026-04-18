/**
 * Integration tests ensuring find-references ignores stale disk-indexed
 * symbols from the current file when the open buffer has fresher content.
 *
 * The workspace indexer scans files from disk; unsaved edits in the active
 * buffer only live in DocumentStore. If the indexer still reports symbols
 * that the buffer has deleted (or moved), find-references must trust the
 * in-memory analysis and not resurrect those stale entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find References - stale index for current document', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let references_provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-stale-'));
        indexer = new WorkspaceIndexer();
        references_provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not classify a WORD via a stale disk-indexed symbol from the same file', async () => {
        // Disk: defines program `my_prog` and calls it.
        const disk_content =
            `program define my_prog\n` +
            `end\n` +
            `\n` +
            `my_prog\n`;
        const main_path = join(test_temp_dir, 'main.do');
        writeFileSync(main_path, disk_content);

        await indexer.initialize([test_temp_dir]);

        // Unsaved buffer: program definition deleted, leaving only the call.
        const in_memory_content =
            `\n` +
            `\n` +
            `\n` +
            `my_prog\n`;
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, in_memory_content, 2);
        const document_state = document_store.get(main_uri)!;

        // Cursor on `my_prog` call at line 3.
        const call_line = 3;
        const name_char = in_memory_content
            .split('\n')[call_line]
            .indexOf('my_prog') + 2;

        const locations = await references_provider.get_references(
            document_state,
            { line: call_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // The program no longer exists in the current buffer; the stale
        // on-disk definition (line 0 or the program body starting at line 0)
        // must not leak into the result.
        const stale_decl_present = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === 0
        );
        expect(stale_decl_present).toBe(false);
    });

    it('prefers the in-memory declaration over a stale disk-indexed one for the same file', async () => {
        // Disk: global declaration at line 0.
        const disk_content =
            `global data_path "data"\n` +
            `display "$data_path"\n`;
        const main_path = join(test_temp_dir, 'main.do');
        writeFileSync(main_path, disk_content);

        await indexer.initialize([test_temp_dir]);

        // Unsaved buffer: declaration moved down to line 2.
        const in_memory_content =
            `\n` +
            `\n` +
            `global data_path "data"\n` +
            `display "$data_path"\n`;
        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, in_memory_content, 2);
        const document_state = document_store.get(main_uri)!;

        // Cursor on the `$data_path` reference at line 3.
        const ref_line = 3;
        const ref_char = in_memory_content
            .split('\n')[ref_line]
            .indexOf('data_path') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: ref_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // The in-memory declaration (line 2) should be present.
        const fresh_decl_present = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === 2
        );
        expect(fresh_decl_present).toBe(true);

        // The stale disk declaration (line 0) must not be reported.
        const stale_decl_present = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === 0
        );
        expect(stale_decl_present).toBe(false);
    });
});
