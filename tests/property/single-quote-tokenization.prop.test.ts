import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { arbitrary_identifier } from './generators/primitives';

describe('Single-Quote Tokenization Properties', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  test('Property 1: Standalone Apostrophe Tokenization', () => {
    fc.assert(
      fc.property(
        arbitrary_identifier(),
        (word) => {
          const input = `'${word}'`;
          const result = lexer.tokenize(input);
          
          const nonWhitespaceTokens = result.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
          
          expect(nonWhitespaceTokens).toHaveLength(3);
          expect(nonWhitespaceTokens[0].type).toBe('OPERATOR');
          expect(nonWhitespaceTokens[0].value).toBe("'");
          expect(nonWhitespaceTokens[1].type).toBe('WORD');
          expect(nonWhitespaceTokens[1].value).toBe(word);
          expect(nonWhitespaceTokens[2].type).toBe('OPERATOR');
          expect(nonWhitespaceTokens[2].value).toBe("'");
          
          // Ensure no STRING tokens
          expect(nonWhitespaceTokens.some(t => t.type === 'STRING')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 2: Local Macro Reference Preservation', () => {
    fc.assert(
      fc.property(
        arbitrary_identifier(),
        (name) => {
          const input = `\`${name}'`;
          const result = lexer.tokenize(input);
          
          const nonWhitespaceTokens = result.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
          
          expect(nonWhitespaceTokens).toHaveLength(1);
          expect(nonWhitespaceTokens[0].type).toBe('MACRO_REF_LOCAL');
          expect(nonWhitespaceTokens[0].value).toBe(`\`${name}'`);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 3: Valid String Literal Round-Trip', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.char().filter(c => c !== '\n' && c !== '"' && c !== '`'), { maxLength: 50 }),
        (content) => {
          // Test simple string
          const simpleInput = `"${content}"`;
          const simpleResult = lexer.tokenize(simpleInput);
          const simpleTokens = simpleResult.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
          
          expect(simpleTokens.some(t => t.type === 'STRING')).toBe(true);
          
          // Test compound string (only if content doesn't end with ")
          if (!content.endsWith('"')) {
            const compoundInput = `\`"${content}"'`;
            const compoundResult = lexer.tokenize(compoundInput);
            const compoundTokens = compoundResult.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
            
            expect(compoundTokens.some(t => t.type === 'STRING')).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 4: No False Unclosed String Errors', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            arbitrary_identifier(),
            fc.constant("'")
          ),
          { minLength: 1, maxLength: 10 }
        ),
        (parts) => {
          const input = parts.join(' ');
          const result = lexer.tokenize(input);
          
          // Should not have unclosed string errors for standalone apostrophes
          const unclosedStringErrors = result.errors.filter(e => 
            e.message.toLowerCase().includes('unclosed string')
          );
          
          expect(unclosedStringErrors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
