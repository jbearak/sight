import { Range, Position } from 'vscode-languageserver-textdocument';

/**
 * Represents the current language context during parsing.
 * Stata code can contain embedded Mata or Python blocks.
 */
export enum LanguageContext {
  STATA = 'stata',
  MATA = 'mata',
  PYTHON = 'python',
}

/**
 * Represents a range of code in a specific language context.
 * Tracks the start and end delimiters of embedded language blocks.
 */
export interface ContextRange {
  context: LanguageContext;
  range: Range;
  // For nested contexts (e.g., mata within mata)
  parent_context?: LanguageContext;
  // Block delimiter information
  start_delimiter: {
    command: string; // 'mata', 'python', 'mata:', 'python:'
    range: Range;
  };
  end_delimiter?: {
    command: string; // 'end', 'end python'
    range: Range;
  };
  // Whether this is a single-line context (mata:, python:)
  is_single_line: boolean;
}

/**
 * Diagnostic information for context structure errors.
 */
export interface ContextDiagnostic {
  message: string;
  range: Range;
  severity: 'error' | 'warning' | 'information';
  code: ContextErrorCode;
}

/**
 * Error codes for context-related diagnostics.
 */
export enum ContextErrorCode {
  UNCLOSED_MATA_BLOCK = 4001,
  UNCLOSED_PYTHON_BLOCK = 4002,
  UNEXPECTED_END = 4003,
  UNEXPECTED_END_COMMAND = 4004,
  MISMATCHED_END_PYTHON = 4005,
  NESTED_BLOCK_ERROR = 4006,
  INVALID_DELIMITER_POSITION = 4007,
}

/**
 * Interface for the Context Tracker component.
 * Maintains language context state during parsing and provides context
 * information to other LSP components.
 */
export interface IContextTracker {
  /**
   * Get the language context at a specific position.
   * @param position The position in the document
   * @returns The language context at that position
   */
  get_context_at_position(position: Position): LanguageContext;

  /**
   * Get all context ranges in the document.
   * @returns Array of all context ranges
   */
  get_all_context_ranges(): ContextRange[];

  /**
   * Get the context range containing a specific position.
   * @param position The position in the document
   * @returns The context range containing the position, or undefined
   */
  get_context_range_at_position(position: Position): ContextRange | undefined;

  /**
   * Check if a position is within an embedded language block.
   * @param position The position in the document
   * @returns True if the position is in an embedded language context
   */
  is_in_embedded_language(position: Position): boolean;

  /**
   * Validate context structure and return diagnostics for errors.
   * @returns Array of context diagnostics
   */
  validate_context_structure(): ContextDiagnostic[];

  /**
   * Get helpful suggestions for fixing context errors.
   * @param error The context diagnostic error
   * @returns Array of suggested fixes
   */
  get_error_recovery_suggestions(error: ContextDiagnostic): string[];

  /**
   * Check if a document can recover from malformed blocks.
   * @returns True if recovery is possible
   */
  can_recover_from_errors(): boolean;

  /**
   * Attempt to recover from malformed blocks by finding likely end positions.
   * @param start_line The line where the unclosed block starts
   * @param language The language type ('mata' or 'python')
   * @returns The line number of a likely end position, or null if recovery failed
   */
  attempt_recovery_from_unclosed_block(
    start_line: number,
    language: 'mata' | 'python'
  ): number | null;

  /**
   * Get a list of common mistakes and their fixes.
   * @returns Array of common mistakes with explanations and examples
   */
  get_common_mistakes(): Array<{
    mistake: string;
    fix: string;
    example: string;
  }>;
}
