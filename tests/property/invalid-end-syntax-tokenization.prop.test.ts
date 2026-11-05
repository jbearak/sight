import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { LanguageContext } from '../../src/types';

describe('Invalid End Syntax Tokenization Property Tests', () => {
  /**
   * Property 1: End followed by a word
   * StataMP 18 ends a Mata block at `end xyz` and discards `xyz`, so
   * the END_MATA token carries the tail. A Python block ends only at a
   * line that is exactly `end`, so `end xyz` stays Python code.
   * Feature: lexer-end-delimiter-handling, Property 1: Invalid End Syntax Tokenization
   * Validates: Requirements 1.3, 1.4
   */
  it('should close a mata block, but not a python block, at end xyz', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.oneof(
          fc.constant('xyz'),
          fc.constant('invalid'),
          fc.constant('block')
        ),
        (block_type, invalid_suffix) => {
          const my_lexer = new StataLexer();
          
          // Create document with invalid end syntax
          const my_document = `${block_type}
x = 5
end ${invalid_suffix}`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have appropriate start token
          const my_start_token_type = block_type === 'mata' ? 'MATA_START' : 'PYTHON_START';
          const my_start_tokens = my_result.tokens.filter(t => t.type === my_start_token_type);
          expect(my_start_tokens.length).toBe(1);
          
          const my_end_mata_tokens = my_result.tokens.filter(t => t.type === 'END_MATA');
          const my_end_python_tokens = my_result.tokens.filter(t => t.type === 'END_PYTHON');
          expect(my_end_python_tokens.length).toBe(0);
          if (block_type === 'mata') {
            expect(my_end_mata_tokens.map(t => t.value)).toEqual([`end ${invalid_suffix}`]);
            expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          } else {
            expect(my_end_mata_tokens.length).toBe(0);
            // 'end' is a WORD inside the still-open python block
            expect(
              my_result.tokens.filter(t => t.type === 'WORD' && t.value === 'end')
            ).toHaveLength(1);
            expect(my_result.finalState.language_context).toBe(LanguageContext.PYTHON);
          }
        }
      ),
      { numRuns: 40 }
    );
  });

  /**
   * Property 2: Legacy End Python Syntax Handling
   * Stata 18 hands a Python block every line except one that is exactly
   * `end` (plus optional trailing blanks), so the old "end python"
   * syntax does not close the block: Python sees it as a SyntaxError
   * and the block stays open. It must lex as plain Python words.
   * Feature: lexer-end-delimiter-handling, Property 2: Legacy End Python Syntax Handling
   * Validates: Requirements 1.3, 1.4
   */
  it('should not close a python block at legacy end python syntax', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z0-9_\s\-+=(){}[\]]*$/)
            // A content line that is itself a bare `end` would close
            // the block before `end python` is reached.
            .filter(my_line => !/^end[ \t\r]*$/m.test(my_line)),
          { minLength: 0, maxLength: 3 }
        ),
        (content_lines) => {
          const my_lexer = new StataLexer();
          
          // Build document with legacy "end python" syntax
          let my_document = 'python\n';
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end python';
          
          const my_result = my_lexer.tokenize(my_document);
          
          const my_python_tokens = my_result.tokens.filter(t => t.type === 'PYTHON_START');
          expect(my_python_tokens.length).toBe(1);
          expect(my_python_tokens[0].value).toBe('python');
          
          const my_end_tokens = my_result.tokens.filter(t => t.type === 'END_PYTHON');
          expect(my_end_tokens.length).toBe(0);
          
          // The block is still open at the end of the document
          expect(my_result.finalState.language_context).toBe(LanguageContext.PYTHON);
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 3: Invalid End Syntax in Stata Context
   * Invalid end syntax in Stata context (where no embedded block is open)
   * should be tokenized as regular WORD tokens or appropriate special tokens.
   * Feature: lexer-end-delimiter-handling, Property 3: Invalid End Syntax in Stata Context
   * Validates: Requirements 1.3, 1.4
   */
  it('should tokenize invalid end syntax in stata context as word tokens', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('end xyz'),
          fc.constant('end invalid')
        ),
        (invalid_end_syntax) => {
          const my_lexer = new StataLexer();
          
          const my_result = my_lexer.tokenize(invalid_end_syntax);
          
          // Should tokenize as separate WORD tokens
          const my_words = invalid_end_syntax.split(' ');
          expect(my_words.length).toBe(2);
          expect(my_words[0]).toBe('end');
          
          // "end" should be WORD token in Stata context
          const my_end_tokens = my_result.tokens.filter(
            t => t.type === 'WORD' && t.value === 'end'
          );
          expect(my_end_tokens.length).toBe(1);
          
          // Second word should be WORD token
          const my_second_word_tokens = my_result.tokens.filter(
            t => t.type === 'WORD' && t.value === my_words[1]
          );
          expect(my_second_word_tokens.length).toBe(1);
          
          // Should remain in Stata context
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property 4: Mixed Valid and Invalid End Syntax
   * Documents containing both valid and invalid end syntax should be
   * tokenized consistently, with valid ends closing blocks and invalid
   * ends leaving blocks unclosed.
   * Feature: lexer-end-delimiter-handling, Property 4: Mixed Valid and Invalid End Syntax
   * Validates: Requirements 1.3, 1.4
   */
  it('should handle mixed valid and invalid end syntax consistently', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (use_mata_first) => {
          const my_lexer = new StataLexer();
          
          const my_first_block = use_mata_first ? 'mata' : 'python';
          const my_second_block = use_mata_first ? 'python' : 'mata';
          
          // Document with valid end, then invalid end syntax
          const my_document = `${my_first_block}
x = 1
end
${my_second_block}
y = 2
end invalid`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have no lexer errors
          expect(my_result.errors).toHaveLength(0);
          
          // Should have two start tokens
          const my_first_start_type = use_mata_first ? 'MATA_START' : 'PYTHON_START';
          const my_second_start_type = use_mata_first ? 'PYTHON_START' : 'MATA_START';
          
          const my_first_start_tokens = my_result.tokens.filter(t => t.type === my_first_start_type);
          const my_second_start_tokens = my_result.tokens.filter(t => t.type === my_second_start_type);
          
          expect(my_first_start_tokens.length).toBe(1);
          expect(my_second_start_tokens.length).toBe(1);
          
          // `end invalid` closes the second block only if it is Mata
          // (Stata discards the tail); a Python block stays open.
          const my_end_tokens = my_result.tokens.filter(
            t => t.type === 'END_MATA' || t.type === 'END_PYTHON'
          );
          if (use_mata_first) {
            expect(my_end_tokens.map(t => t.value)).toEqual(['end']);
            expect(
              my_result.tokens.filter(t => t.type === 'WORD' && t.value === 'end')
            ).toHaveLength(1);
            expect(
              my_result.tokens.filter(t => t.type === 'WORD' && t.value === 'invalid')
            ).toHaveLength(1);
            expect(my_result.finalState.language_context).toBe(LanguageContext.PYTHON);
          } else {
            expect(my_end_tokens.map(t => t.value)).toEqual(['end', 'end invalid']);
            expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});