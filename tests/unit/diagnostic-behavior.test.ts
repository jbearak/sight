import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

function analyze_code(content: string) {
    const my_lexer = new StataLexer();
    const my_parser = new StataParser();
    const my_analyzer = new SemanticAnalyzer();

    const my_lex_result = my_lexer.tokenize(content);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    const my_analysis_result = my_analyzer.analyze(
        my_parse_result.ast,
        'test://file.do',
        undefined,
        { undefined_macro_enabled: true },
        my_lex_result.tokens
    );

    return my_analysis_result.diagnostics;
}

describe('Diagnostic Behavior', () => {
    it('should not warn for defined local macros', () => {
        const content = `
local my_var "test"
display \`my_var'
        `;
        
        const diagnostics = analyze_code(content);
        const undefined_macro_diagnostics = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        
        expect(undefined_macro_diagnostics).toHaveLength(0);
    });

    it('should not warn for defined global macros', () => {
        const content = `
global my_global "test"
display $my_global
        `;
        
        const diagnostics = analyze_code(content);
        const undefined_macro_diagnostics = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        
        expect(undefined_macro_diagnostics).toHaveLength(0);
    });

    it('should warn for undefined local macro references', () => {
        const content = `display \`undefined_local'`;
        
        const diagnostics = analyze_code(content);
        const undefined_macro_diagnostics = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        
        expect(undefined_macro_diagnostics).toHaveLength(1);
        expect(undefined_macro_diagnostics[0].message).toContain('undefined_local');
    });

    it('should warn for undefined global macro references', () => {
        const content = `display $undefined_global`;
        
        const diagnostics = analyze_code(content);
        const undefined_macro_diagnostics = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        
        expect(undefined_macro_diagnostics).toHaveLength(1);
        expect(undefined_macro_diagnostics[0].message).toContain('undefined_global');
    });

    it('should distinguish defined vs referenced macros', () => {
        const content = `
local myvar = 42
display \`myvar'
display \`undefined_macro'
        `;
        
        const diagnostics = analyze_code(content);
        
        // Should not warn about myvar
        const defined_warnings = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                d.message.includes('myvar')
        );
        expect(defined_warnings).toHaveLength(0);
        
        // Should warn about undefined_macro
        const undefined_warnings = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                d.message.includes('undefined_macro')
        );
        expect(undefined_warnings).toHaveLength(1);
    });

    it('should not warn for positional arguments', () => {
        const content = `display \`1' \`2' \`0'`;
        
        const diagnostics = analyze_code(content);
        const undefined_macro_diagnostics = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        
        expect(undefined_macro_diagnostics).toHaveLength(0);
    });
});