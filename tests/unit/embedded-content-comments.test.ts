/**
 * Which comment rules apply inside `mata` and `python` blocks and
 * one-liners, as StataMP 18 reads them:
 *
 * - Mata has `//` and `/* *\/` comments. `*` never starts one: at the
 *   start of a line it is pointer dereference (`*p`) or an error
 *   (`* note` is r(3499) "note not found"), elsewhere multiplication.
 * - Python block content is handed to Python as written: `7 // 2` is
 *   floor division (3), `/*` is code, and `*a, b = ...` unpacks. Only
 *   a column-0 `end` line ends the block, even after `/*`.
 * - A `python:` one-liner is a Stata command line, so Stata strips
 *   `//` and `/* *\/` comments before Python sees it; `*` is code.
 * - A `mata:` one-liner is Mata: `mata: * note` runs `* note`.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { Token } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

const COMMENT_TYPES = new Set(['COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION']);

function tokens_of(my_source: string): Token[] {
    return new StataLexer().tokenize(my_source).tokens;
}

function comments_of(my_source: string): string[] {
    return tokens_of(my_source)
        .filter((my_token) => COMMENT_TYPES.has(my_token.type))
        .map((my_token) => my_token.value);
}

describe('python block content', () => {
    it('reads // as floor division', () => {
        expect(comments_of('python\nx = 7 // 2\nprint(x)\nend\n')).toEqual([]);
    });

    it('reads a line-start * as code', () => {
        expect(comments_of('python\n*a, b = [1, 2, 3]\nend\n')).toEqual([]);
    });

    it('reads * in a call as code', () => {
        expect(
            comments_of('python\ndef f(*args):\n    return len(args)\nprint(f(*[1, 2]))\nend\n')
        ).toEqual([]);
    });

    it('reads /* as code, so a later end line still ends the block', () => {
        // Stata 18 passes `/*` to Python (a SyntaxError) and ends the
        // block at the `end` line after it.
        const my_source = 'python\n/*\nend\n*/\ndi 1\n';
        const the_tokens = tokens_of(my_source);
        expect(comments_of(my_source)).toEqual(['*/']);
        const my_end = the_tokens.find((my_token) => my_token.type === 'END_PYTHON');
        expect(my_end?.range.start.line).toBe(2);
    });

    it('reads /// as code, not a line join', () => {
        const my_source = 'python\nx = 1 ///\nend\n';
        expect(comments_of(my_source)).toEqual([]);
        const my_end = tokens_of(my_source).find(
            (my_token) => my_token.type === 'END_PYTHON'
        );
        expect(my_end?.range.start.line).toBe(2);
    });
});

describe('python: one-liner', () => {
    it('strips a // comment, as Stata does', () => {
        expect(comments_of('python: print(7 // 2)\n')).toEqual(['// 2)']);
    });

    it('strips a block comment, as Stata does', () => {
        expect(comments_of('python: print(8 /* 2 */ )\n')).toEqual(['/* 2 */']);
    });

    it('reads * after the colon as code', () => {
        expect(comments_of('python: print(*[1, 2])\n')).toEqual([]);
        expect(comments_of('python: * x\n')).toEqual([]);
    });

    it('reads * anywhere in the line as code, then resets', () => {
        // Stata 18 hands `[*a, *b]` and `x = *a, *b` to Python as written
        expect(comments_of('python: x = [*a, *b]\n* note\n')).toEqual(['* note']);
        expect(comments_of('python: x = *a, *b\n')).toEqual([]);
    });
});

describe('mata comments', () => {
    it('keeps // and block comments', () => {
        expect(comments_of('mata\nx = 7 // 2\ny = 8 /* 2 */ + 1\nend\n')).toEqual([
            '// 2',
            '/* 2 */',
        ]);
    });

    it('reads a line-start * as code', () => {
        expect(comments_of('mata\n* note\n    * note\n*p\nend\n')).toEqual([]);
    });

    it('reads * after code as multiplication', () => {
        expect(comments_of('mata\nx = (a) * b\nx = 1; * note\nend\n')).toEqual([]);
    });

    it('reads * after a brace as code', () => {
        expect(comments_of('mata\nif (1) {\n* note\n}\nend\n')).toEqual([]);
    });

    it('reads mata: * note as a one-line statement, not a block', () => {
        const my_source = 'mata: * note\ndi 1\n';
        const the_tokens = tokens_of(my_source);
        expect(the_tokens[0]?.type).toBe('MATA_INLINE');
        expect(comments_of(my_source)).toEqual([]);
        const my_ast = new StataParser().parse(the_tokens).ast;
        expect(my_ast.nodes).toHaveLength(2);
        expect(my_ast.nodes[1]?.range.start.line).toBe(1);
    });

    it('still opens a block at mata: followed by a comment', () => {
        expect(tokens_of('mata: // c\nx = 1\nend\n')[0]?.type).toBe('MATA_START');
    });
});

describe('embedded content comments: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    for_each_formatter_mode(
        'keeps python // and * code as written',
        (my_mode) => {
            const my_source =
                'python\ndef f(*args):\n    return 7 // 2\n*a, b = [1, 2, 3]\nend\ndi 1\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps mata * code as written',
        (my_mode) => {
            const my_source = 'mata\n*p\nx = (a) * b\nend\ndi 1\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});
