import { StataLSPConfig, CrossFileConfig } from '../src/types';

/**
 * Create a minimal StataLSPConfig populated with sensible defaults for tests.
 *
 * Merges the provided partial `overrides` into the default configuration so tests can
 * replace only the fields they need without type assertions.
 *
 * @param overrides - Partial configuration values to merge over the defaults
 * @returns A complete `StataLSPConfig` instance with `overrides` applied
 */
export function createTestConfig(overrides: Partial<StataLSPConfig> = {}): StataLSPConfig {
    const defaultCrossFile: CrossFileConfig = {
        index_workspace: true,
        max_indexed_files: 1000,
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        max_callee_revalidations: 10,
        assume_call_site: 'end',
        diagnostics: {
            out_of_scope: 'information',
            missing_file: 'warning',
            max_depth: 'warning',
            call_site_identification: 'information'
        }
    };

    return {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'off',
                styleWarnings: 'hint',
                malformedOperator: 'warning',
                invalidOperatorSequence: 'error',
                cStyleLogicalInControlFlow: 'information',
            },
            indentation: true
        },
        completion: { 
            cacheSize: 100, 
            prefixMaxItems: 50 
        },
        formatting: { 
            indentSize: 4, 
            indentStyle: 'spaces', 
            lineWidth: 80,
            preferredCommentStyle: '//',
            normalizeCommentStyle: false,
            commentLineWidth: 72
        },
        indexing: { 
            maxFileSizeBytes: 500000 
        },
        adoPaths: [],
        indexWorkspace: true,
        cross_file: defaultCrossFile,
        ...overrides
    };
}