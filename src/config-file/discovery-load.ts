import { find_project_config } from './discovery';
import { load_toml_file } from './toml-loader';
import type { DiscoveryOptions, LoadedProjectConfig } from './types';

export function discover_and_load_project_config(
    search_root: string,
    options: DiscoveryOptions = {}
): LoadedProjectConfig {
    const discovered = find_project_config(search_root, options);
    if (discovered.kind === 'none') {
        return {
            kind: 'none',
            warnings: discovered.warnings,
            candidate_dirs: discovered.candidate_dirs,
        };
    }

    const loaded = load_toml_file(discovered.path);
    return {
        ...loaded,
        candidate_dirs: discovered.candidate_dirs,
        warnings: [...discovered.warnings, ...loaded.warnings],
    } as LoadedProjectConfig;
}
