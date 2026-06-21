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

    it('refreshes workspace indexing when project config reloads', () => {
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('function configure_workspace_indexing');
        expect(source).toMatch(
            /configure_workspace_indexing\(\s*settings,\s*active_workspace_roots,\s*true\s*\)/
        );
        expect(source).toMatch(/workspace_indexer\?\.reset\(\)/);
        expect(source).toMatch(/dependency_graph\?\.reset\(\)/);
        expect(source).toMatch(/workspace_indexer\.initialize\(/);
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
