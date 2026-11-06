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
});
