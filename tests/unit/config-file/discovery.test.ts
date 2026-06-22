import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    find_project_config,
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
} from '../../../src/config-file';

const the_temp_dirs: string[] = [];

function make_temp_dir(): string {
    const my_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-config-'));
    the_temp_dirs.push(my_dir);
    return my_dir;
}

afterEach(() => {
    while (the_temp_dirs.length > 0) {
        const my_dir = the_temp_dirs.pop();
        if (my_dir) {
            fs.rmSync(my_dir, { recursive: true, force: true });
        }
    }
});

describe('find_project_config', () => {
    it('finds the nearest sight.toml from a single search root', () => {
        const root = make_temp_dir();
        const parent_config = path.join(root, PROJECT_CONFIG_FILE);
        const child = path.join(root, 'a', 'b');
        const child_config = path.join(root, 'a', PROJECT_CONFIG_FILE);
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(parent_config, 'debug = false\n');
        fs.writeFileSync(child_config, 'debug = true\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('sight-toml');
        if (result.kind === 'sight-toml') {
            expect(result.path).toBe(child_config);
        }
        expect(result.candidate_dirs).toEqual([
            child,
            path.dirname(child),
        ]);
    });

    it('detects stale .sight.json without making it active', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'project');
        const stale = path.join(root, STALE_JSON_CONFIG_FILE);
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(stale, '{"diagnostics":{"indentation":true}}\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('none');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('stale-json-config');
        expect(result.warnings[0].path).toBe(stale);
    });

    it('stops at max depth', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'a', 'b', 'c');
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(path.join(root, PROJECT_CONFIG_FILE), 'debug = true\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('none');
        expect(result.candidate_dirs).toEqual([
            child,
            path.dirname(child),
        ]);
    });
});
