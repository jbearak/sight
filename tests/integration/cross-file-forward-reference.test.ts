import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

describe('Cross-File Forward Reference Integration Tests', () => {
    /**
     * Integration test for apple.do/orange.do scenario
     * Tests the specific bug scenario reported by the user
     * 
     * Note: Workspace symbols do NOT suppress undefined macro warnings.
     * Only cross-file directives (@lsp-done-by, @lsp-included-by, @lsp-do, etc.)
     * provide scope resolution for diagnostics.
     */
    it('should preserve forward reference warnings for same-file symbols with cross-file directives', () => {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        // Create workspace symbols representing orange.do
        // Note: Workspace symbols do NOT suppress undefined macro warnings
        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map([
                ['orange', {
                    name: 'orange',
                    scope: 'global',
                    location: { 
                        uri: 'file:///orange.do', 
                        range: { 
                            start: { line: 0, character: 0 }, 
                            end: { line: 0, character: 10 } 
                        } 
                    },
                    sourceUri: 'file:///orange.do',
                }]
            ]),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };

        // apple.do content with forward reference to same-file symbol
        const apple_code = `// @lsp-done-by: "orange.do"
di \`apple'  // Forward reference - should warn
local apple "red"
di \`apple'  // Not forward reference - should not warn
di \${orange}  // Cross-file symbol - should warn (workspace symbols do NOT suppress diagnostics)`;

        const lexer_result = lexer.tokenize(apple_code);
        const parse_result = parser.parse(lexer_result.tokens);
        const analysis_result = analyzer.analyze(
            parse_result.ast, 
            'file:///apple.do', 
            workspace_symbols, 
            { undefined_macro_enabled: true }, 
            lexer_result.tokens
        );

        // Should have warning for the forward reference to 'apple'
        const apple_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('apple')
        );
        
        // Analyzer SHOULD warn for 'orange' - workspace symbols do NOT suppress diagnostics
        // Use cross-file directives (@lsp-done-by, @lsp-do, etc.) for scope resolution
        const orange_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('orange')
        );

        expect(apple_warnings.length).toBe(1);
        // Workspace symbols do NOT suppress undefined macro warnings
        expect(orange_warnings.length).toBe(1);
        
        // Verify the apple warning is on the correct line (line 1, the first `di \`apple'`)
        expect(apple_warnings[0].range.start.line).toBe(1);
    });

    /**
     * Integration test for string literal macro detection
     * Tests Requirements 3.1, 3.2
     */
    it('should detect undefined macros in string literals', () => {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        // berry.do content with macro reference in string literal
        const berry_code = `di \`"The fruit is \`apple'"'`;

        const lexer_result = lexer.tokenize(berry_code);
        const parse_result = parser.parse(lexer_result.tokens);
        const analysis_result = analyzer.analyze(
            parse_result.ast, 
            'file:///berry.do', 
            undefined, 
            { undefined_macro_enabled: true }, 
            lexer_result.tokens
        );

        // Should have warning for undefined macro 'apple' in string literal
        const apple_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                 d.message.includes('apple')
        );

        expect(apple_warnings.length).toBe(1);
    });

    /**
     * Test that proper ordering eliminates warnings for same-file symbols
     * 
     * Note: Cross-file symbols (from workspace_symbols) will still warn since
     * workspace_symbols do NOT suppress undefined macro warnings.
     */
    it('should not warn when same-file macros are defined before use', () => {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        // Define before use - should have no warnings for same-file symbols
        const code = `local my_macro "value"
di \`my_macro'`;

        const lexer_result = lexer.tokenize(code);
        const parse_result = parser.parse(lexer_result.tokens);
        const analysis_result = analyzer.analyze(
            parse_result.ast, 
            'file:///child.do', 
            undefined, 
            { undefined_macro_enabled: true }, 
            lexer_result.tokens
        );

        // Should have no undefined macro warnings
        const undefined_warnings = analysis_result.diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );

        expect(undefined_warnings.length).toBe(0);
    });
});
