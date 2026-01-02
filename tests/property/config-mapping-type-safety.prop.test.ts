import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    map_stata_lsp_json_to_partial_config,
    DeepPartial,
} from '../../src/utils/workspace-config';
import { StataLSPConfig } from '../../src/types';

describe('Config Mapping Type Safety Property Tests', () => {
    /**
     * Property 2: Config Mapping Type Safety
     *
     * For any valid JSON object representing a `.sight.json` configuration,
     * the `map_stata_lsp_json_to_partial_config` function should return a value
     * that conforms to `DeepPartial<StataLSPConfig>`, with all recognized fields
     * properly mapped from camelCase to snake_case.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should map camelCase fields to snake_case correctly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    indexWorkspace: fc.boolean(),
                    maxIndexedFiles: fc.integer({ min: 1, max: 10000 }),
                    assumeCallSite: fc.oneof(
                        fc.constant('end' as const),
                        fc.constant('start' as const)
                    ),
                }),
                (my_cross_file_config) => {
                    const my_raw = {
                        crossFile: my_cross_file_config,
                    };

                    const my_result = map_stata_lsp_json_to_partial_config(my_raw);

                    // Verify snake_case mapping
                    expect(my_result.cross_file).toBeDefined();
                    expect(my_result.cross_file!.index_workspace).toBe(
                        my_cross_file_config.indexWorkspace
                    );
                    expect(my_result.cross_file!.max_indexed_files).toBe(
                        my_cross_file_config.maxIndexedFiles
                    );
                    expect(my_result.cross_file!.assume_call_site).toBe(
                        my_cross_file_config.assumeCallSite
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Config Mapping Type Safety (diagnostics nested object)
     *
     * For any valid diagnostics configuration, the nested diagnostics fields
     * should be properly mapped from camelCase to snake_case.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should map nested diagnostics fields correctly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    undefinedSymbol: fc.oneof(
                        fc.constant('error' as const),
                        fc.constant('warning' as const),
                        fc.constant('information' as const),
                        fc.constant('off' as const)
                    ),
                    outOfScope: fc.oneof(
                        fc.constant('error' as const),
                        fc.constant('warning' as const),
                        fc.constant('information' as const),
                        fc.constant('off' as const)
                    ),
                    missingFile: fc.oneof(
                        fc.constant('error' as const),
                        fc.constant('warning' as const),
                        fc.constant('information' as const),
                        fc.constant('off' as const)
                    ),
                }),
                (my_diagnostics_config) => {
                    const my_raw = {
                        crossFile: {
                            diagnostics: my_diagnostics_config,
                        },
                    };

                    const my_result = map_stata_lsp_json_to_partial_config(my_raw);

                    // Verify nested snake_case mapping
                    expect(my_result.cross_file).toBeDefined();
                    expect(my_result.cross_file!.diagnostics).toBeDefined();
                    expect(my_result.cross_file!.diagnostics!.undefined_symbol).toBe(
                        my_diagnostics_config.undefinedSymbol
                    );
                    expect(my_result.cross_file!.diagnostics!.out_of_scope).toBe(
                        my_diagnostics_config.outOfScope
                    );
                    expect(my_result.cross_file!.diagnostics!.missing_file).toBe(
                        my_diagnostics_config.missingFile
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: 'info' alias should normalize to 'information'
     *
     * For any diagnostics field using 'info', it should be normalized
     * to 'information' in the mapped config.
     *
     * **Validates: Severity alias normalization**
     */
    it('should normalize info alias to information for crossFile diagnostics', () => {
        const my_raw = {
            crossFile: {
                diagnostics: {
                    undefinedSymbol: 'info',
                    outOfScope: 'info',
                    missingFile: 'info',
                    callSiteIdentification: 'info',
                },
            },
        };

        const my_result = map_stata_lsp_json_to_partial_config(my_raw);

        expect(my_result.cross_file!.diagnostics!.undefined_symbol).toBe('information');
        expect(my_result.cross_file!.diagnostics!.out_of_scope).toBe('information');
        expect(my_result.cross_file!.diagnostics!.missing_file).toBe('information');
        expect(my_result.cross_file!.diagnostics!.call_site_identification).toBe('information');
    });

    /**
     * Property 2: Config Mapping Type Safety (empty/invalid input handling)
     *
     * For any invalid or empty input, the function should return an empty
     * object without throwing errors.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should return empty object for invalid inputs', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant(null),
                    fc.constant(undefined),
                    fc.string(),
                    fc.integer(),
                    fc.boolean(),
                    fc.constant({}),
                    fc.constant({ notCrossFile: {} })
                ),
                (my_invalid_input) => {
                    const my_result = map_stata_lsp_json_to_partial_config(my_invalid_input);

                    // Should return empty object for invalid inputs
                    expect(my_result).toEqual({});
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Config Mapping Type Safety (partial config handling)
     *
     * For any partial configuration with only some fields present,
     * only those fields should be mapped.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should handle partial configurations correctly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    has_index_workspace: fc.boolean(),
                    has_max_indexed_files: fc.boolean(),
                    index_workspace_value: fc.boolean(),
                    max_indexed_files_value: fc.integer({ min: 1, max: 10000 }),
                }),
                (my_flags) => {
                    const my_cross_file: Record<string, unknown> = {};

                    if (my_flags.has_index_workspace) {
                        my_cross_file.indexWorkspace = my_flags.index_workspace_value;
                    }
                    if (my_flags.has_max_indexed_files) {
                        my_cross_file.maxIndexedFiles = my_flags.max_indexed_files_value;
                    }

                    const my_raw = { crossFile: my_cross_file };
                    const my_result = map_stata_lsp_json_to_partial_config(my_raw);

                    // Verify only present fields are mapped
                    if (my_flags.has_index_workspace) {
                        expect(my_result.cross_file!.index_workspace).toBe(
                            my_flags.index_workspace_value
                        );
                    } else {
                        expect(my_result.cross_file!.index_workspace).toBeUndefined();
                    }

                    if (my_flags.has_max_indexed_files) {
                        expect(my_result.cross_file!.max_indexed_files).toBe(
                            my_flags.max_indexed_files_value
                        );
                    } else {
                        expect(my_result.cross_file!.max_indexed_files).toBeUndefined();
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Config Mapping Type Safety (type coercion rejection)
     *
     * For any field with an incorrect type, the field should not be mapped.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should reject fields with incorrect types', () => {
        fc.assert(
            fc.property(
                fc.record({
                    indexWorkspace: fc.oneof(
                        fc.string(),
                        fc.integer(),
                        fc.constant(null)
                    ),
                    maxIndexedFiles: fc.oneof(
                        fc.string(),
                        fc.boolean(),
                        fc.constant(null)
                    ),
                    assumeCallSite: fc.oneof(
                        fc.string().filter((s) => s !== 'end' && s !== 'start'),
                        fc.integer(),
                        fc.boolean()
                    ),
                }),
                (my_invalid_types) => {
                    const my_raw = {
                        crossFile: my_invalid_types,
                    };

                    const my_result = map_stata_lsp_json_to_partial_config(my_raw);

                    // Fields with wrong types should not be mapped
                    expect(my_result.cross_file!.index_workspace).toBeUndefined();
                    expect(my_result.cross_file!.max_indexed_files).toBeUndefined();
                    expect(my_result.cross_file!.assume_call_site).toBeUndefined();
                }
            ),
            { numRuns: 100 }
        );
    });
});
