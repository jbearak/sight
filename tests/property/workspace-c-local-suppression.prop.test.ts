import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer, create_empty_symbol_table } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { SymbolTable, ProgramSymbol, MacroSymbol } from '../../src/types';

describe('Workspace c_local suppression', () => {
    it('should suppress undefined macro warnings when c_local is defined in workspace program', () => {
        // Create workspace symbols with a program that has c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const program_symbol: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado',
            c_locals: ['result', 'status']
        };
        workspace_symbols.programs.set('myprogram', program_symbol);

        // Test code that calls the program and uses its c_locals
        const code = `
myprogram arg1 arg2
display "\`result'"
display "\`status'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should not have undefined macro warnings for 'result' and 'status'
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro')
        );
        expect(undefined_macro_diagnostics).toHaveLength(0);

        // Should have the c_local macros registered in local symbols
        expect(result.symbols.localMacros.has('result')).toBe(true);
        expect(result.symbols.localMacros.has('status')).toBe(true);

        // The macros should reference the workspace program as source
        const result_macro = result.symbols.localMacros.get('result');
        expect(result_macro?.sourceUri).toBe('file:///workspace/myprogram.ado');
    });

    it('should prefer same-file program over workspace program for c_locals', () => {
        // Create workspace symbols with a program that has c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const workspace_program: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado',
            c_locals: ['workspace_result']
        };
        workspace_symbols.programs.set('myprogram', workspace_program);

        // Test code that defines the same program locally with different c_locals
        const code = `
program define myprogram
    c_local local_result "local value"
end

myprogram arg1 arg2
display "\`local_result'"
display "\`workspace_result'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should have the local c_local macro registered
        expect(result.symbols.localMacros.has('local_result')).toBe(true);
        
        // Should NOT have the workspace c_local macro registered since same-file program takes precedence
        expect(result.symbols.localMacros.has('workspace_result')).toBe(false);

        // Should have undefined macro warning for workspace_result since it's not available from local program
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro') && d.message.includes('workspace_result')
        );
        expect(undefined_macro_diagnostics).toHaveLength(1);

        // The local_result macro should reference the current file as source
        const local_result_macro = result.symbols.localMacros.get('local_result');
        expect(local_result_macro?.sourceUri).toBe('file:///test.do');
    });

    it('should handle case-sensitive program lookup for c_locals', () => {
        // Create workspace symbols with a program that has c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const program_symbol: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado',
            c_locals: ['result']
        };
        // Programs are stored with exact case
        workspace_symbols.programs.set('myprogram', program_symbol);

        // Test code that calls the program with same case
        const code = `
myprogram arg1 arg2
display "\`result'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should not have undefined macro warnings for 'result'
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro') && d.message.includes('result')
        );
        expect(undefined_macro_diagnostics).toHaveLength(0);

        // Should have the c_local macro registered
        expect(result.symbols.localMacros.has('result')).toBe(true);
    });

    it('should not register c_locals when program has no c_locals property', () => {
        // Create workspace symbols with a program that has no c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const program_symbol: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado'
            // No c_locals property
        };
        workspace_symbols.programs.set('myprogram', program_symbol);

        // Test code that calls the program and tries to use a macro
        const code = `
myprogram arg1 arg2
display "\`result'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should have undefined macro warning for 'result' since program has no c_locals
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro') && d.message.includes('result')
        );
        expect(undefined_macro_diagnostics).toHaveLength(1);

        // Should not have the macro registered
        expect(result.symbols.localMacros.has('result')).toBe(false);
    });

    it('should handle empty c_locals array', () => {
        // Create workspace symbols with a program that has empty c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const program_symbol: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado',
            c_locals: [] // Empty array
        };
        workspace_symbols.programs.set('myprogram', program_symbol);

        // Test code that calls the program and tries to use a macro
        const code = `
myprogram arg1 arg2
display "\`result'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should have undefined macro warning for 'result' since c_locals is empty
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro') && d.message.includes('result')
        );
        expect(undefined_macro_diagnostics).toHaveLength(1);

        // Should not have the macro registered
        expect(result.symbols.localMacros.has('result')).toBe(false);
    });

    it('should work when workspace_symbols is undefined', () => {
        // Test code that calls a program without workspace symbols
        const code = `
myprogram arg1 arg2
display "\`result'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            undefined, // No workspace symbols
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should have undefined macro warning for 'result' since no workspace symbols
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro') && d.message.includes('result')
        );
        expect(undefined_macro_diagnostics).toHaveLength(1);

        // Should not have the macro registered
        expect(result.symbols.localMacros.has('result')).toBe(false);
    });

    it('should register multiple c_locals from workspace program', () => {
        // Create workspace symbols with a program that has multiple c_locals
        const workspace_symbols: SymbolTable = create_empty_symbol_table();
        const program_symbol: ProgramSymbol = {
            name: 'myprogram',
            location: { uri: 'file:///workspace/myprogram.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
            sourceUri: 'file:///workspace/myprogram.ado',
            c_locals: ['result1', 'result2', 'status', 'error_code']
        };
        workspace_symbols.programs.set('myprogram', program_symbol);

        // Test code that calls the program and uses multiple c_locals
        const code = `
myprogram arg1 arg2
display "\`result1'"
display "\`result2'"
display "\`status'"
display "\`error_code'"
`;

        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const tokens = lexer.tokenize(code);
        const ast = parser.parse(tokens.tokens);
        const result = analyzer.analyze(
            ast.ast,
            'file:///test.do',
            workspace_symbols,
            { undefined_macro_enabled: true },
            tokens.tokens // Pass tokens for macro reference detection
        );

        // Should not have undefined macro warnings for any of the c_locals
        const undefined_macro_diagnostics = result.diagnostics.filter(d => 
            d.message.includes('Undefined local macro')
        );
        expect(undefined_macro_diagnostics).toHaveLength(0);

        // Should have all c_local macros registered
        expect(result.symbols.localMacros.has('result1')).toBe(true);
        expect(result.symbols.localMacros.has('result2')).toBe(true);
        expect(result.symbols.localMacros.has('status')).toBe(true);
        expect(result.symbols.localMacros.has('error_code')).toBe(true);

        // All macros should reference the workspace program as source
        for (const macro_name of ['result1', 'result2', 'status', 'error_code']) {
            const macro = result.symbols.localMacros.get(macro_name);
            expect(macro?.sourceUri).toBe('file:///workspace/myprogram.ado');
        }
    });
});