/**
 * Where `input` data, embedded-language openers, and `#delimit ;`
 * directive comments start and stop, in the cases each checked with
 * StataMP 18:
 *
 * - `set obs 1` then `input score` / `10`: the data fills the one
 *   observation and Stata returns to command mode by itself; the
 *   `local`, `program define helper` ... `end` and `helper` after it
 *   all run.
 * - under `#delimit ;`, `input x;` / `1;` / `end;` reads one record
 *   per `;` up to a record whose first word is `end`, and code
 *   resumes after that record's `;` (`end; display "x";` displays x).
 * - `program /* note` newline `*\/ define collectdata` defines
 *   collectdata; the `input x` in it has no data, so its `end` ends
 *   the definition and `display 1` runs at top level.
 * - `#delimit ; * switch delimiter` then `local x 42;` and
 *   `display `x';` displays 42: the `*` comment ends at the newline.
 * - `` `run': python: `` with `run` holding `noisily` opens a Python
 *   block (prints 0 and 1 from an indented loop body).
 * - `mi xeq: mata: ...`, `mi xeq 1: mata:`, `version 18: mata:`,
 *   `frame default: mata:`, `capture noisily: mata:` and
 *   `mi xeq: quietly mata:` run the rest of the line as Mata;
 *   `by g: mata:` is read as Mata too, which Stata then rejects
 *   ("mata may not be combined with by").
 * - `if 1 input str10 city` reads `Paris` as data up to `end`.
 */

import { describe, it, expect } from 'bun:test';
import { create_empty_symbol_table, SemanticAnalyzer } from '../../src/analyzer';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { LanguageContext, StataDiagnosticCode, StataNode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';
import { create_document_state } from '../property/helpers/document-utils';
import { context_diagnostics, init_tracker_from_source } from '../test-context-helper';

function parse(source: string) {
    const lex_result = new StataLexer().tokenize(source);
    return { lex_result, parse_result: new StataParser().parse(lex_result.tokens) };
}

/** The name of each top-level command, or the node's type. */
function node_names(the_nodes: readonly StataNode[]): string[] {
    return the_nodes.map((my_node) => my_node.type === 'command'
        ? my_node.name : my_node.type);
}

/** The local macros the analyzer reports as undefined. */
function undefined_macros(source: string): string[] {
    const { lex_result, parse_result } = parse(source);
    return new SemanticAnalyzer().analyze(
        parse_result.ast, 'file:///input-edge.do', undefined,
        { undefined_macro_enabled: true }, lex_result.tokens)
        .diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((my_diagnostic) => my_diagnostic.message);
}

function format_source(source: string, mode: FormatterMode): string {
    const { lex_result, parse_result } = parse(source);
    const edits = new CodeFormatter().format({
        uri: 'file:///input-edge.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
    }, { tabSize: 4, insertSpaces: true }, create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

/** Format twice and require the second pass to change nothing. */
function format_stable(source: string, mode: FormatterMode): string {
    const formatted = format_source(source, mode);
    expect(format_source(formatted, mode)).toBe(formatted);
    return formatted;
}

describe('input with no end before a program definition', () => {
    const SOURCE = [
        'set obs 1',
        'input score',
        '10',
        'local label score',
        'program define helper',
        '    display 1',
        'end',
        'display "`label\'"',
        'helper',
        '',
    ].join('\n');

    it('does not read the program as data', () => {
        const { parse_result } = parse(SOURCE);
        const the_names = node_names(parse_result.ast.nodes);
        expect(the_names).toContain('program');
        expect(the_names).toContain('macro_def');
        expect(the_names.slice(-2)).toEqual(['display', 'helper']);
    });

    it('defines the local the data would have hidden', () => {
        expect(undefined_macros(SOURCE)).toEqual([]);
    });

    it('still reads data that ends before a program', () => {
        const { parse_result } = parse(
            'input x\n1\nend\nprogram define p\n    di 1\nend\n');
        expect(node_names(parse_result.ast.nodes)).toEqual(['input', 'program']);
    });
});

describe('input under #delimit ;', () => {
    const SOURCE = '#delimit ;\ninput x;\n1;\nend;\nlist x;\n';

    it('reads the records up to end as data', () => {
        const { parse_result } = parse(SOURCE);
        const the_nodes = parse_result.ast.nodes;
        expect(node_names(the_nodes)).toEqual(['directive', 'input', 'list']);
        const input = the_nodes[1];
        expect(input?.type === 'command' ? input.input_data?.content : null)
            .toBe('1');
    });

    it('reports no unexpected end', () => {
        expect(context_diagnostics(SOURCE)).toEqual([]);
    });

    it('reads code after the end record on the same line', () => {
        const { parse_result } = parse(
            '#delimit ;\ninput x; 1; 2;\n3;\nend; display "same line";\n');
        expect(node_names(parse_result.ast.nodes))
            .toEqual(['directive', 'input', 'display']);
    });

    it('has no data in a program definition, whose end it reaches', () => {
        const { parse_result } = parse(
            '#delimit ;\nprogram define p;\n    input x;\nend;\ndisplay 1;\n');
        expect(node_names(parse_result.ast.nodes))
            .toEqual(['directive', 'program', 'display']);
    });

    for_each_formatter_mode('keeps the data as written', (mode) => {
        for (const my_source of [
            SOURCE,
            '#delimit ;\ninput x y;\n1 2;\n3 4;\nend;\nlist;\n',
            '#delimit ;\ninput x;\nend;\nlist;\n',
            '#delimit ;\nif 1 {;\n    input x;\n1;\n    end;\n};\nlist;\n',
        ]) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });

    for_each_formatter_mode('keeps records on the input line and code after end', (mode) => {
        const formatted = format_stable(
            '#delimit ;\ninput x; 1; 2;\n3;\nend; display "same line";\n', mode);
        const { parse_result } = parse(formatted);
        const input = parse_result.ast.nodes[1];
        expect(input?.type === 'command' ? input.input_data?.content.trim() : null)
            .toBe('1; 2;\n3');
        expect(node_names(parse_result.ast.nodes))
            .toEqual(['directive', 'input', 'display']);
    });
});

describe('input in a program whose header has a multi-line block comment', () => {
    const SOURCE = [
        'program /* note',
        '*/ define collectdata',
        '    input x',
        'end',
        'display 1',
        '',
    ].join('\n');

    it('ends the definition at the end, leaving display at top level', () => {
        const { parse_result } = parse(SOURCE);
        expect(parse_result.errors).toEqual([]);
        expect(node_names(parse_result.ast.nodes)).toEqual(['program', 'display']);
    });

    it('still reads data after a // comment that holds /*', () => {
        const { parse_result } = parse(
            'program p // a /* b\n    di 1\nend\ninput x\n1\nend\n');
        expect(node_names(parse_result.ast.nodes)).toEqual(['program', 'input']);
    });
});

describe('a * comment on the #delimit ; line', () => {
    const SOURCE = '#delimit ; * switch delimiter\nlocal x 42;\ndisplay `x\';\n';

    it('ends at the newline', () => {
        const { parse_result } = parse(SOURCE);
        expect(node_names(parse_result.ast.nodes))
            .toEqual(['directive', 'macro_def', 'display']);
        expect(undefined_macros(SOURCE)).toEqual([]);
    });

    for_each_formatter_mode('is kept on the directive line', (mode) => {
        expect(format_stable(SOURCE, mode)).toBe(SOURCE);
    });
});

describe('a macro prefix before python:', () => {
    const SOURCE = [
        'local run quietly',
        '`run\': python:',
        'for i in range(2):',
        '    print(i)',
        'end',
        '',
    ].join('\n');

    it('opens a python block', () => {
        const the_types = new StataLexer().tokenize(SOURCE).tokens
            .map((my_token) => my_token.type);
        expect(the_types).toContain('PYTHON_START');
        expect(the_types).toContain('END_PYTHON');
        expect(context_diagnostics(SOURCE)).toEqual([]);
    });

    for_each_formatter_mode('keeps the prefix and the Python body', (mode) => {
        const formatted = format_stable(SOURCE, mode);
        expect(formatted).toContain('    print(i)\n');
        expect(formatted).toContain('`run\'');
        expect(formatted.split('\n').some((my_line) =>
            my_line.includes('`run\'') && my_line.includes('python:'))).toBe(true);
    });
});

describe('a colon prefix before mata:', () => {
    function context_at(source: string, character: number): LanguageContext {
        const tracker = new ContextTracker();
        init_tracker_from_source(tracker, source);
        return tracker.get_context_at_position({ line: 0, character });
    }

    it('reads mi xeq: mata: as Mata', () => {
        expect(context_at('mi xeq: mata: st_numscalar("n", 1)\ndisplay 2\n', 20))
            .toBe(LanguageContext.MATA);
    });

    it('reads mata: as Mata after other colon prefixes', () => {
        for (const my_prefix of [
            'mi xeq 1:', 'by g:', 'bysort g:', 'capture noisily:',
            'frame default:', 'version 18:', 'mi xeq: quietly',
        ]) {
            const source = `${my_prefix} mata: st_numscalar("n", 1)\n`;
            expect(context_at(source, my_prefix.length + 12))
                .toBe(LanguageContext.MATA);
        }
    });

    for_each_formatter_mode('keeps the line as written', (mode) => {
        for (const my_line of [
            'mi xeq: mata: st_numscalar("n", 1)', 'mi xeq 1: mata: x = 1',
            'bysort g: mata: x = 1', 'mi xeq: quietly mata: x = 1',
            'mi xeq: python: print(1)',
        ]) {
            const source = `${my_line}\ndisplay 2\n`;
            expect(format_stable(source, mode)).toBe(source);
        }
    });

    it('still reads a * after by g: as code, not a comment', () => {
        const the_types = new StataLexer().tokenize('by g: * x\n').tokens
            .map((my_token) => my_token.type);
        expect(the_types).not.toContain('COMMENT_LINE');
    });
});

describe('a comment after the end of input data', () => {
    for (const my_style of ['/* */', '//', '*']) {
        for_each_formatter_mode(`is stable when normalized to ${my_style}`, (mode) => {
            for (const my_tail of [
                '/* sample */', '// sample', '* sample', '/* a */ /* b */',
                'foo', '/* unclosed', '/* a */ foo',
            ]) {
                const source = `input x\n42\nend ${my_tail}\n`;
                const format_once = (text: string): string => {
                    const state = create_document_state(text);
                    const edits = new CodeFormatter().format_with_comment_normalization(
                        state, { tabSize: 4, insertSpaces: true },
                        {
                            ...create_formatter_config(mode).formatting,
                            normalizeCommentStyle: true,
                            preferredCommentStyle: my_style,
                        });
                    return edits[0]?.newText ?? text;
                };
                const once = format_once(source);
                expect(format_once(once)).toBe(once);
                if (my_style === '/* */' && my_tail.endsWith('*/')) {
                    expect(once).toBe(source);
                }
            }
        });
    }
});

describe('input after a one-line if condition', () => {
    it('reads the lines up to end as data', () => {
        const { parse_result } = parse('if 1 input str10 city\nParis\nend\nlist\n');
        expect(node_names(parse_result.ast.nodes)).toEqual(['if', 'list']);
        expect(context_diagnostics('if 1 input str10 city\nParis\nend\nlist\n'))
            .toEqual([]);
    });

    for_each_formatter_mode('keeps the data as written', (mode) => {
        const source = 'if 1 {\n    if 1 input str10 city\nParis\n    end\n}\nlist\n';
        expect(format_stable(source, mode)).toBe(source);
    });
});
