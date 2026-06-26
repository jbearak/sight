import { describe, it, expect } from 'bun:test';
import {
    entry_is_directory_sync,
    entry_is_file_sync,
    entry_is_file_async,
    classify_entry_sync,
} from '../../src/utils/symlink-aware-entry';

// ─── Fake Dirent + stat seam ──────────────────────────────────────────────────

type EntryKind = 'dir' | 'file' | 'link-dir' | 'link-file' | 'link-dead';

function make_entry(kind: EntryKind) {
    return {
        isDirectory:    () => kind === 'dir',
        isFile:         () => kind === 'file',
        isSymbolicLink: () =>
            kind === 'link-dir' ||
            kind === 'link-file' ||
            kind === 'link-dead',
    };
}

/**
 * Build a sync stat seam that resolves `full_path` to a kind and counts how
 * many times `statSync` was called (to prove the non-symlink fast path never
 * stats).
 */
function make_sync_fs(target: EntryKind) {
    const calls = { count: 0 };
    const fs = {
        statSync: (_p: string) => {
            calls.count++;
            if (target === 'link-dead') {
                throw new Error('ENOENT: dangling symlink');
            }
            const is_dir = target === 'dir' || target === 'link-dir';
            const is_file = target === 'file' || target === 'link-file';
            return { isDirectory: () => is_dir, isFile: () => is_file };
        },
    };
    return { fs, calls };
}

function make_async_fs(target: EntryKind) {
    const calls = { count: 0 };
    const fs = {
        stat: async (_p: string) => {
            calls.count++;
            if (target === 'link-dead') {
                throw new Error('ENOENT: dangling symlink');
            }
            const is_dir = target === 'dir' || target === 'link-dir';
            const is_file = target === 'file' || target === 'link-file';
            return { isDirectory: () => is_dir, isFile: () => is_file };
        },
    };
    return { fs, calls };
}

describe('symlink-aware entry classification (sync)', () => {
    it('plain directory: dir true, file false, no stat call', () => {
        const { fs, calls } = make_sync_fs('dir');
        const e = make_entry('dir');
        expect(entry_is_directory_sync(e, '/x', fs)).toBe(true);
        expect(entry_is_file_sync(e, '/x', fs)).toBe(false);
        expect(calls.count).toBe(0); // fast path, never stats
    });

    it('plain file: file true, dir false, no stat call', () => {
        const { fs, calls } = make_sync_fs('file');
        const e = make_entry('file');
        expect(entry_is_file_sync(e, '/x', fs)).toBe(true);
        expect(entry_is_directory_sync(e, '/x', fs)).toBe(false);
        expect(calls.count).toBe(0);
    });

    it('symlink to directory: dir true (via stat), file false', () => {
        const dir_fs = make_sync_fs('link-dir');
        const e = make_entry('link-dir');
        expect(entry_is_directory_sync(e, '/x', dir_fs.fs)).toBe(true);
        expect(dir_fs.calls.count).toBe(1);

        const file_fs = make_sync_fs('link-dir');
        expect(entry_is_file_sync(e, '/x', file_fs.fs)).toBe(false);
    });

    it('symlink to file: file true (via stat), dir false', () => {
        const file_fs = make_sync_fs('link-file');
        const e = make_entry('link-file');
        expect(entry_is_file_sync(e, '/x', file_fs.fs)).toBe(true);
        expect(file_fs.calls.count).toBe(1);

        const dir_fs = make_sync_fs('link-file');
        expect(entry_is_directory_sync(e, '/x', dir_fs.fs)).toBe(false);
    });

    it('dangling symlink: both false, does not throw', () => {
        const { fs } = make_sync_fs('link-dead');
        const e = make_entry('link-dead');
        expect(entry_is_directory_sync(e, '/x', fs)).toBe(false);
        expect(entry_is_file_sync(e, '/x', fs)).toBe(false);
    });
});

describe('symlink-aware entry classification (async)', () => {
    it('plain file: true, no stat call (fast path)', async () => {
        const { fs, calls } = make_async_fs('file');
        expect(await entry_is_file_async(make_entry('file'), '/x', fs))
            .toBe(true);
        expect(calls.count).toBe(0);
    });

    it('plain directory: file false, no stat call', async () => {
        const { fs, calls } = make_async_fs('dir');
        expect(await entry_is_file_async(make_entry('dir'), '/x', fs))
            .toBe(false);
        expect(calls.count).toBe(0);
    });

    it('symlink to file: file true (via single stat)', async () => {
        const file_fs = make_async_fs('link-file');
        expect(await entry_is_file_async(make_entry('link-file'), '/x', file_fs.fs))
            .toBe(true);
        expect(file_fs.calls.count).toBe(1);
    });

    it('symlink to directory: file false (via stat)', async () => {
        const dir_fs = make_async_fs('link-dir');
        expect(await entry_is_file_async(make_entry('link-dir'), '/x', dir_fs.fs))
            .toBe(false);
    });

    it('dangling symlink: false, does not throw', async () => {
        const { fs } = make_async_fs('link-dead');
        expect(await entry_is_file_async(make_entry('link-dead'), '/x', fs))
            .toBe(false);
    });
});

describe('classify_entry_sync (single-syscall, completion listing)', () => {
    it('plain dir / plain file classify without a stat call', () => {
        const dir_fs = make_sync_fs('dir');
        expect(classify_entry_sync(make_entry('dir'), '/x', dir_fs.fs))
            .toBe('directory');
        expect(dir_fs.calls.count).toBe(0);

        const file_fs = make_sync_fs('file');
        expect(classify_entry_sync(make_entry('file'), '/x', file_fs.fs))
            .toBe('file');
        expect(file_fs.calls.count).toBe(0);
    });

    it('symlinked entry is classified with exactly ONE stat call', () => {
        const dir_fs = make_sync_fs('link-dir');
        expect(classify_entry_sync(make_entry('link-dir'), '/x', dir_fs.fs))
            .toBe('directory');
        expect(dir_fs.calls.count).toBe(1); // not double-stat

        const file_fs = make_sync_fs('link-file');
        expect(classify_entry_sync(make_entry('link-file'), '/x', file_fs.fs))
            .toBe('file');
        expect(file_fs.calls.count).toBe(1);
    });

    it('dangling symlink classifies as other, no throw', () => {
        const { fs } = make_sync_fs('link-dead');
        expect(classify_entry_sync(make_entry('link-dead'), '/x', fs))
            .toBe('other');
    });
});
