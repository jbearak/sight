import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

describe('Macro Redefinition Scoping', () => {
    it('should not report undefined local macro after first levelsof definition', () => {
        const code = `levelsof merp, local(merp)
di \`merp'
levelsof merp, local(merp)
di \`merp'`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        
        const parser = new StataParser();
        const { ast } = parser.parse(tokens);
        
        const analyzer = new SemanticAnalyzer();
        const result = analyzer.analyze(ast, 'file:///test.do');
        
        // Should not have any "Undefined local macro" diagnostics
        const undefinedMacroDiagnostics = result.diagnostics.filter(
            d => d.message.includes('Undefined local macro')
        );
        
        expect(undefinedMacroDiagnostics).toHaveLength(0);
        
        // Should have the macro in the symbol table
        expect(result.symbols.localMacros.has('merp')).toBe(true);
        
        const macro = result.symbols.localMacros.get('merp');
        expect(macro).toBeDefined();
        expect(macro!.definition_index).toBe(0); // First definition wins
        expect(macro!.additional_definitions).toBeDefined();
        expect(macro!.additional_definitions!).toHaveLength(1); // Second definition tracked
    });

    it('should preserve first definition scoping info when macro is redefined', () => {
        const code = `local foo "first"
local foo "second"
di \`foo'`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        
        const parser = new StataParser();
        const { ast } = parser.parse(tokens);
        
        const analyzer = new SemanticAnalyzer();
        const result = analyzer.analyze(ast, 'file:///test.do');
        
        // Should not have any "Undefined local macro" diagnostics
        const undefinedMacroDiagnostics = result.diagnostics.filter(
            d => d.message.includes('Undefined local macro')
        );
        
        expect(undefinedMacroDiagnostics).toHaveLength(0);
        
        // Check macro properties
        const macro = result.symbols.localMacros.get('foo');
        expect(macro).toBeDefined();
        expect(macro!.definition_index).toBe(0); // First definition
        expect(macro!.value).toBe('"first"'); // First definition value
        expect(macro!.additional_definitions).toBeDefined();
        expect(macro!.additional_definitions!).toHaveLength(1);
        expect(macro!.additional_definitions![0].index).toBe(1); // Second definition index
    });

    it('should handle multiple redefinitions correctly', () => {
        const code = `tempvar x
tempvar x
tempvar x
di \`x'`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        
        const parser = new StataParser();
        const { ast } = parser.parse(tokens);
        
        const analyzer = new SemanticAnalyzer();
        const result = analyzer.analyze(ast, 'file:///test.do');
        
        // Should not have any "Undefined local macro" diagnostics
        const undefinedMacroDiagnostics = result.diagnostics.filter(
            d => d.message.includes('Undefined local macro')
        );
        
        expect(undefinedMacroDiagnostics).toHaveLength(0);
        
        // Check macro properties
        const macro = result.symbols.localMacros.get('x');
        expect(macro).toBeDefined();
        expect(macro!.definition_index).toBe(0); // First definition
        expect(macro!.additional_definitions).toBeDefined();
        expect(macro!.additional_definitions!).toHaveLength(2); // Two additional definitions
    });
});
