import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
} from '../property/helpers/formatter-test-utils';

/** Parse a fixture and fail the test on lexer or parser errors. */
function parse(source: string) {
    const lex = new StataLexer().tokenize(source);
    const result = new StataParser().parse(lex.tokens);
    expect(lex.errors).toEqual([]);
    expect(result.errors).toEqual([]);
    return { ...result, tokens: lex.tokens };
}

describe('single-statement if', () => {
    const the_conditions = [
        '(1)',
        'flag == 2',
        '(flag == 2) | (flag == 3)',
        'inlist(flag, 2, 3)',
        'flag[_n - 1] == 2',
        '!missing(flag)',
        'r(N) > 0',
        'e(b)[1, 2] > 0',
        'flag < .a',
        'flag < .',
        '(flag == 2) + 1 > 0',
        'L.flag',
        'F2.flag == 1',
        'D.flag > 0',
        'L2D.flag',
        'αβ',
        '`flag\' == 2',
        '`prefix\'_flag == 2',
        '"`flag\'" == "yes"',
        '`"text `flag\' more"\' == "yes"',
    ];

    for (const my_condition of the_conditions) {
        it(`separates the body after ${my_condition}`, () => {
            const { ast } = parse(
                `if ${my_condition} local wide_var cm13\ndisplay 1\n`
            );
            expect(ast.nodes).toHaveLength(2);
            expect(ast.nodes[0]).toMatchObject({
                type: 'if',
                condition: my_condition,
                body: [{ type: 'macro_def', name: 'wide_var' }],
                range: { end: { line: 0 } },
            });
        });
    }

    it('preserves brace conditions containing macro-supplied operators', () => {
        const { ast } = parse([
            'local op ==',
            'if flag `op\' 1 {',
            '    local selected yes',
            '}',
        ].join('\n'));
        expect(ast.nodes[1]).toMatchObject({
            type: 'if', condition: 'flag `op\' 1',
            body: [{ type: 'macro_def', name: 'selected' }],
        });
    });

    for (const my_language of ['mata', 'python']) {
        it(`parses a ${my_language} inline command as the body`, () => {
            const { ast } = parse([
                `if (1) ${my_language}: print(1)`,
                'display 2',
            ].join('\n'));
            expect(ast.nodes[0]).toMatchObject({
                type: 'if', condition: '(1)',
                body: [{
                    type: 'embedded_block', language: my_language,
                    is_single_line: true,
                }],
            });
            expect(ast.nodes).toHaveLength(2);
        });
    }

    for (const my_indent of ['', '    ']) {
        it(`separates a continued body with ${my_indent.length} spaces`, () => {
            const { ast } = parse(
                `if (1)///\n${my_indent}local selected yes\ndisplay 1`
            );
            expect(ast.nodes[0]).toMatchObject({
                type: 'if', condition: '(1)',
                body: [{ type: 'macro_def', name: 'selected' }],
            });
            expect(ast.nodes).toHaveLength(2);
        });
    }

    it('parses nested if and global definitions', () => {
        const { ast, tokens } = parse([
            'if 1 if 2 global result yes',
            'display "$result"',
        ].join('\n'));
        expect(ast.nodes[0]).toMatchObject({
            type: 'if', condition: '1',
            body: [{ type: 'if', condition: '2', body: [{
                type: 'macro_def', name: 'result', scope: 'global',
            }] }],
        });
        const result = new SemanticAnalyzer().analyze(
            ast, 'file:///test.do', undefined, undefined, tokens
        );
        expect(result.diagnostics).toEqual([]);
    });

    const the_outer_conditions = [
        '1', '(1)', '`enabled\'', 'flag `op\' 1', '`prefix\'if',
    ];
    for (const my_condition of the_outer_conditions) {
        it(`assigns the nested brace after ${my_condition} to the inner if`, () => {
            const { ast } = parse([
                `if ${my_condition} if 2 {`,
                '    local selected yes',
                '}',
                'display "`selected\'"',
            ].join('\n'));
            expect(ast.nodes[0]).toMatchObject({
                type: 'if', condition: my_condition, is_single_statement: true,
                body: [{ type: 'if', condition: '2', body: [{
                    type: 'macro_def', name: 'selected',
                }] }],
            });
            expect(ast.nodes).toHaveLength(2);
        });
    }

    it('does not treat uppercase Local as a macro definition', () => {
        const { ast } = parse('if 1 Local result yes');
        expect(ast.nodes[0]).toMatchObject({
            type: 'if', condition: '1',
            body: [{ type: 'command', name: 'Local' }],
        });
    });

    it('keeps references in the condition before body definitions', () => {
        const { ast, tokens } = parse('if `later\' local later yes');
        const result = new SemanticAnalyzer().analyze(
            ast, 'file:///test.do', undefined, undefined, tokens
        );
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            code: StataDiagnosticCode.UNDEFINED_MACRO,
            symbol_name: 'later',
        }));
    });

    it('keeps a continued condition and semicolon-delimited body', () => {
        const { ast } = parse([
            '#delimit ;',
            'if (flag == 2) | ///',
            '    (flag == 3)',
            '    local wide_var cm13;',
            'display 1;',
        ].join('\n'));
        expect(ast.nodes[1]).toMatchObject({
            type: 'if',
            condition: '(flag == 2) | (flag == 3)',
            body: [{ type: 'macro_def', name: 'wide_var' }],
            range: { end: { line: 3 } },
        });
        expect(ast.nodes).toHaveLength(3);
    });

    it('recognizes definitions without hiding genuine undefined references', () => {
        const source = [
            'if (flag == 2) local wide_var cm13',
            'if (flag == 3) local wide_var cm17',
            'if ("`wide_var\'" != "") {',
            '    local wide_lab : variable label `wide_var\'',
            '}',
            'display "`wide_var\' `wide_lab\' `missing\'"',
        ].join('\n');
        const { ast, tokens } = parse(source);
        const result = new SemanticAnalyzer().analyze(
            ast, 'file:///test.do', undefined, undefined, tokens
        );
        expect(result.diagnostics.filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
        ).map((my_diagnostic) => my_diagnostic.symbol_name)).toEqual([
            'missing',
        ]);
    });

    it('keeps program-local definitions inside their program scope', () => {
        const { ast, tokens } = parse([
            'program define example',
            '    if 1 local inner yes',
            '    display "`inner\'"',
            'end',
            'display "`inner\'"',
        ].join('\n'));
        const result = new SemanticAnalyzer().analyze(
            ast, 'file:///test.do', undefined, undefined, tokens
        );
        const undefined_refs = result.diagnostics.filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        expect(undefined_refs).toHaveLength(1);
        expect(undefined_refs[0].range.start.line).toBe(4);
    });

    for_each_formatter_mode('preserves the condition and macro body', (mode) => {
        const source = [
            'if (flag == 2) local wide_var cm13',
            'display "`wide_var\'"',
        ].join('\n');
        const edits = new CodeFormatter().format(
            create_document_state(source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(mode)
        );
        const { ast } = parse(edits[0]?.newText ?? source);
        expect(ast.nodes).toHaveLength(2);
        expect(ast.nodes[0]).toMatchObject({
            type: 'if',
            condition: '(flag == 2)',
            body: [{ type: 'macro_def', name: 'wide_var' }],
        });
    });
});
