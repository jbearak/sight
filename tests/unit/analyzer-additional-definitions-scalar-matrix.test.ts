import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('analyzer - scalar redeclarations', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'file:///a.do');
    }

    it('keeps first scalar as primary, appends second to additional_definitions', () => {
        const source = [
            'scalar s = 1',
            'scalar s = 2',
        ].join('\n');
        const symbols = analyze(source).symbols;
        const s = symbols.scalars.get('s');
        expect(s).toBeDefined();
        expect(s!.location.range.start.line).toBe(0);
        expect(s!.additional_definitions?.length).toBe(1);
        expect(s!.additional_definitions![0].line).toBe(1);
    });

    it('keeps primary location stable across 3+ redeclarations', () => {
        const source = [
            'scalar s = 1',
            'scalar s = 2',
            'scalar s = 3',
        ].join('\n');
        const symbols = analyze(source).symbols;
        const s = symbols.scalars.get('s');
        expect(s).toBeDefined();
        expect(s!.location.range.start.line).toBe(0);
        expect(s!.additional_definitions?.length).toBe(2);
        expect(s!.additional_definitions![0].line).toBe(1);
        expect(s!.additional_definitions![1].line).toBe(2);
    });
});

describe('analyzer - matrix redeclarations', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'file:///a.do');
    }

    it('keeps first matrix as primary, appends second to additional_definitions', () => {
        const source = [
            'matrix m = 1',
            'matrix m = 2',
        ].join('\n');
        const symbols = analyze(source).symbols;
        const m = symbols.matrices.get('m');
        expect(m).toBeDefined();
        expect(m!.location.range.start.line).toBe(0);
        expect(m!.additional_definitions?.length).toBe(1);
        expect(m!.additional_definitions![0].line).toBe(1);
    });

    it('keeps primary location stable across 3+ redeclarations', () => {
        const source = [
            'matrix m = 1',
            'matrix m = 2',
            'matrix m = 3',
        ].join('\n');
        const symbols = analyze(source).symbols;
        const m = symbols.matrices.get('m');
        expect(m).toBeDefined();
        expect(m!.location.range.start.line).toBe(0);
        expect(m!.additional_definitions?.length).toBe(2);
        expect(m!.additional_definitions![0].line).toBe(1);
        expect(m!.additional_definitions![1].line).toBe(2);
    });
});
