/**
 * Document utilities for property-based testing.
 * Provides functions to create document state, parse, analyze, and extract information.
 */

import { DocumentState } from '../../../src/document-store';
import { StataLexer } from '../../../src/index';
import { StataParser } from '../../../src/index';
import { SemanticAnalyzer } from '../../../src/index';
import { ContextTracker } from '../../../src/context-tracker';
import { Token, TriviaNode } from '../../../src/types';
import { undefined_symbol_data_fields } from '../../../src/utils/undefined-symbol-diagnostic';
import { Position, Range } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver';

// Counter for generating unique URIs to avoid cache collisions
let document_counter = 0;

/**
 * Builds a complete DocumentState representing opening a document from the provided source.
 *
 * The returned state includes tokens, AST, semantic symbols, aggregated diagnostics (lexer, parser, semantic), context ranges and tracker, line offsets, a unique URI/version, and other metadata used for testing.
 *
 * @param my_source - The document content to tokenize, parse, and analyze
 * @returns A DocumentState containing uri, version, content, tokens, ast, symbols, diagnostics, context_ranges, context_tracker, line_offsets, and forward_calls
 */
export function create_document_state(my_source: string): DocumentState {
  const my_lexer = new StataLexer();
  const my_parser = new StataParser();
  const my_analyzer = new SemanticAnalyzer();
  const my_context_tracker = new ContextTracker();

  // Tokenize
  const my_lex_result = my_lexer.tokenize(my_source);

  // Parse
  const my_parse_result = my_parser.parse(my_lex_result.tokens);

  // Analyze - returns AnalysisResult with symbols property
  const my_analysis_result = my_analyzer.analyze(
    my_parse_result.ast,
    'file:///test.do',
    undefined,
    { undefined_variable_enabled: true }, // Enable undefined variable detection for tests
    my_lex_result.tokens
  );

  // Track context
  my_context_tracker.initialize_from_tokens(my_lex_result.tokens, my_source);
  const my_context_ranges = my_context_tracker.get_all_context_ranges();

  // Build line offsets for position lookups
  const my_line_offsets = build_line_offsets(my_source);

  // Convert lexer errors to LSP diagnostics format
  const my_lexer_diagnostics = my_lex_result.errors.map(error => ({
    range: error.range,
    message: error.message,
    severity: DiagnosticSeverity.Error,
    code: error.code,
    source: 'sight',
  }));

  // Convert parser errors to LSP diagnostics format
  const my_parser_diagnostics = my_parse_result.errors.map(error => ({
    range: error.range,
    message: error.message,
    severity: DiagnosticSeverity.Error,
    code: error.code,
    source: 'sight',
  }));

  // Convert semantic diagnostics to LSP diagnostics format. Mirror
  // DocumentStore.build_diagnostics by carrying the structured
  // symbol_name/reference_kind on `data` so the provider can recover the
  // referenced symbol without parsing message prose.
  const my_semantic_diagnostics = my_analysis_result.diagnostics.map(diag => ({
    range: diag.range,
    message: diag.message,
    severity: diag.severity === 'error' ? DiagnosticSeverity.Error :
              diag.severity === 'warning' ? DiagnosticSeverity.Warning :
              diag.severity === 'information' ? DiagnosticSeverity.Information :
              DiagnosticSeverity.Hint,
    code: diag.code,
    source: 'sight',
    ...undefined_symbol_data_fields(diag),
  }));

  // Combine all diagnostics
  const my_lsp_diagnostics = [
    ...my_lexer_diagnostics,
    ...my_parser_diagnostics,
    ...my_semantic_diagnostics,
  ];

  return {
    uri: 'file:///test.do',
    version: ++document_counter,  // Unique version to avoid cache collisions
    content: my_source,
    tokens: my_lex_result.tokens,
    ast: my_parse_result.ast,
    symbols: my_analysis_result.symbols,
    scopes: my_analysis_result.scopes,
    diagnostics: my_lsp_diagnostics,
    context_ranges: my_context_ranges,
    context_tracker: my_context_tracker,
    line_offsets: my_line_offsets,
    forward_calls: [],
    ignored_lines: my_analysis_result.ignored_lines,
  };
}

/**
 * Parse and analyze a document in one step.
 * Returns the full DocumentState with all analysis results.
 */
export function parse_and_analyze(my_source: string): DocumentState {
  return create_document_state(my_source);
}

/**
 * Extract all comments from a document.
 * Returns an array of comment trivia nodes with their positions.
 */
export function extract_comments(my_source: string): Array<{
  content: string;
  style: 'star' | 'slash' | 'block' | 'continuation';
  line: number;
  column: number;
}> {
  const my_doc_state = create_document_state(my_source);
  const my_comments: Array<{
    content: string;
    style: 'star' | 'slash' | 'block' | 'continuation';
    line: number;
    column: number;
  }> = [];

  // Extract comments from all nodes
  for (const my_node of my_doc_state.ast.nodes) {
    extract_comments_from_node(my_node, my_comments);
  }

  return my_comments;
}

function extract_comments_from_node(
  my_node: any,
  my_comments: Array<{
    content: string;
    style: 'star' | 'slash' | 'block' | 'continuation';
    line: number;
    column: number;
  }>
): void {
  if (!my_node) {
    return;
  }

  // Extract leading trivia
  if (my_node.leadingTrivia && Array.isArray(my_node.leadingTrivia)) {
    for (const my_trivia of my_node.leadingTrivia) {
      if (my_trivia.type === 'comment') {
        my_comments.push({
          content: my_trivia.content,
          style: my_trivia.style,
          line: my_trivia.range.start.line,
          column: my_trivia.range.start.character,
        });
      }
    }
  }

  // Extract trailing trivia
  if (my_node.trailingTrivia && Array.isArray(my_node.trailingTrivia)) {
    for (const my_trivia of my_node.trailingTrivia) {
      if (my_trivia.type === 'comment') {
        my_comments.push({
          content: my_trivia.content,
          style: my_trivia.style,
          line: my_trivia.range.start.line,
          column: my_trivia.range.start.character,
        });
      }
    }
  }

  // Recursively extract from body
  if (my_node.body && Array.isArray(my_node.body)) {
    for (const my_child of my_node.body) {
      extract_comments_from_node(my_child, my_comments);
    }
  }
}

/**
 * Get all non-whitespace tokens from a document.
 * Useful for comparing token sequences while ignoring whitespace differences.
 */
export function tokenize_non_whitespace(my_source: string): Token[] {
  const my_doc_state = create_document_state(my_source);
  return my_doc_state.tokens.filter(t => t.type !== 'WHITESPACE');
}

/**
 * Build line offset index for O(1) position lookups.
 * Returns an array where line_offsets[i] is the byte offset of line i.
 */
function build_line_offsets(my_source: string): number[] {
  const my_offsets: number[] = [0];
  for (let my_i = 0; my_i < my_source.length; my_i++) {
    if (my_source[my_i] === '\n') {
      my_offsets.push(my_i + 1);
    }
  }
  return my_offsets;
}

/**
 * Get the byte offset for a given position.
 */
export function position_to_offset(
  my_source: string,
  my_position: Position
): number {
  const my_lines = my_source.split('\n');
  let my_offset = 0;

  for (let my_i = 0; my_i < my_position.line && my_i < my_lines.length; my_i++) {
    my_offset += my_lines[my_i].length + 1; // +1 for newline
  }

  my_offset += my_position.character;
  return my_offset;
}

/**
 * Get the position for a given byte offset.
 */
export function offset_to_position(
  my_source: string,
  my_offset: number
): Position {
  const my_lines = my_source.split('\n');
  let my_current_offset = 0;

  for (let my_i = 0; my_i < my_lines.length; my_i++) {
    const my_line_length = my_lines[my_i].length + 1; // +1 for newline
    if (my_current_offset + my_line_length > my_offset) {
      return {
        line: my_i,
        character: my_offset - my_current_offset,
      };
    }
    my_current_offset += my_line_length;
  }

  // Fallback to end of document
  const my_last_line = my_lines.length - 1;
  return {
    line: my_last_line,
    character: my_lines[my_last_line].length,
  };
}

/**
 * Find the position of a specific string in the document.
 * Returns the first occurrence or null if not found.
 */
export function find_position_of(my_source: string, my_search: string): Position | null {
  const my_index = my_source.indexOf(my_search);
  if (my_index === -1) {
    return null;
  }
  return offset_to_position(my_source, my_index);
}

/**
 * Find all positions of a specific string in the document.
 */
export function find_all_positions_of(my_source: string, my_search: string): Position[] {
  const my_positions: Position[] = [];
  let my_index = 0;

  while ((my_index = my_source.indexOf(my_search, my_index)) !== -1) {
    my_positions.push(offset_to_position(my_source, my_index));
    my_index += my_search.length;
  }

  return my_positions;
}