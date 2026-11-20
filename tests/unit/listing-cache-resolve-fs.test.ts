/**
 * `create_listing_cache_resolve_fs` (used by `sight check`) reuses a
 * directory's listing only while the directory is unchanged: same
 * directory, same timestamps, and not changed moments ago.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    create_listing_cache_resolve_fs,
    type ListingStat,
} from '../../src/utils/file-path-utils';

let tmp_dir: string | undefined;

afterEach(() => {
    if (tmp_dir) {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
        tmp_dir = undefined;
    }
});

function make_directory(the_names: string[]): string {
    tmp_dir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'listing-cache-')));
    for (const my_name of the_names) {
        fs.writeFileSync(path.join(tmp_dir, my_name), '');
    }
    return tmp_dir;
}

describe('create_listing_cache_resolve_fs', () => {
    it('reuses an unchanged listing and sees a new file at once', async () => {
        const root = make_directory(['a.do']);
        // Modified long ago, so the listing may be cached. Setting the
        // time stamps the directory's ctime now; the cache compares it
        // with a millisecond clock, so let a few milliseconds pass.
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(root, past, past);
        await Bun.sleep(5);
        const listing = create_listing_cache_resolve_fs({ settle_ms: 0 });
        const first = listing.readdirSync(root, { withFileTypes: true });
        expect(listing.readdirSync(root, { withFileTypes: true }))
            .toBe(first);

        fs.writeFileSync(path.join(root, 'b.do'), '');
        const after = listing.readdirSync(root, { withFileTypes: true });
        expect(after.map((my_entry) => my_entry.name).sort())
            .toEqual(['a.do', 'b.do']);
    });

    // A directory's identity and timestamps as the cache would read
    // them, set by the test: real ones depend on the clock and the
    // filesystem.
    function fake_stat(overrides: Partial<ListingStat> = {}) {
        const the_stats = new Map<string, ListingStat>();
        const stat = (dir_path: string): ListingStat =>
            the_stats.get(dir_path) ??
            { dev: 1n, ino: 1n, mtimeNs: 0n, ctimeNs: 0n, ...overrides };
        return { the_stats, stat };
    }

    it('does not cache a directory that changed moments ago', () => {
        const root = make_directory(['a.do']);
        const now_ns = BigInt(Date.now()) * 1_000_000n;
        const recent = create_listing_cache_resolve_fs({
            stat: fake_stat({ mtimeNs: now_ns, ctimeNs: now_ns }).stat,
        });
        expect(recent.readdirSync(root, { withFileTypes: true }))
            .not.toBe(recent.readdirSync(root, { withFileTypes: true }));
        // The same directory, unchanged for long, is cached.
        const old = create_listing_cache_resolve_fs({ stat: fake_stat().stat });
        expect(old.readdirSync(root, { withFileTypes: true }))
            .toBe(old.readdirSync(root, { withFileTypes: true }));
    });

    it('does not cache the root of a volume or a directory with no inode', () => {
        const root = make_directory(['a.do']);
        // The parent is on another device: `root` is a volume's root,
        // whose timestamps some filesystems never move.
        const volume = fake_stat();
        volume.the_stats.set(path.dirname(root),
            { dev: 2n, ino: 9n, mtimeNs: 0n, ctimeNs: 0n });
        const on_volume = create_listing_cache_resolve_fs({ stat: volume.stat });
        expect(on_volume.readdirSync(root, { withFileTypes: true }))
            .not.toBe(on_volume.readdirSync(root, { withFileTypes: true }));
        const no_inode = create_listing_cache_resolve_fs({
            stat: fake_stat({ ino: 0n }).stat,
        });
        expect(no_inode.readdirSync(root, { withFileTypes: true }))
            .not.toBe(no_inode.readdirSync(root, { withFileTypes: true }));
    });

    it('shares one listing between two paths to a directory', () => {
        const root = make_directory([]);
        for (const my_name of ['one', 'two']) {
            fs.mkdirSync(path.join(root, my_name));
        }
        // Both paths report one identity, as two links to a directory do.
        const listing = create_listing_cache_resolve_fs({
            stat: fake_stat().stat,
        });
        expect(listing.readdirSync(
            path.join(root, 'two'), { withFileTypes: true }))
            .toBe(listing.readdirSync(
                path.join(root, 'one'), { withFileTypes: true }));
    });

    it('checks existence and stats on disk every time', () => {
        const root = make_directory([]);
        const listing = create_listing_cache_resolve_fs({ settle_ms: 0 });
        const missing = path.join(root, 'missing');
        expect(listing.existsSync(missing)).toBe(false);
        expect(() => listing.statSync(missing)).toThrow();
        fs.mkdirSync(missing);
        expect(listing.existsSync(missing)).toBe(true);
        expect(listing.statSync(missing).isDirectory()).toBe(true);
        expect(() => listing.readdirSync(path.join(root, 'nope'),
            { withFileTypes: true })).toThrow();
    });

    it('reads a path again when it names another directory', () => {
        // A path that comes to name another directory (a renamed
        // directory, a retargeted link) can show the same timestamps;
        // only the directory's identity differs.
        const root = make_directory([]);
        for (const my_name of ['one', 'two']) {
            fs.mkdirSync(path.join(root, my_name));
            fs.writeFileSync(path.join(root, my_name, `${my_name}.do`), '');
        }
        const current = path.join(root, 'current');
        fs.renameSync(path.join(root, 'one'), current);
        const fake = fake_stat();
        const listing = create_listing_cache_resolve_fs({ stat: fake.stat });
        const names = (): string[] =>
            listing.readdirSync(current, { withFileTypes: true })
                .map((my_entry) => my_entry.name);
        expect(names()).toEqual(['one.do']);
        fs.renameSync(current, path.join(root, 'one'));
        fs.renameSync(path.join(root, 'two'), current);
        // Same identity: the cached listing is still used.
        expect(names()).toEqual(['one.do']);
        fake.the_stats.set(current,
            { dev: 1n, ino: 2n, mtimeNs: 0n, ctimeNs: 0n });
        expect(names()).toEqual(['two.do']);
    });
});
