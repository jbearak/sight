import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('analyzer - program redeclarations in same file', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'file:///a.do');
    }

    it('records first program define as primary, subsequent as additional_definitions', () => {
        const source = [
            'program define foo',
            '    di "first"',
            'end',
            '',
            'program define foo',
            '    di "second"',
            'end',
        ].join('\n');

        const symbols = analyze(source).symbols;

        const foo = symbols.programs.get('foo');
        expect(foo).toBeDefined();
        // Primary = first definition at line 0
        expect(foo!.location.range.start.line).toBe(0);
        // Second declaration becomes additional
        expect(foo!.additional_definitions?.length).toBe(1);
        expect(foo!.additional_definitions![0].line).toBe(4);
    });

    it('keeps primary location stable across 3+ redeclarations', () => {
        const source = [
            'program define bar',
            'end',
            'program define bar',
            'end',
            'program define bar',
            'end',
        ].join('\n');

        const symbols = analyze(source).symbols;

        const bar = symbols.programs.get('bar');
        expect(bar!.location.range.start.line).toBe(0);
        expect(bar!.additional_definitions?.length).toBe(2);
        expect(bar!.additional_definitions![0].line).toBe(2);
        expect(bar!.additional_definitions![1].line).toBe(4);
    });
});
