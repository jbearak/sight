/**
 * Unit tests for C-style logical context detection bugfix.
 *
 * Verifies that C-style logical operators (`&&`, `||`) inside
 * if qualifiers within control flow bodies are correctly
 * classified as 'qualifier' context (Error, code 6002), not
 * 'control_flow' context (Information, code 6003).
 *
 * Requirements covered:
 * - 2.1: qualifier context → Error diagnostic (6002)
 * - 2.2: control_flow context → Information diagnostic (6003)
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { OperatorSequenceAnalyzer } from '../../src/providers/operator-sequence-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('C-Style Logical Context Detection Bugfix', () => {
    let analyzer: OperatorSequenceAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new OperatorSequenceAnalyzer();
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
                },
            },
        };
    });

    describe('Reproduction case (Requirements 2.1, 2.2)', () => {
        it('if (1 && 1) gets code 6003, gen if 1 && 2 gets code 6002', () => {
            const doc = create_document_state(
                'if (1 & & 1) {\n    gen x = y if 1 & & 2\n}'
            );
            const diagnostics = analyzer.analyze(doc, default_config);

            // Line 0: if condition → Information (6003)
            const control_flow_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(control_flow_diags).toHaveLength(1);
            expect(control_flow_diags[0].range.start.line).toBe(0);
            expect(control_flow_diags[0].severity).toBe(
                DiagnosticSeverity.Information
            );

            // Line 1: if qualifier → Error (6002)
            const qualifier_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(qualifier_diags).toHaveLength(1);
            expect(qualifier_diags[0].range.start.line).toBe(1);
            expect(qualifier_diags[0].severity).toBe(
                DiagnosticSeverity.Error
            );
        });
    });

    describe('Nested control flow (Requirement 2.1)', () => {
        it('if qualifier inside foreach inside if gets code 6002', () => {
            const source = [
                'if (1) {',
                '    foreach x of local vars {',
                '        gen z = 1 if a & & b',
                '    }',
                '}',
            ].join('\n');
            const doc = create_document_state(source);
            const diagnostics = analyzer.analyze(doc, default_config);

            const qualifier_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(qualifier_diags).toHaveLength(1);
            expect(qualifier_diags[0].range.start.line).toBe(2);
            expect(qualifier_diags[0].severity).toBe(
                DiagnosticSeverity.Error
            );

            // No control flow diagnostic
            const control_flow_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(control_flow_diags).toHaveLength(0);
        });
    });

    describe('Nested if conditions (Requirement 2.2)', () => {
        it('inner if condition gets code 6003', () => {
            const source = [
                'if (a) {',
                '    if (b & & c) {',
                '        display "nested"',
                '    }',
                '}',
            ].join('\n');
            const doc = create_document_state(source);
            const diagnostics = analyzer.analyze(doc, default_config);

            const control_flow_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(control_flow_diags).toHaveLength(1);
            expect(control_flow_diags[0].range.start.line).toBe(1);
            expect(control_flow_diags[0].severity).toBe(
                DiagnosticSeverity.Information
            );

            // No error diagnostic
            const qualifier_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(qualifier_diags).toHaveLength(0);
        });
    });

    describe('Mixed nesting (Requirements 2.1, 2.2)', () => {
        it('condition gets 6003, qualifier in body gets 6002', () => {
            const source = [
                'if (x | | y) {',
                '    gen a = 1 if c | | d',
                '}',
            ].join('\n');
            const doc = create_document_state(source);
            const diagnostics = analyzer.analyze(doc, default_config);

            // Condition → Information (6003)
            const control_flow_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(control_flow_diags).toHaveLength(1);
            expect(control_flow_diags[0].range.start.line).toBe(0);

            // Qualifier → Error (6002)
            const qualifier_diags = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(qualifier_diags).toHaveLength(1);
            expect(qualifier_diags[0].range.start.line).toBe(1);
        });
    });
});
