import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
    build_non_capability_settings_from_sources,
    select_pushed_client_settings,
} from '../../src/server-factory';

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

    it('merges init, client, then project config in precedence order', () => {
        // Behavioral guard for both the public->internal mapping and the
        // precedence: every layer is mapped (so camelCase aliases like
        // crossFile.* are not dropped), project config wins over client, and
        // client wins over init options.
        const project_wins = build_non_capability_settings_from_sources({
            last_client_settings: {
                crossFile: { backwardDependencies: 'auto' },
            },
            project_file_config: {
                cross_file: { backward_dependencies: 'explicit' },
            },
        });
        expect(project_wins.cross_file.backward_dependencies).toBe('explicit');

        const client_wins = build_non_capability_settings_from_sources({
            init_options_config: {
                sight: { crossFile: { backwardDependencies: 'explicit' } },
            },
            last_client_settings: {
                crossFile: { backwardDependencies: 'auto' },
            },
        });
        expect(client_wins.cross_file.backward_dependencies).toBe('auto');
    });

    it('routes the live getConfiguration result through the shared builder', () => {
        // Wiring guard: the per-scope getConfiguration path must delegate to
        // build_non_capability_settings_from_sources (passing the live tree
        // as the client layer) so it shares the mapping/precedence the
        // behavioral tests cover, instead of re-implementing the merge inline.
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('function map_public_settings');
        expect(source).toContain('select_pushed_client_settings');
        expect(source).toMatch(
            /build_non_capability_settings_from_sources\(\{[\s\S]*?last_client_settings:\s*config,/
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

    it('applies wrapped pushed settings for non-capability clients', () => {
        const last_client_settings = select_pushed_client_settings({
            sight: {
                crossFile: {
                    backwardDependencies: 'explicit',
                },
            },
        });

        const settings = build_non_capability_settings_from_sources({
            last_client_settings,
        });

        expect(settings.cross_file.backward_dependencies).toBe('explicit');
    });

    it('applies unwrapped pushed settings for non-capability clients', () => {
        const last_client_settings = select_pushed_client_settings({
            crossFile: {
                backwardDependencies: 'explicit',
            },
        });

        const settings = build_non_capability_settings_from_sources({
            last_client_settings,
        });

        expect(settings.cross_file.backward_dependencies).toBe('explicit');
    });
});
