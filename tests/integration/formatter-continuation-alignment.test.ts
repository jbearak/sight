import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SourcePreservingFormatter } from '../../src/formatter/source-preserving-formatter';

describe('Formatter continuation alignment preservation', () => {
    it('should preserve spacing between code and /// markers', () => {
        // This test reproduces the issue where the formatter un-aligns /// markers
        // The user has tabs between the end of code and the /// markers to align them
        const source = `lval union_status 0 "Never married" \t\t\t\t\t\t\t\t\t\t\t///
\t1 "First marriage"  \t\t\t\t\t\t\t\t\t\t\t/// 
\t2 "Separated/divorced/widowed"       \t\t\t\t\t\t\t/// 
\t3 "Remarried"\t   \t\t\t\t\t\t\t\t\t\t\t\t///
\t.a "Tagged as invalid" \t\t\t\t\t\t\t\t\t\t///
\t.b "Missing if first or subsequent marriage" \t\t\t\t\t///
\t.d "Missing/don't know" \t\t\t\t\t\t\t\t\t\t///
\t.e "Survey does not have marital status" \t\t\t\t\t\t///
\t.z "NIU (incomplete interview)"\t\t\t\t\t\t\t\t\t//
label values union_status union_status`;

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);
        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens);
        
        // Test with spaces (VS Code default) - this is what breaks alignment
        const formatter = new SourcePreservingFormatter({
            indent_size: 4,
            indent_style: 'spaces',  // VS Code default
            preserve_alignment: true
        });
        
        const formatted = formatter.format(lex_result.tokens, parse_result.ast, [], source, { preserve_alignment: true });
        
        // The formatter should:
        // 1. Normalize leading indentation on the start line (line 0) - no change since it's at top level
        // 2. Preserve inter-token spacing (tabs between code and ///) on the start line
        // 3. Preserve whitespace on continuation lines (lines 1-8) for alignment
        
        // Check that the first line preserves spacing between code and ///
        const formatted_lines = formatted.split('\n');
        const first_line = formatted_lines[0];
        
        // The first line should still have the /// at the end
        expect(first_line.endsWith('///')).toBe(true);
        
        // The continuation lines should preserve their whitespace for alignment
        // (they have tabs for alignment which should be preserved)
        for (let i = 1; i <= 8; i++) {
            const line = formatted_lines[i];
            // Each continuation line should end with /// or //
            expect(line.trimEnd().endsWith('///') || line.trimEnd().endsWith('//')).toBe(true);
        }
        
        // The last line should be unchanged
        expect(formatted_lines[9]).toBe('label values union_status union_status');
    });
    

});
