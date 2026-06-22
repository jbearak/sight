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

    it('maps camelCase initialization options into the internal shape', () => {
        // Regression guard: initializationOptions must be run through the
        // public->internal mapper, otherwise crossFile/preserveAlignment from
        // non-VS-Code clients are silently dropped by the validator.
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('function map_init_options');
        expect(source).toMatch(
            /init_partial\s*=\s*map_init_options\(\s*\n?\s*init_record\?\.\['sight'\]\s*\?\?\s*init_options_config/
        );
    });

    it('builds merged settings for clients without configuration capability', () => {
        // Regression guard: non-capability clients cannot be queried per
        // document, so the workspace refresh and config reload must seed
        // global_settings from the builder (init options + sight.toml), not
        // read back the stale cached value via get_document_settings.
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('function build_non_capability_settings');
        const builder_uses = source.match(
            /global_settings\s*=\s*build_non_capability_settings\(\)/g
        ) || [];
        expect(builder_uses.length).toBeGreaterThanOrEqual(2);
    });
});
