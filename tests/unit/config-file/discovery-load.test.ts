import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    discover_and_load_project_config,
    load_explicit_project_config_from_base,
} from '../../../src/config-file';

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

describe('load_explicit_project_config_from_base', () => {
    it('resolves relative explicit config paths from caller supplied base', () => {
        const root = make_temp_dir();
        const config_dir = path.join(root, 'config');
        fs.mkdirSync(config_dir);
        fs.writeFileSync(path.join(config_dir, 'sight.toml'), 'debug = true\n');

        const loaded = load_explicit_project_config_from_base(
            root,
            path.join('config', 'sight.toml')
        );

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.path).toBe(path.join(config_dir, 'sight.toml'));
        }
    });
});
