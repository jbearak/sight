/**
 * Position and range utilities for property-based testing.
 * Provides functions to compare and manipulate positions and ranges.
 */

import { Position, Range, Location } from 'vscode-languageserver-textdocument';

/**
 * Check if two ranges overlap.
 * Ranges overlap if they share any common positions.
 */
export function ranges_overlap(my_range_a: Range, my_range_b: Range): boolean {
  // Check if range_a ends before range_b starts
  if (position_less_than(my_range_a.end, my_range_b.start)) {
    return false;
  }

  // Check if range_b ends before range_a starts
  if (position_less_than(my_range_b.end, my_range_a.start)) {
    return false;
  }

  return true;
}

/**
 * Check if two ranges are equal.
 */
export function ranges_equal(my_range_a: Range, my_range_b: Range): boolean {
  return (
    positions_equal(my_range_a.start, my_range_b.start) &&
    positions_equal(my_range_a.end, my_range_b.end)
  );
}

/**
 * Check if two positions are equal.
 */
export function positions_equal(my_pos_a: Position, my_pos_b: Position): boolean {
  return my_pos_a.line === my_pos_b.line &&
    my_pos_a.character === my_pos_b.character;
}

/**
 * Check if position_a is less than position_b.
 * Positions are compared line-first, then character.
 */
export function position_less_than(my_pos_a: Position, my_pos_b: Position): boolean {
  if (my_pos_a.line !== my_pos_b.line) {
    return my_pos_a.line < my_pos_b.line;
  }
  return my_pos_a.character < my_pos_b.character;
}

/**
 * Check if position_a is less than or equal to position_b.
 */
export function position_less_than_or_equal(my_pos_a: Position, my_pos_b: Position): boolean {
  return position_less_than(my_pos_a, my_pos_b) || positions_equal(my_pos_a, my_pos_b);
}

/**
 * Check if a position is within a range (inclusive).
 */
export function position_in_range(my_position: Position, my_range: Range): boolean {
  return (
    position_less_than_or_equal(my_range.start, my_position) &&
    position_less_than_or_equal(my_position, my_range.end)
  );
}

/**
 * Compare two Location objects for equality.
 * Locations are equal if they have the same URI and range.
 */
export function location_matches(my_loc_a: Location, my_loc_b: Location): boolean {
  return my_loc_a.uri === my_loc_b.uri && ranges_equal(my_loc_a.range, my_loc_b.range);
}

/**
 * Extract text at a given range from source code.
 * Handles multi-line ranges correctly.
 */
export function extract_text_at_range(my_source: string, my_range: Range): string {
  const my_lines = my_source.split('\n');

  if (my_range.start.line === my_range.end.line) {
    // Single line
    const my_line = my_lines[my_range.start.line];
    if (!my_line) {
      return '';
    }
    return my_line.substring(my_range.start.character, my_range.end.character);
  }

  // Multi-line
  let my_result = '';

  // First line
  const my_first_line = my_lines[my_range.start.line];
  if (my_first_line) {
    my_result += my_first_line.substring(my_range.start.character);
  }
  my_result += '\n';

  // Middle lines
  for (let my_i = my_range.start.line + 1; my_i < my_range.end.line; my_i++) {
    my_result += my_lines[my_i] || '';
    my_result += '\n';
  }

  // Last line
  const my_last_line = my_lines[my_range.end.line];
  if (my_last_line) {
    my_result += my_last_line.substring(0, my_range.end.character);
  }

  return my_result;
}

/**
 * Create a range from two positions.
 */
export function create_range(my_start: Position, my_end: Position): Range {
  return { start: my_start, end: my_end };
}

/**
 * Create a position.
 */
export function create_position(my_line: number, my_character: number): Position {
  return { line: my_line, character: my_character };
}

/**
 * Offset a position by a given number of lines and characters.
 */
export function offset_position(
  my_position: Position,
  my_line_offset: number,
  my_char_offset: number = 0
): Position {
  return {
    line: my_position.line + my_line_offset,
    character: my_line_offset === 0 ? my_position.character + my_char_offset : my_char_offset,
  };
}

/**
 * Get the length of a range in characters (approximate, doesn't account for newlines).
 */
export function range_length(my_range: Range): number {
  if (my_range.start.line === my_range.end.line) {
    return my_range.end.character - my_range.start.character;
  }

  // For multi-line ranges, return a rough estimate
  return (my_range.end.line - my_range.start.line) * 80 +
    (my_range.end.character - my_range.start.character);
}

/**
 * Check if a range contains another range.
 */
export function range_contains(my_outer: Range, my_inner: Range): boolean {
  return (
    position_less_than_or_equal(my_outer.start, my_inner.start) &&
    position_less_than_or_equal(my_inner.end, my_outer.end)
  );
}

/**
 * Merge two ranges into a single range that encompasses both.
 */
export function merge_ranges(my_range_a: Range, my_range_b: Range): Range {
  const my_start = position_less_than(my_range_a.start, my_range_b.start)
    ? my_range_a.start
    : my_range_b.start;

  const my_end = position_less_than(my_range_a.end, my_range_b.end)
    ? my_range_b.end
    : my_range_a.end;

  return { start: my_start, end: my_end };
}
