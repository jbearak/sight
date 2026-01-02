/**
 * Regression test for @lsp-global directive not working when placed inline
 * (not in file header).
 * 
 * Issue: User placed `// @lsp-global metadata_for_dhs_checks_is_ready` on line 65,
 * but the reference on line 66 still produced an undefined global macro warning.
 * Moving the directive to the file header (line 4) fixed the issue.
 * 
 * Root cause: Multi-line block comments were being placed at their start line
 * in a reconstructed content array, but their embedded newlines caused the
 * directive parser to calculate incorrect line numbers.
 * 
 * Fix: Parse declaration directives directly from tokens, preserving accurate
 * line numbers from the token ranges.
 */

import { describe, test, expect } from 'bun:test';
import { SemanticAnalyzer } from '../src/analyzer';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { StataDiagnosticCode } from '../src/types';

describe('@lsp-global inline directive regression', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();

    test('directive immediately after block comment should suppress warning', () => {
        // Simplified version of the user's file structure
        const content = `/*  Confirm that the metadata for processing the survey checks has been prepped
    this might not be the case if we called this script by itself, i.e., outside 
    the context of loop.do
*/
// @lsp-global metadata_for_dhs_checks_is_ready
if ( "\${metadata_for_dhs_checks_is_ready}" != "1" ) {
    display "not ready"
}`;

        const lexer_result = lexer.tokenize(content);
        const parse_result = parser.parse(lexer_result.tokens);
        const analyzer = new SemanticAnalyzer();
        const analysis_result = analyzer.analyze(
            parse_result.ast,
            'file:///test.do',
            undefined,
            undefined,
            lexer_result.tokens
        );

        // Should NOT have undefined macro warning - directive is on line 4, reference on line 5
        const undefined_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('metadata_for_dhs_checks_is_ready')
        );
        
        expect(undefined_warnings.length).toBe(0);
    });

    test('directive in header should suppress warning later in file', () => {
        const content = `// @lsp-global metadata_for_dhs_checks_is_ready
/*  Confirm that the metadata for processing the survey checks has been prepped
    this might not be the case if we called this script by itself, i.e., outside 
    the context of loop.do
*/
if ( "\${metadata_for_dhs_checks_is_ready}" != "1" ) {
    display "not ready"
}`;

        const lexer_result = lexer.tokenize(content);
        const parse_result = parser.parse(lexer_result.tokens);
        const analyzer = new SemanticAnalyzer();
        const analysis_result = analyzer.analyze(
            parse_result.ast,
            'file:///test.do',
            undefined,
            undefined,
            lexer_result.tokens
        );

        const undefined_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('metadata_for_dhs_checks_is_ready')
        );
        
        expect(undefined_warnings.length).toBe(0);
    });

    test('directive mid-file after code should suppress warning', () => {
        const content = `gen x = 1
gen y = 2
gen z = 3
// @lsp-global myconfig
if ( "\${myconfig}" != "1" ) {
    display "test"
}`;

        const lexer_result = lexer.tokenize(content);
        const parse_result = parser.parse(lexer_result.tokens);
        const analyzer = new SemanticAnalyzer();
        const analysis_result = analyzer.analyze(
            parse_result.ast,
            'file:///test.do',
            undefined,
            undefined,
            lexer_result.tokens
        );

        const undefined_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('myconfig')
        );
        
        expect(undefined_warnings.length).toBe(0);
    });

    test('directive line number is preserved correctly after block comment', () => {
        const content = `/*  Block comment
    spanning multiple lines
*/
// @lsp-global testmacro
if ( "\${testmacro}" != "1" ) {
    display "test"
}`;

        const lexer_result = lexer.tokenize(content);
        const parse_result = parser.parse(lexer_result.tokens);
        const analyzer = new SemanticAnalyzer();
        const analysis_result = analyzer.analyze(
            parse_result.ast,
            'file:///test.do',
            undefined,
            undefined,
            lexer_result.tokens
        );

        // Verify the directive was registered with correct line number
        const global_macro = analysis_result.symbols.globalMacros.get('testmacro');
        expect(global_macro).toBeDefined();
        expect(global_macro?.definition_line).toBe(3); // Line 3 (0-indexed)
        
        // Should NOT have undefined macro warning
        const undefined_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('testmacro')
        );
        expect(undefined_warnings.length).toBe(0);
    });
});
