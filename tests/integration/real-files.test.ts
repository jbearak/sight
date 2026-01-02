import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('Real-world Stata Files Integration', () => {
    it('should parse complex control flow and macros without crashing', () => {
        const content = `
program define complex_test
    version 17.0
    syntax [varlist], [option1(string) *]
    
    local i = 1
    foreach var of local varlist {
        if i == 1 {
            quietly {
                summarize var
                local count = r(N)
            }
            display "First variable"
        }
        else if i > 1 {
            gen var_sq = var^2
        }
        else {
            tempvar tmp
            gen tmp = log(var)
            drop tmp
        }
        local i = i + 1
    }
    
    display "Done."
end
`;
        const lexer = new StataLexer();
        const lexer_result = lexer.tokenize(content);
        const tokens = lexer_result.tokens;

        expect(tokens.length).toBeGreaterThan(0);

        const parser = new StataParser();
        const parse_result = parser.parse(tokens);
        if (parse_result.errors.length > 0) {
            console.log('Parse errors:', JSON.stringify(parse_result.errors, null, 2));
        }
        expect(parse_result.errors.length).toBe(0);
        const ast = parse_result.ast;
        expect(ast).toBeDefined();

        const analyzer = new SemanticAnalyzer();
        const analysis_result = analyzer.analyze(ast, 'file:///test.do');
        const symbols = analysis_result.symbols;
        expect(symbols).toBeDefined();
        // Programs are normalized to lowercase in the symbol table
        expect(symbols.programs.has('complex_test')).toBe(true);
    });

    it('should handle compound quotes and nested macros', () => {
        const content = `
local inner "hello"
local outer "\`inner'"
display "\`outer'"
display \`"This is a compound quote with "\`inner'""'
`;
        const lexer = new StataLexer();
        const tokens = lexer.tokenize(content).tokens;
        const parser = new StataParser();
        const ast = parser.parse(tokens).ast;
        expect(ast).toBeDefined();
    });
});

