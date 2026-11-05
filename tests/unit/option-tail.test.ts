/**
 * The option parser dropped a token after the comma that no option can
 * start, so AST formatting fell back to source-preserving formatting
 * (and on main before #369 lost the code). StataMP 18 runs each of these:
 *
 *     di "a", "b"                       (shows `a b`; display has no options)
 *     twoway scatter y x, mcolor(red) || lfit y x, lcolor(blue)
 *     regress price mpg,
 *     frame `f' {                        (a frame named by a macro)
 *
 * Now `display` keeps its comma in its arguments, other commands keep the
 * rest of the statement in `options_tail`, and a frame block can be named
 * by a macro, so AST formatting prints these files itself.
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

/** The first command's arguments, option names and option tail. */
function command_parts(my_source: string): {
    args: string[];
    options: string[];
    tail: string[];
} {
    const my_node = parse(my_source).ast.nodes[0];
    if (my_node?.type !== 'command') {
        throw new Error(`not a command: ${my_node?.type}`);
    }
    return {
        args: [...(my_node.varlist ?? []), ...(my_node.extra_args ?? [])]
            .map((my_item) => my_item.name),
        options: (my_node.options ?? []).map((my_option) => my_option.name),
        tail: (my_node.options_tail ?? []).map((my_item) => my_item.name),
    };
}

describe('tokens after the comma that are not options', () => {
    it('keeps the comma of display as an argument', () => {
        expect(command_parts('di "a", "b"\n'))
            .toEqual({ args: ['"a"', ',', '"b"'], options: [], tail: [] });
        expect(command_parts('display 1, 2\n'))
            .toEqual({ args: ['1', ',', '2'], options: [], tail: [] });
    });

    it('keeps a twoway || plot after the options', () => {
        expect(command_parts('twoway scatter y x, mcolor(red) || lfit y x, lcolor(blue)\n'))
            .toEqual({
                args: ['scatter', 'y', 'x'],
                options: ['mcolor'],
                tail: ['||', 'lfit', 'y', 'x,', 'lcolor(blue)'],
            });
    });

    it('keeps a bare trailing comma', () => {
        expect(command_parts('regress y x,\n'))
            .toEqual({ args: ['y', 'x'], options: [], tail: [','] });
    });

    it('moves an option that touches the stray token into the tail', () => {
        expect(command_parts('reg y x, robust/cluster\n'))
            .toEqual({ args: ['y', 'x'], options: [], tail: [',', 'robust/cluster'] });
        expect(command_parts('reg y x, a b/c\n'))
            .toEqual({ args: ['y', 'x'], options: ['a'], tail: ['b/c'] });
    });

    it('holds all of these in the AST', () => {
        for (const my_source of [
            'di "a", "b"\n',
            'twoway scatter y x, mcolor(red) || line y x\n',
            'regress y x,\n',
            'frame `f\' {\n    di 1\n}\n',
            'frame $g {\n    di 1\n}\n',
        ]) {
            expect(parse(my_source).ast.unprintable_ranges).toBeUndefined();
        }
    });

    it('parses a frame block named by a macro', () => {
        const my_node = parse('frame `f\' {\n    di 1\n}\n').ast.nodes[0];
        expect(my_node?.type === 'frame' && my_node.frameName).toBe('`f\'');
    });
});

describe('tokens after the comma that are not options: formatting', () => {
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
        'di "a", "b"\n',
        'di "a","b"\n',
        'di "a",\n',
        'display "x = " %9.2f r(mean) _n "y"\n',
        'twoway scatter y x, mcolor(red) || line y x, lcolor(blue)\n',
        'twoway (scatter y x) (line y x), legend(off)\n',
        'tw (sc y x) || (lfit y x)\n',
        'graph combine g1 g2, cols(2) title("A")\n',
        'regress y x,\n',
        'reg y x, robust/cluster\n',
        'reg y x, mcolor(red)|| line y x\n',
        'frame `f\' {\n    di 1\n}\n',
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

    for_each_formatter_mode('formats the body of a frame block named by a macro', (my_mode) => {
        const my_once = format_text('frame `f\' {\ndi 1\n}\n', my_mode);
        expect(my_once).toBe('frame `f\' {\n    di 1\n}\n');
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });
});
