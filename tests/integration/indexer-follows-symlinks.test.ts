/**
 * The workspace scan must follow symlinked directories and symlinked source
 * files (issue #219) — a `readdir` entry for a symlink is neither
 * `isDirectory()` nor `isFile()`, so the old classification silently dropped
 * them. It must do so SAFELY: a symlink cycle must terminate, the same
 * physical file reached via a symlink must not be indexed twice, and a symlink
 * whose target escapes every declared scan root must not be followed.
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

    it('indexes a symlinked .do file', async () => {
        const real = path.join(tmp_dir, 'real.do');
        fs.writeFileSync(real, 'program define foo\nend\n');
        const link = path.join(tmp_dir, 'aliased.do');
        if (!try_symlink(real, link)) return; // platform without symlinks

        const indexed = await index(tmp_dir);
        // Both the regular file and the symlinked file are indexed.
        expect(indexed.includes(URI.file(real).toString())).toBe(true);
        expect(indexed.includes(URI.file(link).toString())).toBe(true);
    });

    it('indexes files inside a symlinked subdirectory', async () => {
        const real_dir = path.join(tmp_dir, 'realdir');
        fs.mkdirSync(real_dir);
        fs.writeFileSync(path.join(real_dir, 'inner.do'), 'display 1\n');
        const link_dir = path.join(tmp_dir, 'linkdir');
        if (!try_symlink(real_dir, link_dir)) return;

        const indexed = await index(tmp_dir);
        // The file is reachable as realdir/inner.do and/or linkdir/inner.do;
        // at least one must be indexed and exactly one physical copy counts.
        const inner_count = indexed.filter(
            (u) => u.endsWith('/inner.do'),
        ).length;
        expect(inner_count).toBe(1); // followed once, not double-indexed
    });

    it('terminates on an ancestor-pointing directory symlink cycle', async () => {
        const sub = path.join(tmp_dir, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(tmp_dir, 'main.do'), 'display 1\n');
        // sub/loop -> tmp_dir (cycle back to an ancestor)
        if (!try_symlink(tmp_dir, path.join(sub, 'loop'))) return;

        // Must complete (no infinite recursion / hang) and still index main.do.
        const indexed = await index(tmp_dir);
        expect(indexed.includes(URI.file(path.join(tmp_dir, 'main.do')).toString()))
            .toBe(true);
        // main.do must not be double-indexed via the cycle.
        const main_count = indexed.filter(
            (u) => u.endsWith('/main.do'),
        ).length;
        expect(main_count).toBe(1);
    });

    it('does NOT double-index a physical file reached via two paths', async () => {
        const real_dir = path.join(tmp_dir, 'realdir');
        fs.mkdirSync(real_dir);
        fs.writeFileSync(path.join(real_dir, 'shared.do'), 'display 1\n');
        // A second symlink in the SAME root pointing at realdir.
        if (!try_symlink(real_dir, path.join(tmp_dir, 'alias'))) return;

        const indexed = await index(tmp_dir);
        const shared_count = indexed.filter(
            (u) => u.endsWith('/shared.do'),
        ).length;
        expect(shared_count).toBe(1);
    });

    it('does NOT follow a symlink that escapes all declared scan roots', async () => {
        // An external tree OUTSIDE the workspace root.
        const external = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-ext-'));
        try {
            fs.writeFileSync(path.join(external, 'outside.do'), 'display 1\n');
            const root = path.join(tmp_dir, 'ws');
            fs.mkdirSync(root);
            fs.writeFileSync(path.join(root, 'inside.do'), 'display 1\n');
            // root/escape -> external (escapes the declared root `root`)
            if (!try_symlink(external, path.join(root, 'escape'))) return;

            const indexed = await index(root);
            expect(indexed.includes(URI.file(path.join(root, 'inside.do')).toString()))
                .toBe(true);
            // The escaping symlink's target must NOT be crawled.
            expect(
                indexed.includes(URI.file(path.join(external, 'outside.do')).toString()),
            ).toBe(false);
            // and not via the symlink path either
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
        // .sthlp one level down. File symlinks are not boundary-checked, so the
        // target may live anywhere.
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

    it('terminates on a directory symlink cycle while searching', async () => {
        const sub = path.join(tmp_dir, 'sub');
        fs.mkdirSync(sub);
        // A genuine help file reachable below the root.
        fs.writeFileSync(path.join(sub, 'zzsymtopic.sthlp'), '{smcl}\nhelp\n');
        // sub/loop -> tmp_dir (cycle); must not hang.
        if (!try_symlink(tmp_dir, path.join(sub, 'loop'))) return;

        const found = await resolve(tmp_dir, 'zzsymtopic');
        expect(found).toBe(path.join(sub, 'zzsymtopic.sthlp'));
    });
});
