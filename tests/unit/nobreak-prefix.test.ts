/**
 * `nobreak` and `break` are prefixes, like `capture`: each takes a
 * command or a `{ }` block. Checked in StataMP 18: `nobreak {`,
 * `break {` and `capture noisily break {` open blocks whose locals are
 * visible after the `}`; `nobreak * note` is a comment; `nobrea`,
 * `brea` and `NOBREAK` are unrecognized commands.
 */

import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { detect_completion_context } from '../../src/providers/completion';
import { LiteralMacroAdjacencyAnalyzer } from '../../src/providers/literal-macro-adjacency-diagnostics';
import { OperatorSequenceAnalyzer } from '../../src/providers/operator-sequence-diagnostics';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode, StataNode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';
import { create_document_state } from '../property/helpers/document-utils';

function parse(source: string): StataNode[] {
    const the_tokens = new StataLexer().tokenize(source).tokens;
    return new StataParser().parse(the_tokens).ast.nodes;
}

function analyzer_codes(source: string): string[] {
    const lex_result = new StataLexer().tokenize(source);
    const ast = new StataParser().parse(lex_result.tokens).ast;
    return new SemanticAnalyzer()
        .analyze(ast, 'file:///t.do', undefined,
            { undefined_macro_enabled: true }, lex_result.tokens)
        .diagnostics
        .map((my_diag) => `${my_diag.range.start.line + 1} ${String(my_diag.code)}`);
}

function format_source(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        { tabSize: 4, insertSpaces: true },
        create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

describe('nobreak and break prefixes', () => {
    it('reads nobreak { as a prefix block', () => {
        const [node] = parse('nobreak {\n    local rc = _rc\n}\n');
        expect(node?.type).toBe('command');
        if (node?.type !== 'command') return;
        expect(node.prefix?.map((my_prefix) => my_prefix.fullName))
            .toEqual(['nobreak']);
        expect(node.closed_by_brace).toBe(true);
    });

    it('keeps locals set in the block visible after it', () => {
        const source = [
            'program p',
            '    nobreak {',
            '        local rc = _rc',
            '    }',
            '    capture noisily break {',
            '        local q 1',
            '    }',
            '    break local t 2',
            '    display "`rc\' `q\' `t\'"',
            'end',
        ].join('\n');
        const the_codes = analyzer_codes(source);
        expect(the_codes.filter((my_code) =>
            my_code.endsWith(StataDiagnosticCode.UNDEFINED_MACRO)))
            .toEqual([]);
    });

    it('reads * after nobreak or break as a comment', () => {
        const the_types = new StataLexer().tokenize('nobreak * note\nbreak * note\n')
            .tokens.map((my_token) => my_token.type);
        expect(the_types.filter((my_type) => my_type === 'COMMENT_LINE'))
            .toHaveLength(2);
    });

    it('takes no abbreviation and matches case exactly', () => {
        for (const my_word of ['nobrea', 'brea', 'NOBREAK']) {
            const [node] = parse(`${my_word} display 1\n`);
            expect(node?.type).toBe('command');
            if (node?.type !== 'command') return;
            expect(node.prefix ?? []).toEqual([]);
            expect(node.name).toBe(my_word);
        }
    });

    for_each_formatter_mode('indents the block body', (mode) => {
        const source = 'program p\nnobreak {\nlocal rc = _rc\n}\nend\n';
        expect(format_source(source, mode)).toBe(
            'program p\n    nobreak {\n        local rc = _rc\n    }\nend\n');
    });

    describe('in the other places that skip prefixes', () => {
        it('defines a constructed local behind the prefix in a loop', () => {
            const source = [
                'forvalues i = 1/2 {',
                '    nobreak local v`i\' = 1',
                '    break local w`i\' = 1',
                '}',
                'display "`v1\' `w2\'"',
            ].join('\n');
            expect(analyzer_codes(source).filter((my_code) =>
                my_code.endsWith(StataDiagnosticCode.UNDEFINED_MACRO)))
                .toEqual([]);
        });

        it('reads assert after the prefix as a command', () => {
            const found = (source: string) => new LiteralMacroAdjacencyAnalyzer()
                .analyze(create_document_state(source), DEFAULT_SETTINGS)
                .filter((my_diag) =>
                    my_diag.code === StataDiagnosticCode.LITERAL_MACRO_ADJACENCY);
            expect(found("capture assert 1`b'")).toHaveLength(1);
            expect(found("nobreak assert 1`b'")).toHaveLength(1);
            expect(found("break assert 1`b'")).toHaveLength(1);
        });

        it('completes a command after the prefix, and the options of the command after it', () => {
            for (const my_source of ['nobreak ', 'break ']) {
                const context = detect_completion_context(
                    create_document_state(my_source),
                    { line: 0, character: my_source.length });
                expect(context.type).toBe('command');
            }
            const source = 'break regress y x, ';
            const context = detect_completion_context(
                create_document_state(source),
                { line: 0, character: source.length });
            expect(context.type).toBe('option');
            if (context.type === 'option') {
                expect(context.command).toBe('regress');
            }
        });

        it('keeps the mixed-model || separator valid after the prefix', () => {
            const analyzer = new OperatorSequenceAnalyzer();
            for (const my_prefix of ['nobreak', 'break', 'capture nobreak']) {
                expect(analyzer.analyze(
                    create_document_state(`${my_prefix} mixed y x || id:`),
                    DEFAULT_SETTINGS)).toHaveLength(0);
            }
        });
    });
});
