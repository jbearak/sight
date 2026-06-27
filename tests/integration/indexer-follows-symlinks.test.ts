/**
 * The persistent workspace indexer follows neither symlinked directories nor
 * symlinked files (issue #219): it keys entries by path and the file watcher
 * invalidates by the changed event path, so an alias entry could not be kept
 * fresh when its real target changes. In-workspace targets are covered via
 * their real path; symlink-following lives in the one-shot consumers (path
 * completion, `sight check`, the on-demand `.sthlp` lookup). These tests pin
 * the indexer side: a symlinked source file is NOT added to the index, a
 * symlinked directory is never recursed (so cycles terminate trivially and an
 * external target is not crawled), and real files are unaffected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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

/**
 * Create a symlink, returning false if the platform refuses (e.g. Windows
 * without the privilege) so the caller can skip rather than fail.
 */
function try_symlink(target: string, link_path: string): boolean {
    try {
        fs.symlinkSync(target, link_path);
        return true;
    } catch {
        return false;
    }
}

async function index(root: string): Promise<string[]> {
    const indexer = new WorkspaceIndexer();
    indexer.configure(build_config());
    await indexer.initialize([root], []);
    return [...indexer.get_indexed_files().keys()];
}

describe('indexer follows symlinks safely (#219)', () => {
    beforeEach(() => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-idx-'));
    });
    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    it('does NOT add a symlinked source file to the persistent index', async () => {
        // The persistent indexer keys/invalidates by path and cannot keep an
        // alias entry fresh, so it indexes the real file only (issue #219).
        const real = path.join(tmp_dir, 'real.do');
        fs.writeFileSync(real, 'program define foo\nend\n');
        const link = path.join(tmp_dir, 'aliased.do');
        if (!try_symlink(real, link)) return; // platform without symlinks

        const indexed = await index(tmp_dir);
        expect(indexed.includes(URI.file(real).toString())).toBe(true);
        expect(indexed.includes(URI.file(link).toString())).toBe(false);
    });

    it('a dangling symlink does not break the scan', async () => {
        // A dangling symlink (any name) must not throw or be indexed.
        try_symlink(
            path.join(tmp_dir, 'missing-target'),
            path.join(tmp_dir, 'broken.do'),
        );
        fs.writeFileSync(path.join(tmp_dir, 'real.do'), 'display 1\n');

        const indexed = await index(tmp_dir);
        expect(indexed).toContain(
            URI.file(path.join(tmp_dir, 'real.do')).toString(),
        );
        expect(indexed.includes(URI.file(path.join(tmp_dir, 'broken.do')).toString()))
            .toBe(false);
    });

    it('indexes a symlinked-dir target via its real in-workspace location', async () => {
        const real_dir = path.join(tmp_dir, 'realdir');
        fs.mkdirSync(real_dir);
        fs.writeFileSync(path.join(real_dir, 'inner.do'), 'display 1\n');
        const link_dir = path.join(tmp_dir, 'linkdir');
        if (!try_symlink(real_dir, link_dir)) return;

        const indexed = await index(tmp_dir);
        // The symlinked dir is not descended, but realdir/inner.do is reached
        // by the direct scan — indexed exactly once, under its real path.
        expect(indexed).toContain(
            URI.file(path.join(real_dir, 'inner.do')).toString(),
        );
        const inner_count = indexed.filter(
            (u) => u.endsWith('/inner.do'),
        ).length;
        expect(inner_count).toBe(1); // not double-indexed via the symlink
    });

    it('terminates trivially on an ancestor-pointing dir symlink (not descended)', async () => {
        const sub = path.join(tmp_dir, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(tmp_dir, 'main.do'), 'display 1\n');
        // sub/loop -> tmp_dir: a cycle if descended; it is not descended.
        if (!try_symlink(tmp_dir, path.join(sub, 'loop'))) return;

        // Completes (no recursion through the symlink) and indexes main.do once.
        const indexed = await index(tmp_dir);
        expect(indexed).toContain(
            URI.file(path.join(tmp_dir, 'main.do')).toString(),
        );
        const main_count = indexed.filter(
            (u) => u.endsWith('/main.do'),
        ).length;
        expect(main_count).toBe(1);
    });

    it('does NOT descend a symlinked directory whose target is outside the workspace', async () => {
        // An external tree OUTSIDE the workspace root.
        const external = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-ext-'));
        try {
            fs.writeFileSync(path.join(external, 'outside.do'), 'display 1\n');
            const root = path.join(tmp_dir, 'ws');
            fs.mkdirSync(root);
            fs.writeFileSync(path.join(root, 'inside.do'), 'display 1\n');
            // root/external_link -> external (target outside the workspace)
            if (!try_symlink(external, path.join(root, 'external_link'))) return;

            const indexed = await index(root);
            expect(indexed).toContain(
                URI.file(path.join(root, 'inside.do')).toString(),
            );
            // The external target must NOT be crawled (under any path).
            const outside_count = indexed.filter(
                (u) => u.endsWith('/outside.do'),
            ).length;
            expect(outside_count).toBe(0);
        } finally {
            fs.rmSync(external, { recursive: true, force: true });
        }
    });
});

describe('sthlp recursive search follows symlinks safely (#219)', () => {
    beforeEach(() => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-sthlp-'));
    });
    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    async function resolve(root: string, topic: string): Promise<string | null> {
        const indexer = new WorkspaceIndexer();
        indexer.configure(build_config());
        await indexer.initialize([root], []);
        return indexer.resolve_sthlp_file(topic);
    }

    it('finds a symlinked .sthlp file buried in a subdirectory', async () => {
        // The recursive search only runs for workspace-root dirs, and only
        // when the topic is not found directly at the root. Bury a symlinked
        // .sthlp one level down (under a REAL subdir). Symlinked files are
        // followed regardless of where the target lives.
        const external = fs.mkdtempSync(path.join(os.tmpdir(), 'sthlp-tgt-'));
        try {
            const real_help = path.join(external, 'real.sthlp');
            fs.writeFileSync(real_help, '{smcl}\nhelp\n');
            const sub = path.join(tmp_dir, 'sub');
            fs.mkdirSync(sub);
            const link = path.join(sub, 'zzsymtopic.sthlp');
            if (!try_symlink(real_help, link)) return;

            const found = await resolve(tmp_dir, 'zzsymtopic');
            expect(found).toBe(link);
        } finally {
            fs.rmSync(external, { recursive: true, force: true });
        }
    });

    it('does not recurse through a directory symlink while searching', async () => {
        const sub = path.join(tmp_dir, 'sub');
        fs.mkdirSync(sub);
        // A genuine help file reachable below the root.
        fs.writeFileSync(path.join(sub, 'zzsymtopic.sthlp'), '{smcl}\nhelp\n');
        // sub/loop -> tmp_dir: would be a cycle if descended; it is not.
        if (!try_symlink(tmp_dir, path.join(sub, 'loop'))) return;

        const found = await resolve(tmp_dir, 'zzsymtopic');
        expect(found).toBe(path.join(sub, 'zzsymtopic.sthlp'));
    });

    it('does not return a dangling symlinked .sthlp (search continues)', async () => {
        const sub = path.join(tmp_dir, 'sub');
        fs.mkdirSync(sub);
        // A dangling symlink whose name matches the help basename must not
        // be returned as a (broken) match — entry_is_file_async stats it,
        // the stat throws, and the search continues.
        if (!try_symlink(
            path.join(sub, 'missing-target'),
            path.join(sub, 'zzsymtopic.sthlp'),
        )) return;

        const found = await resolve(tmp_dir, 'zzsymtopic');
        expect(found).toBeNull();
    });
});
