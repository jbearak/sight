import { Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { LanguageContext } from '../context-tracker/types';
import { StataDiagnosticCode, StataLSPConfig, StataNode, ControlFlowNode, ProgramNode } from '../types';

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
    
    // Compute block comment lines to exclude from indentation checks
    const block_comment_lines = this.compute_block_comment_lines(lines);
    
    for (const range of stataRanges) {
      diagnostics.push(...this.find_comment_indentation_issues(lines, range, block_comment_lines, indent_size));
      diagnostics.push(...this.find_block_indentation_issues(document, lines, range, block_comment_lines, indent_size));
      
      // NEW: Compute expected depths from AST and find unnecessary indentation issues
      const expected_depths = this.compute_expected_depths(document, range);
      diagnostics.push(...this.find_unnecessary_indentation_issues(document, lines, range, block_comment_lines, indent_size, expected_depths));
    }

    return diagnostics;
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

  private get_line_indentation(line: string, indent_size: number): number {
    let level = 0;
    for (const char of line) {
      if (char === ' ') {
        level += 1;
      } else if (char === '\t') {
        level += indent_size;
      } else {
        break;
      }
    }
    return level;
  }

  private is_continuation_line(line: string, prevLine: string): boolean {
    const prevTrimmed = prevLine.trim();
    return prevTrimmed.endsWith('///');
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
          });
        }
      }
    }
    
    return diagnostics;
  }

  private find_block_indentation_issues(document: DocumentState, lines: string[], range: { start: number; end: number }, block_comment_lines: Set<number>, indent_size: number): Diagnostic[] {
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
        const braceIndent = this.get_statement_indentation(lines, i, range.start, indent_size);
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
          if (j > i + 1 && this.is_continuation_line(innerLine, lines[j - 1])) {
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
            });
          }
        }
      }
    }
    
    return diagnostics;
  }

  private is_control_flow_start(line: string): boolean {
    return /^(if|foreach|forvalues|while|program|mata|python)\b/.test(line) || line === '{';
  }

  /**
   * Computes a Set of line numbers that are inside block comments.
   * A line is considered "inside" a block comment if:
   * - It contains the opening delimiter (from that point to end of line)
   * - It is entirely within an open block comment
   * - It contains the closing delimiter (from start of line to that point)
   * 
   * Note: Stata doesn't support nested block comments, so the first
   * closing delimiter ends the comment regardless of any opening
   * sequences inside.
   */
  compute_block_comment_lines(lines: string[]): Set<number> {
    const block_comment_lines = new Set<number>();
    let in_block_comment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;

      while (j < line.length) {
        if (!in_block_comment) {
          // Look for /* (with bounds check for j + 1)
          if (j + 1 < line.length && line[j] === '/' && line[j + 1] === '*') {
            in_block_comment = true;
            block_comment_lines.add(i);
            j += 2;
            continue;
          }
        } else {
          // Already in block comment - this line is inside
          block_comment_lines.add(i);

          // Look for */ (with bounds check for j + 1)
          if (j + 1 < line.length && line[j] === '*' && line[j + 1] === '/') {
            in_block_comment = false;
            j += 2;
            continue;
          }
        }
        j++;
      }

      // If we're still in a block comment at end of line, mark this line
      if (in_block_comment) {
        block_comment_lines.add(i);
      }
    }

    return block_comment_lines;
  }

  /**
   * Get the indentation of the statement that a line belongs to.
   * If the line is a continuation (previous line ends with ///), trace back
   * to find the original statement's indentation.
   */
  private get_statement_indentation(lines: string[], lineIndex: number, rangeStart: number, indent_size: number): number {
    let current_index = lineIndex;
    
    // Trace back through continuation lines to find the original statement
    while (current_index > rangeStart) {
      const prev_line = lines[current_index - 1];
      const prev_trimmed = prev_line.trim();
      
      // If previous line ends with ///, this is a continuation - keep going back
      if (prev_trimmed.endsWith('///')) {
        current_index--;
      } else {
        break;
      }
    }
    
    // Return the indentation of the original statement line
    return this.get_line_indentation(lines[current_index], indent_size);
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
    let current_depth = 0;
    
    const walk_node = (node: StataNode): void => {
      const start_line = node.range.start.line;
      const end_line = node.range.end.line;
      
      // Only process lines within the specified range
      if (start_line >= range.start && start_line <= range.end) {
        // Set expected depth for the start line
        if (!expected_depths.has(start_line)) {
          expected_depths.set(start_line, current_depth);
        }
      }
      
      // Check if this is a block node that increases depth
      if (this.is_block_node_type(node)) {
        const block_node = node as ControlFlowNode | ProgramNode;
        
        // Increase depth for body
        current_depth++;
        
        // Process body nodes
        for (const my_child of block_node.body) {
          // Special case: if a child starts on the same line as the parent block,
          // it should be at the parent's indentation level, not indented.
          // This handles "else if" where the "if" is on the same line as "else".
          const child_start_line = my_child.range.start.line;
          if (child_start_line === start_line && this.is_block_node_type(my_child)) {
            // Temporarily restore parent depth for this child
            current_depth--;
            walk_node(my_child);
            current_depth++;
          } else {
            walk_node(my_child);
          }
        }
        
        // Decrease depth after body
        current_depth--;
        
        // Set expected depth for the end line (closing brace)
        if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
          if (!expected_depths.has(end_line)) {
            expected_depths.set(end_line, current_depth);
          }
        }
      }
    };
    
    // Walk all top-level nodes
    for (const my_node of document.ast.nodes) {
      walk_node(my_node);
    }
    
    return expected_depths;
  }

  /**
   * Check if a node is a block node that increases indentation depth.
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
    lines: string[],
    block_comment_lines: Set<number>
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
    
    // Skip continuation lines (previous line ends with ///)
    if (lineIndex > 0) {
      const prev_line = lines[lineIndex - 1];
      const prev_trimmed = prev_line.trim();
      if (prev_trimmed.endsWith('///')) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Find lines with unnecessary indentation at any depth.
   * A line has unnecessary indentation if its actual indentation
   * exceeds the expected indentation for its depth.
   * 
   * Requirements: 1.1, 2.1, 2.2
   */
  find_unnecessary_indentation_issues(
    document: DocumentState,
    lines: string[],
    range: { start: number; end: number },
    block_comment_lines: Set<number>,
    indent_size: number,
    expected_depths: Map<number, number>
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    for (let i = range.start; i <= range.end && i < lines.length; i++) {
      const line = lines[i];
      
      // Skip excluded lines
      if (this.should_skip_unnecessary_check(line, i, lines, block_comment_lines)) {
        continue;
      }
      
      const actual_indent = this.get_line_indentation(line, indent_size);
      
      // Get expected depth from AST, default to 0 (top-level) if not found
      const expected_depth = expected_depths.get(i) ?? 0;
      const expected_indent = expected_depth * indent_size;
      
      // Check if actual indentation exceeds expected
      if (actual_indent > expected_indent) {
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: Range.create(
            Position.create(i, 0),
            Position.create(i, actual_indent)
          ),
          message: 'Line appears unnecessarily indented. Use Format Document to fix.',
          source: 'sight',
          code: StataDiagnosticCode.UNNECESSARY_INDENTATION,
        });
      }
    }
    
    return diagnostics;
  }
}
