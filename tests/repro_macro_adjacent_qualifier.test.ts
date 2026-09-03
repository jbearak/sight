import { describe, it, expect } from 'bun:test';
import { StataParser } from '../src/parser';
import { StataLexer } from '../src/lexer';

/**
 * Regression: names built from a macro reference plus adjacent literal
 * text, such as `var'_bh, are lexed as several tokens. The stray-token
 * check in qualifier expressions must treat them as one operand.
 */
describe('Macro-adjacent names in if-qualifier', () => {
    function stray_errors(code: string) {
        const lex_result = new StataLexer().tokenize(code);
        const result = new StataParser().parse(lex_result.tokens);
        return result.errors.filter(e => e.message.includes('Unexpected token'));
    }

    it('accepts macro prefix on both sides of a comparison', () => {
        const code = "quietly count if `var'_wm != `var'_bh & survey_source_flag == 0";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('accepts macro suffix on the RHS of a comparison', () => {
        expect(stray_errors("count if x != y_`var' & y == 0")).toHaveLength(0);
    });

    it('accepts global macro fragments on the RHS', () => {
        expect(stray_errors("count if x == ${pre}_x & y == 0")).toHaveLength(0);
    });

    it('accepts macro fragments at the end of the expression', () => {
        expect(stray_errors("count if `var'_wm != `var'_bh")).toHaveLength(0);
    });

    it('still flags a whitespace-separated stray token', () => {
        expect(stray_errors("count if x != `var' _bh & y == 0")).toHaveLength(1);
        expect(stray_errors("count if x == 1 y")).toHaveLength(1);
    });
});
