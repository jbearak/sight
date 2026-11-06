/**
 * Program definition headers in the grammar and the indentation rule,
 * with `program` and `define` abbreviated as Stata 18 allows (`pr` …
 * `program`, `de` … `define`); base ados write `prog def`.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { find_token, has_scope, tokenize_stata } from './helpers/textmate-tokenizer';

describe('TextMate Grammar - program definitions', () => {
    it('highlights an abbreviated definition header', async () => {
        const the_tokens = await tokenize_stata('prog def roctab, rclass\nend\n');
        expect(has_scope(find_token(the_tokens, 'prog'), 'storage.type.function.stata')).toBe(true);
        expect(has_scope(find_token(the_tokens, 'def'), 'keyword.other.stata')).toBe(true);
        expect(has_scope(find_token(the_tokens, 'roctab'), 'entity.name.function.stata')).toBe(true);
    });

    it('highlights pr and an abbreviated subcommand', async () => {
        const the_tokens = await tokenize_stata('pr drop myprog\n');
        expect(has_scope(find_token(the_tokens, 'pr'), 'storage.type.function.stata')).toBe(true);
        expect(has_scope(find_token(the_tokens, 'drop'), 'keyword.other.stata')).toBe(true);
    });

    it('leaves words that only start like program alone', async () => {
        const the_tokens = await tokenize_stata('profile on\n');
        expect(has_scope(find_token(the_tokens, 'profile'), 'storage.type.function.stata')).toBe(false);
    });
});

describe('language-configuration.json indentation', () => {
    const config = JSON.parse(fs.readFileSync(
        path.join(import.meta.dir, '../../client/language-configuration.json'), 'utf8'));
    const increase = new RegExp(config.indentationRules.increaseIndentPattern);

    it('indents after an abbreviated program define header', () => {
        for (const my_line of ['program define p', 'prog def p, rclass', 'pr de p']) {
            expect(increase.test(my_line)).toBe(true);
        }
        expect(increase.test('prog drop p')).toBe(false);
    });

    it('indents after a lone opening brace', () => {
        // The alternative used to be written `\|`, a literal pipe
        expect(increase.test('    {')).toBe(true);
    });
});
