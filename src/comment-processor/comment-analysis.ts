/**
 * Comment Analysis Module
 *
 * Provides data models and helper functions for analyzing and classifying
 * comments in Stata code.
 */

import { get_line_text, get_line_count, compute_line_offsets } from '../utils/line-utils';
import { Token, LanguageContext, ContextRange } from '../types';
import { Range } from 'vscode-languageserver-textdocument';

/**
 * Represents the analysis of a single comment token.
 */
export interface CommentAnalysis {
  token: Token;
  style: 'star' | 'slash' | 'block' | 'continuation';
  content: string;
  indent_level: number;
  is_in_embedded_context: boolean;
  language_context: LanguageContext;
  line_number: number;
  is_multiline: boolean;
  contains_markdown: boolean;
}

/**
 * Represents a group of related comments that can be processed together.
 */
export interface CommentGroup {
  comments: CommentAnalysis[];
  start_line: number;
  end_line: number;
  should_combine: boolean;
  common_indent: number;
}

/**
 * Represents a Markdown element detected in a comment.
 */
export interface MarkdownElement {
  type: 'header' | 'list_item' | 'code_block' | 'emphasis' | 'link' | 'blockquote';
  line_start: number;
  line_end: number;
  preserve_structure: boolean;
}

/**
 * Represents the analysis of Markdown content in a comment.
 */
export interface MarkdownAnalysis {
  elements: MarkdownElement[];
  has_markdown: boolean;
  line_break_sensitive: boolean[];
}

/**
 * Classifies a comment token by its style.
 *
 * @param token - The token to classify
 * @returns The comment style: 'star', 'slash', 'block', or 'continuation'
 */
export function classify_comment_style(token: Token): 'star' | 'slash' | 'block' | 'continuation' {
  const value = token.value.toLowerCase();

  if (token.type === 'CONTINUATION') {
    return 'continuation';
  }

  if (token.type === 'COMMENT_BLOCK') {
    return 'block';
  }

  if (token.type === 'COMMENT_LINE') {
    if (value.startsWith('///')) {
      return 'continuation';
    } else if (value.startsWith('//')) {
      return 'slash';
    } else if (value.startsWith('*')) {
      return 'star';
    }
  }

  // Default to slash for unknown comment types
  return 'slash';
}

/**
 * Extracts the content of a comment, removing the delimiters.
 *
 * @param token - The comment token
 * @param style - The comment style
 * @returns The comment content without delimiters
 */
export function extract_comment_content(token: Token, style: 'star' | 'slash' | 'block' | 'continuation'): string {
  const value = token.value;

  switch (style) {
    case 'star':
      // Remove leading * and optional space
      return value.replace(/^\*\s?/, '');
    case 'slash':
      // Remove leading // and optional space
      return value.replace(/^\/\/\s?/, '');
    case 'continuation':
      // Remove leading /// and optional space
      return value.replace(/^\/\/\/\s?/, '');
    case 'block':
      // Remove /* and */ delimiters
      return value.replace(/^\/\*\s?/, '').replace(/\s?\*\/$/, '');
    default:
      return value;
  }
}

/**
 * Calculates the indentation level of a comment based on its range.
 *
 * @param token - The comment token
 * @returns The indentation level (number of spaces/tabs)
 */
export function calculate_indent_level(token: Token): number {
  return token.range.start.character;
}

/**
 * Determines if a comment is in an embedded language context.
 *
 * @param token - The comment token
 * @param context_ranges - The embedded language context ranges
 * @returns true if the comment is in an embedded context, false otherwise
 */
export function is_in_embedded_context(
  token: Token,
  context_ranges: ContextRange[]
): boolean {
  const token_line = token.range.start.line;
  const token_char = token.range.start.character;

  for (const context_range of context_ranges) {
    const range = context_range.range;
    if (
      token_line >= range.start.line &&
      token_line <= range.end.line
    ) {
      // Check if token is within the range
      if (token_line === range.start.line && token_char < range.start.character) {
        continue;
      }
      if (token_line === range.end.line && token_char > range.end.character) {
        continue;
      }
      return true;
    }
  }

  return false;
}

/**
 * Gets the language context for a comment position.
 *
 * @param token - The comment token
 * @param context_ranges - The embedded language context ranges
 * @returns The language context (STATA, MATA, or PYTHON)
 */
export function get_language_context(
  token: Token,
  context_ranges: ContextRange[]
): LanguageContext {
  const token_line = token.range.start.line;
  const token_char = token.range.start.character;

  for (const context_range of context_ranges) {
    const range = context_range.range;
    if (
      token_line >= range.start.line &&
      token_line <= range.end.line
    ) {
      // Check if token is within the range
      if (token_line === range.start.line && token_char < range.start.character) {
        continue;
      }
      if (token_line === range.end.line && token_char > range.end.character) {
        continue;
      }
      return context_range.context;
    }
  }

  return LanguageContext.STATA;
}

/**
 * Detects if a comment contains Markdown syntax.
 *
 * @param content - The comment content
 * @returns true if Markdown is detected, false otherwise
 */
export function contains_markdown(content: string): boolean {
  // Check for common Markdown patterns
  const markdown_patterns = [
    /^#+\s/m,           // Headers
    /^\s*[-*+]\s/m,     // Lists
    /^\s*\d+\.\s/m,     // Numbered lists
    /`[^`]+`/,           // Inline code
    /```[\s\S]*?```/,    // Code blocks
    /\*\*[^\*]+\*\*/,    // Bold
    /__[^_]+__/,         // Bold (alt)
    /\*[^\*]+\*/,        // Italic
    /_[^_]+_/,           // Italic (alt)
    /\[.+\]\(.+\)/,      // Links
  ];

  for (const pattern of markdown_patterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines if a comment spans multiple lines.
 *
 * @param token - The comment token
 * @returns true if the comment spans multiple lines, false otherwise
 */
export function is_multiline_comment(token: Token): boolean {
  return token.range.start.line !== token.range.end.line;
}

/**
 * Analyzes Markdown content in a comment.
 *
 * @param content - The comment content
 * @returns The Markdown analysis
 */
export function analyze_markdown(content: string): MarkdownAnalysis {
  const my_doc = { content, line_offsets: compute_line_offsets(content) };
  const my_line_count = get_line_count(my_doc);
  const my_elements: MarkdownElement[] = [];
  const my_line_break_sensitive: boolean[] = new Array(my_line_count).fill(false);

  // Patterns for Markdown elements
  const my_header_pattern = /^#+\s/;
  const my_list_item_pattern = /^\s*[-*+]\s/;
  const my_numbered_list_pattern = /^\s*\d+\.\s/;
  const my_blockquote_pattern = /^\s*>/;
  const my_code_block_pattern = /^```/;

  let my_in_code_block = false;
  let my_code_block_start = -1;

  for (let i = 0; i < my_line_count; i++) {
    const my_line = get_line_text(my_doc, i);

    // Check for code block markers
    if (my_code_block_pattern.test(my_line)) {
      if (my_in_code_block) {
        // End of code block
        my_elements.push({
          type: 'code_block',
          line_start: my_code_block_start,
          line_end: i,
          preserve_structure: true,
        });
        my_in_code_block = false;
        my_line_break_sensitive[i] = true;
      } else {
        // Start of code block
        my_in_code_block = true;
        my_code_block_start = i;
        my_line_break_sensitive[i] = true;
      }
      continue;
    }

    // If in code block, mark as sensitive
    if (my_in_code_block) {
      my_line_break_sensitive[i] = true;
      continue;
    }

    // Check for headers
    if (my_header_pattern.test(my_line)) {
      my_elements.push({
        type: 'header',
        line_start: i,
        line_end: i,
        preserve_structure: true,
      });
      my_line_break_sensitive[i] = true;
    }

    // Check for list items
    if (my_list_item_pattern.test(my_line)) {
      my_elements.push({
        type: 'list_item',
        line_start: i,
        line_end: i,
        preserve_structure: true,
      });
      my_line_break_sensitive[i] = true;
    }

    // Check for numbered lists
    if (my_numbered_list_pattern.test(my_line)) {
      my_elements.push({
        type: 'list_item',
        line_start: i,
        line_end: i,
        preserve_structure: true,
      });
      my_line_break_sensitive[i] = true;
    }

    // Check for blockquotes
    if (my_blockquote_pattern.test(my_line)) {
      my_elements.push({
        type: 'blockquote',
        line_start: i,
        line_end: i,
        preserve_structure: true,
      });
      my_line_break_sensitive[i] = true;
    }
  }

  return {
    elements: my_elements,
    has_markdown: my_elements.length > 0,
    line_break_sensitive: my_line_break_sensitive,
  };
}

/**
 * Determines if a line is sensitive to line breaks (e.g., Markdown list items).
 *
 * @param line - The line to check
 * @returns true if the line is sensitive to line breaks, false otherwise
 */
export function is_markdown_sensitive_line(line: string): boolean {
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
 * Creates a CommentAnalysis from a comment token.
 *
 * @param token - The comment token
 * @param context_ranges - The embedded language context ranges
 * @returns The comment analysis
 */
export function analyze_comment(
  token: Token,
  context_ranges: ContextRange[] = []
): CommentAnalysis {
  const style = classify_comment_style(token);
  const content = extract_comment_content(token, style);
  const indent_level = calculate_indent_level(token);
  const is_embedded = is_in_embedded_context(token, context_ranges);
  const language_context = get_language_context(token, context_ranges);
  const line_number = token.range.start.line;
  const is_multiline = is_multiline_comment(token);
  const has_markdown = contains_markdown(content);

  return {
    token,
    style,
    content,
    indent_level,
    is_in_embedded_context: is_embedded,
    language_context,
    line_number,
    is_multiline,
    contains_markdown: has_markdown,
  };
}

/**
 * Groups consecutive comments that can be processed together.
 *
 * @param comments - The comments to group
 * @returns An array of comment groups
 */
export function group_comments(comments: CommentAnalysis[]): CommentGroup[] {
  if (comments.length === 0) {
    return [];
  }

  const groups: CommentGroup[] = [];
  let current_group: CommentAnalysis[] = [comments[0]];
  let current_start_line = comments[0].line_number;
  let current_end_line = comments[0].token.range.end.line;

  for (let i = 1; i < comments.length; i++) {
    const my_comment = comments[i];
    const my_line = my_comment.line_number;

    // Check if this comment is consecutive (within 1 line of the previous)
    if (my_line <= current_end_line + 1) {
      current_group.push(my_comment);
      current_end_line = my_comment.token.range.end.line;
    } else {
      // Start a new group
      const my_common_indent = calculate_common_indent(current_group);
      const my_should_combine = should_combine_comments(current_group);

      groups.push({
        comments: current_group,
        start_line: current_start_line,
        end_line: current_end_line,
        should_combine: my_should_combine,
        common_indent: my_common_indent,
      });

      current_group = [my_comment];
      current_start_line = my_line;
      current_end_line = my_comment.token.range.end.line;
    }
  }

  // Add the last group
  if (current_group.length > 0) {
    const my_common_indent = calculate_common_indent(current_group);
    const my_should_combine = should_combine_comments(current_group);

    groups.push({
      comments: current_group,
      start_line: current_start_line,
      end_line: current_end_line,
      should_combine: my_should_combine,
      common_indent: my_common_indent,
    });
  }

  return groups;
}

/**
 * Calculates the common indentation level for a group of comments.
 *
 * @param comments - The comments in the group
 * @returns The minimum indentation level
 */
function calculate_common_indent(comments: CommentAnalysis[]): number {
  if (comments.length === 0) {
    return 0;
  }

  return Math.min(...comments.map((c) => c.indent_level));
}

/**
 * Determines if a group of comments should be combined into a block comment.
 *
 * @param comments - The comments in the group
 * @returns true if the comments should be combined, false otherwise
 */
function should_combine_comments(comments: CommentAnalysis[]): boolean {
  // Only combine if all comments are line comments (not block comments)
  if (comments.length < 2) {
    return false;
  }

  // Check if all comments are the same style and not continuation comments
  const first_style = comments[0].style;
  if (first_style === 'continuation' || first_style === 'block') {
    return false;
  }

  for (const my_comment of comments) {
    if (my_comment.style !== first_style) {
      return false;
    }
  }

  return true;
}
