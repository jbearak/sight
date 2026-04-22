/**
 * Diagnostic Suppression Property Tests
 *
 * Tests that verify diagnostic suppression comments work correctly
 * for undefined symbol diagnostics.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Diagnostic Suppression Property Tests', () => {
    let my_diagnostics_provider: DiagnosticsProvider;
    let my_config: StataLSPConfig;

    beforeEach(() => {
        // Create a mock connection for diagnostics provider
        const my_mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

        // Create default config with diagnostics enabled
        my_config = {
            diagnostics: {
                enabled: true,
                severity: {
                    styleWarnings: 'warning',
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                },
            },
            completion: {},
            formatting: {
                indentSize: 4,
                indentStyle: 'spaces',
                lineWidth: 80,
                preferredCommentStyle: '//',
                normalizeCommentStyle: false,
                commentLineWidth: 72,
            },
            indexing: { maxFileSizeBytes: 500000 },
            adoPaths: [],
            indexWorkspace: true,
            cross_file: {
                index_workspace: true,
                max_indexed_files: 1000,
                assume_call_site: 'end',
                diagnostics: {
                    missing_file: 'warning',
                },
            },
        } as StataLSPConfig;
    });

    /**
     * Property: @lsp-ignore suppresses diagnostics on same line
     */
    it('should suppress undefined macro diagnostics with @lsp-ignore on same line', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                async (macro_name: string) => {
                    const content = `local result \`${macro_name}' // @lsp-ignore`;
                    const my_document = create_document_state(content);
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );
                    
                    // Should not have undefined macro diagnostic
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return undefined_macro_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: @lsp-ignore-next suppresses diagnostics on next line
     */
    it('should suppress undefined macro diagnostics with @lsp-ignore-next on previous line', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                async (macro_name: string) => {
                    const content = `// @lsp-ignore-next\nlocal result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );
                    
                    // Should not have undefined macro diagnostic
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return undefined_macro_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Suppression works for undefined variables too
     */
    it('should suppress undefined variable diagnostics with suppression comments', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('@lsp-ignore', '@lsp-ignore-next'),
                async (var_name: string, suppress_type: string) => {
                    const content = suppress_type === '@lsp-ignore'
                        ? `summarize ${var_name} // @lsp-ignore`
                        : `// @lsp-ignore-next\nsummarize ${var_name}`;
                    
                    const my_document = create_document_state(content);
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );
                    
                    // Should not have undefined variable diagnostic
                    const undefined_var_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    );
                    
                    return undefined_var_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Non-suppressed diagnostics still appear
     */
    it('should still report undefined symbols without suppression comments', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                async (macro_name: string) => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );
                    
                    // Should have undefined macro diagnostic
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return undefined_macro_diags.length > 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Suppression is line-specific
     */
    it('should only suppress diagnostics on the specified line', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                async (macro1: string, macro2: string) => {
                    fc.pre(macro1 !== macro2); // Ensure different macro names
                    
                    const content = `local result1 \`${macro1}' // @lsp-ignore\nlocal result2 \`${macro2}'`;
                    const my_document = create_document_state(content);
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );
                    
                    // Should have exactly one undefined macro diagnostic (for macro2)
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return undefined_macro_diags.length === 1 &&
                           undefined_macro_diags[0].range.start.line === 1; // Second line (0-indexed)
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: diagnostics.severity.undefinedMacro = 'off' suppresses undefined macro diagnostics
     */
    it('should suppress undefined macro diagnostics when diagnostics.severity.undefinedMacro is off', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                async (macro_name: string) => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set diagnostics.severity.undefinedMacro to 'off'
                    const my_off_config = {
                        ...my_config,
                        diagnostics: {
                            ...my_config.diagnostics,
                            severity: {
                                ...my_config.diagnostics.severity,
                                undefinedMacro: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_off_config
                    );
                    
                    // Should not have any undefined macro diagnostics
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return undefined_macro_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: diagnostics.severity.undefinedVariable = 'off' suppresses undefined variable diagnostics
     */
    it('should suppress undefined variable diagnostics when diagnostics.severity.undefinedVariable is off', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                async (var_name: string) => {
                    const content = `gen new_var = ${var_name}`;
                    const my_document = create_document_state(content);
                    
                    // Set diagnostics.severity.undefinedVariable to 'off'
                    const my_off_config = {
                        ...my_config,
                        diagnostics: {
                            ...my_config.diagnostics,
                            severity: {
                                ...my_config.diagnostics.severity,
                                undefinedVariable: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_off_config
                    );
                    
                    // Should not have any undefined variable diagnostics
                    const undefined_var_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    );
                    
                    return undefined_var_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Individual severity settings work independently
     */
    it('should respect individual severity settings for undefined macros and variables', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('error', 'warning', 'information', 'hint'),
                async (macro_name: string, severity: 'error' | 'warning' | 'information' | 'hint') => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set individual severity
                    const my_severity_config = {
                        ...my_config,
                        diagnostics: {
                            ...my_config.diagnostics,
                            severity: {
                                ...my_config.diagnostics.severity,
                                undefinedMacro: severity,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_severity_config
                    );
                    
                    // Should have undefined macro diagnostic with specified severity
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    if (undefined_macro_diags.length !== 1) {
                        return false;
                    }
                    
                    const expected_severity = severity === 'error' ? 1 :
                                            severity === 'warning' ? 2 :
                                            severity === 'information' ? 3 : 4;
                    
                    return undefined_macro_diags[0].severity === expected_severity;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: suppression comments also suppress OUT_OF_SCOPE_SYMBOL rewrites
     */
    it('should suppress OUT_OF_SCOPE_SYMBOL rewrites with suppression comments', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('@lsp-ignore', '@lsp-ignore-next'),
                async (macro_name: string, suppress_type: string) => {
                    const content = suppress_type === '@lsp-ignore'
                        ? `display \`${macro_name}' // @lsp-ignore\nlocal ${macro_name} value`
                        : `// @lsp-ignore-next\ndisplay \`${macro_name}'\nlocal ${macro_name} value`;
                    const my_document = create_document_state(content);
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_config
                    );

                    // Should not have any out-of-scope rewrites
                    const out_of_scope_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                    );
                    return out_of_scope_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: crossFile.diagnostics.missingFile = 'off' suppresses missing file diagnostics
     */
    it('should suppress missing file diagnostics when crossFile.diagnostics.missingFile is off', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                async (filename: string) => {
                    const content = `// @lsp-done-by "${filename}.do"\nlocal result \`missing_macro'`;
                    const my_document = create_document_state(content);
                    
                    // Set missingFile to 'off'
                    const my_suppress_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                missing_file: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_suppress_config
                    );
                    
                    // Should not have any missing file diagnostics
                    const missing_file_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.MISSING_FILE
                    );
                    
                    return missing_file_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Multiple 'off' settings work together
     */
    it('should suppress missing-file diagnostics alongside disabled undefined macros', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                async (filename: string) => {
                    const content = `// @lsp-done-by "${filename}.do"\nlocal result \`missing_macro'`;
                    const my_document = create_document_state(content);

                    // Disable both the base undefined-macro diagnostic and
                    // the missing-file cross-file diagnostic.
                    const my_suppress_all_config = {
                        ...my_config,
                        diagnostics: {
                            ...my_config.diagnostics,
                            severity: {
                                ...my_config.diagnostics.severity,
                                undefinedMacro: 'off' as const,
                            },
                        },
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                missing_file: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_suppress_all_config
                    );
                    
                    // Should not have either undefined-macro or missing-file diagnostics
                    const cross_file_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                             d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL ||
                             d.code === StataDiagnosticCode.MISSING_FILE
                    );
                    return cross_file_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: 'off' settings are case-insensitive for cross-file diagnostics
     * 
     * Note: Case-insensitivity is handled by the config mapping layer (normalize_severity
     * in workspace-config.ts), not by the diagnostics provider. This test verifies that
     * configs created via map_stata_lsp_json_to_partial_config properly normalize case variants.
     */
    it('should handle case-insensitive off settings for cross-file diagnostics', async () => {
        // Import the config mapping function to test case normalization
        const { map_stata_lsp_json_to_partial_config } = await import('../../src/utils/workspace-config');
        
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                fc.constantFrom('off', 'OFF', 'Off', 'oFf'),
                async (filename: string, off_variant: string) => {
                    const content = `// @lsp-done-by "${filename}.do"`;
                    const my_document = create_document_state(content);
                    
                    // Use the config mapping layer to normalize the case variant
                    const raw_config = {
                        crossFile: {
                            diagnostics: {
                                missingFile: off_variant,
                            },
                        },
                    };
                    const mapped = map_stata_lsp_json_to_partial_config(raw_config);
                    
                    // Build config with normalized value from mapping layer
                    const my_case_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                missing_file: mapped.cross_file?.diagnostics?.missing_file ?? 'off',
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_case_config
                    );
                    
                    // Should not have any missing file diagnostics
                    const missing_file_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.MISSING_FILE
                    );
                    
                    return missing_file_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });
});