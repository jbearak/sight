import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';

/**
 * Unit tests for lexer brace-depth tracking in nested global macros.
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
describe('Lexer: Nested Global Macro Tokenization', () => {
    it('should tokenize ${one${two}} as a single MACRO_REF_GLOBAL token', () => {
        const source = '${one${two}}';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        // Filter out EOF token
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe('${one${two}}');
        expect(result.errors.length).toBe(0);
    });

    it('should tokenize ${a${b${c}}} as a single MACRO_REF_GLOBAL token', () => {
        const source = '${a${b${c}}}';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe('${a${b${c}}}');
        expect(result.errors.length).toBe(0);
    });

    it('should tokenize ${one`two\'} as a single MACRO_REF_GLOBAL token', () => {
        const source = "${one`two'}";
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe("${one`two'}");
        expect(result.errors.length).toBe(0);
    });

    it('should tokenize ${a`b\'${c}} with mixed nesting as a single token', () => {
        const source = "${a`b'${c}}";
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe("${a`b'${c}}");
        expect(result.errors.length).toBe(0);
    });

    it('should not produce orphan closing brace for ${one${two}}', () => {
        const source = '${one${two}}';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        // Check that there's no RBRACE token
        const rbrace_tokens = result.tokens.filter(t => t.type === 'RBRACE');
        expect(rbrace_tokens.length).toBe(0);
    });

    it('should handle simple ${name} without nesting', () => {
        const source = '${simple}';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe('${simple}');
        expect(result.errors.length).toBe(0);
    });

    it('should handle $name without braces', () => {
        const source = '$simple';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe('$simple');
        expect(result.errors.length).toBe(0);
    });

    it('should handle deeply nested braces ${a${b${c${d}}}}', () => {
        const source = '${a${b${c${d}}}}';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe('${a${b${c${d}}}}');
        expect(result.errors.length).toBe(0);
    });

    it('should handle local macro with apostrophe inside braced global', () => {
        // The apostrophe inside the local macro should not interfere with brace tracking
        const source = "${outer`inner'}";
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
        
        expect(non_eof_tokens.length).toBe(1);
        expect(non_eof_tokens[0].type).toBe('MACRO_REF_GLOBAL');
        expect(non_eof_tokens[0].value).toBe("${outer`inner'}");
        expect(result.errors.length).toBe(0);
    });
});
