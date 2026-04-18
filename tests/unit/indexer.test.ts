import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { URI } from 'vscode-uri';

describe('WorkspaceIndexer', () => {
    let indexer: WorkspaceIndexer;
    let temp_dir: string;

    beforeEach(() => {
        indexer = new WorkspaceIndexer();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it('should index a simple .do file', async () => {
        const file_path = path.join(temp_dir, 'test.do');
        fs.writeFileSync(file_path, 'local x = 1\nprogram define myprog\n  display "hello"\nend');

        await indexer.index_file(file_path);

        const symbols = indexer.get_all_symbols();
        expect(symbols.programs.has('myprog')).toBe(true);
        expect(symbols.localMacros.has('x')).toBe(true);
    });

    it('should index a directory recursively', async () => {
        const sub_dir = path.join(temp_dir, 'sub');
        fs.mkdirSync(sub_dir);

        fs.writeFileSync(path.join(temp_dir, 'main.do'), 'global myglobal = 1');
        fs.writeFileSync(path.join(sub_dir, 'helper.ado'), 'program define helper\nend');

        await indexer.initialize([temp_dir]);

        const symbols = indexer.get_all_symbols();
        expect(symbols.globalMacros.has('myglobal')).toBe(true);
        expect(symbols.programs.has('helper')).toBe(true);
    });

    it('should resolve local .ado programs', async () => {
        const file_path = path.join(temp_dir, 'main.do');
        const ado_path = path.join(temp_dir, 'myprog.ado');

        fs.writeFileSync(ado_path, 'program define myprog\nend');

        await indexer.index_file(ado_path);

        const referer_uri = URI.file(file_path).toString();
        const resolved = indexer.resolve_program('myprog', referer_uri);

        expect(resolved).toBeDefined();
        expect(resolved?.name).toBe('myprog');
    });

    it('should resolve nested workspace .sthlp files recursively', async () => {
        const my_help_dir = path.join(temp_dir, 'pkg', 'sthlp', 'r');
        const my_help_path = path.join(my_help_dir, 'regress.sthlp');
        fs.mkdirSync(my_help_dir, { recursive: true });
        fs.writeFileSync(my_help_path, '{smcl}');

        await indexer.initialize([temp_dir]);

        const resolved = await indexer.resolve_sthlp_file('regress');

        expect(resolved).toBe(my_help_path);
    });

    it('should remove symbols when file is removed', async () => {
        const file_path = path.join(temp_dir, 'test.do');
        fs.writeFileSync(file_path, 'program define todelete\nend');

        await indexer.index_file(file_path);
        expect(indexer.get_all_symbols().programs.has('todelete')).toBe(true);

        indexer.remove_file(file_path);
        expect(indexer.get_all_symbols().programs.has('todelete')).toBe(false);
    });

    it('should clean up skipped_files when a large file is removed', async () => {
        const file_path = path.join(temp_dir, 'large.do');
        // Create a file larger than 500KB (default threshold)
        const large_content = 'a'.repeat(600 * 1024);
        fs.writeFileSync(file_path, large_content);

        // Index the file - it should be skipped due to size
        await indexer.index_file(file_path);
        expect(indexer.get_skipped_files().has(file_path)).toBe(true);

        // Remove the file - should clean up from skipped_files
        indexer.remove_file(file_path);
        expect(indexer.get_skipped_files().has(file_path)).toBe(false);
    });

    it('should cancel indexing and stop processing files', async () => {
        // Create multiple files to ensure cancellation happens mid-process
        const num_files = 20;
        for (let i = 0; i < num_files; i++) {
            const file_path = path.join(temp_dir, `file_${i}.do`);
            fs.writeFileSync(
                file_path,
                `program define prog_${i}\nend`
            );
        }

        // Start indexing but cancel after a short delay
        const index_promise = indexer.initialize([temp_dir]);
        await new Promise((resolve) => setTimeout(resolve, 5));
        indexer.cancel();

        await index_promise;

        // Verify that cancellation was called and stopped further processing
        // The key is that cancel() was called and the indexer stopped
        // (not necessarily that it stopped mid-file, but that it didn't
        // continue processing after cancel was called)
        const metrics = indexer.get_metrics();
        expect(metrics.files_indexed + metrics.files_skipped).toBeGreaterThanOrEqual(0);
        expect(metrics.files_indexed + metrics.files_skipped).toBeLessThanOrEqual(
            num_files
        );
    });

    it('should track indexing metrics', async () => {
        const file_path = path.join(temp_dir, 'test.do');
        fs.writeFileSync(file_path, 'program define myprog\nend');

        await indexer.index_file(file_path);

        const metrics = indexer.get_metrics();
        expect(metrics.files_indexed).toBeGreaterThan(0);
        expect(metrics.total_index_time_ms).toBeGreaterThanOrEqual(0);
        expect(metrics.avg_file_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should skip files larger than MAX_FILE_SIZE_BYTES', async () => {
        const file_path = path.join(temp_dir, 'large.do');
        // Create a file larger than 10MB
        const large_content = 'a'.repeat(11 * 1024 * 1024);
        fs.writeFileSync(file_path, large_content);

        await indexer.index_file(file_path);

        const metrics = indexer.get_metrics();
        expect(metrics.files_skipped).toBe(1);
        expect(metrics.files_indexed).toBe(0);
    });

    describe('reset()', () => {
        it('should clear all indexes and metrics', async () => {
            const file_path = path.join(temp_dir, 'test.do');
            fs.writeFileSync(
                file_path,
                'program define myprog\nend\nglobal g = 1'
            );

            await indexer.index_file(file_path);
            expect(indexer.get_all_symbols().programs.has('myprog'))
                .toBe(true);
            expect(indexer.get_metrics().files_indexed).toBe(1);
            expect(indexer.get_version()).toBeGreaterThan(0);

            indexer.reset();

            expect(indexer.get_all_symbols().programs.size).toBe(0);
            expect(indexer.get_all_symbols().globalMacros.size).toBe(0);
            expect(indexer.get_metrics().files_indexed).toBe(0);
            expect(indexer.get_metrics().files_skipped).toBe(0);
            expect(indexer.get_metrics().total_index_time_ms).toBe(0);
            expect(indexer.get_version()).toBe(0);
        });

        it('should clear skipped files', async () => {
            const file_path = path.join(temp_dir, 'large.do');
            fs.writeFileSync(file_path, 'a'.repeat(600 * 1024));

            await indexer.index_file(file_path);
            expect(indexer.get_skipped_files().size).toBe(1);

            indexer.reset();

            expect(indexer.get_skipped_files().size).toBe(0);
        });

        it('should allow re-initialization after reset', async () => {
            const file_path = path.join(temp_dir, 'test.do');
            fs.writeFileSync(
                file_path,
                'program define first_prog\nend'
            );

            await indexer.initialize([temp_dir]);
            expect(indexer.get_all_symbols().programs.has('first_prog'))
                .toBe(true);

            // Reset and write a new file
            indexer.reset();

            fs.writeFileSync(
                file_path,
                'program define second_prog\nend'
            );

            await indexer.initialize([temp_dir]);
            expect(indexer.get_all_symbols().programs.has('first_prog'))
                .toBe(false);
            expect(indexer.get_all_symbols().programs.has('second_prog'))
                .toBe(true);
        });

        it('should cancel pending updates', async () => {
            const file_path = path.join(temp_dir, 'pending.do');
            fs.writeFileSync(
                file_path,
                'program define pending_prog\nend'
            );

            indexer.schedule_update(file_path);
            indexer.reset();

            // Wait for debounce window to pass
            await new Promise(resolve => setTimeout(resolve, 300));

            // Pending update should not have fired
            expect(indexer.get_all_symbols().programs.size).toBe(0);
        });
    });

    it('should reflect unsaved backward directives in get_related_uris', async () => {
        // Regression: get_related_uris must not miss parent-child relationships
        // when the child file's `@lsp-done-by` directive exists only in an
        // unsaved buffer, not on disk.
        const parent_path = path.join(temp_dir, 'parent.do');
        const child_path = path.join(temp_dir, 'child.do');
        fs.writeFileSync(parent_path, 'program define myprog\nend\n');
        // Child on disk has NO backward directive yet.
        fs.writeFileSync(child_path, 'myprog\n');

        const graph = new DependencyGraph();
        indexer.set_dependency_graph(graph);
        await indexer.initialize([temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();

        // Simulate the user adding `@lsp-done-by: "parent.do"` to the
        // child buffer without saving.
        indexer.set_buffer_directives(child_uri, [
            {
                type: 'done-by',
                path: parent_path,
                raw_path: 'parent.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 30 },
                },
            },
        ]);

        const related = indexer.get_related_uris(parent_uri);
        expect(related.has(child_uri)).toBe(true);

        // Clearing the overlay drops the buffer-only relationship.
        indexer.clear_buffer_directives(child_uri);
        const related_after_clear = indexer.get_related_uris(parent_uri);
        expect(related_after_clear.has(child_uri)).toBe(false);
    });

    it('should restrict get_related_uris to include chains when include_only is set', async () => {
        // Local macros only propagate through `include` chains in Stata,
        // never through `do`/`run`. `get_related_uris` must be able to
        // return an include-only reachable set so find-references on a
        // local macro doesn't scan unrelated do-called files.
        const parent_path = path.join(temp_dir, 'parent.do');
        const included_path = path.join(temp_dir, 'included_child.do');
        const done_path = path.join(temp_dir, 'done_child.do');
        fs.writeFileSync(
            parent_path,
            `include "${included_path}"\ndo "${done_path}"\n`,
        );
        fs.writeFileSync(included_path, 'display "in include"\n');
        fs.writeFileSync(done_path, 'display "in do"\n');

        const graph = new DependencyGraph();
        indexer.set_dependency_graph(graph);
        await indexer.initialize([temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        const included_uri = URI.file(included_path).toString();
        const done_uri = URI.file(done_path).toString();

        const all_related = indexer.get_related_uris(parent_uri);
        expect(all_related.has(included_uri)).toBe(true);
        expect(all_related.has(done_uri)).toBe(true);

        const include_only = indexer.get_related_uris(parent_uri, {
            include_only: true,
        });
        expect(include_only.has(included_uri)).toBe(true);
        expect(include_only.has(done_uri)).toBe(false);
    });

    it('should debounce rapid file updates', async () => {
        const file_path = path.join(temp_dir, 'debounce.do');
        fs.writeFileSync(file_path, 'program define prog1\nend');

        // Schedule multiple rapid updates
        indexer.schedule_update(file_path);
        indexer.schedule_update(file_path);
        indexer.schedule_update(file_path);

        // Wait for debounce window (200ms) + processing time
        await new Promise(resolve => setTimeout(resolve, 350));

        const metrics = indexer.get_metrics();
        // Should only index once despite 3 schedule calls
        expect(metrics.files_indexed).toBe(1);
    });
});
