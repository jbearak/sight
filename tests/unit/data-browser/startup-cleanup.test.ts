import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prune_stale_browse_files } from '../../../client/src/data-browser/signal-watcher';

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
});
