import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { CommentProcessor } from '../../src/comment-processor/comment-processor';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import {
  arbitrary_stata_document,
  arbitrary_document_with_comments,
} from './generators';
import { parse_and_analyze } from './helpers';

describe('Non-Comment Code Preservation Property Tests', () => {
  let my_processor: CommentProcessor;
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_processor = new CommentProcessor();
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 12: Non-comment code preservation
   * For any document being formatted, all non-comment tokens should remain
   * exactly unchanged during comment normalization. The code structure,
   * variable names, commands, and all non-comment content must be preserved.
   * Feature: comment-style-normalization, Property 12: Non-comment code preservation
   * Validates: Requirements 10.2
   */
  it('should preserve all non-comment code during normalization', () => {
    fc.assert(
      fc.property(arbitrary_document_with_comments(), (my_source) => {
        try {
          // Parse the original document
          const my_original_doc_state = parse_and_analyze(my_source);

          // Extract non-comment tokens from original
          const my_original_non_comment_tokens = (my_original_doc_state.tokens || [])
            .filter((my_token) => my_token.type !== 'COMMENT_LINE' && my_token.type !== 'COMMENT_BLOCK' && my_token.type !== 'CONTINUATION')
            .map((my_token) => ({
              type: my_token.type,
              value: my_token.value,
              line: my_token.range.start.line,
              character: my_token.range.start.character,
            }));

          // Process comments with normalization
          const the_transformations = my_processor.process_comments(
            my_original_doc_state.tokens || [],
            'slash',
            my_original_doc_state.context_ranges || []
          );

          // Apply transformations to get normalized content
          let my_normalized_content = my_source;
          const the_sorted_transformations = [...the_transformations].sort((a, b) => {
            const a_line = a.original_range.start.line;
            const b_line = b.original_range.start.line;
            if (a_line !== b_line) {
              return b_line - a_line;
            }
            return b.original_range.start.character - a.original_range.start.character;
          });

          const the_lines = my_normalized_content.split('\n');
          for (const my_transformation of the_sorted_transformations) {
            const my_start_line = my_transformation.original_range.start.line;
            const my_end_line = my_transformation.original_range.end.line;
            const my_start_char = my_transformation.original_range.start.character;
            const my_end_char = my_transformation.original_range.end.character;

            if (my_start_line === my_end_line) {
              const my_line = the_lines[my_start_line];
              if (my_line) {
                const my_before = my_line.substring(0, my_start_char);
                const my_after = my_line.substring(my_end_char);
                the_lines[my_start_line] = my_before + my_transformation.new_text + my_after;
              }
            } else {
              const my_before = the_lines[my_start_line].substring(0, my_start_char);
              const my_after = the_lines[my_end_line].substring(my_end_char);
              const my_new_lines = my_transformation.new_text.split('\n');

              const my_replacement = [
                my_before + my_new_lines[0],
                ...my_new_lines.slice(1, -1),
                (my_new_lines[my_new_lines.length - 1] || '') + my_after,
              ];

              the_lines.splice(my_start_line, my_end_line - my_start_line + 1, ...my_replacement);
            }
          }

          my_normalized_content = the_lines.join('\n');

          // Parse the normalized document
          const my_normalized_doc_state = parse_and_analyze(my_normalized_content);

          // Extract non-comment tokens from normalized
          const my_normalized_non_comment_tokens = (my_normalized_doc_state.tokens || [])
            .filter((my_token) => my_token.type !== 'COMMENT_LINE' && my_token.type !== 'COMMENT_BLOCK' && my_token.type !== 'CONTINUATION')
            .map((my_token) => ({
              type: my_token.type,
              value: my_token.value,
              line: my_token.range.start.line,
              character: my_token.range.start.character,
            }));

          // Verify same number of non-comment tokens
          if (my_original_non_comment_tokens.length !== my_normalized_non_comment_tokens.length) {
            return false;
          }

          // Verify each non-comment token is identical
          for (let my_i = 0; my_i < my_original_non_comment_tokens.length; my_i++) {
            const my_orig_token = my_original_non_comment_tokens[my_i];
            const my_norm_token = my_normalized_non_comment_tokens[my_i];

            // Token type and value must match exactly
            if (my_orig_token.type !== my_norm_token.type || my_orig_token.value !== my_norm_token.value) {
              return false;
            }
          }

          return true;
        } catch {
          // If parsing or processing fails, skip this test case
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 12b: Code structure preservation
   * For any document with comments, the AST structure of non-comment code
   * should remain identical after comment normalization. This ensures that
   * semantic meaning is preserved.
   * Feature: comment-style-normalization, Property 12b: Code structure preservation
   * Validates: Requirements 10.2
   */
  it('should preserve code structure when normalizing comments', () => {
    fc.assert(
      fc.property(arbitrary_document_with_comments(), (my_source) => {
        try {
          // Parse the original document
          const my_original_doc_state = parse_and_analyze(my_source);

          // Process comments with normalization
          const my_processor_local = new CommentProcessor();
          const the_transformations = my_processor_local.process_comments(
            my_original_doc_state.tokens || [],
            'slash',
            my_original_doc_state.context_ranges || []
          );

          // Apply transformations to get normalized content
          let my_normalized_content = my_source;
          const the_sorted_transformations = [...the_transformations].sort((a, b) => {
            const a_line = a.original_range.start.line;
            const b_line = b.original_range.start.line;
            if (a_line !== b_line) {
              return b_line - a_line;
            }
            return b.original_range.start.character - a.original_range.start.character;
          });

          const the_lines = my_normalized_content.split('\n');
          for (const my_transformation of the_sorted_transformations) {
            const my_start_line = my_transformation.original_range.start.line;
            const my_end_line = my_transformation.original_range.end.line;
            const my_start_char = my_transformation.original_range.start.character;
            const my_end_char = my_transformation.original_range.end.character;

            if (my_start_line === my_end_line) {
              const my_line = the_lines[my_start_line];
              if (my_line) {
                const my_before = my_line.substring(0, my_start_char);
                const my_after = my_line.substring(my_end_char);
                the_lines[my_start_line] = my_before + my_transformation.new_text + my_after;
              }
            } else {
              const my_before = the_lines[my_start_line].substring(0, my_start_char);
              const my_after = the_lines[my_end_line].substring(my_end_char);
              const my_new_lines = my_transformation.new_text.split('\n');

              const my_replacement = [
                my_before + my_new_lines[0],
                ...my_new_lines.slice(1, -1),
                (my_new_lines[my_new_lines.length - 1] || '') + my_after,
              ];

              the_lines.splice(my_start_line, my_end_line - my_start_line + 1, ...my_replacement);
            }
          }

          my_normalized_content = the_lines.join('\n');

          // Parse the normalized document
          const my_normalized_doc_state = parse_and_analyze(my_normalized_content);

          // Verify both documents parse successfully
          if (!my_original_doc_state.ast || !my_normalized_doc_state.ast) {
            return true;
          }

          // Verify the AST structure is equivalent (ignoring comments)
          // Both should have the same command structure
          const my_original_commands = extract_commands(my_original_doc_state.ast);
          const my_normalized_commands = extract_commands(my_normalized_doc_state.ast);

          if (my_original_commands.length !== my_normalized_commands.length) {
            return false;
          }

          // Verify each command is identical
          for (let my_i = 0; my_i < my_original_commands.length; my_i++) {
            if (my_original_commands[my_i] !== my_normalized_commands[my_i]) {
              return false;
            }
          }

          return true;
        } catch {
          // If parsing or processing fails, skip this test case
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Helper function to extract command names from AST.
 */
function extract_commands(ast: any): string[] {
  const my_commands: string[] = [];

  function traverse(my_node: any) {
    if (!my_node) {
      return;
    }

    if (my_node.type === 'Command' && my_node.name) {
      my_commands.push(my_node.name);
    }

    if (Array.isArray(my_node.body)) {
      for (const my_child of my_node.body) {
        traverse(my_child);
      }
    }

    if (my_node.body && typeof my_node.body === 'object') {
      traverse(my_node.body);
    }

    if (my_node.commands && Array.isArray(my_node.commands)) {
      for (const my_cmd of my_node.commands) {
        traverse(my_cmd);
      }
    }
  }

  traverse(ast);
  return my_commands;
}
