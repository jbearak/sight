/**
 * Unit tests for the bare-expression command-position classifier
 * (issue #268 item 3).
 *
 * `assert` is only a bare-expression command when it is in command
 * position (statement start, optionally after single-line prefix
 * commands and their colons); everywhere else it is an ordinary WORD
 * (variable, callee, subscript target) and must not be classified.
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { collect_significant_tokens } from '../../src/providers/diagnostic-token-stream';
import { is_bare_expression_command_at } from '../../src/providers/command-position';

const lexer = new StataLexer();

/**
 * Tokenize `source`, collect significant tokens, and report whether the
 * WORD token equal to `word` at occurrence `occurrence` (0-based) is
 * classified as a bare-expression command.
 */
function classify(source: string, word: string, occurrence = 0): boolean {
    const { tokens } = lexer.tokenize(source);
    const the_significant = collect_significant_tokens(tokens);
    let my_seen = 0;
    for (let i = 0; i < the_significant.length; i++) {
        const my_token = the_significant[i];
        if (my_token.type === 'WORD' && my_token.value === word) {
            if (my_seen === occurrence) {
                return is_bare_expression_command_at(the_significant, i);
            }
            my_seen++;
        }
    }
    throw new Error(`word ${word} (occurrence ${occurrence}) not found`);
}

describe('is_bare_expression_command_at', () => {
    it('classifies assert at start of file', () => {
        expect(classify("assert 1`b'", 'assert')).toBe(true);
    });

    it('classifies assert after a statement terminator', () => {
        expect(classify("display x\nassert 1`b'", 'assert')).toBe(true);
    });

    it('classifies assert after an opening brace', () => {
        expect(classify("if ok {\nassert 1`b'\n}", 'assert')).toBe(true);
    });

    it('classifies assert after a closing brace', () => {
        expect(classify("if ok {\n}\nassert 1`b'", 'assert')).toBe(true);
    });

    it('classifies assert after each single-line prefix command', () => {
        for (const my_prefix of ['capture', 'cap', 'quietly', 'qui', 'quie', 'noisily', 'noi']) {
            expect(classify(`${my_prefix} assert 1\`b'`, 'assert')).toBe(true);
        }
    });

    it('classifies assert after a prefix command with colon', () => {
        expect(classify("cap: assert 1`b'", 'assert')).toBe(true);
    });

    it('classifies assert after stacked prefixes with colon', () => {
        expect(classify("cap noi: assert 1`b'", 'assert')).toBe(true);
    });

    it('rejects assert after a non-prefix word', () => {
        expect(classify("list assert 1`b'", 'assert')).toBe(false);
    });

    it('rejects assert after an operator (assignment RHS)', () => {
        expect(classify("gen y = assert[1`b']", 'assert')).toBe(false);
    });

    it('rejects assert after a non-prefix word with colon', () => {
        // `foo:` is a program prefix Sight does not model as a
        // single-line prefix command; stay conservative (a miss, never
        // a false classification).
        expect(classify("foo: assert 1`b'", 'assert')).toBe(false);
    });

    it('rejects a non-listed word even in command position', () => {
        expect(classify('display x', 'display')).toBe(false);
    });

    it('rejects wrong-case Assert (Stata is case-sensitive)', () => {
        expect(classify("Assert 1`b'", 'Assert')).toBe(false);
    });

    it('classifies per-statement independently', () => {
        const source = "cap assert 1`b'\ngen y = assert[2`c']";
        expect(classify(source, 'assert', 0)).toBe(true);
        expect(classify(source, 'assert', 1)).toBe(false);
    });

    it('classifies assert in command position under #delimit ;', () => {
        expect(
            classify("#delimit ;\ndisplay x ;\nassert 1`b' ;", 'assert')
        ).toBe(true);
    });

    it('classifies assert immediately after a #delimit line', () => {
        expect(classify("#delimit ;\nassert 1`b' ;", 'assert')).toBe(true);
    });
});
