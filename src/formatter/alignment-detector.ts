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

// Tokens that end a statement under `#delimit ;`, or start a block or
// body, so the next line is not a continuation.
const DELIMIT_STATEMENT_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  'STATEMENT_TERMINATOR', 'DELIMIT_DIRECTIVE', 'LBRACE', 'RBRACE',
  'MATA_START', 'PYTHON_START', 'END_MATA', 'END_PYTHON',
]);

const COMMENT_TOKEN_TYPES: ReadonlySet<string> = new Set([
  'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION',
]);

// `#delimit ;`, with the `;` as the first thing after the keyword.
const DELIMIT_SEMICOLON_PATTERN = /^#delimit[ \t]*;/;

/**
 * Statements under `#delimit ;` that span lines. A line break there is
 * whitespace, so each later line of a statement continues it, as the
 * line after a `///` does in `#delimit cr`. Each run has the
 * statement's first line and the lines that continue it.
 */
export function find_delimit_continuation_runs(
  tokens: Token[]
): { start_line: number; continuation_lines: number[] }[] {
  const the_runs: { start_line: number; continuation_lines: number[] }[] = [];
  let is_semicolon_mode = false;
  // The statement so far: its first code line, and its last token.
  let statement_start_line: number | undefined;
  let previous: Token | undefined;
  let my_run: { start_line: number; continuation_lines: number[] } | undefined;

  for (const my_token of tokens) {
    if (my_token.type === 'EOF') {
      break;
    }
    const my_line = my_token.range.start.line;
    if (is_semicolon_mode && statement_start_line !== undefined &&
        previous !== undefined && my_line > previous.range.end.line) {
      if (my_run === undefined) {
        my_run = { start_line: statement_start_line, continuation_lines: [] };
        the_runs.push(my_run);
      }
      my_run.continuation_lines.push(my_line);
    }
    if (my_token.type === 'DELIMIT_DIRECTIVE') {
      is_semicolon_mode = DELIMIT_SEMICOLON_PATTERN.test(my_token.value);
    }
    if (DELIMIT_STATEMENT_BOUNDARY_TYPES.has(my_token.type)) {
      statement_start_line = undefined;
      my_run = undefined;
    } else if (statement_start_line === undefined &&
        !COMMENT_TOKEN_TYPES.has(my_token.type)) {
      // A comment before a statement doesn't start it.
      statement_start_line = my_line;
    }
    previous = my_token;
  }
  return the_runs;
}

/**
 * Lines after a `///` with no space before it. The parser joins such a
 * line to the token before the `///` when it starts at column 0 (`b///`
 * then `c` is `bc`) and separates it when indented, so re-indenting it
 * can change the statement. A `///` alone on its line carries the join
 * forward only from column 0, as ContinuationTracker reads it.
 */
export function find_tight_continuation_lines(tokens: Token[]): Set<number> {
  const the_lines = new Set<number>();
  let previous: Token | undefined;
  for (const my_token of tokens) {
    if (my_token.type === 'WHITESPACE') {
      continue;
    }
    if (my_token.type === 'CONTINUATION') {
      const my_line = my_token.range.start.line;
      // The newline a `///` swallows ends on the next line, so a
      // terminator before this `///` means it is alone on its line.
      const is_after_token = previous !== undefined &&
        previous.type !== 'STATEMENT_TERMINATOR' &&
        previous.range.end.line === my_line;
      const is_tight = is_after_token
        ? previous?.range.end.character === my_token.range.start.character
        : the_lines.has(my_line) && my_token.range.start.character === 0;
      if (is_tight) {
        the_lines.add(my_line + 1);
      }
    }
    previous = my_token;
  }
  return the_lines;
}

export class AlignmentDetector {
  private the_groups = new Map<number, ContinuationGroup>();
  private aligned_lines_set = new Set<number>();

  analyze(tokens: Token[], _original_source?: string): Map<number, ContinuationGroup> {
    this.the_groups.clear();
    this.aligned_lines_set.clear();
    
    // Find continuation groups: lines after `///`, and the later lines
    // of a statement under `#delimit ;`.
    const my_continuation_groups = this.find_continuation_groups(tokens);
    for (const my_run of find_delimit_continuation_runs(tokens)) {
      const existing = my_continuation_groups.get(my_run.start_line);
      if (existing) {
        existing.continuation_lines = [
          ...new Set([...existing.continuation_lines, ...my_run.continuation_lines]),
        ];
        continue;
      }
      my_continuation_groups.set(my_run.start_line, {
        start_line: my_run.start_line,
        continuation_lines: my_run.continuation_lines,
        has_alignment: false,
        aligned_lines: new Set(),
        base_delta: 0,
      });
    }
    
    // For continuation lines (lines AFTER ///), preserve whitespace for alignment
    // But do NOT preserve whitespace on the start line - it should be normalized
    for (const [start_line, group] of my_continuation_groups) {
      // Do NOT mark the start line for whitespace preservation
      // The start line should have its leading indentation normalized
      
      // Mark only the continuation lines (lines after ///) for whitespace preservation
      for (const line of group.continuation_lines) {
        group.aligned_lines.add(line);
        this.aligned_lines_set.add(line);
      }
      group.has_alignment = group.continuation_lines.length > 0;
      
      this.the_groups.set(start_line, group);
    }
    
    return this.the_groups;
  }

  should_preserve_whitespace(line: number): boolean {
    return this.aligned_lines_set.has(line);
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