/**
 * Property test: formatting a file that ends under `#delimit ;` keeps
 * its final newline, and formatting again changes nothing.
 *
 * Under `#delimit ;` a line break is whitespace, not a token, so the
 * source-preserving formatter, which rebuilds the file from tokens,
 * used to drop the line breaks after the last `;`.
 */

import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import { create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { arbitrary_non_reserved_identifier } from './generators';
import {
    create_formatter_config,
    for_each_formatter_mode_property,
    FormatterMode,
} from './helpers/formatter-test-utils';

function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    const edits = new CodeFormatter().format({
        uri: 'file:///delimit-final-newline.do',
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

/** One `;`-terminated line: a command, or a comment after the last one. */
const arbitrary_statement = fc.oneof(
    arbitrary_non_reserved_identifier().map(name => `display "${name}";`),
    arbitrary_non_reserved_identifier().map(name => `local ${name} = 1;`),
    arbitrary_non_reserved_identifier().map(name => `display 1 // ${name}\n    2;`),
);

const arbitrary_tail = fc.constantFrom('', '// tail', '/* tail */');

const arbitrary_source = fc
    .tuple(fc.array(arbitrary_statement, { minLength: 1, maxLength: 5 }), arbitrary_tail)
    .map(([the_statements, tail]) =>
        ['#delimit ;', ...the_statements, ...(tail ? [tail] : [])].join('\n') + '\n');

describe('formatting under #delimit ;', () => {
    for_each_formatter_mode_property(
        'keeps the final newline and is idempotent',
        arbitrary_source,
        (mode, source) => {
            const formatted = format_source(source, mode);
            expect(formatted.endsWith(';\n') || formatted.endsWith('tail\n') ||
                formatted.endsWith('tail */\n')).toBe(true);
            expect(formatted.endsWith('\n\n')).toBe(false);
            expect(format_source(formatted, mode)).toBe(formatted);
        },
        50
    );
});
