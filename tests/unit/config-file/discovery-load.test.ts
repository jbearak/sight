import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discover_and_load_project_config } from '../../../src/config-file';

function make_temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-load-'));
}

describe('discover_and_load_project_config', () => {
    it('loads the nearest sight.toml', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'child');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(root, 'sight.toml'), 'debug = true\n');

        const loaded = discover_and_load_project_config(child);

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.partial_config.debug).toBe(true);
        }
    });

    it('does not fall through to ancestor when nearest sight.toml is malformed', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'child');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(root, 'sight.toml'), 'debug = true\n');
        fs.writeFileSync(path.join(child, 'sight.toml'), 'bad = = toml\n');

        const loaded = discover_and_load_project_config(child);

        expect(loaded.kind).toBe('load-failed');
        if (loaded.kind === 'load-failed') {
            expect(loaded.path).toBe(path.join(child, 'sight.toml'));
        }
    });
});
