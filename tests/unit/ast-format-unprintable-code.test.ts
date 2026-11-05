/**
 * The parser recovers from some invalid code by skipping it, or reads a
 * block header with no `{` as an empty block. Printing that AST lost or
 * invented code: `if a` then `b {` ... `}` came out as `if a {`, `}`,
 * `b`, dropping the body. StataMP 18 stops at `if a` alone ("{ required",
 * r(100)), at a lone `}` ("} is not a valid command name", r(199)), and
 * passes the `{` of `b {` to `b` as an argument.
 *
 * A block with no `}` (or a program with no `end`) is listed too:
 * printing it would add the missing closer.
 *
 * The parser now lists such code in `StataAST.unprintable_ranges`, and
 * AST formatting leaves a file with any to source-preserving
 * formatting, which keeps every statement as written.
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

function unprintable_lines(my_source: string): number[] {
    const my_ast = new StataParser().parse(new StataLexer().tokenize(my_source).tokens).ast;
    const the_lines = (my_ast.unprintable_ranges ?? []).map((my_range) => my_range.start.line);
    return [...new Set(the_lines)];
}

/**
 * The source's lines without their indentation, to compare code across
 * formatting: statements must stay on their lines, and spaces inside a
 * line must stay.
 */
function code_of(my_text: string): string[] {
    return my_text.split('\n').map((my_line) => my_line.trim());
}

const INVALID_SOURCES: Array<[string, string, number[]]> = [
    ['an if with no brace before a command with a brace', 'if a\nb {\n    di 1\n}\ndi 2\n', [0, 1]],
    ['an if with no brace or command', 'if 1\ndi 2\n', [0]],
    ['a loop with no brace', 'foreach i in 1 2\ndi 1\nwhile 1\ndi 2\n', [0, 2]],
    ['an orphan close brace', 'di 1\n}\ndi 2\n', [1]],
    ['a brace block after a command on its line', 'di 1 {\n    di 3\n}\ndi 2\n', [0]],
    // Stata stops at `{ di 1` ("code follows on the same line as open
    // brace", r(198)); printing would move `di 1` to a line of its own
    ['code after a block\'s {', '{ di 1\n    di 2\n}\n', [0]],
    ['lines that start with an operator', '= 1\n) x\ndi 1\n', [0, 1]],
    // The `}` is left over after giving up on the block
    ['a statement the parser gives up on, in a block', 'if 1 {\n    unab , x\n    di 1\n}\ndi 2\n', [0, 3]],
    // A missing closer: printing the AST would add it
    ['an if with no }', 'if 1 {\n    di 1\n', [0]],
    ['an if with no }; under #delimit ;', '#delimit ;\nif 1 {;\ndi 1;\ndi 2;\n', [1]],
    ['a capture block with no }', 'capture {\n    di 1\n', [0]],
    ['a program with no end', 'program p\n    di 1\n', [0]],
];

describe('code the AST does not hold', () => {
    for (const [my_name, my_source, my_lines] of INVALID_SOURCES) {
        it(`lists ${my_name}`, () => {
            expect(unprintable_lines(my_source)).toEqual(my_lines);
        });
    }

    it('lists nothing for valid code', () => {
        expect(unprintable_lines('if 1 {\n    di 1\n}\nelse di 2\nforeach i in 1 {\n}\n'))
            .toEqual([]);
        // Stata 18 runs a standalone block
        expect(unprintable_lines('di 1\n{\n    di 3\n}\ndi 2\n')).toEqual([]);
    });
});

describe('code the AST does not hold: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    for (const [my_name, my_source] of INVALID_SOURCES) {
        for_each_formatter_mode(`keeps ${my_name} as written`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            expect(code_of(my_once)).toEqual(code_of(my_source));
            // The same in both modes
            expect(my_once).toBe(format_text(my_source, 'source-preserving'));
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }

    for_each_formatter_mode('keeps each statement of if a then b { on its line', (my_mode) => {
        const my_once = format_text('if a\nb {\n    di 1\n}\ndi 2\n', my_mode);
        expect(my_once.split('\n').map((my_line) => my_line.trim()))
            .toEqual(['if a', 'b {', 'di 1', '}', 'di 2', '']);
    });

    for_each_formatter_mode('still formats valid code with AST formatting', (my_mode) => {
        const my_once = format_text('if 1 {\ndi 1\n}\n', my_mode);
        expect(my_once).toBe('if 1 {\n    di 1\n}\n');
    });
});
