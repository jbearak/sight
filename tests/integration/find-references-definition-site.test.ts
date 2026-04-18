/**
 * Integration tests reproducing the bug where Go to References fails:
 *   1. Cursor on a global macro at its definition site (WORD token, not $name).
 *   2. Cursor on a cross-file variable whose definition lives in a parent file.
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

describe('Find References - definition site & cross-file symbols', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let references_provider: ReferencesProvider;
    let document_store: DocumentStore;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-'));
        indexer = new WorkspaceIndexer();
        // Mirror server-factory wiring: without a dep graph, find-references
        // cannot scope its workspace scan to files that are actually related
        // to the current file.
        indexer.set_dependency_graph(new DependencyGraph());
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

    it('excludes references from workspace files unrelated to the current file by dep-graph for programs', async () => {
        // Current file has no parent/child relationship with `unrelated.do`,
        // which just happens to define a same-named program.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `program define shared_prog\n` +
            `end\n` +
            `shared_prog\n`;
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        const unrelated_content =
            `program define shared_prog\n` +
            `end\n` +
            `shared_prog\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const call_line = 2;
        const name_char = main_content
            .split('\n')[call_line]
            .indexOf('shared_prog') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: call_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const unrelated_uri = URI.file(unrelated_path).toString();
        const leaks_unrelated = locations.some(loc => loc.uri === unrelated_uri);
        expect(leaks_unrelated).toBe(false);

        // Sanity: current-file refs are still present.
        const has_main_ref = locations.some(loc => loc.uri === main_uri);
        expect(has_main_ref).toBe(true);
    });

    it('sorts variable references with dep-graph-related files before unrelated ones', async () => {
        // Three files: main.do (current), child.do (related via do call),
        // zzz_unrelated.do (same-named variable, no dep-graph edges). With a
        // plain URI sort, child.do (sub-folder) would alphabetize ahead of
        // main, and zzz_unrelated would fall last by accident — we want the
        // tier check to be what puts related files ahead regardless of URI.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `gen wage = 1\n` +
            `do "aaa_child.do"\n` +
            `display wage\n`;
        writeFileSync(main_path, main_content);

        const child_path = join(test_temp_dir, 'aaa_child.do');
        const child_content =
            `* @lsp-done-by: "main.do"\n` +
            `replace wage = wage + 1\n`;
        writeFileSync(child_path, child_content);

        const unrelated_path = join(test_temp_dir, 'aaa_unrelated.do');
        const unrelated_content = `gen wage = 99\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const ref_line = 2;
        const wage_char = main_content
            .split('\n')[ref_line]
            .indexOf('wage') + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: wage_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const child_uri = URI.file(child_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();

        const ordered_uris = locations.map(loc => loc.uri);
        const first_unrelated_idx = ordered_uris.indexOf(unrelated_uri);
        const last_related_idx = Math.max(
            ordered_uris.lastIndexOf(main_uri),
            ordered_uris.lastIndexOf(child_uri)
        );

        expect(first_unrelated_idx).toBeGreaterThan(-1);
        expect(last_related_idx).toBeGreaterThan(-1);
        expect(last_related_idx).toBeLessThan(first_unrelated_idx);
    });

    it('still returns variable references from unrelated workspace files', async () => {
        // Variables in Stata are dataset columns — cross-project name matches
        // are useful. Other symbol kinds should be dep-graph scoped, but
        // variables should remain workspace-wide.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `gen wage = 1\n` +
            `display wage\n`;
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        const unrelated_content =
            `gen wage = 2\n` +
            `replace wage = wage + 1\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const ref_line = 1;
        const wage_char = main_content
            .split('\n')[ref_line]
            .indexOf('wage') + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: wage_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const unrelated_uri = URI.file(unrelated_path).toString();
        const has_unrelated_wage = locations.some(loc => loc.uri === unrelated_uri);
        expect(has_unrelated_wage).toBe(true);
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

    it('finds parent-file program refs linked only by @lsp-done-by (no graph edge)', async () => {
        // Parent calls the child through a macro-interpolated path, so the
        // dependency graph records no static edge. The child's explicit
        // `@lsp-done-by` is the only link — find-references must still scan
        // the parent, and the cursor must classify as a program (not a
        // variable, even though an unrelated file defines a same-named
        // variable).
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content =
            `global stub "child.do"\n` +
            `program define shared_name\n` +
            `end\n` +
            `do "$stub"\n`;
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "parent.do"\n` +
            `\n` +
            `shared_name\n`;
        writeFileSync(child_path, child_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        const unrelated_content = `gen shared_name = 1\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const call_line = 2;
        const name_char = child_content
            .split('\n')[call_line]
            .indexOf('shared_name') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: call_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const parent_uri = URI.file(parent_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();

        // The program definition in the parent must be included.
        const has_parent_ref = locations.some(loc => loc.uri === parent_uri);
        expect(has_parent_ref).toBe(true);

        // The unrelated file's `gen shared_name` must not leak in.
        const leaks_unrelated = locations.some(loc => loc.uri === unrelated_uri);
        expect(leaks_unrelated).toBe(false);
    });

    it('finds child-file program refs linked only by @lsp-done-by (from parent)', async () => {
        // Mirror of the previous test, but starting from the parent. The
        // dependency graph has no static edge (macro-interpolated path),
        // and the parent itself has no directive pointing at the child —
        // only the child's header `@lsp-done-by` links back. Find
        // References from the parent's program definition must still
        // reach the child's call site (parent ← child traversal).
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content =
            `global stub "child.do"\n` +
            `program define shared_name\n` +
            `end\n` +
            `do "$stub"\n`;
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "parent.do"\n` +
            `\n` +
            `shared_name\n`;
        writeFileSync(child_path, child_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        const unrelated_content = `gen shared_name = 1\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        const document_state = document_store.get(parent_uri)!;

        const def_line = 1;
        const name_char = parent_content
            .split('\n')[def_line]
            .indexOf('shared_name') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: def_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const child_uri = URI.file(child_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();

        // The child's call of `shared_name` must be included.
        const has_child_ref = locations.some(loc => loc.uri === child_uri);
        expect(has_child_ref).toBe(true);

        // The unrelated file's `gen shared_name` must not leak in.
        const leaks_unrelated = locations.some(loc => loc.uri === unrelated_uri);
        expect(leaks_unrelated).toBe(false);
    });

    it('prefers related-file program over a same-named workspace variable', async () => {
        // Reproduces the classifier ordering bug: an unrelated workspace
        // variable of the same name must not cause the cursor to be
        // classified as a variable when the only related definition is a
        // program in the parent file.
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content =
            `program define shared_name\n` +
            `end\n` +
            `do "child.do"\n`;
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = `shared_name\n`;
        writeFileSync(child_path, child_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        const unrelated_content = `gen shared_name = 1\n`;
        writeFileSync(unrelated_path, unrelated_content);

        await indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri)!;

        const call_line = 0;
        const name_char = child_content
            .split('\n')[call_line]
            .indexOf('shared_name') + 3;

        const locations = await references_provider.get_references(
            document_state,
            { line: call_line, character: name_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker
        );

        const parent_uri = URI.file(parent_path).toString();
        const unrelated_uri = URI.file(unrelated_path).toString();

        // Classified as program → parent definition included.
        const has_parent_program_ref = locations.some(loc => loc.uri === parent_uri);
        expect(has_parent_program_ref).toBe(true);

        // Classified as program → unrelated-file variable not included.
        const leaks_unrelated = locations.some(loc => loc.uri === unrelated_uri);
        expect(leaks_unrelated).toBe(false);
    });

    it('does not leak local macro references across do/run boundaries', async () => {
        // Stata only propagates locals through `include`. A `do`-called
        // child with a same-named local macro reference is unrelated to
        // the parent's local.
        const parent_path = join(test_temp_dir, 'parent.do');
        const child_path = join(test_temp_dir, 'child.do');
        const parent_content =
            `local x = 5\n` +
            `display "\`x'"\n` +
            `do "${child_path}"\n`;
        const child_content = `display "\`x'"\n`;
        writeFileSync(parent_path, parent_content);
        writeFileSync(child_path, child_content);

        await indexer.initialize([test_temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(parent_uri)!;

        // Cursor on `x` inside `` `x' `` on line 1 (the reference in parent).
        const ref_line = 1;
        const ref_char = parent_content
            .split('\n')[ref_line]
            .indexOf("`x'") + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: ref_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const has_child_ref = locations.some(loc => loc.uri === child_uri);
        expect(has_child_ref).toBe(false);
    });

    it('still includes local macro references across include chains', async () => {
        // The `do`-exclusion above must not regress `include` behavior.
        // `include` propagates locals, so child refs are legitimate hits.
        const parent_path = join(test_temp_dir, 'parent.do');
        const child_path = join(test_temp_dir, 'child.do');
        const parent_content =
            `local x = 5\n` +
            `display "\`x'"\n` +
            `include "${child_path}"\n`;
        const child_content = `display "\`x'"\n`;
        writeFileSync(parent_path, parent_content);
        writeFileSync(child_path, child_content);

        await indexer.initialize([test_temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(parent_uri)!;

        const ref_line = 1;
        const ref_char = parent_content
            .split('\n')[ref_line]
            .indexOf("`x'") + 1;

        const locations = await references_provider.get_references(
            document_state,
            { line: ref_line, character: ref_char },
            { includeDeclaration: false },
            indexer,
            document_state.context_tracker
        );

        const has_child_ref = locations.some(loc => loc.uri === child_uri);
        expect(has_child_ref).toBe(true);
    });
});
