import * as fs from 'fs';
import * as path from 'path';
import {
    DiscoveredConfig,
    DiscoveryOptions,
    MAX_DISCOVERY_DEPTH,
    PROJECT_CONFIG_FILE,
    ProjectConfigWarning,
    STALE_JSON_CONFIG_FILE,
} from './types';

function stale_json_warning(config_path: string): ProjectConfigWarning {
    return {
        code: 'stale-json-config',
        path: config_path,
        message:
            '.sight.json is no longer supported. Convert it to sight.toml; ' +
            'JSON syntax is not compatible with TOML.',
    };
}

export function ancestor_dirs(
    search_root: string,
    max_depth: number = MAX_DISCOVERY_DEPTH
): string[] {
    const dirs: string[] = [];
    let current = path.resolve(search_root);

    for (let i = 0; i < max_depth; i++) {
        dirs.push(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return dirs;
}

export function find_project_config(
    search_root: string,
    options: DiscoveryOptions = {}
): DiscoveredConfig {
    const candidate_dirs: string[] = [];
    const warnings: ProjectConfigWarning[] = [];
    const max_depth = options.max_depth ?? MAX_DISCOVERY_DEPTH;

    for (const my_dir of ancestor_dirs(search_root, max_depth)) {
        candidate_dirs.push(my_dir);

        const stale_json_path = path.join(my_dir, STALE_JSON_CONFIG_FILE);
        if (fs.existsSync(stale_json_path)) {
            warnings.push(stale_json_warning(stale_json_path));
        }

        const config_path = path.join(my_dir, PROJECT_CONFIG_FILE);
        if (fs.existsSync(config_path)) {
            return {
                kind: 'sight-toml',
                path: config_path,
                candidate_dirs,
                warnings,
            };
        }
    }

    return {
        kind: 'none',
        candidate_dirs,
        warnings,
    };
}

export function is_project_config_event_path(file_path: string): boolean {
    const base = path.basename(file_path);
    return base === PROJECT_CONFIG_FILE || base === STALE_JSON_CONFIG_FILE;
}
