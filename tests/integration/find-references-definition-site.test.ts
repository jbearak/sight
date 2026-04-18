/**
 * Integration tests reproducing the bug where Go to References fails:
 *   1. Cursor on a global macro at its definition site (WORD token, not $name).
 *   2. Cursor on a cross-file variable whose definition lives in a parent file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

describe('Find References - definition site & cross-file symbols', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let references_provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-'));
        indexer = new WorkspaceIndexer();
        references_provider = new ReferencesProvider();
        document_store = new DocumentStore();
    });

    afterEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('finds global macro references when cursor is on the definition name', async () => {
        const main_path = join(test_temp_dir, 'demo_main.do');
        const main_content =
            `* Main analysis file\n` +
            `clear all\n` +
            `global data_path "data"\n` +
            `do "demo_subprocess.do"\n`;
        writeFileSync(main_path, main_content);

        const sub_path = join(test_temp_dir, 'demo_subprocess.do');
        const sub_content = `local input_file "$data_path/survey.dta"\n`;
        writeFileSync(sub_path, sub_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        // Cursor in the middle of `data_path` on the `global data_path ...` line
        const global_line = 2;
        const data_path_char = main_content
            .split('\n')[global_line]
            .indexOf('data_path') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: global_line, character: data_path_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const sub_uri = URI.file(sub_path).toString();
        const has_sub_ref = locations.some(
            loc => loc.uri === sub_uri && loc.range.start.line === 0
        );
        expect(has_sub_ref).toBe(true);
    });

    it('does not treat a plain WORD as a macro reference away from the declaration', async () => {
        const main_path = join(test_temp_dir, 'plain.do');
        const main_content =
            `global data_path "data"\n` +
            `display data_path\n` +
            `display "$data_path"\n`;
        writeFileSync(main_path, main_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        // Cursor on `data_path` inside `display data_path` (not a macro ref)
        const plain_line = 1;
        const plain_char = main_content
            .split('\n')[plain_line]
            .indexOf('data_path') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: plain_line, character: plain_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        // The plain WORD isn't a variable/program/etc., so we shouldn't
        // surface `$data_path` references or the `global data_path` declaration.
        const macro_ref_line = 2;
        const includes_macro_ref = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === macro_ref_line
        );
        expect(includes_macro_ref).toBe(false);
        const decl_line = 0;
        const includes_decl = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === decl_line
        );
        expect(includes_decl).toBe(false);
    });

    it('finds cross-file variable references from a child file', async () => {
        const main_path = join(test_temp_dir, 'demo_main.do');
        const main_content =
            `clear all\n` +
            `do "demo_subprocess.do"\n` +
            `gen analysis_sample = 1\n`;
        writeFileSync(main_path, main_content);

        const sub_path = join(test_temp_dir, 'demo_subprocess.do');
        // @lsp-done-by lets the child see parent's non-local symbols
        const sub_content =
            `* @lsp-done-by: "demo_main.do"\n` +
            `\n` +
            `tab analysis_sample\n`;
        writeFileSync(sub_path, sub_content);

        await indexer.initialize([test_temp_dir]);

        const sub_uri = URI.file(sub_path).toString();
        await document_store.open(sub_uri, sub_content, 1);
        const document_state = document_store.get(sub_uri)!;

        const tab_line = 2;
        const analysis_char = sub_content
            .split('\n')[tab_line]
            .indexOf('analysis_sample') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: tab_line, character: analysis_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const main_uri = URI.file(main_path).toString();
        const has_main_ref = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === 2
        );
        expect(has_main_ref).toBe(true);
    });

    it('does not enumerate a program definition twice when the cursor is on the name', async () => {
        const main_path = join(test_temp_dir, 'demo_main.do');
        const main_content =
            `* Main analysis file\n` +
            `program define clean_survey_data\n` +
            `    drop if age < 0\n` +
            `end\n` +
            `do "demo_subprocess.do"\n`;
        writeFileSync(main_path, main_content);

        const sub_path = join(test_temp_dir, 'demo_subprocess.do');
        const sub_content =
            `* Sub-analysis\n` +
            `clean_survey_data\n`;
        writeFileSync(sub_path, sub_content);

        await indexer.initialize([test_temp_dir]);

        const sub_uri = URI.file(sub_path).toString();
        await document_store.open(sub_uri, sub_content, 1);
        const sub_document_state = document_store.get(sub_uri)!;

        // Cursor inside `clean_survey_data` on the call line.
        const call_line = 1;
        const name_char = sub_content
            .split('\n')[call_line]
            .indexOf('clean_survey_data') + 3;

        const locations = await references_provider.get_references(
            sub_document_state,
            { line: call_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            sub_document_state.context_tracker
        );

        const main_uri = URI.file(main_path).toString();
        const main_refs = locations.filter(loc => loc.uri === main_uri);
        // We should see exactly one location in `demo_main.do`
        // (the program definition). The old code listed the declaration name
        // range AND the full program body range separately.
        expect(main_refs.length).toBe(1);

        // Whichever range is returned, it must be a single-line range (not the
        // multi-line full program body).
        const the_main_ref = main_refs[0];
        expect(the_main_ref.range.start.line).toBe(the_main_ref.range.end.line);
    });

    it('excludes cross-file declarations when includeDeclaration is false', async () => {
        const main_path = join(test_temp_dir, 'demo_main.do');
        const main_content =
            `clear all\n` +
            `do "demo_subprocess.do"\n` +
            `gen analysis_sample = 1\n`;
        writeFileSync(main_path, main_content);

        const sub_path = join(test_temp_dir, 'demo_subprocess.do');
        const sub_content =
            `* @lsp-done-by: "demo_main.do"\n` +
            `\n` +
            `tab analysis_sample\n`;
        writeFileSync(sub_path, sub_content);

        await indexer.initialize([test_temp_dir]);

        const sub_uri = URI.file(sub_path).toString();
        await document_store.open(sub_uri, sub_content, 1);
        const document_state = document_store.get(sub_uri)!;

        const tab_line = 2;
        const analysis_char = sub_content
            .split('\n')[tab_line]
            .indexOf('analysis_sample') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: tab_line, character: analysis_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const main_uri = URI.file(main_path).toString();
        // With includeDeclaration=false, the parent definition line must be excluded.
        const includes_parent_def = locations.some(
            loc => loc.uri === main_uri && loc.range.start.line === 2
        );
        expect(includes_parent_def).toBe(false);
        // But the child reference should still be present.
        const has_child_ref = locations.some(
            loc => loc.uri === sub_uri && loc.range.start.line === tab_line
        );
        expect(has_child_ref).toBe(true);
    });
});
