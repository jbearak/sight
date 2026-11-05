/**
 * StataMP 18 ends a `program define` body at the first line whose first
 * word is `end`: indented, with a tail (`end foo`, `end;`), and even
 * when that line closes a `mata`, `mata:` or `python:` block in the
 * body. The lines after it run at the top level, and the program's own
 * `end` is then "command end is unrecognized" r(199). `/* end *\/`,
 * `// end`, `* end`, `local x end` and a `///` join do not end it, and
 * a one-line `mata:` statement in a program works.
 *
 * Sight reads the program the same way, reports the block's `end` as
 * EMBEDDED_BLOCK_ENDS_PROGRAM, and the program's own `end` as
 * UNEXPECTED_END.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ContextTracker } from '../../src/context-tracker';
import { ContextErrorCode } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

const MATA_IN_PROGRAM = [
    'program define foo',
    '    di "PROG_START"',
    '    mata:',
    'printf("IN_MATA\\n")',
    '    end',
    '    di "PROG_AFTER_MATA"',
    'end',
    '',
].join('\n');

const PYTHON_IN_PROGRAM = [
    'program define foo',
    '    python:',
    'print("IN_PY")',
    '    end',
    '    di "PROG_AFTER_PY"',
    'end',
    '',
].join('\n');

/** The (line, code) of each context diagnostic, in line order. */
function context_codes(my_source: string): Array<[number, ContextErrorCode]> {
    const my_tracker = new ContextTracker();
    my_tracker.initialize_from_tokens(
        new StataLexer().tokenize(my_source).tokens,
        my_source
    );
    return my_tracker
        .validate_context_structure()
        .map((my_diag): [number, ContextErrorCode] => [my_diag.range.start.line, my_diag.code])
        .sort((a, b) => a[0] - b[0]);
}

function end_token_lines(my_source: string): number[] {
    return new StataLexer()
        .tokenize(my_source)
        .tokens.filter(
            (my_token) => my_token.type === 'END_MATA' || my_token.type === 'END_PYTHON'
        )
        .map((my_token) => my_token.range.start.line);
}

describe('program definition ends at an embedded block end', () => {
    it('ends the program at a mata block end', () => {
        const my_ast = new StataParser().parse(
            new StataLexer().tokenize(MATA_IN_PROGRAM).tokens
        ).ast;
        const my_program = my_ast.nodes[0];
        expect(my_program?.type).toBe('program');
        if (my_program?.type !== 'program') {
            return;
        }
        expect(my_program.ends_at_embedded_block).toBe(true);
        expect(my_program.range.end.line).toBe(4);
        expect(my_program.body.map((my_node) => my_node.type)).toEqual([
            'command',
            'embedded_block',
        ]);
        // The rest is top-level Stata
        expect(my_ast.nodes.slice(1).map((my_node) => my_node.range.start.line))
            .toEqual([5, 6]);
    });

    it('ends a python block at an indented end inside a program', () => {
        // Outside a program an indented `end` stays Python; inside one,
        // Stata ends the program (and so the block) there.
        expect(end_token_lines(PYTHON_IN_PROGRAM)).toEqual([3]);
        expect(end_token_lines('program define foo\n    python:\n    end // c\nend\n'))
            .toEqual([2]);
        expect(end_token_lines('program define foo\n    python:\n    end foo\nend\n'))
            .toEqual([2]);
        expect(end_token_lines('python:\n    end\nx = 1\nend\n')).toEqual([3]);
    });

    it('reports the block end and the program end', () => {
        expect(context_codes(MATA_IN_PROGRAM)).toEqual([
            [4, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [6, ContextErrorCode.UNEXPECTED_END],
        ]);
        expect(context_codes(PYTHON_IN_PROGRAM)).toEqual([
            [3, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [5, ContextErrorCode.UNEXPECTED_END],
        ]);
    });

    it('does not end the program at a one-line mata statement', () => {
        expect(
            context_codes('program define foo\n    mata: printf("x\\n")\n    di 1\nend\n')
        ).toEqual([]);
    });

    it('accepts a block after the program end (the ado-file pattern)', () => {
        expect(
            context_codes('program define foo\n    mata: f()\nend\n\nmata:\nvoid f() {}\nend\n')
        ).toEqual([]);
    });

    it('does not end the program at a commented or mid-line end', () => {
        // Each body line(s) leaves the program open, so it ends at the
        // python block's `end` that follows.
        const BODIES = [
            '    /*\n    end\n    */',
            '    // end',
            '    local x end',
            '    di 1 ///\n    end',
        ];
        for (const my_body of BODIES) {
            const my_source =
                `program define foo\n${my_body}\n    python:\n    x = 1\n    end\nend\n`;
            const my_ast = new StataParser().parse(
                new StataLexer().tokenize(my_source).tokens
            ).ast;
            const my_program = my_ast.nodes[0];
            expect(my_program?.type).toBe('program');
            if (my_program?.type === 'program') {
                expect(my_program.ends_at_embedded_block).toBe(true);
            }
        }
    });

    it('does not open a program at program drop or a plugin declaration', () => {
        // With no program open, an indented end stays Python.
        expect(end_token_lines('capture program drop foo\npython:\n    end\nx = 1\nend\n'))
            .toEqual([4]);
        expect(end_token_lines('program drop foo\npython:\n    end\nx = 1\nend\n'))
            .toEqual([4]);
        expect(
            end_token_lines('program foo, plugin using("foo.so")\npython:\n    end\nend\n')
        ).toEqual([3]);
    });

    it('closes a program at end with a tail, so a later block is not in it', () => {
        // Stata 18 ends a program definition at `end foo` too.
        expect(context_codes('program foo\nend foo\npython:\nend\n')).toEqual([]);
        expect(context_codes('program foo\nend;\nmata:\nend\n')).toEqual([]);
    });

    it('does not close a program at an end joined by ///', () => {
        // `di 1 ///` then `end` is one line, `di 1 end`, so the program
        // runs on to the block's `end`.
        expect(
            context_codes('program define foo\n    di 1 ///\n    end\n    mata:\n    end\n')
        ).toEqual([[4, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM]]);
    });

    it('opens a program with a block comment in its header', () => {
        const my_source = 'program /* c */ define foo\npython:\n    end\ndi 1\nend\n';
        expect(end_token_lines(my_source)).toEqual([2]);
        expect(context_codes(my_source)).toEqual([
            [2, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [4, ContextErrorCode.UNEXPECTED_END],
        ]);
    });

    it('opens a program with a nested block comment in its header', () => {
        const my_source =
            'program /* outer /* inner */ */ define foo\npython:\n    end\ndi 1\nend\n';
        expect(end_token_lines(my_source)).toEqual([2]);
        expect(context_codes(my_source)).toEqual([
            [2, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [4, ContextErrorCode.UNEXPECTED_END],
        ]);
    });

    it('closes a program with options at its own end', () => {
        // `program foo, rclass` used to be missed, so its `end` was
        // reported as unexpected.
        expect(
            context_codes('program foo, rclass\n    di 1\nend\nprogram define bar, eclass\n    di 2\nend\n')
        ).toEqual([]);
    });
});

describe('program definition ends at an embedded block end: formatting', () => {
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
        'formats the block end as the program end, and the rest as top level',
        (my_mode) => {
            const my_once = format_text(MATA_IN_PROGRAM, my_mode);
            expect(my_once).toBe([
                'program define foo',
                '    di "PROG_START"',
                '    mata:',
                'printf("IN_MATA\\n")',
                'end',
                'di "PROG_AFTER_MATA"',
                'end',
                '',
            ].join('\n'));
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'formats a python block end in a program the same way',
        (my_mode) => {
            const my_once = format_text(PYTHON_IN_PROGRAM, my_mode);
            expect(my_once).toBe([
                'program define foo',
                '    python:',
                'print("IN_PY")',
                'end',
                'di "PROG_AFTER_PY"',
                'end',
                '',
            ].join('\n'));
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps comments after a block end that ends a program',
        (my_mode) => {
            const my_source =
                'program define foo\n    mata:\nx = 1\n    end // c\n    // later\n    di 2\nend\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe('program define foo\n    mata:\nx = 1\nend // c\n// later\ndi 2\nend\n');
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});

describe('unclosed embedded block: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    // An unclosed block runs to the end of the file, so the `}` or `end`
    // after it is block content. AST formatting used to add another one
    // on every pass.
    const UNCLOSED_SOURCES = [
        'if 1 {\n    mata\nx = 1\n}\n',
        'if 1 {\n    foreach i in 1 {\n        python\nx = 1\n    }\n}\n',
        'program define foo\n    mata\nx = 1\n',
    ];

    for (const my_source of UNCLOSED_SOURCES) {
        for_each_formatter_mode(
            `leaves ${JSON.stringify(my_source)} unchanged`,
            (my_mode) => {
                const my_once = format_text(my_source, my_mode);
                expect(my_once).toBe(my_source);
                expect(format_text(my_once, my_mode)).toBe(my_once);
            }
        );
    }

    for_each_formatter_mode(
        'still closes a plain missing brace',
        (my_mode) => {
            const my_once = format_text('if 1 {\n    di 1\n', my_mode);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});
