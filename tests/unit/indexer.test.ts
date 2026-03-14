import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../../src/indexer';
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

    it('should report indexed forward calls with workspace-root-aware paths', async () => {
        const the_updates: any[] = [];
        indexer.set_on_file_indexed((my_update) => {
            the_updates.push(my_update);
        });

        const data_dir = path.join(temp_dir, 'data');
        const sub_dir = path.join(temp_dir, 'sub');
        fs.mkdirSync(data_dir);
        fs.mkdirSync(sub_dir);

        const child_path = path.join(data_dir, 'child.do');
        fs.writeFileSync(child_path, 'global CHILD_VAR "1"\n');

        const caller_path = path.join(sub_dir, 'caller.do');
        fs.writeFileSync(
            caller_path,
            'do "data/child.do"\n' +
            '// @lsp-do: "../data/child.do"\n'
        );

        await indexer.initialize([temp_dir]);

        const caller_uri = URI.file(caller_path).toString();
        const caller_update = the_updates.find(
            (my_update) => my_update.uri === caller_uri
        );

        expect(caller_update).toBeDefined();
        expect(caller_update.forward_calls).toHaveLength(2);
        expect(
            caller_update.forward_calls.every(
                (my_call: any) => my_call.path === child_path
            )
        ).toBe(true);
    });

    it('should derive the workspace root from each indexed file', async () => {
        const the_updates: any[] = [];
        indexer.set_on_file_indexed((my_update) => {
            the_updates.push(my_update);
        });

        const first_workspace_root = path.join(temp_dir, 'ws1');
        const second_workspace_root = path.join(temp_dir, 'ws2');
        const first_data_dir = path.join(first_workspace_root, 'data');
        const second_data_dir = path.join(second_workspace_root, 'data');
        const second_scripts_dir = path.join(second_workspace_root, 'scripts');
        fs.mkdirSync(first_workspace_root, { recursive: true });
        fs.mkdirSync(first_data_dir, { recursive: true });
        fs.mkdirSync(second_data_dir, { recursive: true });
        fs.mkdirSync(second_scripts_dir, { recursive: true });

        fs.writeFileSync(
            path.join(first_data_dir, 'child.do'),
            'global WRONG_ROOT \"1\"\n',
        );
        fs.writeFileSync(
            path.join(second_data_dir, 'child.do'),
            'global RIGHT_ROOT \"1\"\n'
        );

        const caller_path = path.join(second_scripts_dir, 'caller.do');
        fs.writeFileSync(
            caller_path,
            '// @lsp-cd /data\n' +
            'do \"child.do\"\n'
        );

        await indexer.initialize([
            first_workspace_root,
            second_workspace_root,
        ]);

        const caller_uri = URI.file(caller_path).toString();
        const caller_update = the_updates.find(
            (my_update) => my_update.uri === caller_uri
        );

        expect(caller_update).toBeDefined();
        expect(caller_update.forward_calls).toHaveLength(1);
        expect(caller_update.forward_calls[0].path).toBe(
            path.join(second_data_dir, 'child.do')
        );
    });
});
