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
        
        // Debug: show what changed
        const source_lines = source.split('\n');
        const formatted_lines = formatted.split('\n');
        
        console.log('\n=== Comparison ===');
        for (let i = 0; i < Math.max(source_lines.length, formatted_lines.length); i++) {
            const orig = source_lines[i] || '';
            const fmt = formatted_lines[i] || '';
            if (orig !== fmt) {
                console.log(`Line ${i + 1} CHANGED:`);
                console.log(`  Original:  "${orig.replace(/\t/g, '→')}"`);
                console.log(`  Formatted: "${fmt.replace(/\t/g, '→')}"`);
            }
        }
        
        // The formatted output should preserve the spacing between code and ///
        expect(formatted).toBe(source);
    });
    

});
