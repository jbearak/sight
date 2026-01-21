/**
 * Severity Settings Property Tests
 *
 * Tests that verify individual severity settings are respected for
 * undefined macro and variable diagnostics.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Severity Settings Property Tests', () => {
    let my_diagnostics_provider: DiagnosticsProvider;
    let base_config: StataLSPConfig;

    beforeEach(() => {
        const my_mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

        base_config = {
            diagnostics: {
                enabled: true,
                severity: {
                    styleWarnings: 'warning',
                    undefinedMacro: 'warning',
                    undefinedVariable: 'information',
                },
                undefinedVariableEnabled: true,
                indentation: false,
            },
            completion: { cacheSize: 1000, prefixMaxItems: 100 },
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
                    out_of_scope: 'info',
                    missing_file: 'warning',
                    max_depth: 'information',
                },
                max_backward_depth: 10,
                max_forward_depth: 10,
                max_chain_depth: 20,
            },
        } as StataLSPConfig;
    });

    /**
     * Task 8.1: Property test verifying `diagnostics.severity.undefinedMacro` is respected
     */
    it('should respect undefinedMacro severity setting for all valid values', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('error', 'warning', 'information', 'hint', 'off'),
                async (macro_name: string, severity_setting: 'error' | 'warning' | 'information' | 'hint' | 'off') => {
                    const content = `local result \`${macro_name}'`;
                    const my_document = create_document_state(content);
                    
                    const config = {
                        ...base_config,
                        diagnostics: {
                            ...base_config.diagnostics,
                            severity: {
                                ...base_config.diagnostics.severity,
                                undefinedMacro: severity_setting,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        config
                    );
                    
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    if (severity_setting === 'off') {
                        return undefined_macro_diags.length === 0;
                    } else {
                        const expected_severity = {
                            'error': DiagnosticSeverity.Error,
                            'warning': DiagnosticSeverity.Warning,
                            'information': DiagnosticSeverity.Information,
                            'hint': DiagnosticSeverity.Hint,
                        }[severity_setting];
                        
                        return undefined_macro_diags.length === 1 && 
                               undefined_macro_diags[0].severity === expected_severity;
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Task 8.2: Property test verifying `diagnostics.severity.undefinedVariable` is respected
     */
    it('should respect undefinedVariable severity setting for all valid values', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('error', 'warning', 'information', 'hint', 'off'),
                async (var_name: string, severity_setting: 'error' | 'warning' | 'information' | 'hint' | 'off') => {
                    const content = `summarize ${var_name}`;
                    const my_document = create_document_state(content);
                    
                    const config = {
                        ...base_config,
                        diagnostics: {
                            ...base_config.diagnostics,
                            severity: {
                                ...base_config.diagnostics.severity,
                                undefinedVariable: severity_setting,
                            },
                        },
                    };
                    
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        config
                    );
                    
                    const undefined_var_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    );
                    
                    if (severity_setting === 'off') {
                        return undefined_var_diags.length === 0;
                    } else {
                        const expected_severity = {
                            'error': DiagnosticSeverity.Error,
                            'warning': DiagnosticSeverity.Warning,
                            'information': DiagnosticSeverity.Information,
                            'hint': DiagnosticSeverity.Hint,
                        }[severity_setting];
                        
                        return undefined_var_diags.length === 1 && 
                               undefined_var_diags[0].severity === expected_severity;
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Task 8.3: Property test verifying default behavior when no severity settings are configured
     */
    it('should use default severity values when no severity settings are configured', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                async (macro_name: string, var_name: string) => {
                    const content = `local result \`${macro_name}'\nsummarize ${var_name}`;
                    const my_document = create_document_state(content);
                    
                    // Use base_config which has default values: undefinedMacro='warning', undefinedVariable='information'
                    const the_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_document,
                        base_config
                    );
                    
                    const undefined_macro_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    const undefined_var_diags = the_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    );
                    
                    // Default: undefinedMacro should be 'warning', undefinedVariable should be 'information'
                    return undefined_macro_diags.length === 1 && 
                           undefined_macro_diags[0].severity === DiagnosticSeverity.Warning &&
                           undefined_var_diags.length === 1 && 
                           undefined_var_diags[0].severity === DiagnosticSeverity.Information;
                }
            ),
            { numRuns: 50 }
        );
    });
});