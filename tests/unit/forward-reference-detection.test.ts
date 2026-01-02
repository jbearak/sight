import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

function analyze_code(code: string, workspace_symbols?: SymbolTable) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(parse_result.ast, 'file:///test.do', workspace_symbols, { undefined_macro_enabled: true }, lexer_result.tokens);
}

describe('Forward Reference Detection Edge Cases', () => {
    it('forward reference in list operation produces warning', () => {
        // Reference to my_list before it's defined
        const code = `
local result: list my_list - other
local my_list a b c
local other b
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_list')
        );
        expect(the_diagnostics).toHaveLength(1);
    });

    it('properly ordered list operation produces no warning', () => {
        // my_list defined before reference
        const code = `
local my_list a b c
local other b
local result: list my_list - other
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            (d.message.includes('my_list') || d.message.includes('other'))
        );
        expect(the_diagnostics).toHaveLength(0);
    });

    it('first definition determines forward reference boundary', () => {
        // First definition at index 1, redefinition at index 3
        // Reference at index 0 should warn, reference at index 2 should not
        const code = `
local result1: list my_macro - dummy
local my_macro first
local result2: list my_macro - dummy
local my_macro second
local dummy x
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_macro')
        );
        // Only the first reference (before first definition) should warn
        expect(the_diagnostics).toHaveLength(1);
    });

    it('loop variable available in loop body', () => {
        // Loop variable defined at loop header, available in body
        const code = `
local dummy x
foreach my_var in a b c {
    local result: list my_var - dummy
}
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_var')
        );
        expect(the_diagnostics).toHaveLength(0);
    });

    it('tempvar macro available after command', () => {
        const code = `
local dummy x
tempvar my_temp
local result: list my_temp - dummy
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_temp')
        );
        expect(the_diagnostics).toHaveLength(0);
    });

    it('unab macro available after command', () => {
        const code = `
local dummy x
unab my_vars: _all
local result: list my_vars - dummy
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_vars')
        );
        expect(the_diagnostics).toHaveLength(0);
    });

    it('forward reference to unab macro produces warning', () => {
        const code = `
local dummy x
local result: list my_vars - dummy
unab my_vars: _all
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_vars')
        );
        expect(the_diagnostics).toHaveLength(1);
    });

    it('nested forward reference in program block', () => {
        const code = `
program define test_prog
    local dummy x
    local result: list inner_macro - dummy
    local inner_macro value
end
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('inner_macro')
        );
        expect(the_diagnostics).toHaveLength(1);
    });

    it('workspace globals do NOT suppress warnings (workspace indexing does not suppress)', () => {
        // Create workspace symbols with a global macro
        // Note: workspace_symbols parameter is NOT used for warning suppression.
        // Only cross-file directives (@lsp-done-by, @lsp-included-by, etc.) suppress warnings.
        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map([
                ['workspace_global', {
                    name: 'workspace_global',
                    scope: 'global',
                    location: { uri: 'file:///other.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                    sourceUri: 'file:///other.do',
                }]
            ]),
            variables: new Map(),
        };

        // Reference workspace global - this WILL warn because workspace_symbols
        // do NOT suppress undefined macro warnings
        const code = `
local dummy: word 1 of \${workspace_global}
`;
        const result = analyze_code(code, workspace_symbols);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('workspace_global')
        );
        // Warning expected because workspace_symbols do NOT suppress warnings
        expect(the_diagnostics).toHaveLength(1);
    });

    it('file-local global has position checking', () => {
        const code = `
local dummy x
local result: list file_global - dummy
global file_global value
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('file_global')
        );
        // Forward reference to file-local global should warn
        expect(the_diagnostics).toHaveLength(1);
    });

    it('analyzer instance reuse resets preorder_index', () => {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        // First analysis
        const code1 = `
local a 1
local b 2
local c 3
`;
        const lexer_result1 = lexer.tokenize(code1);
        const parse_result1 = parser.parse(lexer_result1.tokens);
        const result1 = analyzer.analyze(parse_result1.ast, 'file:///test1.do', undefined, { undefined_macro_enabled: true }, lexer_result1.tokens);

        // Second analysis with same analyzer instance
        // Forward reference should still be detected correctly
        const code2 = `
local dummy x
local result: list my_macro - dummy
local my_macro value
`;
        const lexer_result2 = lexer.tokenize(code2);
        const parse_result2 = parser.parse(lexer_result2.tokens);
        const result2 = analyzer.analyze(parse_result2.ast, 'file:///test2.do', undefined, { undefined_macro_enabled: true }, lexer_result2.tokens);

        const the_diagnostics = result2.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            d.message.includes('my_macro')
        );
        expect(the_diagnostics).toHaveLength(1);
    });

    it('frame block macros have correct position tracking', () => {
        const code = `
frame create test_frame
frame test_frame {
    local frame_var hello
    unab frame_all_vars: _all
    local frame_result: list frame_all_vars - frame_var
}
`;
        const result = analyze_code(code);
        const the_diagnostics = result.diagnostics.filter(d => 
            d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
            (d.message.includes('frame_var') || 
             d.message.includes('frame_all_vars') ||
             d.message.includes('frame_result'))
        );
        // No forward references - all macros defined before use
        expect(the_diagnostics).toHaveLength(0);
    });
});
