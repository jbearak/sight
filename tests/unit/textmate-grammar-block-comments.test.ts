/**
 * Tokenizer tests for nested / inline block comments.
 *
 * Mirrors the tree-sitter-stata v0.1.2 comment-parsing corpus (issue #185).
 * The flat begin/end block-comment region exited at the first inner `*​/`,
 * leaking the rest of an outer comment back into code scope. These tests use
 * the real vscode-textmate engine (see helpers/textmate-tokenizer.ts) so the
 * stateful, multiline begin/end behavior is actually exercised.
 */

import { describe, it, expect } from 'bun:test';
import {
    tokenize_stata,
    scopes_at,
    find_token,
    has_scope,
} from './helpers/textmate-tokenizer';

const BLOCK = 'comment.block.stata';
const STAR_LINE = 'comment.line.star.stata';

describe('TextMate Grammar - Block Comments (tokenizer)', () => {
    it('keeps the outer comment active across a nested /* */', async () => {
        const source = [
            '/*',
            'reg y x /* nested comment */',
            'sum x',
            '*/',
            'display 1',
        ].join('\n');
        const tokens = await tokenize_stata(source);

        // Line 2 ("sum x") is between the inner close and the outer close:
        // it MUST still be inside the block comment, not code.
        const sum_scopes = scopes_at(tokens, 2, 0);
        expect(sum_scopes).toContain(BLOCK);

        // The text after the inner close on line 1 is also still comment.
        const nested_close_line_scopes = scopes_at(tokens, 1, 20);
        expect(nested_close_line_scopes).toContain(BLOCK);

        // The outer close line must NOT be re-grabbed by the star-line rule.
        const outer_close_scopes = scopes_at(tokens, 3, 0);
        expect(outer_close_scopes).toContain(BLOCK);
        expect(outer_close_scopes).not.toContain(STAR_LINE);

        // After the outer close, code is code again.
        const display_token = find_token(tokens, 'display');
        expect(display_token).toBeDefined();
        expect(display_token!.line).toBe(4);
        expect(has_scope(display_token, BLOCK)).toBe(false);
    });

    it('treats /***/ as a single block comment', async () => {
        const source = '/***/\ndisplay 1';
        const tokens = await tokenize_stata(source);

        // Every token on line 0 is comment.
        const line0 = tokens.filter((my_token) => my_token.line === 0);
        expect(line0.length).toBeGreaterThan(0);
        for (const my_token of line0) {
            expect(my_token.scopes).toContain(BLOCK);
        }
        // Line 1 is code again.
        expect(has_scope(find_token(tokens, 'display'), BLOCK)).toBe(false);
    });

    it('treats /** text **/ as a single block comment', async () => {
        const source = '/** text **/\ndisplay 1';
        const tokens = await tokenize_stata(source);
        const line0 = tokens.filter((my_token) => my_token.line === 0);
        for (const my_token of line0) {
            expect(my_token.scopes).toContain(BLOCK);
        }
        expect(has_scope(find_token(tokens, 'display'), BLOCK)).toBe(false);
    });

    it('handles an inline block comment followed by code', async () => {
        const source = 'reg y x /* note */ , robust';
        const tokens = await tokenize_stata(source);

        // The comment span is block-scoped.
        const comment_open_scopes = scopes_at(tokens, 0, 8);
        expect(comment_open_scopes).toContain(BLOCK);

        // Code after the inline close is NOT comment.
        expect(scopes_at(tokens, 0, 20)).not.toContain(BLOCK);
    });

    it('handles a deeply nested block comment', async () => {
        const source = [
            '/* a /* b /* c */ b */ a */',
            'display 1',
        ].join('\n');
        const tokens = await tokenize_stata(source);

        // Whole first line is comment, all the way to the last `*/`.
        const line0 = tokens.filter((my_token) => my_token.line === 0);
        for (const my_token of line0) {
            expect(my_token.scopes).toContain(BLOCK);
        }
        // Code resumes on line 1.
        expect(has_scope(find_token(tokens, 'display'), BLOCK)).toBe(false);
    });

    it('still treats an unterminated /* as comment to end of input', async () => {
        const source = '/* open\ndisplay 1\nsum y';
        const tokens = await tokenize_stata(source);
        for (const my_token of tokens) {
            expect(my_token.scopes).toContain(BLOCK);
        }
    });
});
