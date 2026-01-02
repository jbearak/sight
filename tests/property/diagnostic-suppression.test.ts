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
                undefinedVariableEnabled: true,
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
                    undefined_symbol: 'warning',
                    out_of_scope: 'info',
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
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
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
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
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
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.constantFrom('@lsp-ignore', '@lsp-ignore-next'),
                async (var_name: string, suppress_type: string) => {
                    const content = suppress_type === '@lsp-ignore'
                        ? `gen new_var = ${var_name} // @lsp-ignore`
                        : `// @lsp-ignore-next\ngen new_var = ${var_name}`;
                    
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
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
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
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
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
     * Property: crossFile.diagnostics.undefinedSymbol = 'off' suppresses all undefined symbol diagnostics
     */
    it('should suppress all undefined symbol diagnostics when crossFile.diagnostics.undefinedSymbol is off', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                async (macro_name: string, var_name: string) => {
                    const content = `local result \`${macro_name}'\ngen new_var = ${var_name}`;
                    const my_document = create_document_state(content);
                    
                    // Set crossFile.diagnostics.undefinedSymbol to 'off'
                    const my_off_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                undefined_symbol: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_off_config
                    );
                    
                    // Should not have any undefined symbol diagnostics
                    const undefined_symbol_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                             d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    );
                    
                    return undefined_symbol_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: crossFile.diagnostics.undefinedSymbol overrides individual severity settings
     */
    it('should override individual severity settings when crossFile.diagnostics.undefinedSymbol is set', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.constantFrom('error', 'warning', 'info'),
                async (macro_name: string, cross_file_severity: 'error' | 'warning' | 'info') => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set individual severity to 'off' but crossFile to a specific severity
                    const my_override_config = {
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
                                ...my_config.cross_file.diagnostics,
                                undefined_symbol: cross_file_severity,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_override_config
                    );
                    
                    // Should have undefined macro diagnostic with cross-file severity
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    if (undefined_macro_diags.length !== 1) {
                        return false;
                    }
                    
                    const expected_severity = cross_file_severity === 'error' ? 1 :
                                            cross_file_severity === 'warning' ? 2 : 3;
                    
                    return undefined_macro_diags[0].severity === expected_severity;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: crossFile.diagnostics.undefinedSymbol = 'off' takes precedence over fallback settings
     */
    it('should suppress diagnostics when crossFile.diagnostics.undefinedSymbol is off regardless of fallback settings', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.constantFrom('error', 'warning', 'information', 'hint'),
                async (macro_name: string, fallback_severity: 'error' | 'warning' | 'information' | 'hint') => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set fallback severity to something other than 'off', but crossFile to 'off'
                    const my_suppress_config = {
                        ...my_config,
                        diagnostics: {
                            ...my_config.diagnostics,
                            severity: {
                                ...my_config.diagnostics.severity,
                                undefinedMacro: fallback_severity,
                            },
                        },
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                undefined_symbol: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_suppress_config
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
     * Property: crossFile.diagnostics.outOfScope = 'off' suppresses out-of-scope diagnostics
     */
    it('should suppress out-of-scope diagnostics when crossFile.diagnostics.outOfScope is off', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                async (macro_name: string) => {
                    const content = `// @lsp-done-by "parent.do" line=5\nlocal result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set outOfScope to 'off'
                    const my_suppress_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                out_of_scope: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_suppress_config
                    );
                    
                    // Should not have any out-of-scope diagnostics
                    const out_of_scope_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.OUT_OF_SCOPE
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
                    const content = `// @lsp-done-by "${filename}.do"`;
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
    it('should suppress all relevant diagnostics when multiple crossFile settings are off', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                async (macro_name: string, filename: string) => {
                    const content = `// @lsp-done-by "${filename}.do"\nlocal result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set all crossFile diagnostics to 'off'
                    const my_suppress_all_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                undefined_symbol: 'off' as const,
                                out_of_scope: 'off' as const,
                                missing_file: 'off' as const,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_suppress_all_config
                    );
                    
                    // Should not have any cross-file related diagnostics
                    const cross_file_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                             d.code === StataDiagnosticCode.OUT_OF_SCOPE ||
                             d.code === StataDiagnosticCode.MISSING_FILE
                    );
                    
                    return cross_file_diags.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: 'off' settings are case-insensitive
     */
    it('should handle case-insensitive off settings', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.constantFrom('off', 'OFF', 'Off', 'oFf'),
                async (macro_name: string, off_variant: string) => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    // Set crossFile.diagnostics.undefinedSymbol to various case variants of 'off'
                    const my_case_config = {
                        ...my_config,
                        cross_file: {
                            ...my_config.cross_file,
                            diagnostics: {
                                ...my_config.cross_file.diagnostics,
                                undefined_symbol: off_variant.toLowerCase() as 'off',
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        my_case_config
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
});