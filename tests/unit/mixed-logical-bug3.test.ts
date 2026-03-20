import { describe, it, expect } from 'bun:test';
import { MixedLogicalOperatorAnalyzer } from '../../src/providers/mixed-logical-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('MixedLogicalOperatorAnalyzer Function Argument Test', () => {
    it('does not falsely flag mixed operators in separate function arguments', () => {
        const analyzer = new MixedLogicalOperatorAnalyzer();
        const doc = create_document_state('display min(a | b, c & d)');
        const config = { ...DEFAULT_SETTINGS };
        const diagnostics = analyzer.analyze(doc, config);
        const mixed = diagnostics.filter(
            d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
        );
        expect(mixed.length).toBe(0);
    });
});
