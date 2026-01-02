import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RenameHandler } from '../../src/utils/file-rename-handler';
import { WorkspaceIndexer } from '../../src/indexer';

function write_file(file_path: string, content: string): void {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('File Rename Handler Integration', () => {
    let temp_dir: string;
    let workspace_indexer: WorkspaceIndexer;
    let rename_handler: RenameHandler;
    let log_messages: string[];

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-rename-'));
        workspace_indexer = new WorkspaceIndexer();
        log_messages = [];

        rename_handler = new RenameHandler(
            (file_path: string) => {
                workspace_indexer.remove_file(file_path);
            },
            (file_path: string) => {
                workspace_indexer.index_file(file_path);
            },
            (message: string) => {
                log_messages.push(message);
            }
        );
    });

    afterEach(() => {
        rename_handler.dispose();
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it('detects atomic save and prevents cache invalidation', async () => {
        const file_path = path.join(temp_dir, 'test.do');
        
        // Initial file creation and indexing
        write_file(file_path, 'program define test_prog\nend');
        await workspace_indexer.index_file(file_path);
        
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog')).toBe(true);

        // Simulate atomic save: delete then immediately create
        rename_handler.handle_file_change(file_path, 'deleted');
        
        // Verify file is scheduled for removal but not yet removed
        expect(rename_handler.get_pending_removals().has(file_path)).toBe(true);
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog')).toBe(true);

        // Simulate file recreation (atomic save completion)
        write_file(file_path, 'program define test_prog_updated\nend');
        rename_handler.handle_file_change(file_path, 'created');

        // Verify atomic save was detected and removal was cancelled
        expect(rename_handler.get_pending_removals().has(file_path)).toBe(false);
        expect(log_messages.some(msg => msg.includes('Atomic save detected'))).toBe(true);
        
        // Verify indexer was called to re-index the file
        await workspace_indexer.index_file(file_path);
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog_updated')).toBe(true);
    });

    it('removes file after delay when not an atomic save', async () => {
        const file_path = path.join(temp_dir, 'test.do');
        
        // Initial file creation and indexing
        write_file(file_path, 'program define test_prog\nend');
        await workspace_indexer.index_file(file_path);
        
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog')).toBe(true);

        // Simulate file deletion without recreation
        rename_handler.handle_file_change(file_path, 'deleted');
        
        // Verify file is scheduled for removal
        expect(rename_handler.get_pending_removals().has(file_path)).toBe(true);
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog')).toBe(true);

        // Wait for delay to expire
        await sleep(150); // Slightly longer than ATOMIC_SAVE_DELAY_MS (100ms)

        // Verify file was removed from index
        expect(rename_handler.get_pending_removals().has(file_path)).toBe(false);
        expect(workspace_indexer.get_all_symbols().programs.has('test_prog')).toBe(false);
        expect(log_messages.some(msg => msg.includes('File removed after delay'))).toBe(true);
    });

    it('handles multiple pending removals correctly', async () => {
        const file1_path = path.join(temp_dir, 'test1.do');
        const file2_path = path.join(temp_dir, 'test2.do');
        
        // Create and index both files
        write_file(file1_path, 'program define prog1\nend');
        write_file(file2_path, 'program define prog2\nend');
        await workspace_indexer.index_file(file1_path);
        await workspace_indexer.index_file(file2_path);
        
        expect(workspace_indexer.get_all_symbols().programs.has('prog1')).toBe(true);
        expect(workspace_indexer.get_all_symbols().programs.has('prog2')).toBe(true);

        // Delete both files
        rename_handler.handle_file_change(file1_path, 'deleted');
        rename_handler.handle_file_change(file2_path, 'deleted');
        
        expect(rename_handler.get_pending_removals().has(file1_path)).toBe(true);
        expect(rename_handler.get_pending_removals().has(file2_path)).toBe(true);

        // Recreate only file1 (atomic save)
        write_file(file1_path, 'program define prog1_updated\nend');
        rename_handler.handle_file_change(file1_path, 'created');

        // Verify file1 removal was cancelled, file2 still pending
        expect(rename_handler.get_pending_removals().has(file1_path)).toBe(false);
        expect(rename_handler.get_pending_removals().has(file2_path)).toBe(true);

        // Wait for file2 delay to expire
        await sleep(150);

        // Verify file2 was removed, file1 was preserved
        expect(rename_handler.get_pending_removals().has(file2_path)).toBe(false);
        expect(workspace_indexer.get_all_symbols().programs.has('prog2')).toBe(false);
        
        // Re-index file1 to verify it's still available
        await workspace_indexer.index_file(file1_path);
        expect(workspace_indexer.get_all_symbols().programs.has('prog1_updated')).toBe(true);
    });

    it('handles file changes for non-Stata files gracefully', async () => {
        const txt_file = path.join(temp_dir, 'readme.txt');
        
        // These should not cause errors
        rename_handler.handle_file_change(txt_file, 'created');
        rename_handler.handle_file_change(txt_file, 'changed');
        rename_handler.handle_file_change(txt_file, 'deleted');
        
        // No pending removals should be created for non-Stata files
        expect(rename_handler.get_pending_removals().size).toBe(0);
    });

    it('disposes of all pending timers on cleanup', async () => {
        const file1_path = path.join(temp_dir, 'test1.do');
        const file2_path = path.join(temp_dir, 'test2.do');
        
        // Schedule multiple removals
        rename_handler.handle_file_change(file1_path, 'deleted');
        rename_handler.handle_file_change(file2_path, 'deleted');
        
        expect(rename_handler.get_pending_removals().size).toBe(2);

        // Dispose should clear all pending removals
        rename_handler.dispose();
        expect(rename_handler.get_pending_removals().size).toBe(0);

        // Wait to ensure no delayed callbacks fire
        await sleep(150);
        
        // No removal messages should have been logged
        expect(log_messages.filter(msg => msg.includes('File removed after delay')).length).toBe(0);
    });
});