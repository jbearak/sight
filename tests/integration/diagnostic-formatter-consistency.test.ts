/**
 * Integration Test: Diagnostic-Formatter Consistency
 *
 * Feature: block-start-indentation-diagnostic
 * Validates: Requirements 4.1, 4.2, 4.3
 *
 * This test verifies that:
 * 1. Diagnostics are emitted for code with indentation issues
 * 2. After formatting, the diagnostics are resolved
 * 3. The formatter and diagnostic analyzer are consistent
 */

import { describe, test, expect } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { for_each_formatter_mode, create_formatter_config } from '../property/helpers/formatter-test-utils';

describe('Diagnostic-Formatter Consistency Integration', () => {
    for_each_formatter_mode('should diagnose and fix unnecessary indentation at top level', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        // Generate code with indentation issues - top-level statement with leading whitespace
        const source_with_issues = `    gen x = 1
    display "hello"
gen y = 2`;

        const doc_state = create_document_state(source_with_issues);

        // Step 1: Verify diagnostics are emitted
        const diagnostics_before = analyzer.analyze(doc_state, default_config);
        const unnecessary_diagnostics = diagnostics_before.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
        );

        // Should have diagnostics for the indented top-level lines
        expect(unnecessary_diagnostics.length).toBeGreaterThanOrEqual(1);

        // Step 2: Format the code
        const edits = formatter.format(doc_state, options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;

        // Step 3: Verify diagnostics are resolved
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const unnecessary_after = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
        );

        // Should have no unnecessary indentation diagnostics after formatting
        expect(unnecessary_after.length).toBe(0);
    });

    for_each_formatter_mode('should diagnose and fix missing indentation inside brace block', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        // Generate code with missing indentation inside block
        const source_with_issues = `if 1 == 1 {
gen x = 1
display "hello"
}`;

        const doc_state = create_document_state(source_with_issues);

        // Step 1: Verify diagnostics are emitted
        const diagnostics_before = analyzer.analyze(doc_state, default_config);
        const missing_diagnostics = diagnostics_before.filter(
            d => d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        // Should have diagnostics for the unindented body lines
        expect(missing_diagnostics.length).toBeGreaterThanOrEqual(1);

        // Step 2: Format the code
        const edits = formatter.format(doc_state, options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;

        // Step 3: Verify diagnostics are resolved
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const missing_after = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        // Should have no missing indentation diagnostics after formatting
        expect(missing_after.length).toBe(0);
    });

    for_each_formatter_mode('should diagnose and fix mixed indentation inside block', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        // Generate code with mixed indentation (space + tab)
        const source_with_issues = `if 1 == 1 {
 \tgen x = 1
}`;

        const doc_state = create_document_state(source_with_issues);

        // Step 1: Format the code
        const edits = formatter.format(doc_state, options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;

        // Step 2: Verify the formatted code has normalized indentation
        const the_lines = formatted_source.split('\n');
        const body_line = the_lines[1];

        // Body line should have only spaces (since insertSpaces: true)
        const leading_whitespace = body_line.match(/^(\s*)/)?.[1] || '';
        expect(leading_whitespace.includes('\t')).toBe(false);
        expect(leading_whitespace.length).toBe(4); // 4 spaces for depth 1

        // Step 3: Verify no indentation diagnostics after formatting
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const indentation_diagnostics = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        expect(indentation_diagnostics.length).toBe(0);
    });

    for_each_formatter_mode('should diagnose and fix over-indentation inside block', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        // Generate code with over-indentation (8 spaces instead of 4)
        const source_with_issues = `if 1 == 1 {
        gen x = 1
}`;

        const doc_state = create_document_state(source_with_issues);

        // Step 1: Verify diagnostics are emitted
        const diagnostics_before = analyzer.analyze(doc_state, default_config);
        const unnecessary_diagnostics = diagnostics_before.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
        );

        // Should have diagnostic for the over-indented body line
        expect(unnecessary_diagnostics.length).toBeGreaterThanOrEqual(1);

        // Step 2: Format the code
        const edits = formatter.format(doc_state, options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;

        // Step 3: Verify diagnostics are resolved
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const unnecessary_after = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
        );

        // Should have no unnecessary indentation diagnostics after formatting
        expect(unnecessary_after.length).toBe(0);
    });

    for_each_formatter_mode('should diagnose and fix nested block indentation issues', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        // Generate code with nested blocks and various indentation issues
        const source_with_issues = `    if 1 == 1 {
gen x = 1
    if 2 == 2 {
gen y = 2
    }
}`;

        const doc_state = create_document_state(source_with_issues);

        // Step 1: Verify diagnostics are emitted
        const diagnostics_before = analyzer.analyze(doc_state, default_config);
        const indentation_diagnostics = diagnostics_before.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        // Should have diagnostics for the indentation issues
        expect(indentation_diagnostics.length).toBeGreaterThanOrEqual(1);

        // Step 2: Format the code
        const edits = formatter.format(doc_state, options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;

        // Step 3: Verify diagnostics are resolved
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const indentation_after = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        // Should have no indentation diagnostics after formatting
        expect(indentation_after.length).toBe(0);
    });

    for_each_formatter_mode('should produce idempotent formatting results', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const options = { tabSize: 4, insertSpaces: true };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        const source_with_issues = `    gen x = 1
if 1 == 1 {
gen y = 2
}`;

        const doc_state = create_document_state(source_with_issues);

        // Format once
        const edits_1 = formatter.format(doc_state, options, default_config);
        expect(edits_1.length).toBeGreaterThan(0);
        const formatted_1 = edits_1[0].newText;

        // Format again
        const doc_state_2 = create_document_state(formatted_1);
        const edits_2 = formatter.format(doc_state_2, options, default_config);
        expect(edits_2.length).toBeGreaterThan(0);
        const formatted_2 = edits_2[0].newText;

        // Results should be identical
        expect(formatted_2).toBe(formatted_1);

        // Both should have no indentation diagnostics
        const diagnostics_1 = analyzer.analyze(doc_state_2, default_config);
        const diagnostics_2 = analyzer.analyze(create_document_state(formatted_2), default_config);

        const indent_diags_1 = diagnostics_1.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );
        const indent_diags_2 = diagnostics_2.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        expect(indent_diags_1.length).toBe(0);
        expect(indent_diags_2.length).toBe(0);
    });

    for_each_formatter_mode('should respect tabs configuration when fixing indentation', (mode) => {
        const analyzer = new IndentationDiagnosticAnalyzer();
        const formatter = new CodeFormatter();
        const tabs_options = { tabSize: 4, insertSpaces: false };

        const default_config: StataLSPConfig = {
            ...create_formatter_config(mode),
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                indentation: true,
            },
        };

        const source_with_issues = `if 1 == 1 {
gen x = 1
}`;

        const doc_state = create_document_state(source_with_issues);

        // Format with tabs
        const edits = formatter.format(doc_state, tabs_options, default_config);
        expect(edits.length).toBeGreaterThan(0);

        const formatted_source = edits[0].newText;
        const the_lines = formatted_source.split('\n');
        const body_line = the_lines[1];

        // Body line should have tabs (since insertSpaces: false)
        const leading_whitespace = body_line.match(/^(\s*)/)?.[1] || '';
        expect(leading_whitespace.includes('\t')).toBe(true);
        expect(leading_whitespace.includes(' ')).toBe(false);

        // Verify no indentation diagnostics after formatting
        const formatted_doc = create_document_state(formatted_source);
        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);
        const indentation_diagnostics = diagnostics_after.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                 d.code === StataDiagnosticCode.MISSING_INDENTATION
        );

        expect(indentation_diagnostics.length).toBe(0);
    });
});
