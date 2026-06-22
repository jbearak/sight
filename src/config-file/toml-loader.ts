import * as fs from 'fs';
import { parse } from 'smol-toml';
import type { LoadedProjectConfig, ProjectConfigWarning } from './types';
import { map_public_config_to_partial_config } from './schema';
import { error_message } from '../utils/error-message';

function load_failed(
    path: string,
    error: unknown,
    warnings: ProjectConfigWarning[]
): LoadedProjectConfig {
    return {
        kind: 'load-failed',
        path,
        error: `${path}: ${error_message(error)}`,
        warnings,
        candidate_dirs: [],
    };
}

export function load_toml_str(
    text: string,
    source_label: string
): LoadedProjectConfig {
    const warnings: ProjectConfigWarning[] = [];
    try {
        const parsed = parse(text);
        const partial_config = map_public_config_to_partial_config(
            parsed,
            (warning) => warnings.push({ ...warning, path: source_label })
        );
        return {
            kind: 'loaded',
            path: source_label,
            partial_config,
            warnings,
            candidate_dirs: [],
        };
    } catch (error) {
        return load_failed(source_label, error, warnings);
    }
}

export function load_toml_file(path: string): LoadedProjectConfig {
    try {
        return load_toml_str(fs.readFileSync(path, 'utf8'), path);
    } catch (error) {
        return load_failed(path, error, []);
    }
}
