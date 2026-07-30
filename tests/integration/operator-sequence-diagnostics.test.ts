/**
 * Integration tests for OperatorSequenceAnalyzer
 * 
 * Tests that operator-sequence diagnostics appear alongside other diagnostic types
 * in the full DiagnosticsProvider pipeline, and that config changes propagate correctly.
 * 
 * Requirements covered:
 * - 1.1-1.6: Suggestible pair detection
 * - 2.1-2.7: Invalid pair detection
 * - 3.1, 3.2: Embedded context suppression
 * - 8.1-8.7: Configuration severity settings
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

describe('Operator Sequence Diagnostics Integration', () => {
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
        } as any);
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                    malformedOperator: 'warning',
                    spacedCompoundOperator: 'information',
                    invalidOperatorSequence: 'error',
                },
            },
        };
    });

    describe('Full Pipeline Integration', () => {
        it('does not flag a mixed random-equation separator', async () => {
            const my_content = [
                'local rhs price',
                "mixed log_supply `rhs' if esample || state_num:",
            ].join('\n');
            const my_uri = 'file:///test_mixed_double_bar.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_operator_sequence = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                        StataDiagnosticCode.MALFORMED_OPERATOR ||
                    my_diagnostic.code ===
                        StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                    my_diagnostic.code ===
                        StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE ||
                    my_diagnostic.code ===
                        StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );

            expect(the_operator_sequence).toHaveLength(0);
        });

        it('preserves a mixed warning before a separator', async () => {
            const my_content = 'mixed y x if a & b | c || id:';
            const my_uri = 'file:///test_mixed_logical_before_separator.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_invalid = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            const the_mixed = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                    StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(the_invalid).toHaveLength(0);
            expect(
                the_mixed.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.MIXED_LOGICAL_OPERATORS,
                    range: {
                        start: { line: 0, character: 15 },
                        end: { line: 0, character: 20 },
                    },
                },
            ]);
        });

        it('keeps unsupported-command double bars invalid', async () => {
            const my_content =
                'my_mixed_program y x if a & b | c || id:';
            const my_uri = 'file:///test_unsupported_mixed_separator.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_relevant = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                        StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE ||
                    my_diagnostic.code ===
                        StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(
                the_relevant.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 0, character: 34 },
                        end: { line: 0, character: 36 },
                    },
                },
            ]);
        });

        it('keeps ordinary expression double bars invalid', async () => {
            const my_content = 'display a & b | c || d';
            const my_uri = 'file:///test_ordinary_expression_double_bar.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_relevant = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                        StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE ||
                    my_diagnostic.code ===
                        StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(
                the_relevant.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 0, character: 18 },
                        end: { line: 0, character: 20 },
                    },
                },
            ]);
        });

        it('reports only invalid bars separated by a block comment', async () => {
            const my_content = 'display a & b |/* comment */| c';
            const my_uri = 'file:///test_comment_separated_double_bar.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );

            expect(
                the_diagnostics.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 0, character: 14 },
                        end: { line: 0, character: 29 },
                    },
                },
            ]);
        });

        it('keeps line-comment-separated bars adjacent in ; mode', async () => {
            const my_content = [
                '#delimit ;',
                'display a & b |// comment',
                '| c ;',
            ].join('\n');
            const my_uri = 'file:///test_line_comment_double_bar_semicolon.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );

            expect(
                the_diagnostics.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 1, character: 14 },
                        end: { line: 2, character: 1 },
                    },
                },
            ]);
        });

        it('stops line-comment adjacency at a CR terminator', async () => {
            const my_content = [
                'display a & b |// comment',
                '| c',
            ].join('\n');
            const my_uri = 'file:///test_line_comment_double_bar_cr.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );

            expect(
                the_diagnostics.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.MIXED_LOGICAL_OPERATORS,
                    range: {
                        start: { line: 0, character: 10 },
                        end: { line: 0, character: 15 },
                    },
                },
            ]);
        });

        it('reports a mix across a line comment in ; mode', async () => {
            const my_content = [
                '#delimit ;',
                'keep if x & y // explanation',
                '    | z ;',
            ].join('\n');
            const my_uri = 'file:///test_mixed_line_comment_semicolon.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_mixed = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                    StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(the_mixed).toHaveLength(1);
        });

        it('reports a mix across a full-line * comment in ; mode', async () => {
            const my_content = [
                '#delimit ;',
                'keep if x & y',
                '* explanation',
                '    | z ;',
            ].join('\n');
            const my_uri = 'file:///test_mixed_star_comment_semicolon.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_mixed = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                    StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(the_mixed).toHaveLength(1);
        });

        it('does not mix operators across a line-comment CR terminator', async () => {
            const my_content = [
                'display x & y // explanation',
                'display z | q',
            ].join('\n');
            const my_uri = 'file:///test_mixed_line_comment_cr_boundary.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics =
                await diagnostics_provider.get_diagnostics(
                    my_document,
                    default_config
                );
            const the_mixed = the_diagnostics.filter(
                (my_diagnostic) =>
                    my_diagnostic.code ===
                    StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );

            expect(the_mixed).toHaveLength(0);
        });

        it('should emit spaced compound operator diagnostics alongside semantic diagnostics', async () => {
            // Code with both undefined macro and a spaced compound operator
            const my_content = `display \`undefined_macro'
gen x = y < = z`;
            const my_uri = 'file:///test_combined.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            // Should have both undefined macro and spaced compound operator diagnostics
            const the_undefined_macro = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            const the_spaced_compound_operator = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );

            expect(the_undefined_macro.length).toBeGreaterThanOrEqual(1);
            expect(the_spaced_compound_operator).toHaveLength(1);
            expect(the_spaced_compound_operator[0].message).toBe(
                "Spaced compound operator '< ='. Stata treats this as '<='; consider writing '<='."
            );
        });

        it('should emit C-style logical diagnostics in control flow context', async () => {
            // Code with both parser error (unclosed brace) and C-style logical in control flow
            const my_content = `if condition {
    display x | | y`;
            const my_uri = 'file:///test_parser_error.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            // Should have C-style logical diagnostic (informational, not error)
            const the_cstyle_logical = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );

            expect(the_cstyle_logical).toHaveLength(1);
            expect(the_cstyle_logical[0].message).toBe(
                "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style"
            );
        });

        it('should emit multiple operator diagnostics in same file', async () => {
            const my_content = `gen x = a < = b
gen y = c > = d
gen z = e | | f`;
            const my_uri = 'file:///test_multiple.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_spaced_compound).toHaveLength(2);
            expect(the_invalid).toHaveLength(1);
        });
    });

    describe('Embedded Context Suppression (Requirements 3.1, 3.2)', () => {
        it('should NOT emit operator diagnostics inside Mata blocks', async () => {
            const my_content = `display "before mata"
mata:
    x = a < = b
    y = c | | d
end
display "after mata"`;
            const my_uri = 'file:///test_mata.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            // Should have no operator diagnostics from inside Mata block
            const the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_operator_diagnostics).toHaveLength(0);
        });

        it('should NOT emit operator diagnostics inside Python blocks', async () => {
            const my_content = `display "before python"
python:
x = a < = b
y = c | | d
end
display "after python"`;
            const my_uri = 'file:///test_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            // Should have no operator diagnostics from inside Python block
            const the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_operator_diagnostics).toHaveLength(0);
        });

        it('should emit operator diagnostics outside embedded blocks but not inside', async () => {
            const my_content = `gen x = a < = b
mata:
    y = c < = d
end
gen z = e > = f`;
            const my_uri = 'file:///test_mixed.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );

            // Should have 2 diagnostics (lines 1 and 5), not 3 (line 3 is in Mata)
            expect(the_spaced_compound).toHaveLength(2);
            
            // Verify they are on the correct lines (0-indexed)
            const the_lines = the_spaced_compound.map(d => d.range.start.line).sort((a, b) => a - b);
            expect(the_lines).toEqual([0, 4]);
        });
    });

    describe('Config Severity Propagation (Requirements 8.1-8.7)', () => {
        it('should use configured severity for spaced compound pairs', async () => {
            const my_content = `gen x = a < = b`;
            const my_uri = 'file:///test_severity.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Test with 'error' severity
            const error_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        spacedCompoundOperator: 'error',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                error_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );

            expect(the_spaced_compound).toHaveLength(1);
            expect(the_spaced_compound[0].severity).toBe(DiagnosticSeverity.Error);
        });

        it('should use configured severity for invalid pairs', async () => {
            const my_content = `gen x = a | | b`;
            const my_uri = 'file:///test_invalid_severity.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Test with 'warning' severity
            const warning_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        invalidOperatorSequence: 'warning',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                warning_config
            );

            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_invalid).toHaveLength(1);
            expect(the_invalid[0].severity).toBe(DiagnosticSeverity.Warning);
        });

        it('should suppress malformed diagnostics when malformedOperator is "off"', async () => {
            const my_content = `gen x = a = = b
gen y = c | | d`;
            const my_uri = 'file:///test_off_malformed.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const off_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        malformedOperator: 'off',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                off_config
            );

            const the_malformed = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            // Malformed should be suppressed, invalid should still appear
            expect(the_malformed).toHaveLength(0);
            expect(the_invalid).toHaveLength(1);
        });

        it('should suppress spaced compound diagnostics when spacedCompoundOperator is "off"', async () => {
            const my_content = `gen x = a < = b
gen y = c | | d`;
            const my_uri = 'file:///test_off_spaced_compound.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const off_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        spacedCompoundOperator: 'off',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                off_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            // Spaced compound should be suppressed, invalid should still appear
            expect(the_spaced_compound).toHaveLength(0);
            expect(the_invalid).toHaveLength(1);
        });

        it('should suppress invalid diagnostics when invalidOperatorSequence is "off"', async () => {
            const my_content = `gen x = a < = b
gen y = c | | d`;
            const my_uri = 'file:///test_off_invalid.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const off_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        invalidOperatorSequence: 'off',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                off_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            // Invalid should be suppressed, spaced compound should still appear
            expect(the_spaced_compound).toHaveLength(1);
            expect(the_invalid).toHaveLength(0);
        });

        it('should suppress all operator diagnostics when operator severities are "off"', async () => {
            const my_content = `gen x = a < = b
gen y = c = = d
gen z = e | | f`;
            const my_uri = 'file:///test_both_off.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const both_off_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        malformedOperator: 'off',
                        spacedCompoundOperator: 'off',
                        invalidOperatorSequence: 'off',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                both_off_config
            );

            const the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_operator_diagnostics).toHaveLength(0);
        });

        it('should support all severity levels for spaced compound pairs', async () => {
            const my_content = `gen x = a < = b`;

            const severity_map: Record<string, DiagnosticSeverity> = {
                'error': DiagnosticSeverity.Error,
                'warning': DiagnosticSeverity.Warning,
                'information': DiagnosticSeverity.Information,
                'hint': DiagnosticSeverity.Hint,
            };

            let version = 1;
            for (const [config_severity, expected_severity] of Object.entries(severity_map)) {
                // Use unique URI for each severity to avoid cache issues
                const my_uri = `file:///test_severity_${config_severity}.do`;
                await document_store.open(my_uri, my_content, version++);
                const my_document = document_store.get(my_uri)!;

                const test_config: StataLSPConfig = {
                    ...default_config,
                    diagnostics: {
                        ...default_config.diagnostics,
                        severity: {
                            ...default_config.diagnostics.severity,
                            spacedCompoundOperator: config_severity as any,
                        },
                    },
                };

                const the_diagnostics = await diagnostics_provider.get_diagnostics(
                    my_document,
                    test_config
                );

                const the_spaced_compound = the_diagnostics.filter(
                    d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
                );

                expect(the_spaced_compound).toHaveLength(1);
                expect(the_spaced_compound[0].severity).toBe(expected_severity);
            }
        });

        it('should keep = = at warning by default but allow explicit information', async () => {
            const my_content = `gen x = a = = b`;
            const my_uri = 'file:///test_equals_equals_default.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const default_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );
            const default_suggestible = default_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );

            expect(default_suggestible).toHaveLength(1);
            expect(default_suggestible[0].severity).toBe(DiagnosticSeverity.Warning);

            const info_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        malformedOperator: 'information',
                    },
                },
            };

            const info_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                info_config
            );
            const info_suggestible = info_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );

            expect(info_suggestible).toHaveLength(1);
            expect(info_suggestible[0].severity).toBe(DiagnosticSeverity.Information);
        });
    });

    describe('Diagnostic Coexistence', () => {
        it('should emit operator diagnostics alongside indentation diagnostics', async () => {
            const my_content = `if condition {
display "not indented"
    gen x = a < = b
}`;
            const my_uri = 'file:///test_with_indent.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const config_with_indent: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    indentation: true,
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                config_with_indent
            );

            const the_indent_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MISSING_INDENTATION ||
                     d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
            );
            const the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );

            // Should have both types of diagnostics
            expect(the_indent_diagnostics.length).toBeGreaterThanOrEqual(1);
            expect(the_operator_diagnostics).toHaveLength(1);
        });

        it('should emit spaced compound and malformed pair types correctly', async () => {
            const my_content = `gen a = x < = 1
gen b = x > = 2
gen c = x ! = 3
gen d = x ~ = 4
gen e = x = = 5`;
            const my_uri = 'file:///test_spaced_compound_and_malformed.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_spaced_compound = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            const the_malformed = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );

            expect(the_spaced_compound).toHaveLength(4);
            expect(the_malformed).toHaveLength(1);
            
            const the_spaced_messages = the_spaced_compound.map(d => d.message);
            const the_malformed_messages = the_malformed.map(d => d.message);
            expect(the_spaced_messages).toContain(
                "Spaced compound operator '< ='. Stata treats this as '<='; consider writing '<='."
            );
            expect(the_spaced_messages).toContain(
                "Spaced compound operator '> ='. Stata treats this as '>='; consider writing '>='."
            );
            expect(the_spaced_messages).toContain(
                "Spaced compound operator '! ='. Stata treats this as '!='; consider writing '!='."
            );
            expect(the_spaced_messages).toContain(
                "Spaced compound operator '~ ='. Stata treats this as '~='; consider writing '~='."
            );
            expect(the_malformed_messages).toContain("Malformed operator '= ='. Did you mean '=='?");
        });

        it('should emit all invalid pair types with correct messages', async () => {
            const my_content = `gen a = x | | y
gen b = x & & y
gen c = x | = y`;
            const my_uri = 'file:///test_special_invalid.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_invalid).toHaveLength(3);
            
            const the_messages = the_invalid.map(d => d.message);
            expect(the_messages).toContain(
                "Invalid operator sequence '| |'. Stata uses '|' for logical OR, not '||'"
            );
            expect(the_messages).toContain(
                "Invalid operator sequence '& &'. Stata uses '&' for logical AND, not '&&'"
            );
            expect(the_messages).toContain(
                "Invalid operator sequence '| ='. Stata does not support compound assignment operators"
            );
        });
    });

    describe('Document Update Handling', () => {
        it('should update diagnostics when document content changes', async () => {
            const my_uri = 'file:///test_update.do';
            
            // Initial content with a spaced compound operator
            const initial_content = `gen x = a < = b`;
            await document_store.open(my_uri, initial_content, 1);
            let my_document = document_store.get(my_uri)!;

            let the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            let the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(the_operator_diagnostics).toHaveLength(1);

            // Close and reopen with fixed content (simpler than using update with changes)
            document_store.close(my_uri);
            const fixed_content = `gen x = a <= b`;
            await document_store.open(my_uri, fixed_content, 2);
            my_document = document_store.get(my_uri)!;
            
            // Clear provider cache
            diagnostics_provider.clear_cache_for_document(my_uri);

            the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            the_operator_diagnostics = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(the_operator_diagnostics).toHaveLength(0);
        });
    });

    describe('Context-Aware C-Style Logical Handling (Requirements 2a.1-2a.4)', () => {
        it('should emit informational diagnostic for && in if control flow', async () => {
            const my_content = `if a & & b {
    display "test"
}`;
            const my_uri = 'file:///test_cstyle_if.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_cstyle = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_cstyle).toHaveLength(1);
            expect(the_cstyle[0].severity).toBe(DiagnosticSeverity.Information);
            expect(the_invalid).toHaveLength(0);
        });

        it('should emit error diagnostic for && in if qualifier', async () => {
            const my_content = `gen x = 1 if a & & b`;
            const my_uri = 'file:///test_cstyle_qualifier.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                default_config
            );

            const the_cstyle = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            const the_invalid = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );

            expect(the_cstyle).toHaveLength(0);
            expect(the_invalid).toHaveLength(1);
            expect(the_invalid[0].severity).toBe(DiagnosticSeverity.Error);
        });

        it('should suppress C-style logical in control flow when config is off', async () => {
            const my_content = `if a | | b {
    display "test"
}`;
            const my_uri = 'file:///test_cstyle_off.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const off_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        cStyleLogicalInControlFlow: 'off',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                off_config
            );

            const the_cstyle = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );

            expect(the_cstyle).toHaveLength(0);
        });

        it('should use configured severity for C-style logical in control flow', async () => {
            const my_content = `if a | | b {
    display "test"
}`;
            const my_uri = 'file:///test_cstyle_severity.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const warning_config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        cStyleLogicalInControlFlow: 'warning',
                    },
                },
            };

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                warning_config
            );

            const the_cstyle = the_diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );

            expect(the_cstyle).toHaveLength(1);
            expect(the_cstyle[0].severity).toBe(DiagnosticSeverity.Warning);
        });
    });
});
