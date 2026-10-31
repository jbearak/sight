import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prune_stale_browse_files } from '../../../client/src/data-browser/signal-watcher';
import { BrowseLease } from '../../../client/src/data-browser/browse-lease';

const the_temp_dirs: string[] = [];

afterEach(() => {
    for (const my_dir of the_temp_dirs.splice(0)) {
        fs.rmSync(my_dir, { recursive: true, force: true });
    }
});

function create_temp_dir(): string {
    const my_dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-browse-test-')
    );
    the_temp_dirs.push(my_dir);
    return my_dir;
}

function touch_file(
    dir: string,
    filename: string,
    age_hours: number
): string {
    const my_path = path.join(dir, filename);
    fs.writeFileSync(my_path, filename);
    const my_date = new Date(
        Date.now() - (age_hours * 60 * 60 * 1000)
    );
    fs.utimesSync(my_path, my_date, my_date);
    return my_path;
}

describe('prune_stale_browse_files', () => {
    it('removes only stale browse temp files', () => {
        const my_dir = create_temp_dir();
        const my_old_dta = touch_file(my_dir, 'a.dta', 30);
        const my_old_json = touch_file(my_dir, 'a.json', 30);
        const my_old_signal = touch_file(my_dir, 'signal_a', 30);
        const my_fresh_dta = touch_file(my_dir, 'fresh.dta', 1);
        const my_other = touch_file(my_dir, 'notes.txt', 30);

        prune_stale_browse_files(my_dir, Date.now());

        expect(fs.existsSync(my_old_dta)).toBe(false);
        expect(fs.existsSync(my_old_json)).toBe(false);
        expect(fs.existsSync(my_old_signal)).toBe(false);
        expect(fs.existsSync(my_fresh_dta)).toBe(true);
        expect(fs.existsSync(my_other)).toBe(true);
    });

    it('judges a leased temp file by its lease, not its own age', () => {
        const my_dir = create_temp_dir();
        // An open panel: old data, fresh lease.
        const my_open_dta = touch_file(my_dir, 'open.dta', 30);
        const my_open_lease = touch_file(my_dir, 'open.lease', 1);
        // A panel that went away (or slept over a day): stale lease.
        const my_gone_dta = touch_file(my_dir, 'gone.dta', 30);
        const my_gone_lease = touch_file(my_dir, 'gone.lease', 30);
        // A lease whose temp file is already gone.
        const my_orphan_lease = touch_file(my_dir, 'orphan.lease', 1);

        prune_stale_browse_files(my_dir, Date.now());

        expect(fs.existsSync(my_open_dta)).toBe(true);
        expect(fs.existsSync(my_open_lease)).toBe(true);
        expect(fs.existsSync(my_gone_dta)).toBe(false);
        expect(fs.existsSync(my_gone_lease)).toBe(false);
        expect(fs.existsSync(my_orphan_lease)).toBe(false);
    });
});

describe('BrowseLease', () => {
    it('writes, refreshes, recreates and removes the lease', async () => {
        const my_dir = create_temp_dir();
        const my_dta = touch_file(my_dir, 'abc.dta', 30);
        const my_lease_path = path.join(my_dir, 'abc.lease');
        const my_lease = new BrowseLease(my_dta);

        my_lease.start();
        expect(fs.existsSync(my_lease_path)).toBe(true);
        // The data file's own mtime is never touched.
        expect(Date.now() - fs.statSync(my_dta).mtimeMs)
            .toBeGreaterThan(29 * 60 * 60 * 1000);

        // A sweep deleted the lease; the next refresh (past the
        // one-minute throttle) writes it again.
        fs.unlinkSync(my_lease_path);
        (my_lease as unknown as { last_refresh_ms: number })
            .last_refresh_ms = -Infinity;
        my_lease.refresh();
        for (let i = 0; i < 50 && !fs.existsSync(my_lease_path); i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(fs.existsSync(my_lease_path)).toBe(true);

        my_lease.stop();
        expect(fs.existsSync(my_lease_path)).toBe(false);
        expect(fs.existsSync(my_dta)).toBe(true);
    });
});

