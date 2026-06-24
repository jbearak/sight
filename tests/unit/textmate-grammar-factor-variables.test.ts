/**
 * Tokenizer tests for factor-variable operator highlighting.
 *
 * Mirrors the tree-sitter-stata v0.1.1 factor-variable corpus (issue #185).
 * Before this change, factor operators (`i.`, `c.`, ...) had no TextMate scope.
 * We scope only the OPERATOR PREFIX (e.g. `i.`); the following variable keeps
 * its ordinary scope. Test variable names deliberately avoid Stata
 * command/function words so assertions about the variable token are stable.
 */

import { describe, it, expect } from 'bun:test';
import {
    tokenize_stata,
    find_token,
    has_scope,
    type ScopedToken,
} from './helpers/textmate-tokenizer';

const FACTOR = 'keyword.operator.factor.stata';
const INTERACTION = 'keyword.operator.interaction.stata';

// Assert a token with exactly this text exists AND carries the factor scope.
// (find_token returning undefined makes has_scope false, so a positive
// assertion is self-guarding; this helper just gives a clearer message.)
function expect_factor(the_tokens: ScopedToken[], text: string): void {
    const my_token = find_token(the_tokens, text);
    expect(my_token, `expected a token "${text}"`).toBeDefined();
    expect(has_scope(my_token, FACTOR), `"${text}" should be factor`).toBe(true);
}

// All token texts that carry the factor scope, in source order.
function factor_token_texts(the_tokens: ScopedToken[]): string[] {
    return the_tokens
        .filter((my_token) => has_scope(my_token, FACTOR))
        .map((my_token) => my_token.text);
}

describe('TextMate Grammar - Factor Variables (tokenizer)', () => {
    it('scopes ONLY the i./c. operators, not the variables', async () => {
        const tokens = await tokenize_stata('regress depvar i.treatment c.income');
        expect_factor(tokens, 'i.');
        expect_factor(tokens, 'c.');
        // The complete factor set is exactly the two operators — the variable
        // names (treatment/income) are NOT scoped. Asserting the whole set
        // guards against a vacuous pass if token splitting changes.
        expect(factor_token_texts(tokens)).toEqual(['i.', 'c.']);
    });

    it('scopes factor operators and interaction together', async () => {
        const tokens = await tokenize_stata(
            'xtreg outcome c.popgrowth#i.shrink i.year, fe robust'
        );
        // Two factor operators present.
        const factor_tokens = tokens.filter((my_token) => has_scope(my_token, FACTOR));
        expect(factor_tokens.map((my_token) => my_token.text).sort()).toEqual(['c.', 'i.', 'i.']);
        // The interaction operator keeps its own scope.
        expect(has_scope(find_token(tokens, '#'), INTERACTION)).toBe(true);
    });

    it('scopes o. (omit), b. and bn. (base), and numbered base b2.', async () => {
        const tokens = await tokenize_stata('regress depvar o.treatment b.region bn.arm b2.grp');
        expect_factor(tokens, 'o.');
        expect_factor(tokens, 'b.');
        expect_factor(tokens, 'bn.');
        expect_factor(tokens, 'b2.');
    });

    it('scopes ibn. and numbered base ib2.', async () => {
        const tokens = await tokenize_stata('regress depvar ibn.region ib2.group');
        expect_factor(tokens, 'ibn.');
        expect_factor(tokens, 'ib2.');
    });

    it('scopes parenthesized level lists and named base selectors', async () => {
        const tokens = await tokenize_stata(
            'regress depvar i(1/3).group ib(first).region i(last).arm ib(#2).cat'
        );
        expect_factor(tokens, 'i(1/3).');
        expect_factor(tokens, 'ib(first).');
        expect_factor(tokens, 'i(last).');
        expect_factor(tokens, 'ib(#2).');
    });

    it('scopes the operator on a grouped variable list i.(...) / c.(...)', async () => {
        // This is why the trailing lookahead admits `(`.
        const tokens = await tokenize_stata('regress depvar i.(group sex) c.(age weight)');
        expect_factor(tokens, 'i.');
        expect_factor(tokens, 'c.');
    });

    // --- negative cases: these must NOT be scoped as factor operators ---

    it('does not scope multiplication mid-expression', async () => {
        const tokens = await tokenize_stata('gen z = myx*myy');
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });

    it('does not scope numeric literals or missing values', async () => {
        const tokens = await tokenize_stata('gen z = 2.5\nreplace z = .a if myv');
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });

    it('does not scope a dotted name embedded in a word', async () => {
        // `version 18.0` and a function result like e(b) must stay non-factor.
        const tokens = await tokenize_stata('version 18.0\ndisplay e(b)');
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });

    it('does not scope factor-looking text inside a string', async () => {
        const tokens = await tokenize_stata('display "i.treatment c.income"');
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });

    it('does not scope factor-looking text inside line comments', async () => {
        const tokens = await tokenize_stata('// i.treatment\n* c.income');
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });

    it('does not scope ordinary (multi-character stem) file names', async () => {
        // The realistic filename case: a normal stem like `mydata` is never a
        // factor letter, so `use mydata.dta` is not mis-scoped. (A bare
        // single-letter stem like `use i.dta` IS a known, accepted false
        // positive — a context-free grammar cannot tell a factor operator from
        // a one-letter filename; this is rare and cosmetic-only.)
        const tokens = await tokenize_stata(
            'use mydata.dta\nsave myresults.csv\ndo analysis.do'
        );
        expect(tokens.some((my_token) => has_scope(my_token, FACTOR))).toBe(false);
    });
});
