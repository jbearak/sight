import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { LanguageContext } from '../../src/types';

describe('Invalid End Syntax Tokenization Property Tests', () => {
  /**
   * Property 1: Invalid End Syntax Does Not Close Block
   * For truly invalid end syntax (like "end xyz", "end invalid"),
   * the lexer should NOT close the embedded block. The 'end' is treated
   * as a regular word within the embedded context.
   * Feature: lexer-end-delimiter-handling, Property 1: Invalid End Syntax Tokenization
   * Validates: Requirements 1.3, 1.4
   */
  it('should not close block for invalid end syntax', () => {
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
          
          // Should NOT have END_* token - 'end xyz' is not a valid block terminator
          const my_end_mata_tokens = my_result.tokens.filter(t => t.type === 'END_MATA');
          const my_end_python_tokens = my_result.tokens.filter(t => t.type === 'END_PYTHON');
          expect(my_end_mata_tokens.length).toBe(0);
          expect(my_end_python_tokens.length).toBe(0);
          
          // 'end' should be a WORD token (inside embedded context)
          const my_end_word_tokens = my_result.tokens.filter(
            t => t.type === 'WORD' && t.value === 'end'
          );
          expect(my_end_word_tokens.length).toBe(1);
          
          // Block should remain unclosed (still in embedded context)
          expect(my_result.finalState.language_context).toBe(
            block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON
          );
        }
      ),
      { numRuns: 40 }
    );
  });

  /**
   * Property 2: Legacy End Python Syntax Handling
   * The old "end python" syntax should be tokenized as "end" (END_PYTHON) 
   * followed by "python" (PYTHON_START), effectively closing one block and
   * starting another.
   * Feature: lexer-end-delimiter-handling, Property 2: Legacy End Python Syntax Handling
   * Validates: Requirements 1.3, 1.4
   */
  it('should handle legacy end python syntax as separate tokens', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zA-Z0-9_\s\-+=(){}[\]]*$/), { minLength: 0, maxLength: 3 }),
        (content_lines) => {
          const my_lexer = new StataLexer();
          
          // Build document with legacy "end python" syntax
          let my_document = 'python\n';
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end python';
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have initial PYTHON_START token
          const my_initial_python_tokens = my_result.tokens.filter(t => t.type === 'PYTHON_START');
          expect(my_initial_python_tokens.length).toBe(2); // Original + new one after "end"
          expect(my_initial_python_tokens[0].value).toBe('python');
          expect(my_initial_python_tokens[1].value).toBe('python');
          
          // Should have END_PYTHON token for "end" part
          const my_end_tokens = my_result.tokens.filter(t => t.type === 'END_PYTHON');
          expect(my_end_tokens.length).toBe(1);
          expect(my_end_tokens[0].value).toBe('end');
          
          // Final state should be in Python context (due to new python block)
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
          
          // Should have only ONE end token (from valid 'end')
          // The 'end invalid' does NOT close the second block
          const my_end_tokens = my_result.tokens.filter(
            t => t.type === 'END_MATA' || t.type === 'END_PYTHON'
          );
          expect(my_end_tokens.length).toBe(1);
          expect(my_end_tokens[0].value).toBe('end');
          
          // Should have WORD tokens for 'end' and 'invalid' in the unclosed block
          const my_end_word_tokens = my_result.tokens.filter(
            t => t.type === 'WORD' && t.value === 'end'
          );
          expect(my_end_word_tokens.length).toBe(1);
          
          const my_invalid_tokens = my_result.tokens.filter(
            t => t.type === 'WORD' && t.value === 'invalid'
          );
          expect(my_invalid_tokens.length).toBe(1);
          
          // Second block should remain unclosed
          expect(my_result.finalState.language_context).toBe(
            use_mata_first ? LanguageContext.PYTHON : LanguageContext.MATA
          );
        }
      ),
      { numRuns: 20 }
    );
  });
});