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

        console.log("=== Original source ===");
        console.log(source);
        console.log("\n=== Lexing ===");

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);
        console.log("Tokens:", lex_result.tokens.length);

        console.log("\n=== Parsing ===");
        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens);
        console.log("AST nodes:", parse_result.ast?.nodes.length);

        console.log("\n=== Context tracking ===");
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(lex_result.tokens, source);
        const context_ranges = context_tracker.get_all_context_ranges();
        console.log("Context ranges:", context_ranges.length);
        for (const range of context_ranges) {
            console.log(`  - ${range.context} (single_line: ${range.is_single_line})`);
            console.log(`    range: ${range.range.start.line}:${range.range.start.character} - ${range.range.end.line}:${range.range.end.character}`);
            console.log(`    start_delimiter: ${range.start_delimiter.command}`);
            console.log(`    end_delimiter: ${range.end_delimiter?.command || 'none'}`);
        }

        console.log("\n=== Formatting ===");
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
        console.log("Edits:", edits.length);

        if (edits.length > 0) {
            console.log(`\n=== Formatted output [${mode}] ===`);
            console.log(edits[0].newText);
            
            // The formatted output should contain all the original statements
            expect(edits[0].newText).toContain('run programs.do');
            expect(edits[0].newText).toContain('mata: aww_init_matrices()');
            expect(edits[0].newText).toContain('confirmdir "output"');
            expect(edits[0].newText).toContain('mkdir "output"');
        }
    });
});
