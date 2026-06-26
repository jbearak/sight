import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

describe('gegen.ado reproduction', () => {
    const gegen_code = `*/

capture program drop gegen
program define gegen, byable(onecall) rclass
    version 13.1

    local 00 \`0'
    qui syntax anything [if] [in] [using] [= exp] [weight], [by(varlist)]
    local byvars \`by'
    local 0 \`00'

    * Parse weights
    * -------------

    local wgt = cond("\`weight'" != "", "[\`weight' \`exp']", "")
end
`;

    it('should not report missing end for program definition', () => {
        const lexer = new StataLexer();
        const lexer_result = lexer.tokenize(gegen_code);
        const parser = new StataParser();
        const result = parser.parse(lexer_result.tokens);

        // Check for the specific error
        const missing_end_error = result.errors.find(e => 
            e.message.includes('Missing "end"')
        );
        expect(missing_end_error).toBeUndefined();
    });

    it('should recognize weight and exp from syntax command', () => {
        const lexer = new StataLexer();
        const lexer_result = lexer.tokenize(gegen_code);
        const parser = new StataParser();
        const result = parser.parse(lexer_result.tokens);

        // Find the program node
        const program_node = result.ast.nodes.find(n => n.type === 'program');

        if (program_node && program_node.type === 'program') {
            // Program signature available for inspection if needed
        }

        // Analyze for diagnostics
        const analyzer = new SemanticAnalyzer('file:///test.do');
        const analysis = analyzer.analyze(result.ast, lexer_result.tokens);

        // Check for undefined macro warnings for weight and exp
        const weight_warning = analysis.diagnostics.find(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO
            && d.message.includes('weight')
        );
        const exp_warning = analysis.diagnostics.find(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO
            && d.message.includes('exp')
        );

        expect(weight_warning).toBeUndefined();
        expect(exp_warning).toBeUndefined();
    });
});
