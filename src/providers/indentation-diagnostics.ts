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
    
    for (const range of stataRanges) {
      diagnostics.push(...this.find_comment_indentation_issues(lines, range));
      diagnostics.push(...this.find_block_indentation_issues(document, lines, range));
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

  private find_comment_indentation_issues(lines: string[], range: { start: number; end: number }): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    for (let i = range.start; i < range.end && i < lines.length - 1; i++) {
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

  private find_block_indentation_issues(document: DocumentState, lines: string[], range: { start: number; end: number }): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    // Simple heuristic: look for braces and check indentation inside
    for (let i = range.start; i <= range.end && i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check for opening brace
      if (trimmed === '{') {
        const braceIndent = this.get_line_indentation(line);
        
        // Check lines inside the block
        for (let j = i + 1; j <= range.end && j < lines.length; j++) {
          const innerLine = lines[j];
          const innerTrimmed = innerLine.trim();
          
          // Stop at closing brace
          if (innerTrimmed === '}') {
            break;
          }
          
          // Skip empty lines and comments
          if (!innerTrimmed || innerTrimmed.startsWith('*') || innerTrimmed.startsWith('//')) {
            continue;
          }
          
          // Skip continuation lines
          if (j > i + 1 && this.is_continuation_line(innerLine, lines[j - 1])) {
            continue;
          }
          
          const innerIndent = this.get_line_indentation(innerLine);
          
          // Check if line should be indented more than the brace
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
}
