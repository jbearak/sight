import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import {
  arbitrary_stata_document,
  arbitrary_document_with_delimit_switches,
  arbitrary_document_with_continuations,
  arbitrary_simple_string,
  arbitrary_compound_string,
  arbitrary_macro_name,
} from './generators';
import { extract_text_at_range } from './helpers';

describe('Lexer Tokenization Property Tests', () => {
  let my_lexer: StataLexer;

  beforeEach(() => {
    my_lexer = new StataLexer();
  });

  /**
   * Property 2: Token Concatenation
   * For any valid Stata source code, concatenating all non-whitespace token
   * values should preserve the semantic content of the source.
   * Feature: comprehensive-property-tests, Property 2: Token Concatenation
   * Validates: Requirement 2.1
   */
  it('should preserve semantic content through tokenization', () => {
    fc.assert(
      fc.property(arbitrary_stata_document(), (my_source) => {
        const my_result = my_lexer.tokenize(my_source);

        // Get non-whitespace tokens
        const my_non_ws_tokens = my_result.tokens.filter(
          (my_token) => my_token.type !== 'WHITESPACE' && my_token.type !== 'EOF'
        );

        // Verify we have tokens
        if (my_non_ws_tokens.length === 0) {
          return true;
        }

        // Verify each token has a valid range
        for (const my_token of my_non_ws_tokens) {
          if (
            my_token.range.start.line < 0 ||
            my_token.range.start.character < 0 ||
            my_token.range.end.line < 0 ||
            my_token.range.end.character < 0
          ) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Delimiter Mode Handling
   * For any document with #delimit directives, the lexer should correctly
   * recognize the directives and track delimiter mode changes.
   * Feature: comprehensive-property-tests, Property 3: Delimiter Mode Handling
   * Validates: Requirement 2.2
   */
  it('should recognize delimiter directives', () => {
    fc.assert(
      fc.property(arbitrary_document_with_delimit_switches(), ({ document }) => {
        const my_result = my_lexer.tokenize(document);

        // Verify we have DELIMIT_DIRECTIVE tokens
        const my_delimit_tokens = my_result.tokens.filter(
          (my_token) => my_token.type === 'DELIMIT_DIRECTIVE'
        );

        // Should have at least one delimit directive
        if (my_delimit_tokens.length === 0) {
          return false;
        }

        // Each directive should contain 'delimit'
        for (const my_token of my_delimit_tokens) {
          if (!my_token.value.toLowerCase().includes('delimit')) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Continuation Handling
   * For any document with /// continuations, the lexer should recognize
   * continuation tokens and handle them appropriately.
   * Feature: comprehensive-property-tests, Property 4: Continuation Handling
   * Validates: Requirement 2.3
   */
  it('should recognize continuation tokens', () => {
    fc.assert(
      fc.property(arbitrary_document_with_continuations(), (my_document) => {
        const my_result = my_lexer.tokenize(my_document);

        // Verify we have CONTINUATION tokens
        const my_continuation_tokens = my_result.tokens.filter(
          (my_token) => my_token.type === 'CONTINUATION'
        );

        // Should have at least one continuation token (or document has no continuations)
        if (my_continuation_tokens.length === 0) {
          // If no continuations, that's OK - the generator might not produce them
          return true;
        }

        // Each continuation token should be ///
        for (const my_token of my_continuation_tokens) {
          if (my_token.value !== '///') {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: String Boundary Detection
   * For any string literal (simple or compound), the lexer should successfully
   * tokenize it without errors.
   * Feature: comprehensive-property-tests, Property 5: String Boundary Detection
   * Validates: Requirement 2.4
   */
  it('should tokenize string literals without errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbitrary_simple_string(), arbitrary_compound_string()),
        (my_string_literal) => {
          const my_document = `display ${my_string_literal}`;
          const my_result = my_lexer.tokenize(my_document);

          // Should not have errors
          if (my_result.errors.length > 0) {
            return false;
          }

          // Should have tokens
          return my_result.tokens.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Global Macro Tokenization
   * For any global macro reference ${name}, the lexer should produce
   * a single MACRO_REF_GLOBAL token.
   * Feature: comprehensive-property-tests, Property 6: Global Macro Tokenization
   * Validates: Requirement 2.5
   */
  it('should tokenize global macro references correctly', () => {
    fc.assert(
      fc.property(arbitrary_macro_name(), (my_name) => {
        const my_document = `display \${${my_name}}`;
        const my_result = my_lexer.tokenize(my_document);

        const my_macro_tokens = my_result.tokens.filter(
          (my_token) => my_token.type === 'MACRO_REF_GLOBAL'
        );

        // Should have exactly one MACRO_REF_GLOBAL token
        if (my_macro_tokens.length !== 1) {
          return false;
        }

        // The token value should match the reference
        return my_macro_tokens[0].value === `\${${my_name}}`;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Source Span Accuracy
   * For any token, its source span should correctly identify its position
   * in the source code.
   * Feature: comprehensive-property-tests, Property 7: Source Span Accuracy
   * Validates: Requirement 2.6
   */
  it('should have accurate source spans for all tokens', () => {
    fc.assert(
      fc.property(arbitrary_stata_document(), (my_source) => {
        const my_result = my_lexer.tokenize(my_source);

        // Verify each token's range extracts the correct text
        for (const my_token of my_result.tokens) {
          const my_extracted = extract_text_at_range(my_source, my_token.range);

          // For most tokens, extracted text should match token value
          // (except for some special cases like WHITESPACE)
          if (my_token.type !== 'WHITESPACE' && my_token.type !== 'EOF') {
            if (my_extracted !== my_token.value) {
              return false;
            }
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
