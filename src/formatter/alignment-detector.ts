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

  analyze(tokens: Token[], original_source: string): Map<number, ContinuationGroup> {
    this.the_groups.clear();
    const my_lines = original_source.split('\n');
    
    // Find continuation groups
    const my_continuation_groups = this.find_continuation_groups(tokens);
    
    // For continuation lines, always preserve whitespace when preserve_alignment is enabled
    // This handles both character-aligned and visually-aligned (tab-based) formatting
    for (const [start_line, group] of my_continuation_groups) {
      // Mark the start line (which contains ///) for whitespace preservation
      // This preserves the spacing between code and the /// marker
      group.aligned_lines.add(start_line);
      
      // Mark all continuation lines for whitespace preservation
      for (const line of group.continuation_lines) {
        group.aligned_lines.add(line);
      }
      group.has_alignment = group.continuation_lines.length > 0;
      
      this.the_groups.set(start_line, group);
    }
    
    return this.the_groups;
  }

  should_preserve_whitespace(line: number): boolean {
    for (const group of this.the_groups.values()) {
      if (group.aligned_lines.has(line)) {
        return true;
      }
    }
    return false;
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

  private detect_alignment_patterns(group: ContinuationGroup, lines: string[], tokens: Token[]): AlignmentPattern[] {
    const my_patterns: AlignmentPattern[] = [];
    
    // Check operator alignment
    const my_operator_pattern = this.check_operator_alignment(group, lines);
    if (my_operator_pattern) my_patterns.push(my_operator_pattern);
    
    // Check condition alignment
    const my_condition_pattern = this.check_condition_alignment(group, lines);
    if (my_condition_pattern) my_patterns.push(my_condition_pattern);
    
    // Check expression alignment
    const my_expression_pattern = this.check_expression_alignment(group, lines);
    if (my_expression_pattern) my_patterns.push(my_expression_pattern);
    
    return my_patterns;
  }

  private check_operator_alignment(group: ContinuationGroup, lines: string[]): AlignmentPattern | null {
    const my_operators = ['&', '|', '+', '-', '*', '/', '==', '!=', '<', '>', '<=', '>='];
    const my_operator_positions = new Map<number, number[]>();
    
    // Check both the start line (with ///) and continuation lines for alignment
    const my_lines_to_check = [group.start_line, ...group.continuation_lines];
    
    for (const line_num of my_lines_to_check) {
      const my_line = lines[line_num];
      if (!my_line) continue;
      
      for (const op of my_operators) {
        // Find ALL occurrences of the operator, not just the first
        let my_index = my_line.indexOf(op);
        while (my_index !== -1) {
          if (!my_operator_positions.has(my_index)) {
            my_operator_positions.set(my_index, []);
          }
          my_operator_positions.get(my_index)!.push(line_num);
          my_index = my_line.indexOf(op, my_index + 1);
        }
      }
    }
    
    // Only mark continuation lines for preservation (not the start line)
    for (const [column, the_lines] of my_operator_positions) {
      if (the_lines.length >= 2) {
        const my_continuation_only = the_lines.filter(l => group.continuation_lines.includes(l));
        if (my_continuation_only.length > 0) {
          return { column, element_type: 'operator', lines: my_continuation_only };
        }
      }
    }
    
    return null;
  }

  private check_condition_alignment(group: ContinuationGroup, lines: string[]): AlignmentPattern | null {
    const my_aligned_lines: number[] = [];
    let my_target_column = -1;
    
    for (const line_num of group.continuation_lines) {
      const my_line = lines[line_num];
      if (!my_line) continue;
      
      const my_if_match = my_line.match(/\bif\s+/);
      if (my_if_match) {
        const my_column = my_if_match.index! + my_if_match[0].length;
        if (my_target_column === -1) {
          my_target_column = my_column;
          my_aligned_lines.push(line_num);
        } else if (my_column === my_target_column) {
          my_aligned_lines.push(line_num);
        }
      }
    }
    
    return my_aligned_lines.length >= 2 ? 
      { column: my_target_column, element_type: 'condition', lines: my_aligned_lines } : null;
  }

  private check_expression_alignment(group: ContinuationGroup, lines: string[]): AlignmentPattern | null {
    const my_aligned_lines: number[] = [];
    let my_target_column = -1;
    
    for (const line_num of group.continuation_lines) {
      const my_line = lines[line_num];
      if (!my_line) continue;
      
      const my_assignment_match = my_line.match(/=\s*/);
      if (my_assignment_match) {
        const my_column = my_assignment_match.index! + my_assignment_match[0].length;
        if (my_target_column === -1) {
          my_target_column = my_column;
          my_aligned_lines.push(line_num);
        } else if (my_column === my_target_column) {
          my_aligned_lines.push(line_num);
        }
      }
    }
    
    return my_aligned_lines.length >= 2 ? 
      { column: my_target_column, element_type: 'expression', lines: my_aligned_lines } : null;
  }
}