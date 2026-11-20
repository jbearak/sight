/**
 * `create_listing_cache_resolve_fs` (used by `sight check`) reuses a
 * directory's listing only while the directory is unchanged: same
 * directory, same timestamps, and not changed moments ago.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { create_listing_cache_resolve_fs } from '../../src/utils/file-path-utils';

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

    it('does not cache a directory that changed moments ago', () => {
        const root = make_directory(['a.do']);
        const listing = create_listing_cache_resolve_fs();
        const first = listing.readdirSync(root, { withFileTypes: true });
        expect(listing.readdirSync(root, { withFileTypes: true }))
            .not.toBe(first);
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
        // A symlink pointed at another directory can show the same
        // timestamps; only the directory's identity differs.
        const root = make_directory([]);
        for (const my_name of ['one', 'two']) {
            fs.mkdirSync(path.join(root, my_name));
            fs.writeFileSync(path.join(root, my_name, `${my_name}.do`), '');
        }
        const link = path.join(root, 'link');
        fs.symlinkSync(path.join(root, 'one'), link, 'dir');
        let inode = 1n;
        const listing = create_listing_cache_resolve_fs({
            settle_ms: 0,
            stat: () => ({ dev: 1n, ino: inode, mtimeNs: 0n, ctimeNs: 0n }),
        });
        const names = (): string[] =>
            listing.readdirSync(link, { withFileTypes: true })
                .map((my_entry) => my_entry.name);
        expect(names()).toEqual(['one.do']);
        fs.rmSync(link);
        fs.symlinkSync(path.join(root, 'two'), link, 'dir');
        // Same identity: the cached listing is still used.
        expect(names()).toEqual(['one.do']);
        inode = 2n;
        expect(names()).toEqual(['two.do']);
    });
});
