import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('file read macro creation', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string, config?: { undefined_macro_enabled?: boolean }) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'test://file.do', undefined, config, tokens);
    }

    describe('macro registration', () => {
        it('should register output macro from file read', () => {
            const result = analyze('file read fh line');

            expect(result.symbols.localMacros.has('line')).toBe(true);
            const macro = result.symbols.localMacros.get('line');
            expect(macro?.name).toBe('line');
            expect(macro?.scope).toBe('local');
        });

        it('should not register the handle argument as a macro', () => {
            const result = analyze('file read fh line');

            expect(result.symbols.localMacros.has('fh')).toBe(false);
        });
    });

    describe('subcommand discrimination', () => {
        it('should not register macros for file write', () => {
            const result = analyze('file write fh "hello"');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should not register macros for file open', () => {
            const result = analyze('file open fh using "data.txt", read');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should not register macros for file close', () => {
            const result = analyze('file close fh');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should not register macros for file seek', () => {
            const result = analyze('file seek fh tof');

            expect(result.symbols.localMacros.size).toBe(0);
        });
    });

    describe('inside program definition', () => {
        it('should register file read macro in program scope', () => {
            const result = analyze(`
program define myprogram
    file read fh line
    display \`line'
end
`);

            expect(result.symbols.localMacros.has('line')).toBe(true);
            const macro = result.symbols.localMacros.get('line');
            expect(macro?.containingScope).toBe('program');
        });

        it('should not warn on references after file read in program', () => {
            const result = analyze(`
program define myprogram
    file read fh line
    display \`line'
end
`, { undefined_macro_enabled: true });

            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     d.message.includes('line')
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('forward reference detection', () => {
        it('should warn on reference before file read command', () => {
            const result = analyze(`
display \`line'
file read fh line
`, { undefined_macro_enabled: true });

            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     d.message.includes('line')
            );
            expect(undefined_diags.length).toBe(1);
        });

        it('should not warn on reference after file read command', () => {
            const result = analyze(`
file read fh line
display \`line'
`, { undefined_macro_enabled: true });

            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     d.message.includes('line')
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should handle file read with no varlist gracefully', () => {
            const result = analyze('file read');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should handle file read with only handle, no macro name', () => {
            const result = analyze('file read fh');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should handle bare file command gracefully', () => {
            const result = analyze('file');

            expect(result.symbols.localMacros.size).toBe(0);
        });

        it('should track definition position for forward reference detection', () => {
            const result = analyze('file read fh line');

            const macro = result.symbols.localMacros.get('line');
            expect(macro?.definition_index).toBeDefined();
            expect(macro?.definition_line).toBeDefined();
            expect(macro?.definition_line).toBe(0);
        });

        it('should register macro at dofile scope', () => {
            const result = analyze('file read fh line');

            const macro = result.symbols.localMacros.get('line');
            expect(macro?.containingScope).toBe('dofile');
        });

        it('should handle file abbreviation (fi read)', () => {
            const result = analyze('fi read fh line');

            expect(result.symbols.localMacros.has('line')).toBe(true);
        });

        it('should handle file abbreviation (fil read)', () => {
            const result = analyze('fil read fh line');

            expect(result.symbols.localMacros.has('line')).toBe(true);
        });

        it('should handle repeated file read for same macro name', () => {
            const result = analyze(`
file read fh line
file read fh line
`);

            expect(result.symbols.localMacros.has('line')).toBe(true);
            const macro = result.symbols.localMacros.get('line');
            expect(macro?.additional_definitions?.length).toBe(1);
        });
    });
});
