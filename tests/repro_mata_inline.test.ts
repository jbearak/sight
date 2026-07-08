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

            if (edits.length > 0) {
                const out = edits[0].newText;
                // Content preserved: both continuation lines survive intact and
                // the terminator is not duplicated or dropped.
                expect(out).toContain('mata: st_local("b",');
                expect(out).toContain('"2");');
                expect(out).not.toContain('"2");;');
                expect(out).toContain('display "done"');
            }
        }
    );
});
