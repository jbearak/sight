import * as path from 'path';
import { find_project_config } from './discovery';
import { load_toml_file } from './toml-loader';
import type { DiscoveryOptions, LoadedProjectConfig } from './types';

function with_discovery_metadata(
    loaded: LoadedProjectConfig,
    candidate_dirs: string[],
    stale_json_paths: string[],
    warnings: LoadedProjectConfig['warnings']
): LoadedProjectConfig {
    return {
        ...loaded,
        candidate_dirs,
        stale_json_paths,
        warnings: [...warnings, ...loaded.warnings],
    } as LoadedProjectConfig;
}

export function resolve_explicit_config_path(
    base_dir: string,
    explicit_path: string
): string {
    return path.resolve(base_dir, explicit_path);
}

export function load_explicit_project_config(
    path_to_config: string
): LoadedProjectConfig {
    return load_toml_file(path_to_config);
}

export function load_explicit_project_config_from_base(
    base_dir: string,
    explicit_path: string
): LoadedProjectConfig {
    return load_explicit_project_config(
        resolve_explicit_config_path(base_dir, explicit_path)
    );
}

export function discover_and_load_project_config(
    search_root: string,
    options: DiscoveryOptions = {}
): LoadedProjectConfig {
    const discovered = find_project_config(search_root, options);
    if (discovered.kind === 'none') {
        return {
            kind: 'none',
            warnings: discovered.warnings,
            stale_json_paths: discovered.stale_json_paths,
            candidate_dirs: discovered.candidate_dirs,
        };
    }

    return with_discovery_metadata(
        load_toml_file(discovered.path),
        discovered.candidate_dirs,
        discovered.stale_json_paths,
        discovered.warnings
    );
}
