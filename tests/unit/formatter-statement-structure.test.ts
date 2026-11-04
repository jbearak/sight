import { describe, expect } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///statement-structure.do',
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

// Statements the parser used to split into several nodes (or truncate):
// prefixes with arguments, `by` varlists, weights, and operators after a
// varlist. Both formatters must keep each one whole on its line.
const STATEMENTS = [
    'assert x > 0',
    'display a + b',
    'svy: reg y x',
    'version 14: gen x = 1',
    'bootstrap, reps(10): reg y x',
    'reg y x if a [pw=w]',
    'gen x:lbl = 1',
    'tab x [fw=n]',
    'collapse (mean) x (sum) y [aw=w], by(g)',
    'mi estimate, dots: reg y x',
    'quietly bys id (t), sort: gen n = _n',
    'capture noisily by id: replace x = 1 if missing(x)',
    'merge m:1 id using `f\', nogen',
    'merge 1:1 id using "data`v\'.dta", keep(match)',
    'append using a b, force',
    'gettoken a b : c, parse(" ")',
    'log using "x.log", replace text',
];

describe('formatting statements with prefixes, weights, and extra arguments', () => {
    for_each_formatter_mode('re-indents each statement and keeps it whole', mode => {
        const source = ['if 1 {', ...STATEMENTS, '}', ''].join('\n');
        const expected = ['if 1 {', ...STATEMENTS.map((s) => `    ${s}`), '}', ''].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a continued varlist in one statement', mode => {
        const source = ['if 1 {', 'reg y x ///', '    z w, robust', '}', ''].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted.split('\n')[1]).toMatch(/^ {4}reg y x/);
        expect(formatted).toContain('z w, robust');
        expect(format_source(formatted, mode)).toBe(formatted);
    });
});
