import { describe, test, expect } from 'bun:test';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { ContextTracker } from '../src/context-tracker';
import { CodeFormatter } from '../src/providers/formatter';
import { for_each_formatter_mode, create_formatter_config } from './property/helpers/formatter-test-utils';

describe('Mata inline formatter bug reproduction', () => {
    for_each_formatter_mode('formatter should preserve code after mata: inline call', (mode) => {
        const source = `run programs.do
mata: aww_init_matrices()

// We next make sure the output folders exist
confirmdir "output"
if (_rc == 170) {
    mkdir "output"
}`;

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);

        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens);

        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(lex_result.tokens, source);
        const context_ranges = context_tracker.get_all_context_ranges();

        const config = create_formatter_config(mode);
        const formatter = new CodeFormatter(config);
        const document_state = {
            content: source,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            line_offsets: lex_result.line_offsets,
            context_ranges: context_ranges,
        };

        const edits = formatter.format(document_state as any, { tabSize: 4, insertSpaces: true });

        if (edits.length > 0) {
            
            // The formatted output should contain all the original statements
            expect(edits[0].newText).toContain('run programs.do');
            expect(edits[0].newText).toContain('mata: aww_init_matrices()');
            expect(edits[0].newText).toContain('confirmdir "output"');
            expect(edits[0].newText).toContain('mkdir "output"');
        }
    });

    for_each_formatter_mode(
        'formatter preserves a #delimit ; multiline inline mata statement (issue #309)',
        (mode) => {
            const source = `#delimit ;
mata: st_local("b",
"2");
#delimit cr
display "done"
`;

            const lexer = new StataLexer();
            const lex_result = lexer.tokenize(source);
            const parser = new StataParser();
            const parse_result = parser.parse(lex_result.tokens);

            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lex_result.tokens, source);
            const context_ranges = context_tracker.get_all_context_ranges();

            const config = create_formatter_config(mode);
            const formatter = new CodeFormatter(config);
            const document_state = {
                content: source,
                tokens: lex_result.tokens,
                ast: parse_result.ast,
                line_offsets: lex_result.line_offsets,
                context_ranges: context_ranges,
            };

            const edits = formatter.format(document_state as any, {
                tabSize: 4,
                insertSpaces: true,
            });

            expect(edits.length).toBeGreaterThan(0);
            const out = edits[0].newText;
            // Content preserved: both continuation lines survive intact and
            // the terminator is not duplicated or dropped.
            expect(out).toContain('mata: st_local("b",');
            expect(out).toContain('"2");');
            expect(out).not.toContain('"2");;');
            expect(out).toContain('display "done"');
        }
    );

    for_each_formatter_mode(
        'formatter preserves a bare `end` continuation line of a #delimit ; inline mata (issue #309)',
        (mode) => {
            // A continuation line trimming to exactly `end` must not be
            // reindented as a block terminator: inline ranges have no `end`.
            const source = `#delimit ;
mata: foo(bar,
end
) ;
#delimit cr
`;

            const lexer = new StataLexer();
            const lex_result = lexer.tokenize(source);
            const parser = new StataParser();
            const parse_result = parser.parse(lex_result.tokens);

            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lex_result.tokens, source);
            const context_ranges = context_tracker.get_all_context_ranges();

            const config = create_formatter_config(mode);
            const formatter = new CodeFormatter(config);
            const document_state = {
                content: source,
                tokens: lex_result.tokens,
                ast: parse_result.ast,
                line_offsets: lex_result.line_offsets,
                context_ranges: context_ranges,
            };

            const edits = formatter.format(document_state as any, {
                tabSize: 4,
                insertSpaces: true,
            });

            expect(edits.length).toBeGreaterThan(0);
            const out = edits[0].newText;
            expect(out).toContain('mata: foo(bar,');
            expect(out).toContain('end');
            expect(out).toContain(') ;');
        }
    );

    for_each_formatter_mode(
        'formatter does not drop a trailing inline statement overlapping the terminator line (issue #309)',
        (mode) => {
            // The mata range (lines 1-2) and the trailing python range
            // (lines 2-3) overlap on line 2. The formatter must not
            // double-replace line 2 and drop the python continuation.
            const source = `#delimit ;
mata: st_local("b",
"2"); python: x = (1+
2);
#delimit cr
display "done"
`;

            const lexer = new StataLexer();
            const lex_result = lexer.tokenize(source);
            const parser = new StataParser();
            const parse_result = parser.parse(lex_result.tokens);

            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lex_result.tokens, source);
            const context_ranges = context_tracker.get_all_context_ranges();

            const config = create_formatter_config(mode);
            const formatter = new CodeFormatter(config);
            const document_state = {
                content: source,
                tokens: lex_result.tokens,
                ast: parse_result.ast,
                line_offsets: lex_result.line_offsets,
                context_ranges: context_ranges,
            };

            const edits = formatter.format(document_state as any, {
                tabSize: 4,
                insertSpaces: true,
            });

            expect(edits.length).toBeGreaterThan(0);
            const out = edits[0].newText;
            // No source text lost: the mata half and both continuation lines survive.
            expect(out).toContain('st_local("b",');
            expect(out).toContain('x = (1+');
            expect(out).toContain('2);');
            expect(out).toContain('display "done"');
        }
    );

    for_each_formatter_mode(
        'formatter preserves indentation of a trailing inline statement sharing the opener line (issue #309)',
        (mode) => {
            // mata: foo(); python: x = (1+ ... shares the OPENER line: the mata
            // range (line 1) and the wider python range (lines 1-2) share their
            // start line. The wider (python) range must be kept so the indented
            // continuation line is preserved verbatim, not reindented.
            const source = `#delimit ;
mata: foo(); python: x = (1+
    2);
#delimit cr
`;

            const lexer = new StataLexer();
            const lex_result = lexer.tokenize(source);
            const parser = new StataParser();
            const parse_result = parser.parse(lex_result.tokens);

            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lex_result.tokens, source);
            const context_ranges = context_tracker.get_all_context_ranges();

            const config = create_formatter_config(mode);
            const formatter = new CodeFormatter(config);
            const document_state = {
                content: source,
                tokens: lex_result.tokens,
                ast: parse_result.ast,
                line_offsets: lex_result.line_offsets,
                context_ranges: context_ranges,
            };

            const edits = formatter.format(document_state as any, {
                tabSize: 4,
                insertSpaces: true,
            });

            expect(edits.length).toBeGreaterThan(0);
            const out = edits[0].newText;
            // The embedded continuation line keeps its original indentation.
            expect(out).toContain('    2);');
            expect(out).toContain('mata: foo(); python: x = (1+');
        }
    );

    // Source-preserving mode only: the AST formatter ignores context ranges
    // (it prints embedded_block nodes directly) and has unrelated pre-existing
    // #delimit ; pretty-printer artifacts.
    test('preserves indentation of overlapping inline ranges nested in a block (issue #309)', () => {
        // mata range (lines 2-3) and python range (lines 3-4) overlap on line
        // 3 with DIFFERENT start lines; neither contains the other. Coalescing
        // them into one verbatim span preserves every line's indentation,
        // including mata's own opener line, rather than leaving it reindented.
        const source = `foreach x in 1 2 {
    #delimit ;
    mata: st_local("b",
    "2"); python: x = (1+
    2);
    #delimit cr
}
`;

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);
        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens);

        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(lex_result.tokens, source);
        const context_ranges = context_tracker.get_all_context_ranges();

        const formatter = new CodeFormatter(create_formatter_config('source-preserving'));
        const document_state = {
            content: source,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            line_offsets: lex_result.line_offsets,
            context_ranges: context_ranges,
        };

        const edits = formatter.format(document_state as any, {
            tabSize: 4,
            insertSpaces: true,
        });

        expect(edits.length).toBeGreaterThan(0);
        const out = edits[0].newText;
        // Every embedded line keeps its 4-space indentation; none is mangled.
        expect(out).toContain('    mata: st_local("b",');
        expect(out).toContain('    "2"); python: x = (1+');
        expect(out).toContain('    2);');
    });
});
