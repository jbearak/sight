import { Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { LanguageContext } from '../context-tracker/types';
import { StataDiagnosticCode, StataLSPConfig, StataNode, StataAST, ControlFlowNode, ProgramNode, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';

const CONTROL_FLOW_RE = /^(if|foreach|while|program|mata|python)\b/;
const FIRST_WORD_RE = /^(\w+)\b/;

// Parse/lex errors that specifically corrupt BLOCK NESTING (brace pairing /
// program-body extent), making the AST-derived indentation depth untrustworthy
// in the region around them. When one is present, an error-recovering parse can
// misparent following statements into an unterminated block, giving correctly-
// indented lines a bogus expected depth. We suppress the AST-depth indentation
// check on the affected block only (see compute_structural_taint) rather than
// trusting the corrupted depth. Codes are compared as strings because
// parser/lexer codes are not all mirrored into StataDiagnosticCode.
//
// Only errors that specifically corrupt BLOCK NESTING (brace pairing /
// program-body extent / whole-file tokenization) belong here: an
// error-recovering parse can then misparent following statements into an
// unterminated block, giving correctly-indented lines a bogus expected depth.
// We suppress the AST-depth indentation check on the smallest enclosing block
// (see compute_structural_taint) rather than trust the corrupted depth. Codes
// are compared as strings because parser/lexer codes are not all mirrored into
// StataDiagnosticCode.
//
// Deliberately EXCLUDED are codes that leave block nesting intact, where
// tainting would only hide genuine indentation diagnostics with no false
// positive to prevent:
//  - UNBALANCED_PARENTHESES: parentheses are not block delimiters, so a
//    brace-balanced block with a bad paren still has trustworthy depths.
//  - the generic SYNTAX_ERROR: parser recovery emits it for statement-local
//    problems too (e.g. `unab m x`), and since the smallest enclosing block of
//    a program-body error is the whole program, tainting it would swallow the
//    program's real indentation diagnostics. Brace/block misparenting already
//    surfaces a brace-structure code (e.g. an unterminated `#delimit ;` brace
//    block emits ORPHAN_CLOSE_BRACE on the stray close brace), so dropping the
//    generic code loses no genuine coverage.
//  - FORVALUES_SYNTAX, STRAY_TOKEN_IN_CONDITION, etc.: statement-local.
const STRUCTURAL_NESTING_ERROR_CODES = new Set<string>([
  'OPEN_BRACE_ALONE',
  'ORPHAN_CLOSE_BRACE',
  'BRACE_NOT_ALONE',
  'BRACE_ELSE_SAME_LINE',
  'CODE_AFTER_OPEN_BRACE',
  'UNCLOSED_BLOCK',
  'MISSING_PROGRAM_END',
  'UNBALANCED_QUOTES',
  'UNBALANCED_BLOCK_COMMENT',
]);

export class IndentationDiagnosticAnalyzer {
  analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = document.content.split('\n');

    // Skip if indentation diagnostics are disabled
    if (config.diagnostics.indentation === false) {
      return diagnostics;
    }

    const indent_size = config.formatting?.indentSize ?? 4;

    // Get Stata-only ranges (exclude embedded language blocks)
    const stataRanges = this.getStataRanges(document);
    
    // Compute block comment lines to exclude from indentation checks.
    // Prefer the lexer tokens so `/*` inside strings/code is not
    // mistaken for a comment opener; fall back to a raw scan when
    // tokens are absent.
    const block_comment_lines = this.compute_block_comment_lines(lines, document.tokens);
    
    // Compute continuation lines from tokens for efficient lookup
    const continuation_lines = document.tokens
      ? this.compute_continuation_lines(document.tokens)
      : new Set<number>();

    // Lines whose AST-derived depth is untrustworthy because a structural
    // parse error corrupted the enclosing block's nesting. Range-independent,
    // so compute once. Empty in the common (clean-parse) case.
    const structural_taint = this.compute_structural_taint(document);

    for (const range of stataRanges) {
      diagnostics.push(...this.find_comment_indentation_issues(lines, range, block_comment_lines, indent_size));
      diagnostics.push(...this.find_block_indentation_issues(document, lines, range, block_comment_lines, indent_size, continuation_lines));
      
      // Compute expected depths from the AST and flag lines whose actual
      // indentation disagrees (too deep -> unnecessary, too shallow ->
      // missing).
      const expected_depths = this.compute_expected_depths(document, range);
      diagnostics.push(...this.find_ast_depth_indentation_issues(lines, range, block_comment_lines, indent_size, expected_depths, continuation_lines, structural_taint));
    }

    // Multiple producers can flag the same line with the same code; collapse
    // those duplicates (e.g. brace scan + AST-depth both emit MISSING).
    return this.dedupe_by_line_and_code(diagnostics);
  }

  /**
   * Compute a set of line numbers that are continuation lines.
   * A line is a continuation if the previous line has a CONTINUATION token.
   * 
   * @param tokens - The document's tokens
   * @returns Set of 0-indexed line numbers that are continuation lines
   */
  private compute_continuation_lines(tokens: Token[]): Set<number> {
    const continuation_lines = new Set<number>();
    
    for (const my_token of tokens) {
      if (my_token.type === 'CONTINUATION') {
        // The line AFTER the continuation token is a continuation line
        continuation_lines.add(my_token.range.start.line + 1);
      }
    }
    
    return continuation_lines;
  }

  private getStataRanges(document: DocumentState): Array<{ start: number; end: number }> {
    const context_ranges = document.context_tracker.get_all_context_ranges();
    const totalLines = document.content.split('\n').length;
    
    // If no embedded contexts, return full document range
    if (context_ranges.length === 0) {
      return [{ start: 0, end: totalLines - 1 }];
    }
    
    const ranges: Array<{ start: number; end: number }> = [];
    let currentStart = 0;
    
    for (const context_range of context_ranges) {
      // If this is not a Stata context, add the range before it
      if (context_range.context !== LanguageContext.STATA) {
        if (currentStart < context_range.range.start.line) {
          ranges.push({ start: currentStart, end: context_range.range.start.line - 1 });
        }
        currentStart = context_range.range.end.line + 1;
      }
    }
    
    // Add final range if needed
    if (currentStart < totalLines) {
      ranges.push({ start: currentStart, end: totalLines - 1 });
    }
    
    return ranges.length > 0 ? ranges : [{ start: 0, end: totalLines - 1 }];
  }

  /**
   * Calculate the visual width of leading whitespace, accounting for tab stops.
   * Tabs expand to the next multiple of indent_size (tab stop).
   * 
   * @param line - The full line of text
   * @param indent_size - Tab stop interval (typically 4, validated by config system)
   * @returns Visual column width of leading whitespace
   */
  private get_line_indentation(line: string, indent_size: number): number {
    let visual_column = 0;
    for (const char of line) {
      if (char === ' ') {
        visual_column += 1;
      } else if (char === '\t') {
        // Tab advances to next tab stop (next multiple of indent_size)
        visual_column = Math.ceil((visual_column + 1) / indent_size) * indent_size;
      } else {
        break;
      }
    }
    return visual_column;
  }

  private is_continuation_line(lineIndex: number, continuation_lines: Set<number>): boolean {
    return continuation_lines.has(lineIndex);
  }

  private find_comment_indentation_issues(lines: string[], range: { start: number; end: number }, block_comment_lines: Set<number>, indent_size: number): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    for (let i = range.start; i < range.end && i < lines.length - 1; i++) {
      // Skip lines inside block comments (Requirements 1.1, 1.2, 1.3)
      if (block_comment_lines.has(i) || block_comment_lines.has(i + 1)) {
        continue;
      }
      
      const line = lines[i];
      const nextLine = lines[i + 1];
      const trimmed = line.trim();
      const nextTrimmed = nextLine.trim();
      
      // Check if current line is a comment
      if ((trimmed.startsWith('*') || trimmed.startsWith('//')) && 
          nextTrimmed && 
          !nextTrimmed.startsWith('*') && 
          !nextTrimmed.startsWith('//')) {
        
        const commentIndent = this.get_line_indentation(line, indent_size);
        const nextIndent = this.get_line_indentation(nextLine, indent_size);
        
        // Check if next line is unnecessarily indented
        if (nextIndent > commentIndent && !this.is_control_flow_start(nextTrimmed)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Information,
            range: Range.create(
              Position.create(i + 1, 0),
              Position.create(i + 1, nextIndent)
            ),
            message: 'Line appears unnecessarily indented after comment. Use Format Document to fix.',
            source: 'sight',
            code: StataDiagnosticCode.UNNECESSARY_INDENTATION,
            ...diagnostic_code_description_fields(
              StataDiagnosticCode.UNNECESSARY_INDENTATION
            ),
          });
        }
      }
    }
    
    return diagnostics;
  }

  private find_block_indentation_issues(document: DocumentState, lines: string[], range: { start: number; end: number }, block_comment_lines: Set<number>, indent_size: number, continuation_lines: Set<number>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    // Look for opening braces - either standalone or at end of control flow statements
    for (let i = range.start; i <= range.end && i < lines.length; i++) {
      // Skip lines inside block comments (Requirements 1.1, 1.2, 1.3)
      if (block_comment_lines.has(i)) {
        continue;
      }
      
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check for opening brace - either standalone '{' or at end of line like 'if ... {'
      const has_opening_brace = trimmed === '{' || trimmed.endsWith('{');
      
      if (has_opening_brace) {
        // If this line is a continuation line, trace back to find the original statement's indentation
        const braceIndent = this.get_statement_indentation(lines, i, range.start, indent_size, continuation_lines);
        let braceDepth = 1;
        
        // Check lines inside the block
        for (let j = i + 1; j <= range.end && j < lines.length && braceDepth > 0; j++) {
          // Skip lines inside block comments (Requirements 1.1, 1.2, 1.3)
          if (block_comment_lines.has(j)) {
            continue;
          }
          
          const innerLine = lines[j];
          const innerTrimmed = innerLine.trim();
          
          // Track brace depth for nested blocks
          if (innerTrimmed.endsWith('{') || innerTrimmed === '{') {
            braceDepth++;
          }
          if (innerTrimmed === '}' || innerTrimmed.startsWith('}')) {
            braceDepth--;
            if (braceDepth === 0) {
              break;
            }
          }
          
          // Only check lines at the current nesting level (braceDepth === 1)
          if (braceDepth !== 1) {
            continue;
          }
          
          // Skip empty lines, comments, and closing braces
          if (!innerTrimmed || innerTrimmed.startsWith('*') || innerTrimmed.startsWith('//') || innerTrimmed === '}') {
            continue;
          }
          
          // Skip continuation lines
          if (this.is_continuation_line(j, continuation_lines)) {
            continue;
          }
          
          const innerIndent = this.get_line_indentation(innerLine, indent_size);
          
          // Check if line should be indented more than the brace line
          if (innerIndent <= braceIndent) {
            diagnostics.push({
              severity: DiagnosticSeverity.Information,
              range: Range.create(
                Position.create(j, 0),
                Position.create(j, innerIndent)
              ),
              message: 'Line should be indented inside brace block. Use Format Document to fix.',
              source: 'sight',
              code: StataDiagnosticCode.MISSING_INDENTATION,
              ...diagnostic_code_description_fields(
                StataDiagnosticCode.MISSING_INDENTATION
              ),
            });
          }
        }
      }
    }
    
    return diagnostics;
  }

  private is_control_flow_start(line: string): boolean {
    if (line === '{') return true;
    if (CONTROL_FLOW_RE.test(line)) return true;
    const my_match = line.match(FIRST_WORD_RE);
    if (my_match) {
      const my_word = my_match[1];
      if (my_word.length >= 4 && 'forvalues'.startsWith(my_word)) return true;
    }
    return false;
  }

  /**
   * Computes a Set of line numbers that are inside block comments.
   * A line is considered "inside" a block comment if:
   * - It contains the opening delimiter (from that point to end of line)
   * - It is entirely within an open block comment
   * - It contains the closing delimiter (from start of line to that point)
   * 
   * Nested block openers increase comment depth, matching the lexer and
   * TextMate grammar.
   *
   * When `tokens` are supplied, the lines are derived from the lexer's
   * COMMENT_BLOCK token ranges, which already exclude `/*` sequences
   * that appear inside string literals or other code. Without tokens, a
   * raw text scan is used as a fallback (it cannot tell a real opener
   * from one inside a string).
   */
  compute_block_comment_lines(lines: string[], tokens?: Token[]): Set<number> {
    if (tokens && tokens.length > 0) {
      return this.block_comment_lines_from_tokens(tokens);
    }

    const block_comment_lines = new Set<number>();
    let block_comment_depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;

      while (j < line.length) {
        if (j + 1 < line.length && line[j] === '/' && line[j + 1] === '*') {
          block_comment_depth++;
          block_comment_lines.add(i);
          j += 2;
          continue;
        }

        if (block_comment_depth > 0) {
          // Already in block comment - this line is inside
          block_comment_lines.add(i);

          if (j + 1 < line.length && line[j] === '*' && line[j + 1] === '/') {
            block_comment_depth--;
            j += 2;
            continue;
          }
        }
        j++;
      }

      // If we're still in a block comment at end of line, mark this line
      if (block_comment_depth > 0) {
        block_comment_lines.add(i);
      }
    }

    return block_comment_lines;
  }

  /**
   * Derive the set of block-comment lines from the lexer's comment
   * tokens. A COMMENT_BLOCK token already spans its full (possibly
   * nested) extent, and a line-leading `*` comment that absorbs an
   * unclosed `/*` becomes a COMMENT_LINE token spanning several lines;
   * both put their covered lines inside a comment. `/*` inside strings
   * or code never produces a comment token, so it is correctly ignored.
   * Single-line `//` / `*` comments are excluded (handled elsewhere).
   */
  private block_comment_lines_from_tokens(tokens: Token[]): Set<number> {
    const the_block_comment_lines = new Set<number>();

    for (const my_token of tokens) {
      const my_spans_lines =
        my_token.range.end.line > my_token.range.start.line;
      const my_is_multiline_comment =
        my_token.type === 'COMMENT_BLOCK' ||
        (my_token.type === 'COMMENT_LINE' && my_spans_lines);
      if (!my_is_multiline_comment) {
        continue;
      }
      for (
        let my_line = my_token.range.start.line;
        my_line <= my_token.range.end.line;
        my_line++
      ) {
        the_block_comment_lines.add(my_line);
      }
    }

    return the_block_comment_lines;
  }

  /**
   * Get the indentation of the statement that a line belongs to.
   * If the line is a continuation (previous line ends with ///), trace back
   * to find the original statement's indentation.
   */
  private get_statement_indentation(lines: string[], lineIndex: number, rangeStart: number, indent_size: number, continuation_lines: Set<number>): number {
    let current_index = lineIndex;
    
    // Trace back through continuation lines to find the original statement
    while (current_index > rangeStart && continuation_lines.has(current_index)) {
      current_index--;
    }
    
    // Return the indentation of the original statement line
    return this.get_line_indentation(lines[current_index], indent_size);
  }

  /**
   * Compute expected indentation depth for brace blocks from command nodes.
   * Returns a Map from line number to depth for lines inside brace blocks.
   * 
   * This method tracks depth through both control flow blocks (if, foreach, etc.)
   * and prefix command brace blocks (capture { }, quietly { }, etc.).
   */
  private compute_brace_block_depths(
    ast: StataAST,
    range: { start: number; end: number }
  ): Map<number, number> {
    const brace_depths = new Map<number, number>();
    
    const walk_node = (node: StataNode, current_depth: number): void => {
      const start_line = node.range.start.line;
      
      // Set depth for this node's start line
      if (start_line >= range.start && start_line <= range.end) {
        const existing = brace_depths.get(start_line) ?? 0;
        brace_depths.set(start_line, Math.max(existing, current_depth));
      }
      
      // Check if this is a prefix command brace block
      if (node.type === 'command' && 'name' in node && node.name === '{') {
        const end_line = node.range.end.line;
        
        // If the node has a body, recurse into it with increased depth
        if ('body' in node && node.body && Array.isArray(node.body)) {
          for (const child of node.body) {
            walk_node(child, current_depth + 1);
          }
        } else {
          // Fallback: mark interior lines with increased depth (for nodes without body)
          for (let line = start_line + 1; line < end_line; line++) {
            if (line >= range.start && line <= range.end) {
              const existing = brace_depths.get(line) ?? 0;
              brace_depths.set(line, Math.max(existing, current_depth + 1));
            }
          }
        }
        
        // Closing brace gets same depth as opening
        if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
          const existing = brace_depths.get(end_line) ?? 0;
          brace_depths.set(end_line, Math.max(existing, current_depth));
        }
        
        return;
      }
      
      // Check if this is a control flow block that increases depth
      const is_control_flow = node.type === 'program' ||
                              node.type === 'if' ||
                              node.type === 'else' ||
                              node.type === 'foreach' ||
                              node.type === 'forvalues' ||
                              node.type === 'while' ||
                              node.type === 'frame';
      
      if (is_control_flow && node.body) {
        // Recurse into body with increased depth. Mirror the same-line
        // child rule in compute_expected_depths: a block child that
        // starts on the parent's line (e.g. the `if` of an `else if`)
        // stays at the parent's depth. Without this, the two depth maps
        // disagree and Math.max in the merge would pick the deeper,
        // wrong value, producing spurious diagnostics on correctly
        // formatted `else if` blocks.
        for (const child of node.body) {
          // A child that starts on the parent's physical line shares that
          // line's indentation, so it stays at the parent's depth (e.g. the
          // `if` of `else if`, the `capture {` of `else capture {`, or the
          // `display` of `else display 2`). Only children on a later line are
          // indented one level deeper.
          const child_start_line = child.range.start.line;
          if (child_start_line === start_line) {
            walk_node(child, current_depth);
          } else {
            walk_node(child, current_depth + 1);
          }
        }
        
        // Set closing brace depth
        const end_line = node.range.end.line;
        if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
          const existing = brace_depths.get(end_line) ?? 0;
          brace_depths.set(end_line, Math.max(existing, current_depth));
        }
      } else if ('body' in node && node.body) {
        // Non-block node with body - recurse without increasing depth
        for (const child of node.body) {
          walk_node(child, current_depth);
        }
      }
    };
    
    for (const node of ast.nodes) {
      walk_node(node, 0);
    }
    
    return brace_depths;
  }

  /**
   * Compute expected indentation depth for each line using AST traversal.
   * Returns a Map from line number to expected depth.
   * 
   * This method walks the AST and tracks the nesting depth for control flow
   * blocks: if, foreach, forvalues, while, program, mata, python, frame.
   * 
   * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2
   */
  compute_expected_depths(
    document: DocumentState,
    range: { start: number; end: number }
  ): Map<number, number> {
    const expected_depths = new Map<number, number>();
    
    // If no AST available, return empty map (fallback to existing behavior)
    if (!document.ast) {
      return expected_depths;
    }
    
    // Walk the AST and compute expected depths
    // Pass depth as parameter to avoid shared state issues across sibling nodes
    const walk_node = (node: StataNode, depth: number): void => {
      const start_line = node.range.start.line;
      const end_line = node.range.end.line;
      
      // Only process lines within the specified range
      if (start_line >= range.start && start_line <= range.end) {
        // Set expected depth for the start line
        if (!expected_depths.has(start_line)) {
          expected_depths.set(start_line, depth);
        }
      }
      
      // Handle embedded_block nodes (Mata/Python blocks)
      // The end delimiter should be at the same depth as the start delimiter
      // Don't recurse into embedded block content (it's a different language)
      if (node.type === 'embedded_block') {
        // Set expected depth for the end line (containing 'end')
        if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
          if (!expected_depths.has(end_line)) {
            expected_depths.set(end_line, depth);
          }
        }
        // Don't recurse into embedded block content
        return;
      }
      
      // Check if this is a block node that increases depth
      if (this.is_block_node_type(node)) {
        const block_node = node as ControlFlowNode | ProgramNode;
        
        // Process body nodes with increased depth
        for (const my_child of block_node.body) {
          // A child that starts on the parent's physical line shares that
          // line's indentation, so it stays at the parent's depth. Handles
          // "else if", "else capture {", and "else display 2" (a plain command
          // on the `else` line). Only children on a later line indent deeper.
          const child_start_line = my_child.range.start.line;
          if (child_start_line === start_line) {
            // Use parent depth for this child (same line)
            walk_node(my_child, depth);
          } else {
            walk_node(my_child, depth + 1);
          }
        }
        
        // Set expected depth for the end line (closing brace)
        if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
          if (!expected_depths.has(end_line)) {
            expected_depths.set(end_line, depth);
          }
        }
      }
    };
    
    // Walk all top-level nodes
    for (const my_node of document.ast.nodes) {
      walk_node(my_node, 0);
    }
    
    // Compute and merge brace block depths
    const brace_depths = this.compute_brace_block_depths(document.ast, range);
    for (const [line, depth] of brace_depths) {
      const existing_depth = expected_depths.get(line) ?? 0;
      expected_depths.set(line, Math.max(existing_depth, depth));
    }
    
    return expected_depths;
  }

  /**
   * Check if a node is a block node that increases indentation depth.
   * Note: Command brace blocks (e.g., capture { }) are handled separately
   * by compute_brace_block_depths, not here.
   */
  private is_block_node_type(node: StataNode): boolean {
    return node.type === 'program' ||
           node.type === 'if' ||
           node.type === 'else' ||
           node.type === 'foreach' ||
           node.type === 'forvalues' ||
           node.type === 'while' ||
           node.type === 'frame';
  }

  /**
   * Check if a line should be excluded from unnecessary indentation checks.
   * Excludes: blank lines, comment-only lines, continuation lines, block comment lines.
   * 
   * Requirements: 2.3, 2.4
   */
  should_skip_unnecessary_check(
    line: string,
    lineIndex: number,
    block_comment_lines: Set<number>,
    continuation_lines: Set<number>
  ): boolean {
    // Skip lines inside block comments
    if (block_comment_lines.has(lineIndex)) {
      return true;
    }
    
    const trimmed = line.trim();
    
    // Skip blank lines (empty or whitespace-only)
    if (trimmed === '') {
      return true;
    }
    
    // Skip comment-only lines (* or // at start after trimming)
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
      return true;
    }
    
    // Skip continuation lines (using token-based detection)
    if (continuation_lines.has(lineIndex)) {
      return true;
    }
    
    return false;
  }

  /**
   * Find lines whose actual indentation disagrees with the AST-computed
   * expected depth, in both directions:
   * - actual > expected -> UNNECESSARY_INDENTATION (too deep)
   * - actual < expected -> MISSING_INDENTATION (too shallow)
   * - actual === expected -> no diagnostic
   *
   * The too-shallow check only fires for lines with a KNOWN expected depth
   * (present in `expected_depths`). Lines absent from the map default to
   * expected depth 0, and actual indentation can never be negative, so the
   * guard changes nothing today; it documents intent and stays correct if
   * the default ever changes. The too-deep check keeps its default-0
   * behavior so top-level over-indentation of AST-unknown lines is still
   * reported.
   *
   * Requirements: 1.1, 2.1, 2.2
   */
  find_ast_depth_indentation_issues(
    lines: string[],
    range: { start: number; end: number },
    block_comment_lines: Set<number>,
    indent_size: number,
    expected_depths: Map<number, number>,
    continuation_lines: Set<number>,
    structural_taint: Set<number>
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (let i = range.start; i <= range.end && i < lines.length; i++) {
      const line = lines[i];

      // Skip excluded lines, and lines whose AST depth is untrustworthy because
      // a structural parse error corrupted the enclosing block's nesting. On a
      // tainted line neither too-deep nor too-shallow is reliable, so suppress
      // both rather than emit a false positive (a miss, not a false positive).
      if (this.should_skip_unnecessary_check(line, i, block_comment_lines, continuation_lines) ||
          structural_taint.has(i)) {
        continue;
      }

      const actual_indent = this.get_line_indentation(line, indent_size);

      // Get expected depth from AST, default to 0 (top-level) if not found
      const has_known_depth = expected_depths.has(i);
      const expected_depth = expected_depths.get(i) ?? 0;
      const expected_indent = expected_depth * indent_size;

      if (actual_indent > expected_indent) {
        // Too deep: unnecessary indentation.
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: Range.create(
            Position.create(i, 0),
            Position.create(i, actual_indent)
          ),
          message: 'Line appears unnecessarily indented. Use Format Document to fix.',
          source: 'sight',
          code: StataDiagnosticCode.UNNECESSARY_INDENTATION,
          ...diagnostic_code_description_fields(
            StataDiagnosticCode.UNNECESSARY_INDENTATION
          ),
        });
      } else if (has_known_depth && actual_indent < expected_indent) {
        // Too shallow: missing indentation for a known block depth.
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: Range.create(
            Position.create(i, 0),
            Position.create(i, actual_indent)
          ),
          message: 'Line appears under-indented for its block depth. Use Format Document to fix.',
          source: 'sight',
          code: StataDiagnosticCode.MISSING_INDENTATION,
          ...diagnostic_code_description_fields(
            StataDiagnosticCode.MISSING_INDENTATION
          ),
        });
      }
    }

    return diagnostics;
  }

  /**
   * Compute the set of line numbers whose AST-derived indentation depth is
   * untrustworthy because a structural parse/lex error corrupted the enclosing
   * block's nesting. For each structural error (see
   * STRUCTURAL_NESTING_ERROR_CODES) we taint the smallest AST block that
   * contains the error line, so suppression is confined to the malformed block
   * — healthy sibling and ancestor blocks keep reporting. When no block
   * contains the error line (top-level error), only that line is tainted.
   *
   * `document.diagnostics` and `document.ast` are produced by the same parse
   * pass, so the two are consistent and the taint toggles together with the
   * diagnostics in a single publish — no transient flicker in healthy regions.
   */
  private compute_structural_taint(document: DocumentState): Set<number> {
    const tainted_lines = new Set<number>();

    const the_error_lines: number[] = [];
    for (const my_diagnostic of document.diagnostics) {
      const my_code =
        typeof my_diagnostic.code === 'string' ? my_diagnostic.code : '';
      if (STRUCTURAL_NESTING_ERROR_CODES.has(my_code)) {
        the_error_lines.push(my_diagnostic.range.start.line);
      }
    }

    // Common case: no structural errors, nothing tainted.
    if (the_error_lines.length === 0) {
      return tainted_lines;
    }

    // No AST to locate the enclosing block — taint just the error lines.
    if (!document.ast) {
      for (const my_error_line of the_error_lines) {
        tainted_lines.add(my_error_line);
      }
      return tainted_lines;
    }

    for (const my_error_line of the_error_lines) {
      const my_block = this.find_smallest_block_containing(
        document.ast,
        my_error_line
      );
      if (my_block) {
        for (
          let my_line = my_block.range.start.line;
          my_line <= my_block.range.end.line;
          my_line++
        ) {
          tainted_lines.add(my_line);
        }
      } else {
        tainted_lines.add(my_error_line);
      }
    }

    return tainted_lines;
  }

  /**
   * Find the smallest (deepest) block node whose line span contains `line`,
   * or null if no block node contains it. "Block node" means a control-flow
   * block (if/else/foreach/forvalues/while/program/frame) or a prefix-command
   * brace block (`capture { }`, `quietly { }`, ...) — the constructs whose
   * body indentation the AST-depth check relies on.
   */
  private find_smallest_block_containing(
    ast: StataAST,
    line: number
  ): StataNode | null {
    let best: StataNode | null = null;

    const walk = (node: StataNode): void => {
      const start_line = node.range.start.line;
      const end_line = node.range.end.line;
      if (line < start_line || line > end_line) {
        return;
      }
      if (this.is_indentation_block_node(node)) {
        // Descending depth-first, later matches are deeper; `<=` keeps the
        // smallest-span (deepest) containing block.
        if (
          best === null ||
          end_line - start_line <=
            best.range.end.line - best.range.start.line
        ) {
          best = node;
        }
      }
      if ('body' in node && Array.isArray(node.body)) {
        for (const my_child of node.body) {
          walk(my_child);
        }
      }
    };

    for (const my_node of ast.nodes) {
      walk(my_node);
    }

    return best;
  }

  /**
   * Whether a node opens an indentation block: a control-flow block
   * (if/else/foreach/forvalues/while/program/frame) or a prefix-command brace
   * block (`capture { }`, `quietly { }`, ...). Single sources the "block
   * child" test used by both same-line depth handling and structural taint,
   * so `else capture {` (a prefix brace opened on the same line as `else`) is
   * treated like `else if` and not pushed one level too deep.
   */
  private is_indentation_block_node(node: StataNode): boolean {
    if (this.is_block_node_type(node)) {
      return true;
    }
    return node.type === 'command' && 'name' in node && node.name === '{';
  }

  /**
   * Collapse indentation diagnostics that share the same start line and
   * code, keeping the first occurrence. This analyzer runs multiple
   * producers over each Stata range (comment heuristic, textual brace
   * scan, AST-depth check), and more than one can flag the same line with
   * the same code — e.g. the brace scan and the AST-depth check both emit
   * MISSING_INDENTATION for an under-indented body line. A physical line
   * has a single indentation state per code, so collapsing duplicates
   * never drops a distinct, separately-actionable diagnostic. This also
   * dedupes overlapping UNNECESSARY_INDENTATION from the comment heuristic
   * and the AST-depth check.
   */
  private dedupe_by_line_and_code(diagnostics: Diagnostic[]): Diagnostic[] {
    const seen_line_codes = new Set<string>();
    const deduped: Diagnostic[] = [];
    for (const my_diagnostic of diagnostics) {
      const my_key = `${my_diagnostic.range.start.line}:${my_diagnostic.code}`;
      if (seen_line_codes.has(my_key)) {
        continue;
      }
      seen_line_codes.add(my_key);
      deduped.push(my_diagnostic);
    }
    return deduped;
  }
}
