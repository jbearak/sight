import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';

/**
 * Property tests for lexer brace-depth tracking in nested global macros.
 * 
 * **Feature: nested-macro-invalid-char-false-positive**
 * **Property 6: Lexer Brace-Depth Tracking**
 * **Property 7: Lexer Mixed Nesting**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

// Generator for valid macro identifier characters
const macro_identifier_char = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

// Generator for nested braced global macros at various depths
function arbitrary_nested_braced_global(max_depth: number = 4): fc.Arbitrary<string> {
    return fc.integer({ min: 1, max: max_depth }).chain(depth => {
        // Generate identifiers for each level
        return fc.array(macro_identifier_char, { minLength: depth, maxLength: depth }).map(identifiers => {
            // Build nested structure: ${a${b${c}}}
            let result = '';
            for (let i = 0; i < depth; i++) {
                result += '${' + identifiers[i];
            }
            // Close all braces
            result += '}'.repeat(depth);
            return result;
        });
    });
}

// Generator for braced global with nested local macro
function arbitrary_braced_global_with_local(): fc.Arbitrary<string> {
    return fc.tuple(macro_identifier_char, macro_identifier_char).map(([outer, inner]) => {
        return "${" + outer + "`" + inner + "'}";
    });
}

// Generator for mixed nesting (braced global containing both local and braced global)
function arbitrary_mixed_nested_global(): fc.Arbitrary<string> {
    return fc.tuple(
        macro_identifier_char,
        macro_identifier_char,
        macro_identifier_char
    ).map(([a, b, c]) => {
        // ${a`b'${c}}
        return "${" + a + "`" + b + "'${" + c + "}}";
    });
}

describe('Nested Global Macro Lexer Property Tests', () => {
    /**
     * Property 6: Lexer Brace-Depth Tracking
     * 
     * *For any* braced global macro reference containing nested braces like `${a${b}}` 
     * or `${a${b${c}}}`, the lexer SHALL return a single MACRO_REF_GLOBAL token 
     * containing the entire expression including all nested braces.
     * 
     * **Validates: Requirements 4.1, 4.3, 4.4**
     */
    it('should tokenize nested braced globals as single MACRO_REF_GLOBAL tokens', () => {
        fc.assert(
            fc.property(
                arbitrary_nested_braced_global(5),
                (nested_global) => {
                    const lexer = new StataLexer();
                    const result = lexer.tokenize(nested_global);
                    
                    // Filter out EOF token
                    const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
                    
                    // Should be exactly one token
                    if (non_eof_tokens.length !== 1) {
                        console.log(`Expected 1 token, got ${non_eof_tokens.length} for: ${nested_global}`);
                        console.log('Tokens:', non_eof_tokens.map(t => `${t.type}: ${t.value}`));
                        return false;
                    }
                    
                    // Should be MACRO_REF_GLOBAL
                    if (non_eof_tokens[0].type !== 'MACRO_REF_GLOBAL') {
                        console.log(`Expected MACRO_REF_GLOBAL, got ${non_eof_tokens[0].type} for: ${nested_global}`);
                        return false;
                    }
                    
                    // Value should match the input
                    if (non_eof_tokens[0].value !== nested_global) {
                        console.log(`Expected value "${nested_global}", got "${non_eof_tokens[0].value}"`);
                        return false;
                    }
                    
                    // Should have no errors
                    if (result.errors.length > 0) {
                        console.log(`Unexpected errors for: ${nested_global}`);
                        console.log('Errors:', result.errors);
                        return false;
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6 continued: No orphan braces
     * 
     * *For any* nested braced global macro, the lexer SHALL NOT produce any RBRACE tokens.
     * 
     * **Validates: Requirements 4.4**
     */
    it('should not produce orphan RBRACE tokens for nested braced globals', () => {
        fc.assert(
            fc.property(
                arbitrary_nested_braced_global(5),
                (nested_global) => {
                    const lexer = new StataLexer();
                    const result = lexer.tokenize(nested_global);
                    
                    // Should have no RBRACE tokens
                    const rbrace_tokens = result.tokens.filter(t => t.type === 'RBRACE');
                    if (rbrace_tokens.length > 0) {
                        console.log(`Found ${rbrace_tokens.length} orphan RBRACE tokens for: ${nested_global}`);
                        return false;
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Lexer Mixed Nesting
     * 
     * *For any* braced global macro reference containing nested local macros like `${a`b'}`,
     * the lexer SHALL correctly track both brace depth and backtick/apostrophe nesting,
     * returning a single complete token.
     * 
     * **Validates: Requirements 4.2**
     */
    it('should tokenize braced globals with nested locals as single tokens', () => {
        fc.assert(
            fc.property(
                arbitrary_braced_global_with_local(),
                (mixed_macro) => {
                    const lexer = new StataLexer();
                    const result = lexer.tokenize(mixed_macro);
                    
                    // Filter out EOF token
                    const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
                    
                    // Should be exactly one token
                    if (non_eof_tokens.length !== 1) {
                        console.log(`Expected 1 token, got ${non_eof_tokens.length} for: ${mixed_macro}`);
                        console.log('Tokens:', non_eof_tokens.map(t => `${t.type}: ${t.value}`));
                        return false;
                    }
                    
                    // Should be MACRO_REF_GLOBAL
                    if (non_eof_tokens[0].type !== 'MACRO_REF_GLOBAL') {
                        console.log(`Expected MACRO_REF_GLOBAL, got ${non_eof_tokens[0].type} for: ${mixed_macro}`);
                        return false;
                    }
                    
                    // Value should match the input
                    if (non_eof_tokens[0].value !== mixed_macro) {
                        console.log(`Expected value "${mixed_macro}", got "${non_eof_tokens[0].value}"`);
                        return false;
                    }
                    
                    // Should have no errors
                    if (result.errors.length > 0) {
                        console.log(`Unexpected errors for: ${mixed_macro}`);
                        console.log('Errors:', result.errors);
                        return false;
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7 continued: Mixed nesting with both local and braced global
     * 
     * *For any* braced global containing both local macros and nested braced globals,
     * the lexer SHALL correctly handle both nesting types.
     * 
     * **Validates: Requirements 4.2**
     */
    it('should tokenize mixed nesting (local + braced global) as single tokens', () => {
        fc.assert(
            fc.property(
                arbitrary_mixed_nested_global(),
                (mixed_macro) => {
                    const lexer = new StataLexer();
                    const result = lexer.tokenize(mixed_macro);
                    
                    // Filter out EOF token
                    const non_eof_tokens = result.tokens.filter(t => t.type !== 'EOF');
                    
                    // Should be exactly one token
                    if (non_eof_tokens.length !== 1) {
                        console.log(`Expected 1 token, got ${non_eof_tokens.length} for: ${mixed_macro}`);
                        console.log('Tokens:', non_eof_tokens.map(t => `${t.type}: ${t.value}`));
                        return false;
                    }
                    
                    // Should be MACRO_REF_GLOBAL
                    if (non_eof_tokens[0].type !== 'MACRO_REF_GLOBAL') {
                        console.log(`Expected MACRO_REF_GLOBAL, got ${non_eof_tokens[0].type} for: ${mixed_macro}`);
                        return false;
                    }
                    
                    // Value should match the input
                    if (non_eof_tokens[0].value !== mixed_macro) {
                        console.log(`Expected value "${mixed_macro}", got "${non_eof_tokens[0].value}"`);
                        return false;
                    }
                    
                    // Should have no errors
                    if (result.errors.length > 0) {
                        console.log(`Unexpected errors for: ${mixed_macro}`);
                        console.log('Errors:', result.errors);
                        return false;
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
