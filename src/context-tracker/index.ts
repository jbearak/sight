import { Position, Range } from 'vscode-languageserver-textdocument';
import {
  LanguageContext,
  ContextRange,
  ContextDiagnostic,
  IContextTracker,
} from './types';
import { ContextErrorCode, Token, TokenType } from '../types';
import { get_line_text, get_line_count, compute_line_offsets } from '../utils/line-utils';
import { block_comment_lines } from '../utils/block-comment-utils';

// Token types that carry no live code. A line whose only tokens are
// these (and that the lexer placed inside a block comment) is safe to
// skip in the raw-line block-structure scans.
const CONTEXT_TRIVIA_TOKEN_TYPES: Set<TokenType> = new Set([
  'COMMENT_LINE',
  'COMMENT_BLOCK',
  'CONTINUATION',
  'WHITESPACE',
  // The newline / `;` that ends a line is a separator, not live code. It
  // matters here because the terminator after a comment's closing `*/`
  // starts on that closing line (e.g. `program define foo */`), and must
  // not make an otherwise fully-commented line look like live code.
  'STATEMENT_TERMINATOR',
  'EOF',
]);

/**
 * Context Tracker maintains language context state during parsing.
 * It detects when code transitions between Stata, Mata, and Python contexts
 * and provides context information to LSP providers.
 */
export class ContextTracker implements IContextTracker {
  private context_ranges: ContextRange[] = [];
  private sorted_ranges_cache: ContextRange[] | null = null;
  private context_stack: LanguageContext[] = [LanguageContext.STATA];
  private document_content: string = '';
  private diagnostics: ContextDiagnostic[] = [];
  // Lines (0-based) that are entirely inside a multi-line block comment
  // (leading text commented, no live code token). The raw-line block-
  // structure scans below skip these so commented-out `end`/`program`/
  // `mata` lines do not produce spurious diagnostics.
  private block_comment_continuation_lines: Set<number> = new Set();

  /**
   * Initialize context tracker from tokens instead of raw content.
   * Avoids re-scanning document by using pre-computed token information.
   * Ensures ranges are sorted by (start.line, start.character).
   * 
   * This method extracts context information directly from tokens,
   * avoiding the need to re-scan the document content.
   * 
   * @param tokens - Pre-computed tokens from the lexer
   * @param document_content - Optional document content for validation
   */
  initialize_from_tokens(tokens: Token[], document_content?: string): void {
    // Store document content for validation if provided
    if (document_content !== undefined) {
      this.document_content = document_content;
    }

    // Pre-compute the lines that sit inside multi-line block comments so
    // the raw-line block-structure validations can skip them. Derived from
    // the same tokens, so nested block comments are handled by the lexer.
    // A line that also carries a live code token (e.g. `/* c */ end`, where
    // the comment closes mid-line) must still be scanned, so drop any line
    // that has a non-trivia token starting on it.
    const my_comment_lines = block_comment_lines(this.document_content, tokens);
    for (const my_token of tokens) {
      if (!CONTEXT_TRIVIA_TOKEN_TYPES.has(my_token.type)) {
        my_comment_lines.delete(my_token.range.start.line);
      }
    }
    this.block_comment_continuation_lines = my_comment_lines;

    // Extract context ranges from tokens
    // Tokens already have position information (range) and type information
    // that can be used to detect context blocks
    
    this.context_ranges = [];
    this.sorted_ranges_cache = null;
    this.context_stack = [LanguageContext.STATA];
    let my_current_range: Partial<ContextRange> | null = null;
    let my_current_context = LanguageContext.STATA;
    
    // State variables for brace-style block tracking
    let my_is_brace_style = false;      // Whether current block is brace-style
    let my_brace_depth = 0;             // Current brace nesting depth
    let my_block_start_line: number | undefined;  // Line where block started
    
    for (let my_i = 0; my_i < tokens.length; my_i++) {
      const my_token = tokens[my_i];
      
      // Check for context block start tokens
      if (my_token.type === 'MATA_START' || my_token.type === 'MATA_INLINE') {
        // Start a new mata block
        if (my_current_range) {
          // Close previous range if any
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
        }
        
        my_current_range = {
          context: LanguageContext.MATA,
          parent_context: my_current_context,
          start_delimiter: {
            command: my_token.value,
            range: my_token.range,
          },
          is_single_line: my_token.type === 'MATA_INLINE',
        };
        
        if (my_token.type === 'MATA_INLINE') {
          // Single-line mata context ends at end of token line
          my_current_range.end_delimiter = {
            command: my_token.value,
            range: my_token.range,
          };
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
          my_current_range = null;
        } else {
          this.context_stack.push(LanguageContext.MATA);
          my_current_context = LanguageContext.MATA;
          my_block_start_line = my_token.range.start.line;
          
          // Look ahead for LBRACE on same line to detect brace-style block
          my_is_brace_style = this.has_lbrace_on_same_line(tokens, my_i, my_block_start_line!);
          my_brace_depth = 0;
        }
      } else if (my_token.type === 'PYTHON_START' || my_token.type === 'PYTHON_INLINE') {
        // Start a new python block
        if (my_current_range) {
          // Close previous range if any
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
        }
        
        my_current_range = {
          context: LanguageContext.PYTHON,
          parent_context: my_current_context,
          start_delimiter: {
            command: my_token.value,
            range: my_token.range,
          },
          is_single_line: my_token.type === 'PYTHON_INLINE',
        };
        
        if (my_token.type === 'PYTHON_INLINE') {
          // Single-line python context ends at end of token line
          my_current_range.end_delimiter = {
            command: my_token.value,
            range: my_token.range,
          };
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
          my_current_range = null;
        } else {
          this.context_stack.push(LanguageContext.PYTHON);
          my_current_context = LanguageContext.PYTHON;
          my_block_start_line = my_token.range.start.line;
          
          // Look ahead for LBRACE on same line to detect brace-style block
          my_is_brace_style = this.has_lbrace_on_same_line(tokens, my_i, my_block_start_line!);
          my_brace_depth = 0;
        }
      } else if (my_token.type === 'LBRACE') {
        // Track brace depth for brace-style blocks
        if (my_is_brace_style && my_current_range) {
          if (my_brace_depth === 0 && my_token.range.start.line === my_block_start_line) {
            // This is the opening brace of the brace-style block
            my_brace_depth = 1;
          } else if (my_brace_depth > 0) {
            // Nested brace inside brace-style block
            my_brace_depth++;
          }
        }
      } else if (my_token.type === 'RBRACE') {
        // Check if this closes a brace-style block
        if (my_is_brace_style && my_current_range && my_brace_depth > 0) {
          my_brace_depth--;
          if (my_brace_depth === 0) {
            // Brace-style block is closed
            my_current_range.end_delimiter = {
              command: '}',
              range: my_token.range,
            };
            this.context_ranges.push(
              this.complete_context_range_from_token(my_current_range)
            );
            my_current_range = null;
            
            // Reset brace-style state
            my_is_brace_style = false;
            my_block_start_line = undefined;
            
            if (this.context_stack.length > 1) {
              this.context_stack.pop();
              my_current_context = this.context_stack[this.context_stack.length - 1];
            }
          }
        }
      } else if (my_token.type === 'END_MATA') {
        // End the current mata block (only for traditional blocks, not brace-style)
        if (my_current_range && my_current_range.context === LanguageContext.MATA && !my_is_brace_style) {
          my_current_range.end_delimiter = {
            command: my_token.value,
            range: my_token.range,
          };
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
          my_current_range = null;
          my_block_start_line = undefined;
          
          if (this.context_stack.length > 1) {
            this.context_stack.pop();
            my_current_context = this.context_stack[this.context_stack.length - 1];
          }
        }
      } else if (my_token.type === 'END_PYTHON') {
        // End the current python block (only for traditional blocks, not brace-style)
        if (my_current_range && my_current_range.context === LanguageContext.PYTHON && !my_is_brace_style) {
          my_current_range.end_delimiter = {
            command: my_token.value,
            range: my_token.range,
          };
          this.context_ranges.push(
            this.complete_context_range_from_token(my_current_range)
          );
          my_current_range = null;
          my_block_start_line = undefined;
          
          if (this.context_stack.length > 1) {
            this.context_stack.pop();
            my_current_context = this.context_stack[this.context_stack.length - 1];
          }
        }
      }
    }
    
    // Handle unclosed block at EOF
    if (my_current_range) {
      this.context_ranges.push(
        this.complete_context_range_from_token(my_current_range)
      );
    }
    
    // Sort ranges by (start.line, start.character)
    this.context_ranges.sort((my_a, my_b) => {
      const my_line_cmp = my_a.range.start.line - my_b.range.start.line;
      if (my_line_cmp !== 0) {
        return my_line_cmp;
      }
      return my_a.range.start.character - my_b.range.start.character;
    });
    
    // Validate context ranges are sorted (debug assertion)
    this.assert_ranges_sorted(this.context_ranges);
    
    // Validate context structure
    this.validate_context_structure();
  }

  get_context_at_position(position: Position): LanguageContext {
    const my_range = this.get_context_range_at_position(position);
    return my_range ? my_range.context : LanguageContext.STATA;
  }

  get_all_context_ranges(): ContextRange[] {
    if (this.sorted_ranges_cache !== null) {
      return this.sorted_ranges_cache;
    }
    // Sort ranges by (start.line, start.character) for binary search
    const my_sorted_ranges = [...this.context_ranges].sort(
      (my_a, my_b) => {
        const my_line_cmp = my_a.range.start.line - my_b.range.start.line;
        if (my_line_cmp !== 0) {
          return my_line_cmp;
        }
        return my_a.range.start.character - my_b.range.start.character;
      }
    );

    // Debug assertion: verify sorted invariant in development
    this.assert_ranges_sorted(my_sorted_ranges);

    this.sorted_ranges_cache = my_sorted_ranges;
    return my_sorted_ranges;
  }

  get_context_range_at_position(position: Position): ContextRange | undefined {
    // Use binary search on sorted ranges for O(log n) lookup
    const my_sorted_ranges = this.get_all_context_ranges();
    return this.find_context_range_binary(position, my_sorted_ranges);
  }

  is_in_embedded_language(position: Position): boolean {
    const my_context = this.get_context_at_position(position);
    return my_context !== LanguageContext.STATA;
  }

  validate_context_structure(): ContextDiagnostic[] {
    this.diagnostics = [];

    // Check for unclosed blocks
    for (const my_range of this.context_ranges) {
      if (!my_range.end_delimiter && !my_range.is_single_line) {
        const my_error_code =
          my_range.context === LanguageContext.MATA
            ? ContextErrorCode.UNCLOSED_MATA_BLOCK
            : ContextErrorCode.UNCLOSED_PYTHON_BLOCK;

        this.diagnostics.push({
          message:
            my_range.context === LanguageContext.MATA
              ? 'Unclosed mata block - missing "end" command'
              : 'Unclosed python block - missing "end" command',
          range: my_range.start_delimiter.range,
          severity: 'error',
          code: my_error_code,
        });
      }
    }

    // Check for mismatched end delimiters
    this.validate_end_delimiters();

    return this.diagnostics;
  }

  /**
   * Validate that end delimiters match their corresponding start delimiters.
   * Implements error recovery for malformed blocks.
   * 
   * Note: We track program blocks to avoid false positives for 'end' commands
   * that are valid program block terminators.
   */
  private validate_end_delimiters(): void {
    const my_doc = { content: this.document_content, line_offsets: compute_line_offsets(this.document_content) };
    const my_line_count = get_line_count(my_doc);
    
    // Track program blocks to know which 'end' commands are valid
    const my_valid_end_lines = this.find_valid_end_lines(my_doc);

    for (let my_line_number = 0; my_line_number < my_line_count; my_line_number++) {
      // Lines inside a multi-line block comment are not live code
      if (this.block_comment_continuation_lines.has(my_line_number)) {
        continue;
      }
      const my_line = get_line_text(my_doc, my_line_number);
      const my_code_part = this.extract_code_before_comment(my_line);
      const my_code_trimmed = my_code_part.trim();

      // Check for 'end' command
      if (my_code_trimmed === 'end') {
        // Find if this 'end' is part of a valid mata block
        const my_context_at_line = this.get_context_at_position({
          line: my_line_number,
          character: 0,
        });

        // Check if this 'end' is a valid end delimiter for a mata or python block
        // It's valid if:
        // 1. It's in a mata or python context, OR
        // 2. It's the end delimiter of a mata or python block, OR
        // 3. It's the end of a program block
        let my_is_valid_end = false;
        if (my_context_at_line === LanguageContext.MATA || my_context_at_line === LanguageContext.PYTHON) {
          my_is_valid_end = true;
        } else {
          // Check if this line is the end delimiter of a mata or python block
          for (const my_range of this.context_ranges) {
            if (
              (my_range.context === LanguageContext.MATA || my_range.context === LanguageContext.PYTHON) &&
              my_range.end_delimiter &&
              my_range.end_delimiter.range.start.line === my_line_number
            ) {
              my_is_valid_end = true;
              break;
            }
          }
        }
        
        // Check if this 'end' is part of a program block
        if (!my_is_valid_end && my_valid_end_lines.has(my_line_number)) {
          my_is_valid_end = true;
        }

        if (!my_is_valid_end) {
          // Emit diagnostic for orphan end commands
          this.diagnostics.push({
            message: 'Unexpected "end" command - not closing any program, mata, python, or input block',
            range: {
              start: { line: my_line_number, character: 0 },
              end: {
                line: my_line_number,
                character: my_code_trimmed.length,
              },
            },
            severity: 'error',
            code: ContextErrorCode.UNEXPECTED_END,
          });
        }
      }

      // Check for 'end python' command
      if (my_code_trimmed === 'end python') {
        // 'end python' command outside python block
        this.diagnostics.push({
          message: '"end python" command outside python block - use "end" to close python blocks',
          range: {
            start: { line: my_line_number, character: 0 },
            end: {
              line: my_line_number,
              character: my_code_trimmed.length,
            },
          },
          severity: 'error',
          code: ContextErrorCode.MISMATCHED_END_PYTHON,
        });
      }

      // Check for 'end mata' command
      if (my_code_trimmed === 'end mata') {
        // 'end mata' is invalid - should use 'end' instead
        this.diagnostics.push({
          message: 'Invalid syntax: use "end" instead of "end mata" to close mata blocks',
          range: {
            start: { line: my_line_number, character: 0 },
            end: {
              line: my_line_number,
              character: my_code_trimmed.length,
            },
          },
          severity: 'warning',
          code: ContextErrorCode.INVALID_DELIMITER_POSITION,
        });
      }

      // Check for malformed end commands (e.g., "end mata" instead of "end")
      if (
        my_code_trimmed.startsWith('end ') &&
        my_code_trimmed !== 'end python'
      ) {
        const my_context_at_line = this.get_context_at_position({
          line: my_line_number,
          character: 0,
        });

        // This is likely a malformed end command
        if (my_context_at_line === LanguageContext.MATA) {
          this.diagnostics.push({
            message:
              'Invalid end command in mata block - use "end" to close mata block',
            range: {
              start: { line: my_line_number, character: 0 },
              end: {
                line: my_line_number,
                character: my_code_trimmed.length,
              },
            },
            severity: 'error',
            code: ContextErrorCode.INVALID_DELIMITER_POSITION,
          });
        }
      }
    }
  }
  
  /**
   * Check if a line starts a program block.
   * Handles various forms: 'program define name', 'program name', 'program def name'
   */
  private is_program_block_start(line: string): boolean {
    const my_code_part = this.extract_code_before_comment(line);
    const my_code_trimmed = my_code_part.trim();
    
    if (!my_code_trimmed.startsWith('program ')) {
      return false;
    }
    
    const my_words = my_code_trimmed.split(/\s+/);
    if (my_words.length < 2) {
      return false;
    }
    
    // 'program define name' or 'program def name'
    if (my_words[1] === 'define' || my_words[1] === 'def') {
      return my_words.length >= 3;
    }
    
    // 'program name' (implicit define)
    if (my_words.length === 2) {
      return true;
    }
    
    return false;
  }

  /**
   * Find line numbers where 'end' commands are valid block terminators
   * (program or input blocks). Uses stack-based tracking to handle nested
   * blocks correctly. Mata/python block ends are validated separately via
   * context ranges.
   */
  private find_valid_end_lines(doc: { content: string; line_offsets: number[] }): Set<number> {
    const my_valid_end_lines = new Set<number>();
    const my_program_stack: number[] = []; // Stack of program start line numbers
    const my_embedded_stack: ('mata' | 'python' | 'input')[] = []; // Stack of embedded language blocks
    const my_line_count = get_line_count(doc);
    
    for (let my_line_number = 0; my_line_number < my_line_count; my_line_number++) {
      // Lines inside a multi-line block comment are not live code, so they
      // neither open nor close program/embedded blocks.
      if (this.block_comment_continuation_lines.has(my_line_number)) {
        continue;
      }
      const my_line = get_line_text(doc, my_line_number);
      const my_code_part = this.extract_code_before_comment(my_line);
      const my_code_trimmed = my_code_part.trim();
      const my_first_word = this.extract_first_word(my_code_trimmed);
      
      // Check for program block start
      if (this.is_program_block_start(my_line)) {
        my_program_stack.push(my_line_number);
      }
      
      // Check for embedded language block start
      if (my_first_word === 'mata' && my_code_trimmed === 'mata') {
        my_embedded_stack.push('mata');
      } else if (my_first_word === 'python' && my_code_trimmed === 'python') {
        my_embedded_stack.push('python');
      } else if (my_first_word === 'input' && my_embedded_stack.length === 0) {
        my_embedded_stack.push('input');
      }

      // Check for 'end' command
      if (my_code_trimmed === 'end') {
        // If we're in an embedded language block, this 'end' closes that block
        if (my_embedded_stack.length > 0) {
          const my_popped = my_embedded_stack.pop();
          // input block ends are valid (mata/python validated separately via context ranges)
          if (my_popped === 'input') {
            my_valid_end_lines.add(my_line_number);
          }
        }
        // Otherwise, if we have program blocks, this 'end' closes a program block
        else if (my_program_stack.length > 0) {
          my_program_stack.pop();
          my_valid_end_lines.add(my_line_number);
        }
      }
    }
    
    return my_valid_end_lines;
  }

  /**
   * Extract the first word from a line.
   */
  private extract_first_word(line: string): string {
    const my_match = line.match(/^(\S+?)[:]/);
    if (my_match) {
      return my_match[1]; // Return word without colon
    }
    const my_word_match = line.match(/^\S+/);
    return my_word_match ? my_word_match[0] : '';
  }

  /**
   * Extract the code part of a line before any inline comment.
   * Handles both * and // style comments.
   */
  private extract_code_before_comment(line: string): string {
    // Handle // comments
    const my_double_slash_index = line.indexOf('//');
    if (my_double_slash_index !== -1) {
      return line.substring(0, my_double_slash_index);
    }

    // Handle * comments (but not at start of line, which is already handled)
    // In Stata, * comments must be at statement boundary
    // For simplicity, we'll look for * that appears after code
    const my_trimmed = line.trim();
    if (!my_trimmed.startsWith('*')) {
      const my_star_index = line.indexOf(' *');
      if (my_star_index !== -1) {
        return line.substring(0, my_star_index);
      }
    }

    return line;
  }

  /**
   * Check if there is an LBRACE token on the same line as the given start index.
   * Used to detect brace-style embedded blocks (e.g., `mata { ... }`).
   */
  private has_lbrace_on_same_line(tokens: Token[], start_index: number, target_line: number): boolean {
    for (let my_i = start_index + 1; my_i < tokens.length; my_i++) {
      const my_token = tokens[my_i];
      // Stop if we've moved past the target line
      if (my_token.range.start.line > target_line) {
        return false;
      }
      // Found LBRACE on the same line
      if (my_token.type === 'LBRACE' && my_token.range.start.line === target_line) {
        return true;
      }
    }
    return false;
  }

  /**
   * Complete a context range by calculating its full range from token positions.
   * For single-line contexts, the entire line is included.
   * For multi-line contexts, the range includes the start delimiter line but excludes the end delimiter line.
   */
  private complete_context_range_from_token(
    partial_range: Partial<ContextRange>
  ): ContextRange {
    const my_start_line = partial_range.start_delimiter!.range.start.line;
    let my_end_line: number;

    if (partial_range.is_single_line) {
      // For single-line contexts, the entire line is included
      my_end_line = my_start_line;
    } else {
      // For multi-line contexts, exclude the end delimiter line
      if (partial_range.end_delimiter) {
        my_end_line = partial_range.end_delimiter.range.start.line - 1;
      } else {
        // If no end delimiter (unclosed block), extend to end of document
        my_end_line = Number.MAX_SAFE_INTEGER;
      }

      // Ensure end line is at least the start line
      if (my_end_line < my_start_line) {
        my_end_line = my_start_line;
      }
    }

    return {
      context: partial_range.context!,
      range: {
        start: { line: my_start_line, character: 0 },
        end: { line: my_end_line, character: Number.MAX_SAFE_INTEGER },
      },
      parent_context: partial_range.parent_context,
      start_delimiter: partial_range.start_delimiter!,
      end_delimiter: partial_range.end_delimiter,
      is_single_line: partial_range.is_single_line!,
    };
  }

  /**
   * Check if a position is within a range.
   */
  private position_in_range(position: Position, range: Range): boolean {
    if (position.line < range.start.line || position.line > range.end.line) {
      return false;
    }

    if (position.line === range.start.line) {
      if (position.character < range.start.character) {
        return false;
      }
    }

    if (position.line === range.end.line) {
      if (position.character > range.end.character) {
        return false;
      }
    }

    return true;
  }

  /**
   * Assert context ranges are sorted by start position.
   * In debug builds, throws if invariant violated.
   */
  private assert_ranges_sorted(ranges: ContextRange[]): void {
    if (process.env.NODE_ENV === 'development') {
      for (let i = 1; i < ranges.length; i++) {
        const my_prev = ranges[i - 1];
        const my_curr = ranges[i];
        const my_prev_line = my_prev.range.start.line;
        const my_prev_char = my_prev.range.start.character;
        const my_curr_line = my_curr.range.start.line;
        const my_curr_char = my_curr.range.start.character;

        if (
          my_prev_line > my_curr_line ||
          (my_prev_line === my_curr_line && my_prev_char > my_curr_char)
        ) {
          throw new Error(
            `Context ranges not sorted: range ${i - 1} ` +
            `(${my_prev_line}:${my_prev_char}) comes after ` +
            `range ${i} (${my_curr_line}:${my_curr_char})`
          );
        }
      }
    }
  }

  /**
   * Compare position to range.
   * Returns: -1 if position before range, 0 if inside, 1 if after.
   */
  private compare_position_to_range(
    position: Position,
    range: Range
  ): number {
    if (
      position.line < range.start.line ||
      (position.line === range.start.line &&
        position.character < range.start.character)
    ) {
      return -1;
    }
    if (
      position.line > range.end.line ||
      (position.line === range.end.line &&
        position.character > range.end.character)
    ) {
      return 1;
    }
    return 0;
  }

  /**
   * Find context range containing position using binary search.
   * Assumes context_ranges is sorted by start position.
   * O(log n) time complexity.
   * Returns the most specific (innermost) range containing the position.
   */
  private find_context_range_binary(
    position: Position,
    context_ranges: ContextRange[]
  ): ContextRange | undefined {
    if (context_ranges.length === 0) {
      return undefined;
    }

    let my_low = 0;
    let my_high = context_ranges.length - 1;
    let my_result: ContextRange | undefined = undefined;

    while (my_low <= my_high) {
      const my_mid = Math.floor((my_low + my_high) / 2);
      const my_range = context_ranges[my_mid];

      const my_cmp = this.compare_position_to_range(position, my_range.range);

      if (my_cmp < 0) {
        // Position is before this range
        my_high = my_mid - 1;
      } else if (my_cmp > 0) {
        // Position is after this range
        my_low = my_mid + 1;
      } else {
        // Position is within this range
        my_result = my_range;
        // Continue searching right for more specific (nested) ranges
        my_low = my_mid + 1;
      }
    }

    return my_result;
  }

  /**
   * Get helpful suggestions for fixing context errors.
   * Provides guidance for common mistakes.
   */
  get_error_recovery_suggestions(error: ContextDiagnostic): string[] {
    const my_suggestions: string[] = [];

    switch (error.code) {
      case ContextErrorCode.UNCLOSED_MATA_BLOCK:
        my_suggestions.push('Add "end" command to close the mata block');
        my_suggestions.push(
          'Ensure "end" is on its own line at the start of a statement'
        );
        break;

      case ContextErrorCode.UNCLOSED_PYTHON_BLOCK:
        my_suggestions.push('Add "end" command to close the python block');
        my_suggestions.push(
          'Ensure "end" is on its own line at the start of a statement'
        );
        break;

      case ContextErrorCode.UNEXPECTED_END:
        my_suggestions.push(
          'Remove "end" command or add a corresponding program, mata, python, or input block'
        );
        my_suggestions.push(
          '"end" can only be used to close a program, mata, python, or input block'
        );
        break;

      case ContextErrorCode.MISMATCHED_END_PYTHON:
        my_suggestions.push(
          'Remove "end python" command or add a corresponding "python" block'
        );
        my_suggestions.push(
          '"end python" can only be used to close a python block'
        );
        break;

      case ContextErrorCode.INVALID_DELIMITER_POSITION:
        my_suggestions.push(
          'Use "end" to close mata blocks, not "end mata"'
        );
        my_suggestions.push(
          'Ensure block delimiters are at statement boundaries'
        );
        break;

      case ContextErrorCode.NESTED_BLOCK_ERROR:
        my_suggestions.push(
          'Check that nested blocks are properly closed in the correct order'
        );
        my_suggestions.push(
          'Inner blocks must be closed before outer blocks'
        );
        break;
    }

    return my_suggestions;
  }

  /**
   * Check if a document can recover from malformed blocks.
   * Returns true if recovery is possible, false if structure is too broken.
   */
  can_recover_from_errors(): boolean {
    // If we have unclosed blocks but can still parse the rest, recovery is possible
    // If we have mismatched delimiters, we can still continue parsing
    // Only fail if the document structure is completely broken
    return this.diagnostics.length < 10; // Arbitrary threshold
  }

  /**
   * Attempt to recover from malformed blocks by finding likely end positions.
   * This is used for graceful degradation when blocks are not properly closed.
   */
  attempt_recovery_from_unclosed_block(
    start_line: number,
    _language: 'mata' | 'python'
  ): number | null {
    const my_doc = { content: this.document_content, line_offsets: compute_line_offsets(this.document_content) };
    const my_line_count = get_line_count(my_doc);

    // Search forward from start_line for a likely end position
    for (let my_i = start_line + 1; my_i < my_line_count; my_i++) {
      // Skip lines inside a multi-line block comment - a commented-out
      // `end`/`mata`/`python` is not a real recovery point.
      if (this.block_comment_continuation_lines.has(my_i)) {
        continue;
      }
      const my_line = get_line_text(my_doc, my_i);
      const my_code_part = this.extract_code_before_comment(my_line);
      const my_code_trimmed = my_code_part.trim();

      // Look for the end keyword
      if (my_code_trimmed === 'end') {
        return my_i;
      }

      // If we encounter another block start, stop searching
      if (
        my_code_trimmed === 'mata' ||
        my_code_trimmed === 'python'
      ) {
        return null; // Can't recover, another block started
      }
    }

    return null; // Reached EOF without finding end
  }

  /**
   * Get a list of common mistakes and their fixes.
   * Helps users understand what went wrong.
   */
  get_common_mistakes(): Array<{
    mistake: string;
    fix: string;
    example: string;
  }> {
    return [
      {
        mistake: 'Using "end mata" instead of "end"',
        fix: 'In mata blocks, use only "end" to close the block',
        example: 'mata\nmatrix A = (1, 2)\nend  // Correct',
      },
      {
        mistake: 'Using "end python" instead of "end"',
        fix: 'In python blocks, use only "end" to close the block',
        example: 'python\nx = 5\nend  // Correct',
      },
      {
        mistake: 'Using "end mata" instead of "end"',
        fix: 'In mata blocks, use only "end" to close the block',
        example: 'mata\nmatrix A = (1, 2)\nend  // Correct',
      },
      {
        mistake: 'Forgetting to close embedded blocks',
        fix: 'Always close both mata and python blocks with "end"',
        example: 'mata\nmatrix A = (1, 2)\nend  // Don\'t forget this',
      },
      {
        mistake: 'Using block delimiters inside strings or comments',
        fix: 'Block delimiters must be at statement boundaries, not in strings/comments',
        example: 'local x = "mata"  // This is a string, not a block start',
      },
      {
        mistake: 'Mismatched nested blocks',
        fix: 'Close inner blocks before outer blocks',
        example: 'mata\npython\nend\nend  // Correct order',
      },
    ];
  }
}