/**
 * `args` and `unab` take a list of names, and stopped at the first token
 * that can't be one. The rest of the statement then started a new
 * command, so AST formatting turned `args a/note` into `args a` and
 * `note` on its own line. StataMP 18 reads the whole line as one
 * statement and rejects the name ("_/ invalid name", r(198)), so Sight
 * keeps the rest in `extra_args`. `///` and comments between the names
 * are whitespace, as in other commands.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

function parse(my_source: string) {
    return new StataParser().parse(new StataLexer().tokenize(my_source).tokens);
}

/** The command nodes of `my_source` as [name, varlist, extra_args]. */
function commands(my_source: string): Array<[string, string[], string[]]> {
    return parse(my_source).ast.nodes.map((my_node) => {
        if (my_node.type !== 'command') {
            return [my_node.type, [], []];
        }
        return [
            my_node.name,
            (my_node.varlist ?? []).map((my_item) => my_item.name),
            (my_node.extra_args ?? []).map((my_item) => my_item.name),
        ];
    });
}

describe('args and unab keep tokens that are not names', () => {
    it('keeps a stray operator in args', () => {
        expect(commands('args a/note\n')).toEqual([['args', ['a'], ['/note']]]);
        expect(commands('args a//note\n')).toEqual([['args', ['a'], ['//note']]]);
        expect(commands('args a, b\n')).toEqual([['args', ['a'], [',', 'b']]]);
        expect(commands('args a b=c\n')).toEqual([['args', ['a', 'b'], ['=c']]]);
    });

    it('reads a continuation or a block comment between args names as whitespace', () => {
        expect(commands('args a ///\n    b\n')).toEqual([['args', ['a', 'b'], []]]);
        expect(commands('args a /* c */ b\n')).toEqual([['args', ['a', 'b'], []]]);
        expect(commands('args a // c\n')).toEqual([['args', ['a'], []]]);
    });

    it('keeps a stray operator in unab, before its options', () => {
        expect(commands('unab x : a/b\n')).toEqual([['unab', ['x', 'a'], ['/b']]]);
        expect(commands('unab x : price-mpg, min(1)\n'))
            .toEqual([['unab', ['x', 'price'], ['-mpg']]]);
        expect(commands('unab x/y : a\n')).toEqual([['unab', ['x'], ['/y', ':', 'a']]]);
        const my_node = parse('unab x : price-mpg, min(1)\n').ast.nodes[0];
        expect(my_node?.type === 'command' ? my_node.options?.map((o) => o.name) : [])
            .toEqual(['min']);
    });

    it('keeps a stray operator in a prefixed or frame-prefixed unab', () => {
        expect(commands('quietly unab x : a/b\n')).toEqual([['unab', ['x', 'a'], ['/b']]]);
        expect(commands('frame f: unab x : a/b\n')).toEqual([['unab', ['x', 'a'], ['/b']]]);
    });
});

describe('args and unab keep tokens that are not names: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    const UNCHANGED_SOURCES = [
        'args a/note\n',
        'args a//note\n',
        'args a, b\n',
        'args a /* c */ b\n',
        'tokenize a/b\n',
        'gettoken a b : c/d\n',
        'unab x/y : a\n',
    ];

    for (const my_source of UNCHANGED_SOURCES) {
        for_each_formatter_mode(
            `leaves ${JSON.stringify(my_source)} unchanged`,
            (my_mode) => {
                const my_once = format_text(my_source, my_mode);
                expect(my_once).toBe(my_source);
                expect(format_text(my_once, my_mode)).toBe(my_once);
            }
        );
    }

    for (const my_source of ['unab x : a/b, min(1)\n', 'frame f: unab x : a/b\n']) {
        for_each_formatter_mode(`keeps the stray operator in ${JSON.stringify(my_source)}`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            // AST formatting writes `unab x:`; the operand stays together.
            expect(my_once.replace('x:', 'x :')).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }

    for_each_formatter_mode('keeps args names joined by /// in one statement', (my_mode) => {
        const my_once = format_text('args a ///\n    b\n', my_mode);
        expect(my_once.replace(/\s+/g, ' ').replace(' /// ', ' ')).toBe('args a b ');
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });
});
