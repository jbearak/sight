/**
 * Tokenizer tests for `//` and `///` with code right before them.
 *
 * Stata 18 reads a `//` or `///` as a comment or continuation only at the
 * start of a line or after a space or tab (or after the `;` that ends a
 * statement under `#delimit ;`). Otherwise it is code: `local a b///`
 * stores `b///`, and `use http://example.com/d` opens the URL. The
 * grammar can't tell the delimiter mode, so it takes a `;` before the
 * slashes as a statement end.
 */

import { describe, it, expect } from 'bun:test';
import {
    tokenize_stata,
    find_token,
    has_scope,
    type ScopedToken,
} from './helpers/textmate-tokenizer';

const TRIPLE = 'comment.line.triple-slash.stata';
const DOUBLE = 'comment.line.double-slash.stata';

function is_comment(token: ScopedToken): boolean {
    return token.scopes.some((s) => s === TRIPLE || s === DOUBLE);
}

/** Text of every token on the first line that is in a comment scope. */
async function comment_text(source: string): Promise<string> {
    const the_tokens = await tokenize_stata(source);
    return the_tokens
        .filter((t) => t.line === 0 && is_comment(t))
        .map((t) => t.text)
        .join('');
}

describe('TextMate grammar: // and /// with code right before them', () => {
    it('does not color a /// right after a word as a continuation', async () => {
        expect(await comment_text('local a b///')).toBe('');
        expect(await comment_text('local a b///note')).toBe('');
        expect(await comment_text('local a (x)///')).toBe('');
        expect(await comment_text("local a `x'///")).toBe('');
    });

    it('does not color a // right after code as a comment', async () => {
        expect(await comment_text('local a b//note')).toBe('');
        expect(await comment_text('display 4//2')).toBe('');
    });

    it('colors // and /// after a space, a tab, a ;, or at line start', async () => {
        expect(await comment_text('local a b /// note')).toBe('/// note');
        expect(await comment_text('local a b\t///')).toBe('///');
        expect(await comment_text('local a b // note')).toBe('// note');
        expect(await comment_text('local a b;// note')).toBe('// note');
        expect(await comment_text('// note')).toBe('// note');
        expect(await comment_text('/// note')).toBe('/// note');
        const the_tokens = await tokenize_stata('local a b ///');
        expect(has_scope(find_token(the_tokens, '///'), TRIPLE)).toBe(true);
    });

    it('keeps a URL after use as one path', async () => {
        const the_tokens = await tokenize_stata(
            'use http://www.stata-press.com/data/r18/auto, clear');
        expect(the_tokens.some(is_comment)).toBe(false);
        expect(the_tokens.some((t) => t.text.includes('//www'))).toBe(true);
    });
});
