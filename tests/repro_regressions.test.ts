/**
 * Regression tests for three reported issues:
 * 1. Orphan closing brace not emitting diagnostic
 * 2. Indentation issues not emitting diagnostics
 * 3. Formatter deleting empty lines
 * 
 * These tests verify the core functionality works correctly.
 * If these pass but the LSP doesn't show diagnostics, the issue
 * is in the LSP server wiring, not the core logic.
 */
import { describe, expect, it } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../src/providers/indentation-diagnostics';
import { CodeFormatter } from '../src/providers/formatter';
import { StataLSPConfig, ParseErrorCode, StataDiagnosticCode } from '../src/types';
import { create_document_state } from './property/helpers/document-utils';

const config: StataLSPConfig = {
    diagnostics: { enabled: true, undefined_macros: true, indentation: true },
    formatting: { enabled: true, mode: 'source-preserving' },
    completion: { enabled: true },
    cross_file: { enabled: false, max_backward_depth: 10, max_forward_depth: 10, max_chain_depth: 20 }
};

const analyzer = new IndentationDiagnosticAnalyzer();
const formatter = new CodeFormatter();
const options = { tabSize: 4, insertSpaces: true };

describe('Regression: Orphan closing brace', () => {
    it('should emit diagnostic for closing brace without opening brace', () => {
        const source = `if (this)
}`;
        const doc_state = create_document_state(source);
        
        const orphan_errors = doc_state.diagnostics.filter(
            e => e.code === ParseErrorCode.ORPHAN_CLOSE_BRACE
        );
        expect(orphan_errors.length).toBeGreaterThan(0);
    });
});

describe('Regression: Indentation diagnostics', () => {
    it('should emit diagnostic for missing indentation inside block', () => {
        const source = `if (this) {
then
}`;
        const doc_state = create_document_state(source);
        const indent_diags = analyzer.analyze(doc_state, config);
        
        const missing_indent = indent_diags.filter(
            d => d.code === StataDiagnosticCode.MISSING_INDENTATION
        );
        expect(missing_indent.length).toBeGreaterThan(0);
    });

    it('should emit diagnostic for unnecessary indentation at top level', () => {
        const source = `    if (this) {
}`;
        const doc_state = create_document_state(source);
        const indent_diags = analyzer.analyze(doc_state, config);
        
        const unnecessary_indent = indent_diags.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
        );
        expect(unnecessary_indent.length).toBeGreaterThan(0);
    });
});

describe('Regression: Formatter empty line preservation', () => {
    it('should preserve empty lines between statements', () => {
        const source = `display "hello"

display "world"`;
        const doc_state = create_document_state(source);
        const formatted = formatter.format(doc_state, options, config);
        
        // formatter.format returns TextEdit[], check the newText
        expect(Array.isArray(formatted)).toBe(true);
        if (Array.isArray(formatted) && formatted.length > 0) {
            expect(formatted[0].newText).toContain('\n\n');
        }
    });

    it('should preserve multiple consecutive blank lines', () => {
        const source = `display "hello"


display "world"`;
        const doc_state = create_document_state(source);
        const formatted = formatter.format(doc_state, options, config);
        
        expect(Array.isArray(formatted)).toBe(true);
        if (Array.isArray(formatted) && formatted.length > 0) {
            // Two blank lines = three consecutive newlines
            expect(formatted[0].newText).toContain('\n\n\n');
        }
    });
});
