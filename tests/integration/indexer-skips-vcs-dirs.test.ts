/**
 * The workspace scan must skip version-control metadata directories
 * (`.git`, `.hg`, `.svn`). They contain no Stata source and recursing
 * them is pure overhead. A `.do` file planted inside `.git` must NOT be
 * indexed; a sibling `.do` outside it must be.
 */

import {
    describe, it, expect, beforeEach, afterEach, spyOn,
} from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { StataLSPConfig } from '../../src/types';

let tmp_dir: string;

function build_config(): StataLSPConfig {
    return {
        diagnostics: { enabled: true, severity: {} as never, indentation: false },
        completion: { cacheSize: 200, prefixMaxItems: 200 },
        formatting: {
            indentSize: 4, indentStyle: 'spaces', lineWidth: 80,
            preferredCommentStyle: 'line', normalizeCommentStyle: false,
            commentLineWidth: 72, mode: 'source-preserving',
            preserve_alignment: true,
        },
        lineCommentStyle: '//',
        indexing: { maxFileSizeBytes: 500000 },
        adoPaths: [],
        indexWorkspace: true,
        cross_file: {
            index_workspace: true, max_indexed_files: 1000,
            assume_call_site: 'end', backward_dependencies: 'auto',
            max_backward_depth: 10, max_forward_depth: 10, max_chain_depth: 20,
            max_callee_revalidations: 10,
            diagnostics: { missing_file: 'warning', max_depth: 'information' },
        },
        debug: false,
    };
}

describe('indexer skips VCS metadata directories', () => {
    beforeEach(() => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-skip-'));
    });
    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    it('does not index .do files inside .git, .hg, or .svn', async () => {
        const tracked = path.join(tmp_dir, 'tracked.do');
        fs.writeFileSync(tracked, 'program define foo\nend\n');

        for (const vcs of ['.git', '.hg', '.svn']) {
            const dir = path.join(tmp_dir, vcs, 'hooks');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'buried.do'), 'program define bar\nend\n');
        }

        const indexer = new WorkspaceIndexer();
        indexer.configure(build_config());
        await indexer.initialize([tmp_dir], []);

        const indexed = indexer.get_indexed_files();
        const tracked_uri = URI.file(tracked).toString();

        // The tracked file outside VCS dirs must be indexed.
        expect(indexed.has(tracked_uri)).toBe(true);

        // No file under any VCS metadata directory may be indexed.
        for (const vcs of ['.git', '.hg', '.svn']) {
            const buried_uri = URI.file(
                path.join(tmp_dir, vcs, 'hooks', 'buried.do'),
            ).toString();
            expect(indexed.has(buried_uri)).toBe(false);
        }
    });

    it('prunes hidden worktrees before reading their directories', async () => {
        const visible = path.join(tmp_dir, '.helper.do');
        fs.writeFileSync(visible, 'program define visible\nend\n');
        const the_hidden_dirs = ['.claude/worktrees/copy', 'src/.cache'];
        for (const my_dir of the_hidden_dirs) {
            const hidden_dir = path.join(tmp_dir, my_dir);
            fs.mkdirSync(hidden_dir, { recursive: true });
            fs.writeFileSync(
                path.join(hidden_dir, 'buried.do'),
                'program define hidden\nend\n'
            );
        }

        const readdir_spy = spyOn(fs.promises, 'readdir');
        const indexer = new WorkspaceIndexer();
        indexer.configure(build_config());
        try {
            await indexer.initialize([tmp_dir]);
            expect([...indexer.get_indexed_files().keys()]).toEqual([
                URI.file(visible).toString(),
            ]);
            const the_reads = readdir_spy.mock.calls.map(
                my_call => String(my_call[0])
            );
            expect(the_reads).not.toContain(path.join(tmp_dir, '.claude'));
            expect(the_reads).not.toContain(path.join(tmp_dir, 'src/.cache'));
        } finally {
            readdir_spy.mockRestore();
            indexer.cancel();
        }
    });

    it('rejects hidden incremental updates before reading source', async () => {
        const indexer = new WorkspaceIndexer();
        indexer.configure(build_config());
        await indexer.initialize([tmp_dir]);
        const hidden_dir = path.join(tmp_dir, '.claude/worktrees/copy');
        fs.mkdirSync(hidden_dir, { recursive: true });
        const hidden_file = path.join(hidden_dir, 'buried.do');
        fs.writeFileSync(hidden_file, 'program define hidden\nend\n');
        const read_spy = spyOn(fs.promises, 'readFile');
        try {
            await indexer.index_file(hidden_file);
            expect(indexer.get_indexed_files().size).toBe(0);
            expect(read_spy).not.toHaveBeenCalled();
        } finally {
            read_spy.mockRestore();
            indexer.cancel();
        }
    });

    it('uses selected workspace and ado roots, not hidden ancestors', async () => {
        const nested_root = path.join(tmp_dir, '.claude/worktrees/selected');
        const ado_root = path.join(tmp_dir, '.ado/personal');
        for (const my_root of [nested_root, ado_root]) {
            fs.mkdirSync(path.join(my_root, '.cache'), { recursive: true });
            fs.writeFileSync(
                path.join(my_root, 'visible.do'),
                'program define visible\nend\n'
            );
            fs.writeFileSync(
                path.join(my_root, '.cache/hidden.do'),
                'program define hidden\nend\n'
            );
        }
        const indexer = new WorkspaceIndexer();
        indexer.configure(build_config());
        try {
            // The selected worktree is also beneath another workspace root.
            await indexer.initialize([tmp_dir, nested_root], [ado_root]);
            for (const my_root of [nested_root, ado_root]) {
                const visible = path.join(my_root, 'visible.do');
                await indexer.index_file(visible);
                expect(indexer.has_indexed_file(
                    URI.file(visible).toString()
                )).toBe(true);
                const hidden_file = path.join(my_root, '.cache/hidden.do');
                await indexer.index_file(hidden_file);
                expect(indexer.has_indexed_file(
                    URI.file(hidden_file).toString()
                )).toBe(false);
            }
            expect(indexer.get_indexed_files().size).toBe(2);
        } finally {
            indexer.cancel();
        }
    });
});
