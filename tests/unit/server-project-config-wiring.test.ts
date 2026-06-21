import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('server-factory project config wiring', () => {
    const server_factory_path = path.join(
        __dirname,
        '../../src/server-factory.ts'
    );

    it('loads project config through the shared config-file module', () => {
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('discover_and_load_project_config');
        expect(source).toContain('apply_loaded_project_config');
    });

    it('merges client settings before project settings', () => {
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toMatch(
            /const\s+client_partial\s*=\s*deep_merge_config\(\s*init_partial\s*\|\|\s*\{\},\s*config\s*\|\|\s*\{\}\s*\)/
        );
        expect(source).toMatch(
            /const\s+merged_partial\s*=\s*deep_merge_config\(\s*client_partial,\s*project_file_config\s*\|\|\s*\{\}\s*\)/
        );
    });
});
