import { Token } from '../types';

export interface ContinuationGroup {
  start_line: number;
  continuation_lines: number[];
  has_alignment: boolean;
  aligned_lines: Set<number>;
  base_delta: number;
}

export interface AlignmentPattern {
  column: number;
  element_type: 'operator' | 'condition' | 'expression';
  lines: number[];
}

export class AlignmentDetector {
  private the_groups = new Map<number, ContinuationGroup>();
  private the_aligned_lines = new Set<number>();

  analyze(tokens: Token[], original_source: string): Map<number, ContinuationGroup> {
    this.the_groups.clear();
    this.the_aligned_lines.clear();
    
    // Find continuation groups
    const my_continuation_groups = this.find_continuation_groups(tokens);
    
    // For continuation lines, always preserve whitespace when preserve_alignment is enabled
    // This handles both character-aligned and visually-aligned (tab-based) formatting
    for (const [start_line, group] of my_continuation_groups) {
      // Mark the start line (which contains ///) for whitespace preservation
      // This preserves the spacing between code and the /// marker
      group.aligned_lines.add(start_line);
      this.the_aligned_lines.add(start_line);
      
      // Mark all continuation lines for whitespace preservation
      for (const line of group.continuation_lines) {
        group.aligned_lines.add(line);
        this.the_aligned_lines.add(line);
      }
      group.has_alignment = group.continuation_lines.length > 0;
      
      this.the_groups.set(start_line, group);
    }
    
    return this.the_groups;
  }

  should_preserve_whitespace(line: number): boolean {
    return this.the_aligned_lines.has(line);
  }

  private find_continuation_groups(tokens: Token[]): Map<number, ContinuationGroup> {
    const my_groups = new Map<number, ContinuationGroup>();
    let my_current_group: ContinuationGroup | null = null;

    for (const my_token of tokens) {
      const my_line = my_token.range.start.line;
      if (my_token.type === 'CONTINUATION') {
        if (!my_current_group) {
          my_current_group = {
            start_line: my_line,
            continuation_lines: [my_line + 1], // Only the line AFTER /// is a continuation
            has_alignment: false,
            aligned_lines: new Set(),
            base_delta: 0
          };
        } else {
          my_current_group.continuation_lines.push(my_line + 1);
        }
      } else if (my_current_group && my_line > my_current_group.continuation_lines[my_current_group.continuation_lines.length - 1]) {
        my_current_group.continuation_lines = [...new Set(my_current_group.continuation_lines)];
        my_groups.set(my_current_group.start_line, my_current_group);
        my_current_group = null;
      }
    }

    if (my_current_group) {
      my_current_group.continuation_lines = [...new Set(my_current_group.continuation_lines)];
      my_groups.set(my_current_group.start_line, my_current_group);
    }

    return my_groups;
  }
}
}