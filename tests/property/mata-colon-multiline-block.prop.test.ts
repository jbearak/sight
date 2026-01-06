/**
 * Property tests for mata: multiline block detection
 * 
 * Feature: mata-colon-multiline-block
 * 
 * This tests the fix for a bug where `mata:` followed by a newline was incorrectly
 * treated as a single-line inline expression (MATA_INLINE) instead of a multi-line
 * block start (MATA_START).
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer/index.ts';
import { LanguageContext } from '../../src/types/index.ts';

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate arbitrary whitespace (spaces and tabs only, no newlines)
 */
const arbitrary_whitespace = fc.stringOf(
    fc.constantFrom(' ', '\t'),
    { minLength: 0, maxLength: 5 }
);

/**
 * Generate simple Mata expressions (single line, no newlines)
 */
const arbitrary_mata_expression = fc.oneof(
    fc.constant('x = 1'),
    fc.constant('y = 2 + 3'),
    fc.constant('st_numscalar("result", 42)'),
    fc.constant('printf("hello")'),
    fc.constant('a = b * c'),
);

/**
 * Generate simple Python expressions (single line, no newlines)
 */
const arbitrary_python_expression = fc.oneof(
    fc.constant('x = 1'),
    fc.constant('print("hello")'),
    fc.constant('y = 2 + 3'),
    fc.constant('import os'),
);

/**
 * Generate line comment content (no newlines)
 */
const arbitrary_comment_content = fc.stringOf(
    fc.constantFrom('a', 'b', 'c', ' ', '1', '2'),
    { minLength: 0, maxLength: 10 }
);

// ============================================================================
// Property 1: Colon-Newline Block Start Detection
// ============================================================================

describe('Property 1: Colon-Newline Block Start Detection', () => {
    // Feature: mata-colon-multiline-block, Property 1
    // Validates: Requirements 1.1, 1.3, 1.4, 3.1, 3.3, 3.4

    it('mata: followed by newline should emit MATA_START', () => {
        fc.assert(fc.property(
            arbitrary_whitespace,
            (ws) => {
                const source = `mata:${ws}\ncode\nend`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const mata_token = result.tokens.find(t => t.value.startsWith('mata'));
                expect(mata_token).toBeDefined();
                expect(mata_token!.type).toBe('MATA_START');
                expect(mata_token!.value).toBe('mata:');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('mata: followed by // comment should emit MATA_START', () => {
        fc.assert(fc.property(
            arbitrary_whitespace,
            arbitrary_comment_content,
            (ws, comment) => {
                const source = `mata:${ws}// ${comment}\ncode\nend`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const mata_token = result.tokens.find(t => t.value.startsWith('mata'));
                expect(mata_token).toBeDefined();
                expect(mata_token!.type).toBe('MATA_START');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('mata: followed by * comment should emit MATA_START', () => {
        fc.assert(fc.property(
            arbitrary_whitespace,
            arbitrary_comment_content,
            (ws, comment) => {
                const source = `mata:${ws}* ${comment}\ncode\nend`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const mata_token = result.tokens.find(t => t.value.startsWith('mata'));
                expect(mata_token).toBeDefined();
                expect(mata_token!.type).toBe('MATA_START');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('python: followed by newline should emit PYTHON_START', () => {
        fc.assert(fc.property(
            arbitrary_whitespace,
            (ws) => {
                const source = `python:${ws}\ncode\nend`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const python_token = result.tokens.find(t => t.value.startsWith('python'));
                expect(python_token).toBeDefined();
                expect(python_token!.type).toBe('PYTHON_START');
                expect(python_token!.value).toBe('python:');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('python: followed by // comment should emit PYTHON_START', () => {
        fc.assert(fc.property(
            arbitrary_whitespace,
            arbitrary_comment_content,
            (ws, comment) => {
                const source = `python:${ws}// ${comment}\ncode\nend`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const python_token = result.tokens.find(t => t.value.startsWith('python'));
                expect(python_token).toBeDefined();
                expect(python_token!.type).toBe('PYTHON_START');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('mata: at EOF should emit MATA_START', () => {
        const source = 'mata:';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const mata_token = result.tokens.find(t => t.value === 'mata:');
        expect(mata_token).toBeDefined();
        expect(mata_token!.type).toBe('MATA_START');
    });
});

// ============================================================================
// Property 2: Colon-Content Inline Detection
// ============================================================================

describe('Property 2: Colon-Content Inline Detection', () => {
    // Feature: mata-colon-multiline-block, Property 2
    // Validates: Requirements 1.2, 2.1, 2.2, 2.3, 3.2

    it('mata: followed by expression should emit MATA_INLINE', () => {
        fc.assert(fc.property(
            arbitrary_mata_expression,
            (expr) => {
                const source = `mata: ${expr}\ndisplay "stata"`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const mata_token = result.tokens.find(t => t.value === 'mata:');
                expect(mata_token).toBeDefined();
                expect(mata_token!.type).toBe('MATA_INLINE');
                
                // Verify context is NOT pushed (next line should be Stata)
                const display_token = result.tokens.find(t => t.value === 'display');
                expect(display_token).toBeDefined();
                expect(display_token!.type).toBe('WORD');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('python: followed by expression should emit PYTHON_INLINE', () => {
        fc.assert(fc.property(
            arbitrary_python_expression,
            (expr) => {
                const source = `python: ${expr}\ndisplay "stata"`;
                const lexer = new StataLexer();
                const result = lexer.tokenize(source);
                
                const python_token = result.tokens.find(t => t.value === 'python:');
                expect(python_token).toBeDefined();
                expect(python_token!.type).toBe('PYTHON_INLINE');
                
                // Verify context is NOT pushed (next line should be Stata)
                const display_token = result.tokens.find(t => t.value === 'display');
                expect(display_token).toBeDefined();
                expect(display_token!.type).toBe('WORD');
                return true;
            }
        ), { numRuns: 50 });
    });

    it('capture mata: expression should emit MATA_INLINE', () => {
        const source = 'capture mata: x = 1\ndisplay "stata"';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const mata_token = result.tokens.find(t => t.value === 'mata:');
        expect(mata_token).toBeDefined();
        expect(mata_token!.type).toBe('MATA_INLINE');
    });
});

// ============================================================================
// Property 3: Block Termination with end
// ============================================================================

describe('Property 3: Block Termination with end', () => {
    // Feature: mata-colon-multiline-block, Property 3
    // Validates: Requirements 4.1, 4.2

    it('mata: block should terminate with END_MATA', () => {
        const source = `mata:
    x = 1
    y = 2
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const mata_start = result.tokens.find(t => t.type === 'MATA_START');
        expect(mata_start).toBeDefined();
        
        const end_mata = result.tokens.find(t => t.type === 'END_MATA');
        expect(end_mata).toBeDefined();
        expect(end_mata!.value).toBe('end');
        
        // Final context should be Stata
        expect(result.finalState.language_context).toBe('stata');
    });

    it('python: block should terminate with END_PYTHON', () => {
        const source = `python:
    x = 1
    print(x)
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const python_start = result.tokens.find(t => t.type === 'PYTHON_START');
        expect(python_start).toBeDefined();
        
        const end_python = result.tokens.find(t => t.type === 'END_PYTHON');
        expect(end_python).toBeDefined();
        expect(end_python!.value).toBe('end');
        
        // Final context should be Stata
        expect(result.finalState.language_context).toBe('stata');
    });
});

// ============================================================================
// Property 4: Non-Boundary end Preservation
// ============================================================================

describe('Property 4: Non-Boundary end Preservation', () => {
    // Feature: mata-colon-multiline-block, Property 4
    // Validates: Requirements 4.3

    it('end followed by code should NOT terminate block', () => {
        const source = `mata:
    end generate x = 1
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        // The first "end" should be WORD (not END_MATA) because it's followed by code
        const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
        const end_word = the_word_tokens.find(t => t.value === 'end');
        expect(end_word).toBeDefined();
        
        // The second "end" should be END_MATA
        const end_mata = result.tokens.find(t => t.type === 'END_MATA');
        expect(end_mata).toBeDefined();
    });
});

// ============================================================================
// Property 5: Embedded Content Tokenization
// ============================================================================

describe('Property 5: Embedded Content Tokenization', () => {
    // Feature: mata-colon-multiline-block, Property 5
    // Validates: Requirements 5.1, 5.2, 5.3

    it('should tokenize strings in mata: block', () => {
        const source = `mata:
    st_local("result", "value")
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const string_tokens = result.tokens.filter(t => t.type === 'STRING');
        expect(string_tokens.length).toBeGreaterThan(0);
    });

    it('should tokenize macro references in mata: block', () => {
        const source = `mata:
    st_local("result", \`"\`macro'"')
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
        expect(macro_tokens.length).toBeGreaterThan(0);
        expect(macro_tokens.some(t => t.value === "`macro'")).toBe(true);
    });

    it('should tokenize compound strings with macros in mata: block', () => {
        const source = `mata:
    printf(\`" \`macro' "')
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
        expect(macro_tokens.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('Regression Tests', () => {
    it('should handle the original bug case: mata: followed by newline', () => {
        // This was the original bug: mata: followed by newline was treated as MATA_INLINE
        const source = `mata:
    st_local("result", \`"\`macro'"')
    printf("\`macro'")
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        // Should be MATA_START, not MATA_INLINE
        const mata_token = result.tokens.find(t => t.value === 'mata:');
        expect(mata_token).toBeDefined();
        expect(mata_token!.type).toBe('MATA_START');
        
        // Should have END_MATA
        const end_token = result.tokens.find(t => t.type === 'END_MATA');
        expect(end_token).toBeDefined();
        
        // Should have macro references
        const macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
        expect(macro_tokens.length).toBeGreaterThan(0);
    });

    it('should preserve inline mata: behavior', () => {
        // Inline mata: should still work
        const source = 'mata: x = 1\ndisplay "stata"';
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const mata_token = result.tokens.find(t => t.value === 'mata:');
        expect(mata_token).toBeDefined();
        expect(mata_token!.type).toBe('MATA_INLINE');
        
        // Next line should be Stata context
        const display_token = result.tokens.find(t => t.value === 'display');
        expect(display_token).toBeDefined();
        expect(display_token!.type).toBe('WORD');
    });

    it('should handle mata without colon as block start', () => {
        // mata (without colon) should still work as block start
        const source = `mata
    x = 1
end`;
        const lexer = new StataLexer();
        const result = lexer.tokenize(source);
        
        const mata_token = result.tokens.find(t => t.value === 'mata');
        expect(mata_token).toBeDefined();
        expect(mata_token!.type).toBe('MATA_START');
    });
});
