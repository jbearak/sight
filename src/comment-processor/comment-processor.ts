/**
 * Comment Processor Class
 *
 * Handles comment style normalization and transformation for Stata code.
 */

import { get_line_text, get_line_count, compute_line_offsets } from '../utils/line-utils';
import { Token, ContextRange } from '../types';
import { Range } from 'vscode-languageserver-textdocument';
import { logger } from '../utils/logger';
import {
  CommentAnalysis,
  analyze_comment,
  extract_comment_content,
  group_comments,
  CommentGroup,
  analyze_markdown,
} from './comment-analysis';

/**
 * Represents a transformation to apply to a comment.
 */
export interface CommentTransformation {
  original_range: Range;
  new_text: string;
  comment_type: 'line' | 'block';
  original_style: 'star' | 'slash' | 'block' | 'continuation';
  target_style: 'star' | 'slash' | 'block' | 'continuation';
}

/**
 * Processes and transforms comments in Stata code.
 */
export class CommentProcessor {
  /**
   * Processes all comments in a token list and generates transformations.
   *
   * @param tokens - The tokens to process
   * @param target_style - The target comment style
   * @param context_ranges - The embedded language context ranges
   * @returns An array of comment transformations
   */
  process_comments(
    tokens: Token[],
    target_style: 'star' | 'slash' | 'block' | 'continuation',
    context_ranges: ContextRange[] = []
  ): CommentTransformation[] {
    const transformations: CommentTransformation[] = [];

    try {
      for (const my_token of tokens) {
        if (!this.is_comment_token(my_token)) {
          continue;
        }

        try {
          const my_analysis = analyze_comment(my_token, context_ranges);

          // Skip continuation comments - they should never be normalized
          if (my_analysis.style === 'continuation') {
            continue;
          }

          // Skip comments in embedded contexts
          if (my_analysis.is_in_embedded_context) {
            continue;
          }

          // Skip if already in target style
          if (my_analysis.style === target_style) {
            continue;
          }

          // Generate transformation
          const my_transformation = this.create_transformation(
            my_analysis,
            target_style
          );

          if (my_transformation) {
            transformations.push(my_transformation);
          }
        } catch (my_error) {
          // Gracefully skip this token on error
          // Log error for debugging but continue processing
          logger.warn(`Error processing comment token: ${my_error}`);
          continue;
        }
      }
    } catch (my_error) {
      // Graceful degradation: return transformations collected so far
      logger.warn(`Error during comment processing: ${my_error}`);
    }

    return transformations;
  }

  /**
   * Normalizes a single comment to a target style.
   *
   * @param comment - The comment analysis
   * @param target_style - The target comment style
   * @returns The normalized comment text
   */
  normalize_comment_style(
    comment: CommentAnalysis,
    target_style: 'star' | 'slash' | 'block' | 'continuation'
  ): string {
    try {
      // Never normalize continuation comments
      if (comment.style === 'continuation') {
        return comment.token.value;
      }

      // If already in target style, return as-is
      if (comment.style === target_style) {
        return comment.token.value;
      }

      // Validate comment has required properties
      if (!comment.token || !comment.token.value) {
        return '';
      }

      const my_indent = ' '.repeat(Math.max(0, comment.indent_level));
      const my_content = comment.content || '';

      switch (target_style) {
        case 'star':
          return `${my_indent}* ${my_content}`;
        case 'slash':
          return `${my_indent}// ${my_content}`;
        case 'block':
          return `${my_indent}/* ${my_content} */`;
        case 'continuation':
          // Never convert to continuation
          return comment.token.value;
        default:
          return comment.token.value;
      }
    } catch (my_error) {
      // Graceful degradation: return original token value
      logger.warn(`Error normalizing comment style: ${my_error}`);
      return comment.token?.value || '';
    }
  }

  /**
   * Wraps comment lines to a specified width while preserving Markdown structure.
   *
   * @param comment_text - The comment text to wrap
   * @param line_width - The maximum line width
   * @param comment_style - The comment style
   * @param indent_level - The indentation level
   * @returns An array of wrapped comment lines
   */
  wrap_comment_lines(
    comment_text: string,
    line_width: number,
    comment_style: 'star' | 'slash' | 'block' | 'continuation',
    indent_level: number
  ): string[] {
    try {
      // Validate inputs
      if (!comment_text || comment_text.length === 0) {
        return [];
      }

      if (line_width <= 0) {
        return [comment_text];
      }

      if (indent_level < 0) {
        indent_level = 0;
      }

      const my_indent = ' '.repeat(indent_level);
      const my_prefix = this.get_comment_prefix(comment_style);

      // Handle whitespace-only content - preserve it as-is
      if (comment_text.trim().length === 0) {
        return [`${my_indent}${my_prefix} ${comment_text}`];
      }

      // Calculate available width: total - indent - prefix - space after prefix
      const my_prefix_with_space = my_prefix.length + 1; // +1 for space after prefix
      const my_available_width = line_width - indent_level - my_prefix_with_space;

      if (my_available_width <= 0) {
        // Line width too small, return as-is
        return [comment_text];
      }

      const my_lines: string[] = [];
      const my_words = comment_text.split(/\s+/);
      let my_current_line = '';

      for (const my_word of my_words) {
        if (my_word.length === 0) {
          continue;
        }

        // Check if adding this word would exceed the width
        const my_test_line = my_current_line.length === 0
          ? my_word
          : `${my_current_line} ${my_word}`;

        if (my_test_line.length <= my_available_width) {
          my_current_line = my_test_line;
        } else {
          // Start a new line
          if (my_current_line.length > 0) {
            my_lines.push(`${my_indent}${my_prefix} ${my_current_line}`);
            my_current_line = my_word;
          } else {
            // Word is longer than available width, add it anyway
            // (can't break words)
            my_lines.push(`${my_indent}${my_prefix} ${my_word}`);
            my_current_line = '';
          }
        }
      }

      // Add the last line
      if (my_current_line.length > 0) {
        my_lines.push(`${my_indent}${my_prefix} ${my_current_line}`);
      }

      return my_lines.length > 0 ? my_lines : [comment_text];
    } catch (my_error) {
      // Graceful degradation: return original text
      logger.warn(`Error wrapping comment lines: ${my_error}`);
      return [comment_text];
    }
  }

  /**
   * Wraps comment lines with Markdown awareness.
   *
   * @param comment_text - The comment text to wrap
   * @param line_width - The maximum line width
   * @param comment_style - The comment style
   * @param indent_level - The indentation level
   * @returns An array of wrapped comment lines with Markdown structure preserved
   */
  wrap_comment_lines_markdown_aware(
    comment_text: string,
    line_width: number,
    comment_style: 'star' | 'slash' | 'block' | 'continuation',
    indent_level: number
  ): string[] {
    try {
      // Validate inputs
      if (!comment_text || comment_text.length === 0) {
        return [];
      }

      if (line_width <= 0) {
        return [comment_text];
      }

      if (indent_level < 0) {
        indent_level = 0;
      }

      const my_indent = ' '.repeat(indent_level);
      const my_prefix = this.get_comment_prefix(comment_style);
      // Calculate available width: total - indent - prefix - space after prefix
      const my_prefix_with_space = my_prefix.length + 1; // +1 for space after prefix
      const my_available_width = line_width - indent_level - my_prefix_with_space;

      if (my_available_width <= 0) {
        // Line width too small, return as-is
        return [comment_text];
      }

      const my_doc = { content: comment_text, line_offsets: compute_line_offsets(comment_text) };
      const my_line_count = get_line_count(my_doc);
      const my_markdown_analysis = analyze_markdown(comment_text);
      const my_result: string[] = [];

      for (let i = 0; i < my_line_count; i++) {
        const my_line = get_line_text(my_doc, i);

        // If this line is Markdown-sensitive, preserve it as-is
        if (my_markdown_analysis.line_break_sensitive[i]) {
          my_result.push(`${my_indent}${my_prefix} ${my_line}`);
          continue;
        }

        // Otherwise, wrap the line
        const my_words = my_line.split(/\s+/);
        let my_current_line = '';

        for (const my_word of my_words) {
          if (my_word.length === 0) {
            continue;
          }

          const my_test_line = my_current_line.length === 0
            ? my_word
            : `${my_current_line} ${my_word}`;

          if (my_test_line.length <= my_available_width) {
            my_current_line = my_test_line;
          } else {
            // Start a new line
            if (my_current_line.length > 0) {
              my_result.push(`${my_indent}${my_prefix} ${my_current_line}`);
              my_current_line = my_word;
            } else {
              // Word is longer than available width, add it anyway
              // (can't break words)
              my_result.push(`${my_indent}${my_prefix} ${my_word}`);
              my_current_line = '';
            }
          }
        }

        // Add the last line
        if (my_current_line.length > 0) {
          my_result.push(`${my_indent}${my_prefix} ${my_current_line}`);
        }
      }

      return my_result.length > 0 ? my_result : [comment_text];
    } catch (my_error) {
      // Graceful degradation: return original text
      logger.warn(`Error wrapping comment lines with Markdown awareness: ${my_error}`);
      return [comment_text];
    }
  }

  /**
   * Determines if a line is sensitive to line breaks (e.g., Markdown list items).
   *
   * @param line - The line to check
   * @returns true if the line is sensitive to line breaks, false otherwise
   */
  is_markdown_sensitive_line(line: string): boolean {
    // Check for Markdown patterns that shouldn't be broken
    const sensitive_patterns = [
      /^\s*[-*+]\s/,           // List items
      /^\s*\d+\.\s/,           // Numbered lists
      /^\s*#+\s/,              // Headers
      /^\s*```/,               // Code blocks
      /^\s*>/,                 // Blockquotes
    ];

    for (const my_pattern of sensitive_patterns) {
      if (my_pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Creates a transformation for a comment.
   *
   * @param comment - The comment analysis
   * @param target_style - The target comment style
   * @returns The transformation, or null if no transformation is needed
   */
  private create_transformation(
    comment: CommentAnalysis,
    target_style: 'star' | 'slash' | 'block' | 'continuation'
  ): CommentTransformation | null {
    try {
      // Never transform continuation comments
      if (comment.style === 'continuation') {
        return null;
      }

      // If already in target style, no transformation needed
      if (comment.style === target_style) {
        return null;
      }

      // Validate comment has required properties
      if (!comment.token || !comment.token.range) {
        return null;
      }

      const my_new_text = this.normalize_comment_style(comment, target_style);

      return {
        original_range: comment.token.range,
        new_text: my_new_text,
        comment_type: comment.is_multiline ? 'block' : 'line',
        original_style: comment.style,
        target_style,
      };
    } catch (my_error) {
      logger.warn(`Error creating transformation: ${my_error}`);
      return null;
    }
  }

  /**
   * Detects blank lines within a comment.
   *
   * @param comment - The comment analysis
   * @returns An array of line numbers that are blank
   */
  detect_blank_lines(comment: CommentAnalysis): number[] {
    try {
      const my_content = extract_comment_content(comment.token, comment.style);
      const my_doc = { content: my_content, line_offsets: compute_line_offsets(my_content) };
      const my_line_count = get_line_count(my_doc);
      const my_blank_lines: number[] = [];

      for (let i = 0; i < my_line_count; i++) {
        if (get_line_text(my_doc, i).trim().length === 0) {
          my_blank_lines.push(i);
        }
      }

      return my_blank_lines;
    } catch (my_error) {
      logger.warn(`Error detecting blank lines: ${my_error}`);
      return [];
    }
  }

  /**
   * Preserves blank lines when combining comments into a block.
   *
   * @param comments - The comments to combine
   * @returns The combined block comment text with blank lines preserved
   */
  combine_lines_to_block_with_blanks(comments: CommentAnalysis[]): string {
    try {
      if (!comments || comments.length === 0) {
        return '';
      }

      const my_indent = ' '.repeat(Math.max(0, comments[0].indent_level));
      const my_lines: string[] = [];

      for (const my_comment of comments) {
        try {
          const my_content = extract_comment_content(my_comment.token, my_comment.style);
          my_lines.push(my_content);
        } catch (my_error) {
          logger.warn(`Error extracting comment content: ${my_error}`);
          continue;
        }
      }

      const my_combined_content = my_lines.join('\n');
      return `${my_indent}/* ${my_combined_content} */`;
    } catch (my_error) {
      logger.warn(`Error combining lines to block with blanks: ${my_error}`);
      return '';
    }
  }

  /**
   * Gets the comment prefix for a given style.
   *
   * @param style - The comment style
   * @returns The comment prefix
   */
  private get_comment_prefix(style: 'star' | 'slash' | 'block' | 'continuation'): string {
    switch (style) {
      case 'star':
        return '*';
      case 'slash':
        return '//';
      case 'continuation':
        return '///';
      case 'block':
        return '/*';
      default:
        return '//';
    }
  }

  /**
   * Converts a multi-line block comment to multiple line comments.
   *
   * @param comment - The block comment analysis
   * @param target_style - The target line comment style
   * @returns An array of line comment texts
   */
  convert_block_to_lines(
    comment: CommentAnalysis,
    target_style: 'star' | 'slash' | 'continuation'
  ): string[] {
    try {
      if (comment.style !== 'block') {
        return [comment.token.value];
      }

      const my_indent = ' '.repeat(Math.max(0, comment.indent_level));
      const my_prefix = this.get_comment_prefix(target_style);

      // Extract content from block comment
      const my_content = extract_comment_content(comment.token, 'block');

      // Split by lines and convert each to target style
      const my_doc = { content: my_content, line_offsets: compute_line_offsets(my_content) };
      const my_line_count = get_line_count(my_doc);
      const my_result: string[] = [];

      for (let i = 0; i < my_line_count; i++) {
        const my_line = get_line_text(my_doc, i);
        const my_trimmed = my_line.trim();
        if (my_trimmed.length > 0) {
          my_result.push(`${my_indent}${my_prefix} ${my_trimmed}`);
        } else {
          // Preserve blank lines as empty strings
          my_result.push('');
        }
      }

      return my_result;
    } catch (my_error) {
      logger.warn(`Error converting block to lines: ${my_error}`);
      return [comment.token?.value || ''];
    }
  }

  /**
   * Combines multiple consecutive line comments into a single block comment.
   *
   * @param comments - The group of line comments to combine
   * @returns The combined block comment text
   */
  combine_lines_to_block(comments: CommentAnalysis[]): string {
    try {
      if (!comments || comments.length === 0) {
        return '';
      }

      const my_indent = ' '.repeat(Math.max(0, comments[0].indent_level));
      const my_lines: string[] = [];

      for (const my_comment of comments) {
        try {
          const my_content = extract_comment_content(my_comment.token, my_comment.style);
          my_lines.push(my_content);
        } catch (my_error) {
          logger.warn(`Error extracting comment content: ${my_error}`);
          continue;
        }
      }

      const my_combined_content = my_lines.join('\n');
      return `${my_indent}/* ${my_combined_content} */`;
    } catch (my_error) {
      logger.warn(`Error combining lines to block: ${my_error}`);
      return '';
    }
  }

  /**
   * Processes a group of comments for multi-line handling.
   *
   * @param group - The comment group to process
   * @param target_style - The target comment style
   * @returns An array of transformations for the group
   */
  process_comment_group(
    group: CommentGroup,
    target_style: 'star' | 'slash' | 'block' | 'continuation'
  ): CommentTransformation[] {
    const transformations: CommentTransformation[] = [];

    try {
      // Validate group
      if (!group || !group.comments || group.comments.length === 0) {
        return transformations;
      }

      // If target is block and group should combine, create a single block comment
      if (target_style === 'block' && group.should_combine && group.comments.length > 1) {
        try {
          const my_combined = this.combine_lines_to_block(group.comments);
          const my_first_comment = group.comments[0];
          const my_last_comment = group.comments[group.comments.length - 1];

          transformations.push({
            original_range: {
              start: my_first_comment.token.range.start,
              end: my_last_comment.token.range.end,
            },
            new_text: my_combined,
            comment_type: 'block',
            original_style: my_first_comment.style,
            target_style: 'block',
          });
        } catch (my_error) {
          logger.warn(`Error combining comments to block: ${my_error}`);
          // Fall through to individual conversion
        }
      } else {
        // Convert each comment individually
        for (const my_comment of group.comments) {
          try {
            // Skip continuation comments
            if (my_comment.style === 'continuation') {
              continue;
            }

            // Skip if already in target style
            if (my_comment.style === target_style) {
              continue;
            }

            // For block-to-line conversions, handle multi-line
            if (my_comment.style === 'block' && target_style !== 'block') {
              const my_lines = this.convert_block_to_lines(my_comment, target_style);
              if (my_lines.length > 1) {
                // Multi-line conversion
                transformations.push({
                  original_range: my_comment.token.range,
                  new_text: my_lines.join('\n'),
                  comment_type: 'line',
                  original_style: 'block',
                  target_style,
                });
              } else if (my_lines.length === 1) {
                // Single line conversion
                transformations.push({
                  original_range: my_comment.token.range,
                  new_text: my_lines[0],
                  comment_type: 'line',
                  original_style: 'block',
                  target_style,
                });
              }
            } else {
              // Single-line conversion
              const my_new_text = this.normalize_comment_style(my_comment, target_style);
              transformations.push({
                original_range: my_comment.token.range,
                new_text: my_new_text,
                comment_type: my_comment.is_multiline ? 'block' : 'line',
                original_style: my_comment.style,
                target_style,
              });
            }
          } catch (my_error) {
            logger.warn(`Error converting individual comment: ${my_error}`);
            // Skip this comment on error
            continue;
          }
        }
      }
    } catch (my_error) {
      logger.warn(`Error processing comment group: ${my_error}`);
    }

    return transformations;
  }

  /**
   * Processes all comments with multi-line handling support.
   *
   * @param tokens - The tokens to process
   * @param target_style - The target comment style
   * @param context_ranges - The embedded language context ranges
   * @returns An array of comment transformations
   */
  process_comments_with_multiline(
    tokens: Token[],
    target_style: 'star' | 'slash' | 'block' | 'continuation',
    context_ranges: ContextRange[] = []
  ): CommentTransformation[] {
    const transformations: CommentTransformation[] = [];

    try {
      // Analyze all comments
      const my_comments: CommentAnalysis[] = [];
      for (const my_token of tokens) {
        if (!this.is_comment_token(my_token)) {
          continue;
        }

        try {
          const my_analysis = analyze_comment(my_token, context_ranges);

          // Skip comments in embedded contexts
          if (my_analysis.is_in_embedded_context) {
            continue;
          }

          my_comments.push(my_analysis);
        } catch (my_error) {
          logger.warn(`Error analyzing comment token: ${my_error}`);
          continue;
        }
      }

      // Group comments for multi-line handling
      const my_groups = group_comments(my_comments);

      // Process each group
      for (const my_group of my_groups) {
        try {
          const my_group_transformations = this.process_comment_group(my_group, target_style);
          transformations.push(...my_group_transformations);
        } catch (my_error) {
          logger.warn(`Error processing comment group: ${my_error}`);
          continue;
        }
      }
    } catch (my_error) {
      logger.warn(`Error during multi-line comment processing: ${my_error}`);
    }

    return transformations;
  }

  /**
   * Checks if a token is a comment token.
   *
   * @param token - The token to check
   * @returns true if the token is a comment, false otherwise
   */
  private is_comment_token(token: Token): boolean {
    return (
      token.type === 'COMMENT_LINE' ||
      token.type === 'COMMENT_BLOCK' ||
      token.type === 'CONTINUATION'
    );
  }
}
