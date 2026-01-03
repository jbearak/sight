import { Token } from '../types';

export interface ContinuationGroup {
  start_line: number;
  continuation_lines: number[];
  has_alignment: boolean;
  aligned_lines: Set<number>;
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
    
    // Analyze each group for alignment
    for (const [start_line, group] of my_continuation_groups) {
      const my_patterns = this.detect_alignment_patterns(group, my_lines, tokens);
      group.has_alignment = my_patterns.length > 0;
      
      for (const pattern of my_patterns) {
        for (const line of pattern.lines) {
          group.aligned_lines.add(line);
        }
      }
      
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
            continuation_lines: [my_line, my_line + 1], // Include both the /// line and the next line
            has_alignment: false,
            aligned_lines: new Set()
          };
        } else {
          my_current_group.continuation_lines.push(my_line);
          my_current_group.continuation_lines.push(my_line + 1);
        }
      } else if (my_current_group && my_line > my_current_group.continuation_lines[my_current_group.continuation_lines.length - 1]) {
        // Deduplicate continuation_lines
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
    
    for (const line_num of group.continuation_lines) {
      const my_line = lines[line_num];
      if (!my_line) continue;
      
      for (const op of my_operators) {
        const my_index = my_line.indexOf(op);
        if (my_index !== -1) {
          if (!my_operator_positions.has(my_index)) {
            my_operator_positions.set(my_index, []);
          }
          my_operator_positions.get(my_index)!.push(line_num);
        }
      }
    }
    
    for (const [column, the_lines] of my_operator_positions) {
      if (the_lines.length >= 2) {
        return { column, element_type: 'operator', lines: the_lines };
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