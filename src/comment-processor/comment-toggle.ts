/**
 * Comment Toggle Module
 *
 * Handles toggling comments on/off using the preferred comment style.
 */

import { Range, Position } from 'vscode-languageserver-textdocument';
import { Token, ContextRange, LanguageContext } from '../types';
import { CommentProcessor } from './comment-processor';
import { analyze_comment, extract_comment_content, classify_comment_style } from './comment-analysis';

/**
 * Represents a line toggle operation (comment or uncomment).
 */
export interface LineToggleOperation {
  line_number: number;
  original_text: string;
  new_text: string;
  is_comment_operation: boolean; // true for comment, false for uncomment
}

/**
 * Handles comment toggling operations.
 */
export class CommentToggle {
  private comment_processor: CommentProcessor;

  constructor() {
    this.comment_processor = new CommentProcessor();
  }

  /**
   * Toggles comments on a range of lines.
   *
   * @param lines - The lines of code
   * @param line_numbers - The line numbers to toggle (0-indexed)
   * @param preferred_style - The preferred comment style
   * @param tokens - The tokens for the document
   * @param context_ranges - The embedded language context ranges
   * @returns An array of toggle operations
   */
  toggle_lines(
    lines: string[],
    line_numbers: number[],
    preferred_style: '//' | '*' | '/* */',
    tokens: Token[],
    context_ranges: ContextRange[] = []
  ): LineToggleOperation[] {
    const operations: LineToggleOperation[] = [];

    for (const my_line_number of line_numbers) {
      if (my_line_number < 0 || my_line_number >= lines.length) {
        continue;
      }

      const my_line = lines[my_line_number];
      const my_operation = this.toggle_single_line(
        my_line,
        my_line_number,
        preferred_style,
        tokens,
        context_ranges
      );

      if (my_operation) {
        operations.push(my_operation);
      }
    }

    return operations;
  }

  /**
   * Toggles a single line between commented and uncommented.
   *
   * @param line - The line text
   * @param line_number - The line number (0-indexed)
   * @param preferred_style - The preferred comment style
   * @param tokens - The tokens for the document
   * @param context_ranges - The embedded language context ranges
   * @returns The toggle operation, or null if no operation needed
   */
  private toggle_single_line(
    line: string,
    line_number: number,
    preferred_style: '//' | '*' | '/* */',
    tokens: Token[],
    context_ranges: ContextRange[] = []
  ): LineToggleOperation | null {
    // Check if line is in embedded context
    if (this.is_in_embedded_context(line_number, context_ranges)) {
      return null;
    }

    // Check if line is already commented
    const my_comment_token = this.find_comment_on_line(line_number, tokens);

    if (my_comment_token) {
      // Line is commented, uncomment it
      return this.uncomment_line(line, line_number, my_comment_token);
    } else {
      // Line is not commented, comment it
      return this.comment_line(line, line_number, preferred_style);
    }
  }

  /**
   * Comments a line using the preferred style.
   *
   * @param line - The line text
   * @param line_number - The line number (0-indexed)
   * @param preferred_style - The preferred comment style
   * @returns The toggle operation
   */
  private comment_line(
    line: string,
    line_number: number,
    preferred_style: '//' | '*' | '/* */'
  ): LineToggleOperation {
    const my_trimmed = line.trimStart();
    const my_indent = line.substring(0, line.length - my_trimmed.length);

    let my_new_text = '';
    switch (preferred_style) {
      case '//':
        my_new_text = `${my_indent}// ${my_trimmed}`;
        break;
      case '*':
        my_new_text = `${my_indent}* ${my_trimmed}`;
        break;
      case '/* */':
        my_new_text = `${my_indent}/* ${my_trimmed} */`;
        break;
    }

    return {
      line_number,
      original_text: line,
      new_text: my_new_text,
      is_comment_operation: true,
    };
  }

  /**
   * Uncomments a line, removing any comment style.
   *
   * @param line - The line text
   * @param line_number - The line number (0-indexed)
   * @param comment_token - The comment token on the line
   * @returns The toggle operation
   */
  private uncomment_line(
    line: string,
    line_number: number,
    comment_token: Token
  ): LineToggleOperation {
    const my_comment_style = classify_comment_style(comment_token);
    const my_content = extract_comment_content(comment_token, my_comment_style);

    // Find the position of the comment in the line
    const my_comment_start = line.indexOf(comment_token.value);

    if (my_comment_start === -1) {
      // Comment not found, return original line
      return {
        line_number,
        original_text: line,
        new_text: line,
        is_comment_operation: false,
      };
    }

    // Get the part before the comment
    const my_before_comment = line.substring(0, my_comment_start);

    // Determine if there's code before the comment
    const my_before_trimmed = my_before_comment.trimEnd();

    let my_new_text = '';
    if (my_before_trimmed.length === 0) {
      // Comment is the entire line, just use the content
      my_new_text = my_content;
    } else {
      // There's code before the comment, keep it
      my_new_text = my_before_trimmed;
    }

    return {
      line_number,
      original_text: line,
      new_text: my_new_text,
      is_comment_operation: false,
    };
  }

  /**
   * Finds a comment token on a specific line.
   *
   * @param line_number - The line number (0-indexed)
   * @param tokens - The tokens to search
   * @returns The comment token, or null if not found
   */
  private find_comment_on_line(line_number: number, tokens: Token[]): Token | null {
    for (const my_token of tokens) {
      if (
        (my_token.type === 'COMMENT_LINE' ||
          my_token.type === 'COMMENT_BLOCK' ||
          my_token.type === 'CONTINUATION') &&
        my_token.range.start.line === line_number
      ) {
        return my_token;
      }
    }
    return null;
  }

  /**
   * Checks if a line is in an embedded language context.
   *
   * @param line_number - The line number (0-indexed)
   * @param context_ranges - The embedded language context ranges
   * @returns true if the line is in an embedded context, false otherwise
   */
  private is_in_embedded_context(
    line_number: number,
    context_ranges: ContextRange[]
  ): boolean {
    for (const my_context of context_ranges) {
      if (
        my_context.context !== LanguageContext.STATA &&
        my_context.range.start.line <= line_number &&
        my_context.range.end.line >= line_number
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Uncomments all comment styles on a line.
   *
   * @param line - The line text
   * @returns The uncommented line
   */
  uncomment_all_styles(line: string): string {
    // Try to remove each comment style
    const my_patterns = [
      /^\s*\/\/\s?/,      // // style
      /^\s*\*\s?/,        // * style
      /^\s*\/\/\/\s?/,    // /// style (continuation)
      /^\s*\/\*\s?/,      // /* style (start)
      /\s?\*\/\s*$/,      // */ style (end)
    ];

    let my_result = line;
    for (const my_pattern of my_patterns) {
      my_result = my_result.replace(my_pattern, '');
    }

    return my_result;
  }
}
