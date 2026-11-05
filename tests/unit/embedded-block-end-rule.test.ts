/**
 * Where a `mata` or `python` block ends.
 *
 * Each case mirrors a probe run in StataMP 18: the block opener, the
 * candidate line(s), a statement that only runs if the block is still
 * open, a bare `end`, and a Stata command. Stata's rules:
 *
 * - Mata closes at an `end` that begins its logical line. Leading
 *   blanks and a closed block comment may precede it; code (`y end`,
 *   `a=end`, `x = 1; end`) and a `///` join onto the line above may
 *   not.
 * - Python closes only at a line that is exactly `end` in column 0,
 *   with optional trailing blanks. An indented `end`, `end // c`,
 *   `end # c` and `end python` are all handed to Python.
 *
 * The lexer, the parser and the context tracker must agree.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { ContextErrorCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

type Language = 'mata' | 'python';

interface EndCase {
    name: string;
    language: Language;
    // Lines between the opener and the probe statement
    candidate: string[];
    // Whether Stata ends the block on the candidate's last line
    ends_block: boolean;
}

const MATA_PROBE = 'printf("STILL_INSIDE\\n")';
const PYTHON_PROBE = 'print("STILL_INSIDE")';

const MATA_CASES: EndCase[] = [
    { name: 'end alone', candidate: ['end'], ends_block: true },
    { name: 'end after spaces', candidate: ['   end'], ends_block: true },
    { name: 'end after a tab', candidate: ['\tend'], ends_block: true },
    { name: 'end then // comment', candidate: ['end // comment'], ends_block: true },
    { name: 'end then block comment', candidate: ['end /* c */'], ends_block: true },
    { name: 'end then spaces', candidate: ['end   '], ends_block: true },
    { name: 'block comment then end', candidate: ['/* c */ end'], ends_block: true },
    {
        name: 'multi-line block comment then end',
        candidate: ['/* a', 'b */ end'],
        ends_block: true,
    },
    { name: 'mid-line end after a word', candidate: ['y end'], ends_block: false },
    { name: 'end after =', candidate: ['a=end'], ends_block: false },
    { name: 'end after #', candidate: ['#end'], ends_block: false },
    { name: 'end after a number', candidate: ['1end'], ends_block: false },
    { name: 'end after ;', candidate: ['x = 1; end'], ends_block: false },
    { name: 'end after ; with no space', candidate: ['x = 1;end'], ends_block: false },
    { name: 'end joined by ///', candidate: ['x = 1 ///', 'end'], ends_block: false },
    {
        name: 'end after code and a multi-line block comment',
        candidate: ['x = 1 /* a', 'b */ end'],
        ends_block: false,
    },
    { name: 'end in a // comment', candidate: ['x = 1 // end'], ends_block: false },
    { name: 'end in a block comment', candidate: ['/* end */'], ends_block: false },
    { name: 'end on a commented line', candidate: ['/*', 'end', '*/'], ends_block: false },
    { name: 'end in a star comment', candidate: ['* end'], ends_block: false },
    { name: 'end in a string', candidate: ['x = "end"'], ends_block: false },
    { name: 'End (case differs)', candidate: ['End'], ends_block: false },
    { name: 'end followed by .', candidate: ['end.'], ends_block: false },
].map((my_case) => ({ ...my_case, language: 'mata' as const }));

const PYTHON_CASES: EndCase[] = [
    { name: 'end alone', candidate: ['end'], ends_block: true },
    { name: 'end then spaces', candidate: ['end   '], ends_block: true },
    { name: 'end then a tab', candidate: ['end\t'], ends_block: true },
    // Stata does not join Python lines with ///
    { name: 'end after a /// line', candidate: ['x = 1 ///', 'end'], ends_block: true },
    { name: 'end after spaces', candidate: ['   end'], ends_block: false },
    { name: 'end after a tab', candidate: ['\tend'], ends_block: false },
    { name: 'end then // comment', candidate: ['end // comment'], ends_block: false },
    { name: 'end then block comment', candidate: ['end /* c */'], ends_block: false },
    { name: 'end then # comment', candidate: ['end # c'], ends_block: false },
    { name: 'end python', candidate: ['end python'], ends_block: false },
    { name: 'end then ;', candidate: ['end;'], ends_block: false },
    { name: 'end = 1', candidate: ['end = 1'], ends_block: false },
    { name: 'block comment then end', candidate: ['/* c */ end'], ends_block: false },
    { name: 'mid-line end after a word', candidate: ['y end'], ends_block: false },
    { name: 'end after =', candidate: ['a=end'], ends_block: false },
    { name: 'end after #', candidate: ['#end'], ends_block: false },
    { name: 'end after a number', candidate: ['1end'], ends_block: false },
    { name: 'end in a # comment', candidate: ['x = 1  # end'], ends_block: false },
    { name: 'end in a string', candidate: ['x = "end"'], ends_block: false },
    { name: 'End (case differs)', candidate: ['End'], ends_block: false },
].map((my_case) => ({ ...my_case, language: 'python' as const }));

/** The probe source and the line where Stata ends the block. */
function build_case(my_case: EndCase): { source: string; end_line: number } {
    const my_probe = my_case.language === 'mata' ? MATA_PROBE : PYTHON_PROBE;
    const the_lines = [
        my_case.language,
        ...my_case.candidate,
        my_probe,
        'end',
        'display 1',
    ];
    const my_end_line = my_case.ends_block
        ? my_case.candidate.length
        : my_case.candidate.length + 2;
    return { source: the_lines.join('\n') + '\n', end_line: my_end_line };
}

const END_TOKEN_TYPE: Record<Language, 'END_MATA' | 'END_PYTHON'> = {
    mata: 'END_MATA',
    python: 'END_PYTHON',
};

describe('embedded block end rule', () => {
    for (const my_case of [...MATA_CASES, ...PYTHON_CASES]) {
        const my_verb = my_case.ends_block ? 'ends' : 'does not end';
        const my_title =
            `${my_case.language}: ${my_case.name} ${my_verb} the block`;

        it(`${my_title} (lexer and parser)`, () => {
            const { source, end_line } = build_case(my_case);
            const my_lex_result = new StataLexer().tokenize(source);
            const my_end_token = my_lex_result.tokens.find(
                (my_token) => my_token.type === END_TOKEN_TYPE[my_case.language]
            );
            expect(my_end_token?.range.start.line).toBe(end_line);

            const my_ast = new StataParser().parse(my_lex_result.tokens).ast;
            const my_block = my_ast.nodes[0];
            expect(my_block?.type).toBe('embedded_block');
            expect(my_block?.range.end.line).toBe(end_line);
            if (!my_case.ends_block) {
                // The block swallows the candidate and the probe, so the
                // only statement after it is the trailing `display 1`.
                expect(my_ast.nodes).toHaveLength(2);
                expect(my_ast.nodes[1]?.range.start.line).toBe(end_line + 1);
            }
        });

        it(`${my_title} (context tracker)`, () => {
            const { source, end_line } = build_case(my_case);
            const my_tracker = new ContextTracker();
            my_tracker.initialize_from_tokens(
                new StataLexer().tokenize(source).tokens,
                source
            );
            const the_ranges = my_tracker.get_all_context_ranges();
            expect(the_ranges[0]?.end_delimiter?.range.start.line).toBe(end_line);

            const my_expected_context =
                my_case.language === 'mata'
                    ? LanguageContext.MATA
                    : LanguageContext.PYTHON;
            const my_probe_line = my_case.candidate.length + 1;
            expect(
                my_tracker.get_context_at_position({
                    line: my_probe_line,
                    character: 0,
                })
            ).toBe(
                my_case.ends_block ? LanguageContext.STATA : my_expected_context
            );

            // When the block stays open, the trailing bare `end` closes
            // it and is not an orphan.
            if (!my_case.ends_block) {
                const the_unexpected = my_tracker
                    .validate_context_structure()
                    .filter((my_diag) => my_diag.code === ContextErrorCode.UNEXPECTED_END);
                expect(the_unexpected).toEqual([]);
            }
        });
    }

    it('reads the reported mata block as one block', () => {
        const my_source =
            'mata\nx = 1 // end\ny end\nz = 2\nend\ndi 1\n';
        const my_lex_result = new StataLexer().tokenize(my_source);
        const my_ast = new StataParser().parse(my_lex_result.tokens).ast;
        expect(my_ast.nodes.map((my_node) => my_node.type)).toEqual([
            'embedded_block',
            'command',
        ]);
        expect(my_ast.nodes[0]?.range.end.line).toBe(4);
        expect(my_ast.nodes[1]?.range.start.line).toBe(5);

        const my_tracker = new ContextTracker();
        my_tracker.initialize_from_tokens(my_lex_result.tokens, my_source);
        for (let my_line = 1; my_line <= 3; my_line++) {
            expect(
                my_tracker.get_context_at_position({ line: my_line, character: 0 })
            ).toBe(LanguageContext.MATA);
        }
        expect(my_tracker.validate_context_structure()).toEqual([]);
    });

    it('keeps program end validation in step with the lexer', () => {
        // The tracker's program/input `end` scan used to re-derive mata
        // block extents from raw lines, so it disagreed with the lexer
        // about which `end` closed the block.
        const my_source = [
            'program define foo',
            '    display 1',
            'end',
            'mata:',
            'y end',
            'end',
            'program define bar',
            '    display 2',
            'end',
        ].join('\n');
        const my_tracker = new ContextTracker();
        my_tracker.initialize_from_tokens(
            new StataLexer().tokenize(my_source).tokens,
            my_source
        );
        expect(my_tracker.validate_context_structure()).toEqual([]);
    });
});

describe('embedded block end rule: formatting', () => {
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
        'keeps a mata block with mid-line end intact',
        (my_mode) => {
            const my_source =
                'mata\nx = 1 // end\ny end\na=end\n#end\n1end\nz = 2\nend\ndi 1\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps a python block with mid-line end intact',
        (my_mode) => {
            const my_source =
                'python\nx = 1  # end\ny = "end"\n#end\nend\ndi 1\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once.split('\n').slice(0, 5)).toEqual([
                'python',
                'x = 1  # end',
                'y = "end"',
                '#end',
                'end',
            ]);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps a nested python end in column 0 and its body as written',
        (my_mode) => {
            const my_source = [
                'if 1 {',
                'python',
                'def f():',
                '    return 1',
                'print(f())',
                'end',
                'di 2',
                '}',
                '',
            ].join('\n');
            const my_once = format_text(my_source, my_mode);
            const the_lines = my_once.split('\n');
            expect(the_lines[1]).toBe('    python');
            expect(the_lines.slice(2, 6)).toEqual([
                'def f():',
                '    return 1',
                'print(f())',
                'end',
            ]);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'still indents a nested mata end to the opener depth',
        (my_mode) => {
            const my_source = 'if 1 {\nmata\nx = 1\nend\n}\n';
            const my_once = format_text(my_source, my_mode);
            const the_lines = my_once.split('\n');
            expect(the_lines[1]).toBe('    mata');
            expect(the_lines[3]).toBe('    end');
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});
