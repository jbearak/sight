/**
 * StataMP 18 ends a `program define` body at the first line whose first
 * word is `end`, however deep in the program's `if`, loop or `capture {`
 * blocks that line is, and whether it is a plain `end` or the `end` of a
 * mata/python block. Stata reads the definition line by line, so the
 * blocks it cuts off have no `}`: the lines after the `end` run at the
 * top level, and the `}` is "} is not a valid command name", r(199).
 *
 * The context tracker already read it that way; the parser now does
 * too, so both formatter modes print the same thing, and the parser
 * doesn't report a missing `}` or `end` that Stata never looks for.
 *
 * A `program` header can also continue onto the next lines with `///`
 * (`program ///` then `define foo, rclass`), which Stata 18 accepts.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ContextTracker } from '../../src/context-tracker';
import { ContextErrorCode, ParseErrorCode, StataNode } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

const MATA_IN_IF = [
    'program define foo',
    '    di "P1"',
    '    if 1 {',
    '        mata:',
    'x = 1',
    'end',
    '    di "AFTER"',
    'end',
    'di "TOP"',
    '',
].join('\n');

const PYTHON_IN_FOREACH_IN_IF = [
    'program define foo',
    '    if 1 {',
    '        foreach i in 1 {',
    '            python:',
    'print(1)',
    'end',
    '            di "AFTER"',
    'end',
    '',
].join('\n');

const MATA_IN_CAPTURE = [
    'program define foo',
    '    capture noisily {',
    '        mata:',
    'x = 1',
    'end',
    '    di "AFTER"',
    '',
].join('\n');

const END_IN_IF = [
    'program define foo',
    '    if 1 {',
    '        di "IN"',
    '    end',
    '    di "AFTER"',
    'end',
    '',
].join('\n');

function parse(my_source: string) {
    return new StataParser().parse(new StataLexer().tokenize(my_source).tokens);
}

/** Each node as `type@start-end`, with its body nested. */
function outline(the_nodes: StataNode[]): unknown[] {
    return the_nodes.map((my_node) => {
        const my_label = `${my_node.type}@${my_node.range.start.line}-${my_node.range.end.line}`;
        const my_body = 'body' in my_node && Array.isArray(my_node.body) ? my_node.body : [];
        return my_body.length > 0 ? [my_label, outline(my_body)] : my_label;
    });
}

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

describe('program ends at an end nested in a brace block', () => {
    it('ends the program at a mata block end inside an if', () => {
        const my_result = parse(MATA_IN_IF);
        expect(outline(my_result.ast.nodes)).toEqual([
            ['program@0-5', ['command@1-1', ['if@2-5', ['embedded_block@3-5']]]],
            'command@6-6',
            'command@7-7',
            'command@8-8',
        ]);
        const my_program = my_result.ast.nodes[0];
        expect(my_program?.type === 'program' && my_program.ends_at_embedded_block).toBe(true);
        const my_if = my_program?.type === 'program' ? my_program.body[1] : undefined;
        expect(my_if?.type === 'if' && my_if.closed_by_program_end).toBe(true);
        expect(my_result.errors).toEqual([]);
        expect(context_codes(MATA_IN_IF)).toEqual([
            [5, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [7, ContextErrorCode.UNEXPECTED_END],
        ]);
    });

    it('ends the program at a python block end two blocks deep', () => {
        const my_result = parse(PYTHON_IN_FOREACH_IN_IF);
        expect(outline(my_result.ast.nodes)).toEqual([
            ['program@0-5', [['if@1-5', [['foreach@2-5', ['embedded_block@3-5']]]]]],
            'command@6-6',
            'command@7-7',
        ]);
        // On main the parser reported a missing `end` for the program
        expect(my_result.errors).toEqual([]);
        expect(context_codes(PYTHON_IN_FOREACH_IN_IF)).toEqual([
            [5, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
            [7, ContextErrorCode.UNEXPECTED_END],
        ]);
    });

    it('ends the program at a mata block end inside capture {', () => {
        const my_result = parse(MATA_IN_CAPTURE);
        expect(outline(my_result.ast.nodes)).toEqual([
            ['program@0-4', [['command@1-4', ['embedded_block@2-4']]]],
            'command@5-5',
        ]);
        expect(my_result.errors).toEqual([]);
    });

    it('ends the program at a plain end inside an if', () => {
        const my_result = parse(END_IN_IF);
        expect(outline(my_result.ast.nodes)).toEqual([
            ['program@0-3', [['if@1-2', ['command@2-2']]]],
            'command@4-4',
            'command@5-5',
        ]);
        expect(my_result.errors).toEqual([]);
        expect(context_codes(END_IN_IF)).toEqual([[5, ContextErrorCode.UNEXPECTED_END]]);
    });

    it('reports the } after the program end as an orphan, as Stata does', () => {
        const my_source = MATA_IN_IF.replace('    di "AFTER"\n', '    di "AFTER"\n    }\n');
        expect(parse(my_source).errors.map((my_error) => [my_error.range.start.line, my_error.code]))
            .toEqual([[7, ParseErrorCode.ORPHAN_CLOSE_BRACE]]);
    });

    it('reports a } right after the block end as an orphan', () => {
        const my_source = 'program define foo\nif 1 {\nmata:\nx=1\nend\n}\ndi 2\n';
        const my_result = parse(my_source);
        expect(my_result.errors.map((my_error) => [my_error.range.start.line, my_error.code]))
            .toEqual([[5, ParseErrorCode.ORPHAN_CLOSE_BRACE]]);
        const my_program = my_result.ast.nodes[0];
        const my_if = my_program?.type === 'program' ? my_program.body[0] : undefined;
        expect(my_if?.type === 'if' && my_if.closed_by_program_end).toBe(true);
    });

    it('marks an else if cut off by the program end', () => {
        const my_result = parse(
            'program define foo\n    if 0 {\n    }\n    else if 1 {\n    end\n');
        const my_program = my_result.ast.nodes[0];
        const my_else = my_program?.type === 'program' ? my_program.body[1] : undefined;
        expect(my_else?.type === 'else' && my_else.closed_by_program_end).toBe(true);
        expect(my_result.errors).toEqual([]);
    });

    it('still reports a missing } outside a program', () => {
        expect(parse('if 1 {\n    di 1\n').errors.map((my_error) => my_error.message))
            .toEqual(['Missing closing brace for if statement']);
    });
});

describe('program ends at an end nested in a brace block: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    // The block's `end` is the program's, at column 0; the lines after it
    // are top level, and no `}` is added for the cut-off blocks.
    const CASES: Array<[string, string, string]> = [
        ['a mata block in an if', MATA_IN_IF, [
            'program define foo',
            '    di "P1"',
            '    if 1 {',
            '        mata:',
            'x = 1',
            'end',
            'di "AFTER"',
            'end',
            'di "TOP"',
            '',
        ].join('\n')],
        ['a python block in a foreach in an if', PYTHON_IN_FOREACH_IN_IF, [
            'program define foo',
            '    if 1 {',
            '        foreach i in 1 {',
            '            python:',
            'print(1)',
            'end',
            'di "AFTER"',
            'end',
            '',
        ].join('\n')],
        ['a mata block in capture {', MATA_IN_CAPTURE, [
            'program define foo',
            '    capture noisily {',
            '        mata:',
            'x = 1',
            'end',
            'di "AFTER"',
            '',
        ].join('\n')],
        ['a plain end in an if', END_IN_IF, [
            'program define foo',
            '    if 1 {',
            '        di "IN"',
            'end',
            'di "AFTER"',
            'end',
            '',
        ].join('\n')],
    ];

    for (const [my_name, my_source, my_expected] of CASES) {
        for_each_formatter_mode(`formats ${my_name}`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_expected);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }

    for_each_formatter_mode(
        'keeps a python block end at column 0 when it ends a nested block',
        (my_mode) => {
            // An indented `end` would leave the Python block open
            const my_once = format_text(PYTHON_IN_FOREACH_IN_IF, my_mode);
            expect(my_once.split('\n')[5]).toBe('end');
        }
    );

    for_each_formatter_mode(
        'adds no } to an else if cut off by the program end',
        (my_mode) => {
            const my_source =
                'program define foo\n    if 0 {\n        di 1\n    }\n' +
                '    else if 1 {\n        di 2\n    end\n    di 3\nend\n';
            const my_once = format_text(my_source, my_mode);
            // AST formatting writes `else if` as `else {` then `if`
            expect(my_once.split('\n').filter((my_line) => my_line.trim() === '}'))
                .toEqual(['    }']);
            expect(my_once.split('\n').slice(-4)).toEqual(['end', 'di 3', 'end', '']);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps a } right after the block end at the top level',
        (my_mode) => {
            const my_source = 'program define foo\nif 1 {\nmata:\nx=1\nend\n}\ndi 2\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe('program define foo\n    if 1 {\n        mata:\nx=1\nend\n}\ndi 2\n');
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps the } after the program end, as written',
        (my_mode) => {
            const my_source = 'program define foo\n    if 1 {\n        di 1\n    end\n}\nend\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe('program define foo\n    if 1 {\n        di 1\nend\n}\nend\n');
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});

describe('program header continued with ///', () => {
    const HEADERS = [
        'program define foo, ///\n    rclass\n',
        'program ///\n    define foo, rclass\n',
        'program define ///\n    foo\n',
        'program define foo, rclass ///\n    // note\n',
    ];

    for (const my_header of HEADERS) {
        it(`closes ${JSON.stringify(my_header)} at its end`, () => {
            const my_source = `${my_header}    di 1\nend\n`;
            expect(context_codes(my_source)).toEqual([]);
            const my_result = parse(my_source);
            expect(my_result.errors).toEqual([]);
            expect(my_result.ast.nodes.map((my_node) => my_node.type)).toEqual(['program']);
        });

        it(`ends ${JSON.stringify(my_header)} at a mata block end`, () => {
            const my_source = `${my_header}    mata:\nx = 1\n    end\n    di 2\nend\n`;
            const my_block_end = my_header.split('\n').length + 1;
            expect(context_codes(my_source)).toEqual([
                [my_block_end, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
                [my_block_end + 2, ContextErrorCode.UNEXPECTED_END],
            ]);
        });
    }

    it('does not open a program at a plugin declaration continued with ///', () => {
        expect(context_codes('program define foo, ///\n    plugin\nend\n')).toEqual([
            [2, ContextErrorCode.UNEXPECTED_END],
        ]);
    });
});
