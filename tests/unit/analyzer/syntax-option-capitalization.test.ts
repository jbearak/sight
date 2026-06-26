/**
 * Stata's `syntax` command lets option names use mixed case to declare a
 * minimum abbreviation (e.g. `Cache(string)` allows `cache(...)`, `Cac(...)`,
 * `Ca(...)`, `C(...)`). At runtime, the implicit local Stata creates is the
 * lowercase form of the option name. References like `` `cache' `` therefore
 * must not be flagged as undefined inside the program body.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SemanticAnalyzer } from '../../../src/analyzer/index';
import { StataLexer } from '../../../src/lexer';
import { StataParser } from '../../../src/parser';
import { StataDiagnosticCode } from '../../../src/types';

describe('Syntax option capitalization → implicit locals', () => {
    let my_analyzer: SemanticAnalyzer;
    let my_lexer: StataLexer;
    let my_parser: StataParser;

    beforeEach(() => {
        my_analyzer = new SemanticAnalyzer();
        my_lexer = new StataLexer();
        my_parser = new StataParser();
    });

    function analyze_document(my_source: string) {
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);
        return my_analyzer.analyze(
            my_parse_result.ast,
            'file:///test.do',
            undefined,
            { undefined_macro_enabled: true },
            my_lex_result.tokens
        );
    }

    function undefined_macro_messages(my_source: string): string[] {
        const my_result = analyze_document(my_source);
        return my_result.diagnostics
            .filter((my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO)
            .map((my_diag) => my_diag.message);
    }

    it('treats Cache(string) as defining a local named `cache`', () => {
        const my_source = `program define format_wpp_5yr
    syntax, Cache(string) Prefix(string) Outpath(string) [Suffix(string)]
    display "\`cache'"
    display "\`prefix'"
    display "\`outpath'"
    display "\`suffix'"
end`;
        expect(undefined_macro_messages(my_source)).toEqual([]);
    });

    it('still treats lowercase option names normally', () => {
        const my_source = `program define lower
    syntax, cache(string)
    display "\`cache'"
end`;
        expect(undefined_macro_messages(my_source)).toEqual([]);
    });

    it('treats fully uppercase options as defining a lowercase local', () => {
        const my_source = `program define upper
    syntax, OUT(string)
    display "\`out'"
end`;
        expect(undefined_macro_messages(my_source)).toEqual([]);
    });

    it('still flags references that use the wrong case (Stata is case-sensitive)', () => {
        // Stata only creates the lowercase implicit local. A reference to
        // \`Cache' (with capitals) is genuinely undefined and must still
        // produce a diagnostic — this guards against accidentally registering
        // both casings.
        const my_source = `program define wrong_case
    syntax, Cache(string)
    display "\`Cache'"
end`;
        expect(undefined_macro_messages(my_source)).toEqual([
            "\`Cache' is not defined",
        ]);
    });
});
