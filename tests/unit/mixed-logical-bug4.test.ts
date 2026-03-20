import { describe, it, expect } from 'bun:test';
import { MixedLogicalOperatorAnalyzer } from '../../src/providers/mixed-logical-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('MixedLogicalOperatorAnalyzer Bracket Test', () => {
    it('detects mixed operators inside square brackets', () => {
        const analyzer = new MixedLogicalOperatorAnalyzer();
        const doc = create_document_state('display x[a & b | c]');
        const config = { ...DEFAULT_SETTINGS };
        const diagnostics = analyzer.analyze(doc, config);
        const mixed = diagnostics.filter(
            d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
        );
        expect(mixed.length).toBeGreaterThan(0);
    });

    it('does not mix operators inside brackets with outside operators', () => {
        const analyzer = new MixedLogicalOperatorAnalyzer();
        const doc = create_document_state('display x[a & b] | c');
        const config = { ...DEFAULT_SETTINGS };
        const diagnostics = analyzer.analyze(doc, config);
        const mixed = diagnostics.filter(
            d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
        );
        expect(mixed.length).toBe(0);
    });
});
