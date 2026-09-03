import { describe, it, expect } from 'bun:test';
import { StataParser } from '../src/parser';
import { StataLexer } from '../src/lexer';

/**
 * Regression: names built from a macro reference plus adjacent literal
 * text, such as `var'_bh, are lexed as several tokens. The stray-token
 * check in qualifier expressions must treat them as one operand, and
 * an adjacent literal `in` must not start an in-qualifier.
 */
describe('Macro-adjacent names in if-qualifier', () => {
    function parse(code: string) {
        const lex_result = new StataLexer().tokenize(code);
        return new StataParser().parse(lex_result.tokens);
    }

    function stray_errors(code: string) {
        return parse(code).errors.filter(
            e => e.message.includes('Unexpected token')
        );
    }

    function first_command(code: string) {
        const result = parse(code);
        expect(result.errors).toHaveLength(0);
        const node = result.ast.nodes[0];
        if (!node || node.type !== 'command') {
            throw new Error(`Expected a command node for: ${code}`);
        }
        return node;
    }

    it('accepts macro prefix on both sides of a comparison', () => {
        const code = "quietly count if `var'_wm != `var'_bh " +
            "& survey_source_flag == 0";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('accepts macro suffix on the RHS of a comparison', () => {
        const code = "count if x != y_`var' & y == 0";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('accepts global macro fragments on the RHS', () => {
        const code = "count if x == ${pre}_x & y == 0";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('accepts macro fragments at the end of the expression', () => {
        const code = "count if `var'_wm != `var'_bh";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('accepts a number followed by an adjacent macro', () => {
        const code = "count if x == 1`suffix' & y == 0";
        expect(stray_errors(code)).toHaveLength(0);
    });

    it('keeps an adjacent local macro suffix named in inside the if', () => {
        const node = first_command("count if x == `var'in & y == 1");
        expect(node.ifExpression).toBe("x == `var'in & y == 1");
        expect(node.inExpression).toBeUndefined();
    });

    it('keeps an adjacent global macro suffix named in inside the if', () => {
        const node = first_command("count if x == ${v}in & y == 1");
        expect(node.ifExpression).toBe("x == ${v}in & y == 1");
        expect(node.inExpression).toBeUndefined();
    });

    it('still treats a whitespace-separated in as a qualifier', () => {
        const node = first_command("count if x == `var' in 1/5");
        expect(node.ifExpression).toBe("x == `var'");
        expect(node.inExpression).toBe('1/5');
    });

    it('still flags a whitespace-separated stray token', () => {
        const code = "count if x != `var' _bh & y == 0";
        expect(stray_errors(code)).toHaveLength(1);
        expect(stray_errors("count if x == 1 y")).toHaveLength(1);
    });

    it('still flags adjacent string and word without a macro', () => {
        expect(stray_errors('count if x == "foo"bar')).toHaveLength(1);
    });
});
