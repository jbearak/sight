import { describe, it, expect } from 'bun:test';
import { StataParser } from '../src/parser';
import { StataLexer } from '../src/lexer';

describe('Subscript notation in if-qualifier - Issue reproduction', () => {
    function parse_and_get_errors(code: string) {
        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(code);
        const parser = new StataParser();
        const result = parser.parse(lex_result.tokens);
        return result.errors;
    }

    it('should NOT flag subscript notation in if-qualifier as stray token', () => {
        // This is the problematic case from the issue
        const code = `list month state count total_check ReportsToID category_measure if total_check != total_check[_n-1] & _n != 1`;
        const errors = parse_and_get_errors(code);
        
        // Filter for stray token errors
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript notation in standalone assert', () => {
        // This works according to the user
        const code = `assert total_check == total_check[_n-1] | _n == 1`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript on LHS of comparison in if-qualifier', () => {
        const code = `list x if x[_n-1] == 1`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript on RHS of comparison in if-qualifier', () => {
        const code = `list x if x == y[_n-1]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag _n subscript reference', () => {
        const code = `gen x = y[_n-1]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript with _N (total observations)', () => {
        const code = `list x if x == y[_N]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript with numeric index', () => {
        const code = `list x if x == y[1]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag subscript with expression', () => {
        const code = `list x if x == y[_n - 5]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should NOT flag multiple subscripts in condition', () => {
        const code = `list x if x[_n-1] == y[_n-1]`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(0);
    });

    it('should still detect actual stray tokens after subscript expression', () => {
        // This should still be flagged - 'oops' is a stray token
        const code = `list x if x == y[_n-1] oops`;
        const errors = parse_and_get_errors(code);
        
        const stray_errors = errors.filter(e => e.message.includes('Unexpected token'));
        console.log('Errors:', stray_errors.map(e => e.message));
        
        expect(stray_errors).toHaveLength(1);
        expect(stray_errors[0].message).toContain('oops');
    });
});
