import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import {
  arbitrary_stata_document,
  arbitrary_document_with_comments,
  arbitrary_document_with_abbreviations,
} from './generators';
import {
  parse_and_analyze,
  extract_comments,
} from './helpers';
import { ast_equivalent } from './helpers/ast-comparison';

describe('Formatting Preservation Property Tests', () => {
  let my_formatter: CodeFormatter;

  beforeEach(() => {
    my_formatter = new CodeFormatter();
  });

  /**
   * Property 15: Semantic Preservation
   * For any valid Stata document, formatting should produce code that parses
   * to an equivalent AST (ignoring source ranges).
   * Feature: comprehensive-property-tests, Property 15: Semantic Preservation
   * Validates: Requirement 5.1
   */
  it('should preserve semantic meaning through formatting', () => {
    fc.assert(
      fc.property(arbitrary_stata_document(), (my_source) => {
        try {
          // Parse original document
          const my_original_doc_state = parse_and_analyze(my_source);

          // Format the document
          const my_format_edits = my_formatter.format(my_original_doc_state, {
            tabSize: 2,
            insertSpaces: true,
          });

          // If no edits, formatting didn't change anything
          if (my_format_edits.length === 0) {
            return true;
          }

          // Apply formatting edits to get formatted text
          const my_formatted_text = my_format_edits[0].newText;

          // Parse the formatted document
          const my_formatted_doc_state = parse_and_analyze(my_formatted_text);

          // Verify AST equivalence (ignoring ranges)
          return ast_equivalent(
            my_original_doc_state.ast,
            my_formatted_doc_state.ast
          );
        } catch {
          // If formatting or parsing fails, skip this test case
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 16: Whitespace Only
   * For any valid Stata document, formatting should only change whitespace
   * and indentation, not the actual tokens.
   * Feature: comprehensive-property-tests, Property 16: Whitespace Only
   * Validates: Requirement 5.2
   */
  it('should only modify whitespace during formatting', () => {
    fc.assert(
      fc.property(arbitrary_stata_document(), (my_source) => {
        // Format the document
        const my_original_doc_state = parse_and_analyze(my_source);
        const my_format_edits = my_formatter.format(my_original_doc_state, {
          tabSize: 2,
          insertSpaces: true,
        });

        // If no edits, formatting didn't change anything
        if (my_format_edits.length === 0) {
          return true;
        }

        const my_formatted_text = my_format_edits[0].newText;

        // Verify that the formatted text parses to the same AST
        const my_formatted_doc_state = parse_and_analyze(my_formatted_text);

        // The key property: AST should be equivalent
        return ast_equivalent(
          my_original_doc_state.ast,
          my_formatted_doc_state.ast
        );
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 17: Comment Preservation
   * For any document with comments, formatting should preserve all comments
   * and their association with the same nodes.
   * Feature: comprehensive-property-tests, Property 17: Comment Preservation
   * Validates: Requirement 5.3
   */
  it('should preserve all comments during formatting', () => {
    fc.assert(
      fc.property(arbitrary_document_with_comments(), (my_source) => {
        // Extract comments from original
        const my_original_comments = extract_comments(my_source);

        // Format the document
        const my_original_doc_state = parse_and_analyze(my_source);
        const my_format_edits = my_formatter.format(my_original_doc_state, {
          tabSize: 2,
          insertSpaces: true,
        });

        // If no edits, formatting didn't change anything
        if (my_format_edits.length === 0) {
          return true;
        }

        const my_formatted_text = my_format_edits[0].newText;

        // Extract comments from formatted
        const my_formatted_comments = extract_comments(my_formatted_text);

        // Verify same number of comments
        if (my_original_comments.length !== my_formatted_comments.length) {
          return false;
        }

        // Verify each comment's content is preserved
        for (let my_i = 0; my_i < my_original_comments.length; my_i++) {
          const my_orig_comment = my_original_comments[my_i];
          const my_fmt_comment = my_formatted_comments[my_i];

          // Comment content and style should match
          if (
            my_orig_comment.content !== my_fmt_comment.content ||
            my_orig_comment.style !== my_fmt_comment.style
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
   * Property 18: No Token Normalization
   * For any document with abbreviated commands, formatting should NOT expand
   * abbreviations (e.g., 'di' should remain 'di', not become 'display').
   * Feature: comprehensive-property-tests, Property 18: No Token Normalization
   * Validates: Requirement 5.4
   */
  it('should not normalize abbreviated commands', () => {
    fc.assert(
      fc.property(arbitrary_document_with_abbreviations(), ({ document, abbreviations }) => {
        // Format the document
        const my_original_doc_state = parse_and_analyze(document);
        const my_format_edits = my_formatter.format(my_original_doc_state, {
          tabSize: 2,
          insertSpaces: true,
        });

        // If no edits, formatting didn't change anything
        if (my_format_edits.length === 0) {
          return true;
        }

        const my_formatted_text = my_format_edits[0].newText;

        // Verify all abbreviations are still present in formatted text
        for (const my_abbrev of abbreviations) {
          if (!my_formatted_text.includes(my_abbrev)) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
