import { Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { LanguageContext } from '../context-tracker/types';
import { StataDiagnosticCode, StataLSPConfig } from '../types';

export class IndentationDiagnosticAnalyzer {
  analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = document.content.split('\n');

    // Skip if indentation diagnostics are disabled
    if (config.diagnostics.indentation === false) {
      return diagnostics;
    }

    // Get Stata-only ranges (exclude embedded language blocks)
    const stataRanges = this.getStataRanges(document);
    
    // Compute block comment lines to exclude from indentation checks
    const block_comment_lines = this.compute_block_comment_lines(lines);
    
    for (const range of stataRanges) {
      diagnostics.push(...this.find_comment_indentation_issues(lines, range, block_comment_lines));
      diagnostics.push(...this.find_block_indentation_issues(document, lines, range, block_comment_lines));
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

  private get_line_indentation(line: string): number {
    let level = 0;
    for (const char of line) {
      if (char === ' ') {
        level += 1;
      } else if (char === '\t') {
        level += 4; // Assume 4 spaces per tab
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

  private find_comment_indentation_issues(lines: string[], range: { start: number; end: number }, block_comment_lines: Set<number>): Diagnostic[] {
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
        
        const commentIndent = this.get_line_indentation(line);
        const nextIndent = this.get_line_indentation(nextLine);
        
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

  private find_block_indentation_issues(document: DocumentState, lines: string[], range: { start: number; end: number }, block_comment_lines: Set<number>): Diagnostic[] {
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
        const braceIndent = this.get_statement_indentation(lines, i, range.start);
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
          
          const innerIndent = this.get_line_indentation(innerLine);
          
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
          // Look for /*
          if (line[j] === '/' && line[j + 1] === '*') {
            in_block_comment = true;
            block_comment_lines.add(i);
            j += 2;
            continue;
          }
        } else {
          // Already in block comment - this line is inside
          block_comment_lines.add(i);

          // Look for */
          if (line[j] === '*' && line[j + 1] === '/') {
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
  private get_statement_indentation(lines: string[], lineIndex: number, rangeStart: number): number {
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
    return this.get_line_indentation(lines[current_index]);
  }
}
