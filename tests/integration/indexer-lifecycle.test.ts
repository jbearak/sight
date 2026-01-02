import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../../src/indexer';

function write_file(file_path: string, content: string): void {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content);
}

describe('WorkspaceIndexer lifecycle integration', () => {
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-indexer-lifecycle-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it('updates index on delete+create rename sequence', async () => {
        const indexer = new WorkspaceIndexer();

        const old_path = path.join(temp_dir, 'old.do');
        write_file(old_path, 'program define oldprog\nend\nscalar S = 1\nmatrix define M = (1)');
        await indexer.index_file(old_path);

        expect(indexer.get_all_symbols().programs.has('oldprog')).toBe(true);
        expect(indexer.get_all_symbols().scalars.has('S')).toBe(true);
        expect(indexer.get_all_symbols().matrices.has('M')).toBe(true);

        // Simulate rename as delete+create (common in clients)
        const new_path = path.join(temp_dir, 'new.do');
        fs.renameSync(old_path, new_path);

        indexer.remove_file(old_path);
        await indexer.index_file(new_path);

        const symbols = indexer.get_all_symbols();
        expect(symbols.programs.has('oldprog')).toBe(true);
        // URI changed, but symbol should still exist in the merged view
        expect(symbols.scalars.has('S')).toBe(true);
        expect(symbols.matrices.has('M')).toBe(true);
    });

    it('handles atomic-save-like swap without losing symbols', async () => {
        const indexer = new WorkspaceIndexer();

        const target_path = path.join(temp_dir, 'main.do');
        write_file(target_path, 'program define p\nend\nscalar S = 1');
        await indexer.index_file(target_path);
        expect(indexer.get_all_symbols().programs.has('p')).toBe(true);
        expect(indexer.get_all_symbols().scalars.has('S')).toBe(true);

        // Simulate atomic save: write temp, then replace target
        const temp_path = path.join(temp_dir, '.main.do.swp');
        write_file(temp_path, 'program define p\nend\nscalar S = 2\nmatrix A = (1,2\\3,4)');

        // Client might report: delete target, create target (from temp)
        indexer.remove_file(target_path);
        fs.renameSync(temp_path, target_path);
        await indexer.index_file(target_path);

        const symbols = indexer.get_all_symbols();
        expect(symbols.programs.has('p')).toBe(true);
        expect(symbols.scalars.has('S')).toBe(true);
        expect(symbols.matrices.has('A')).toBe(true);
    });
});
