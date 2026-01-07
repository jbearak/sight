/**
 * Helper utilities for property-based testing.
 * Re-exports all comparison, document, and position utilities.
 */

// AST comparison utilities
export {
  ast_equivalent,
  deep_equal_ignoring_ranges,
  nodes_equal,
} from './ast-comparison';

// Document utilities
export {
  create_document_state,
  parse_and_analyze,
  extract_comments,
  tokenize_non_whitespace,
  position_to_offset,
  offset_to_position,
  find_position_of,
  find_all_positions_of,
} from './document-utils';

// Position and range utilities
export {
  ranges_overlap,
  ranges_equal,
  positions_equal,
  position_less_than,
  position_less_than_or_equal,
  position_in_range,
  location_matches,
  extract_text_at_range,
  create_range,
  create_position,
  offset_position,
  range_length,
  range_contains,
  merge_ranges,
} from './position-utils';

// Text edit utilities
export { apply_edits, find_command_nodes } from './text-edit-utils';
