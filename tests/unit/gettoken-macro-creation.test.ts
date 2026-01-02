import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('gettoken macro creation', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string, config?: { undefined_macro_enabled?: boolean }) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'test://file.do', undefined, config, tokens);
    }

    describe('single output macro', () => {
        it('should register single output macro from gettoken', () => {
            const result = analyze('gettoken first : input');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            const macro = result.symbols.localMacros.get('first');
            expect(macro?.name).toBe('first');
            expect(macro?.scope).toBe('local');
        });

        it('should not register input macro (after colon)', () => {
            const result = analyze('gettoken first : input');
            
            // 'input' is the source macro, not created by gettoken
            // It should only be registered if it was defined elsewhere
            expect(result.symbols.localMacros.has('first')).toBe(true);
            // 'input' should not be auto-registered by gettoken
        });
    });

    describe('two output macros', () => {
        it('should register both output macros from gettoken', () => {
            const result = analyze('gettoken first rest : input');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
            
            const first_macro = result.symbols.localMacros.get('first');
            const rest_macro = result.symbols.localMacros.get('rest');
            
            expect(first_macro?.name).toBe('first');
            expect(first_macro?.scope).toBe('local');
            expect(rest_macro?.name).toBe('rest');
            expect(rest_macro?.scope).toBe('local');
        });
    });

    describe('with options', () => {
        it('should register macros with parse option', () => {
            const result = analyze('gettoken first : input, parse(" ")');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
        });

        it('should register macros with quotes option', () => {
            const result = analyze('gettoken first rest : input, quotes');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
        });

        it('should register macros with multiple options', () => {
            const result = analyze('gettoken first rest : input, parse(",") quotes');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
        });

        it('should handle no-space colon form', () => {
            const result = analyze('gettoken first rest: input');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
        });
    });

    describe('inside program definition', () => {
        it('should register gettoken macros in program scope', () => {
            const result = analyze(`
program define myprogram
    gettoken first rest : args
    display \`first'
    display \`rest'
end
`);
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
            
            const first_macro = result.symbols.localMacros.get('first');
            expect(first_macro?.containingScope).toBe('program');
        });

        it('should not warn on references after gettoken in program', () => {
            const result = analyze(`
program define myprogram
    gettoken first rest : args
    display \`first'
    display \`rest'
end
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     (d.message.includes('first') || d.message.includes('rest'))
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('forward reference detection', () => {
        it('should warn on reference before gettoken command', () => {
            const result = analyze(`
display \`first'
gettoken first : input
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('first')
            );
            expect(undefined_diags.length).toBe(1);
        });

        it('should not warn on reference after gettoken command', () => {
            const result = analyze(`
gettoken first : input
display \`first'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('first')
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should warn on reference before gettoken for second macro', () => {
            const result = analyze(`
display \`rest'
gettoken first rest : input
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('rest')
            );
            expect(undefined_diags.length).toBe(1);
        });

        it('should not warn on reference after gettoken for both macros', () => {
            const result = analyze(`
gettoken first rest : input
display \`first'
display \`rest'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     (d.message.includes('first') || d.message.includes('rest'))
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should handle gettoken with no varlist gracefully', () => {
            // Malformed command - should not crash
            const result = analyze('gettoken');
            
            // Should not register any macros
            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should track definition position for forward reference detection', () => {
            const result = analyze('gettoken first : input');
            
            const macro = result.symbols.localMacros.get('first');
            expect(macro?.definition_index).toBeDefined();
            expect(macro?.definition_line).toBeDefined();
            expect(macro?.definition_line).toBe(0); // First line (0-indexed)
        });

        it('should handle gettoken abbreviation (gettok)', () => {
            const result = analyze('gettok first rest : input');
            
            expect(result.symbols.localMacros.has('first')).toBe(true);
            expect(result.symbols.localMacros.has('rest')).toBe(true);
        });

        it('should handle gettoken at dofile level', () => {
            const result = analyze('gettoken first : input');
            
            const macro = result.symbols.localMacros.get('first');
            expect(macro?.containingScope).toBe('dofile');
        });
    });
});
