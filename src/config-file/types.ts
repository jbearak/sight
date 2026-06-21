import type { StataLSPConfig } from '../types';

export const PROJECT_CONFIG_FILE = 'sight.toml';
export const STALE_JSON_CONFIG_FILE = '.sight.json';
export const MAX_DISCOVERY_DEPTH = 32;

export type ProjectConfigWarningCode =
    | 'stale-json-config'
    | 'unknown-key'
    | 'invalid-value'
    | 'normalized-key-collision';

export interface ProjectConfigWarning {
    code: ProjectConfigWarningCode;
    message: string;
    path?: string;
    key_path?: string;
}

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends Array<infer U>
        ? U[]
        : T[P] extends object
            ? DeepPartial<T[P]>
            : T[P];
};

export interface DiscoveryOptions {
    max_depth?: number;
}

export interface DiscoveredConfigBase {
    candidate_dirs: string[];
    stale_json_paths: string[];
    warnings: ProjectConfigWarning[];
}

export type DiscoveredConfig =
    | (DiscoveredConfigBase & {
        kind: 'sight-toml';
        path: string;
    })
    | (DiscoveredConfigBase & {
        kind: 'none';
    });

export type LoadedProjectConfig =
    | {
        kind: 'loaded';
        path: string;
        partial_config: DeepPartial<StataLSPConfig>;
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    }
    | {
        kind: 'load-failed';
        path: string;
        error: string;
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    }
    | {
        kind: 'none';
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    };
