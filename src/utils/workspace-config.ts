/**
 * Workspace configuration loader for Sight.
 *
 * Loads `.sight.json` from the workspace root and maps the public schema
 * (documented in README) into the internal StataLSPConfig shape.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StataLSPConfig } from '../types';

/**
 * Normalize severity value, mapping 'info' alias to 'information' and lowercasing.
 */
function normalize_severity(value: string): 'error' | 'warning' | 'information' | 'off' {
    const lower = value.toLowerCase();
    if (lower === 'info') {
        return 'information';
    }
    return lower as 'error' | 'warning' | 'information' | 'off';
}

/**
 * Recursive partial type that makes all nested properties optional.
 */
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Convert parsed `.sight.json` (README schema) into a partial internal StataLSPConfig.
 *
 * Maps recognized top-level sections and fields from camelCase README names to the internal
 * snake_case config structure and normalizes diagnostic severity values. Unrecognized or
 * invalid fields are ignored.
 *
 * @param raw - The parsed contents of a `.sight.json` file (typically JSON.parse output)
 * @returns A DeepPartial<StataLSPConfig> reflecting any mapped fields; returns an empty object if `raw` is not an object or contains no mappable fields
 */
export function map_stata_lsp_json_to_partial_config(raw: unknown): DeepPartial<StataLSPConfig> {
    if (!raw || typeof raw !== 'object') {
        return {};
    }

    const maybe_raw = raw as Record<string, unknown>;
    const mapped: DeepPartial<StataLSPConfig> = {};

    // README schema: { diagnostics: { ... } }
    const diagnostics = maybe_raw.diagnostics;
    if (diagnostics && typeof diagnostics === 'object') {
        const diagnostics_obj = diagnostics as Record<string, unknown>;
        mapped.diagnostics = {};

        if (typeof diagnostics_obj.indentation === 'boolean') {
            mapped.diagnostics.indentation = diagnostics_obj.indentation;
        }
    }

    // README schema: { formatting: { ... } }
    const formatting = maybe_raw.formatting;
    if (formatting && typeof formatting === 'object') {
        const formatting_obj = formatting as Record<string, unknown>;
        mapped.formatting = {};

        if (typeof formatting_obj.preserveAlignment === 'boolean') {
            mapped.formatting.preserve_alignment = formatting_obj.preserveAlignment;
        }
    }

    // README schema: { crossFile: { ... } }
    const cross_file = maybe_raw.crossFile;
    if (cross_file && typeof cross_file === 'object') {
        const cross_file_obj = cross_file as Record<string, unknown>;
        mapped.cross_file = { diagnostics: {} };

        if (typeof cross_file_obj.indexWorkspace === 'boolean') {
            mapped.cross_file!.index_workspace = cross_file_obj.indexWorkspace;
        }
        if (typeof cross_file_obj.maxIndexedFiles === 'number') {
            mapped.cross_file!.max_indexed_files = cross_file_obj.maxIndexedFiles;
        }
        if (cross_file_obj.assumeCallSite === 'end' || cross_file_obj.assumeCallSite === 'start') {
            mapped.cross_file!.assume_call_site = cross_file_obj.assumeCallSite;
        }
        if (
            cross_file_obj.backwardDependencies === 'auto' ||
            cross_file_obj.backwardDependencies === 'explicit'
        ) {
            mapped.cross_file!.backward_dependencies = cross_file_obj.backwardDependencies;
        }
        if (typeof cross_file_obj.maxBackwardDepth === 'number') {
            mapped.cross_file!.max_backward_depth = cross_file_obj.maxBackwardDepth;
        }
        if (typeof cross_file_obj.maxForwardDepth === 'number') {
            mapped.cross_file!.max_forward_depth = cross_file_obj.maxForwardDepth;
        }
        if (typeof cross_file_obj.maxChainDepth === 'number') {
            mapped.cross_file!.max_chain_depth = cross_file_obj.maxChainDepth;
        }
        if (typeof cross_file_obj.maxCalleeRevalidations === 'number') {
            mapped.cross_file!.max_callee_revalidations = cross_file_obj.maxCalleeRevalidations;
        }

        const diags = cross_file_obj.diagnostics;
        if (diags && typeof diags === 'object') {
            const diags_obj = diags as Record<string, unknown>;

            if (typeof diags_obj.outOfScope === 'string') {
                mapped.cross_file!.diagnostics!.out_of_scope = normalize_severity(diags_obj.outOfScope);
            }
            if (typeof diags_obj.missingFile === 'string') {
                mapped.cross_file!.diagnostics!.missing_file = normalize_severity(diags_obj.missingFile);
            }
            if (typeof diags_obj.callSiteIdentification === 'string') {
                mapped.cross_file!.diagnostics!.call_site_identification = normalize_severity(diags_obj.callSiteIdentification);
            }
        }
    }

    return mapped;
}

/**
 * Read `.sight.json` from the workspace root, returning a mapped partial config.
 */
export function read_workspace_file_config_from_root(
    workspace_root: string
): { partial_config: DeepPartial<StataLSPConfig>; error?: string } {
    try {
        const config_path = path.join(workspace_root, '.sight.json');
        if (!fs.existsSync(config_path)) {
            return { partial_config: {} };
        }
        const raw_text = fs.readFileSync(config_path, 'utf8');
        const parsed = JSON.parse(raw_text);
        return { partial_config: map_stata_lsp_json_to_partial_config(parsed) };
    } catch (error) {
        return {
            partial_config: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}