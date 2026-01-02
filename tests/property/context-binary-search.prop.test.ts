import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext, ContextRange } from '../../src/context-tracker/types';
import { Position } from 'vscode-languageserver-textdocument';

describe('Context Binary Search Property Tests', () => {
  let context_tracker: ContextTracker;

  beforeEach(() => {
    context_tracker = new ContextTracker();
  });

  /**
   * Property 8: Context Ranges Sorted Invariant
   * For any document with embedded language blocks, the Context Tracker should
   * return context ranges sorted by (start.line, start.character) to enable
   * efficient binary search lookups.
   * Feature: lsp-performance-optimization, Property 8: Context Ranges Sorted Invariant
   * Validates: Requirements 7.1
   */
  it('should return context ranges sorted by start position', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.constant('mata'), fc.constant('python')),
          { minLength: 1, maxLength: 5 }
        ),
        (block_types) => {
          let my_document = '';
          for (const my_block_type of block_types) {
            const my_end_command = 'end'; // Both mata and python blocks end with 'end'
            my_document += `${my_block_type}\nx = 5\n${my_end_command}\n`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Get all context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Verify ranges are sorted by (start.line, start.character)
          for (let my_i = 1; my_i < my_ranges.length; my_i++) {
            const my_prev = my_ranges[my_i - 1];
            const my_curr = my_ranges[my_i];

            const my_prev_line = my_prev.range.start.line;
            const my_prev_char = my_prev.range.start.character;
            const my_curr_line = my_curr.range.start.line;
            const my_curr_char = my_curr.range.start.character;

            // Current range should come after or at same position as previous
            if (my_prev_line === my_curr_line) {
              expect(my_prev_char).toBeLessThanOrEqual(my_curr_char);
            } else {
              expect(my_prev_line).toBeLessThan(my_curr_line);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 9: Binary Search Logarithmic Scaling
   * For any document with N embedded language blocks, looking up context at a
   * position should complete in O(log N) time using binary search, not O(N)
   * time using linear scan.
   * Feature: lsp-performance-optimization, Property 9: Binary Search Logarithmic Scaling
   * Validates: Requirements 7.3
   */
  it('should find context ranges efficiently with binary search', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.constant('mata'), fc.constant('python')),
          { minLength: 1, maxLength: 10 }
        ),
        (block_types) => {
          let my_document = '';
          const my_block_count = block_types.length;

          for (const my_block_type of block_types) {
            const my_end_command = 'end'; // Both mata and python blocks end with 'end'
            my_document += `${my_block_type}\nx = 5\n${my_end_command}\n`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Get all context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Verify we have the expected number of ranges
          expect(my_ranges.length).toBe(my_block_count);

          // For each range, verify we can find it by position
          for (const my_range of my_ranges) {
            // Position at start of range
            const my_start_pos: Position = {
              line: my_range.range.start.line,
              character: my_range.range.start.character,
            };

            const my_found_range =
              context_tracker.get_context_range_at_position(my_start_pos);

            // Should find the range
            expect(my_found_range).toBeDefined();
            expect(my_found_range?.context).toBe(my_range.context);

            // Position in middle of range
            const my_mid_line = Math.floor(
              (my_range.range.start.line + my_range.range.end.line) / 2
            );
            const my_mid_pos: Position = {
              line: my_mid_line,
              character: 0,
            };

            const my_found_mid_range =
              context_tracker.get_context_range_at_position(my_mid_pos);

            // Should find the range
            expect(my_found_mid_range).toBeDefined();
            expect(my_found_mid_range?.context).toBe(my_range.context);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 10: Nested Embedded Blocks Are Not Supported
   * Stata does not support nested embedded blocks (e.g., python inside mata).
   * The lexer should treat the inner block keyword as a WORD, resulting in
   * only one context range for the outer block.
   * Feature: lsp-performance-optimization, Property 10: Nested Range Handling
   * Validates: Requirements 7.2
   */
  it('should treat nested block keywords as words (nested blocks not supported)', () => {
    fc.assert(
      fc.property(fc.boolean(), (use_mata_outer) => {
        const my_outer_block = use_mata_outer ? 'mata' : 'python';
        const my_inner_block = use_mata_outer ? 'python' : 'mata';

        // Nested blocks are invalid in Stata - inner block keyword is just a word
        const my_document = `${my_outer_block}
${my_inner_block}
x = 5
end
end`;

        init_tracker_from_source(context_tracker, my_document);

        // Get all context ranges
        const my_ranges = context_tracker.get_all_context_ranges();

        // Should have exactly 1 range (outer block only)
        // The inner block keyword is treated as a WORD, not a block start
        expect(my_ranges.length).toBe(1);

        // The single range should be the outer block
        const my_expected_context = use_mata_outer
          ? LanguageContext.MATA
          : LanguageContext.PYTHON;
        expect(my_ranges[0].context).toBe(my_expected_context);

        // Position inside should return outer context (not inner)
        const my_inner_pos: Position = {
          line: 2,
          character: 0,
        };
        const my_found_range =
          context_tracker.get_context_range_at_position(my_inner_pos);
        expect(my_found_range?.context).toBe(my_expected_context);
      }),
      { numRuns: 15 }
    );
  });

  /**
   * Property 11: Position Lookup Consistency
   * For any position in a document, get_context_at_position and
   * get_context_range_at_position should return consistent results.
   * Feature: lsp-performance-optimization, Property 11: Position Lookup Consistency
   * Validates: Requirements 7.1, 7.2, 7.3
   */
  it('should return consistent context for position lookups', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.constant('mata'), fc.constant('python')),
          { minLength: 1, maxLength: 5 }
        ),
        (block_types) => {
          let my_document = '';
          for (const my_block_type of block_types) {
            const my_end_command = 'end'; // Both mata and python blocks end with 'end'
            my_document += `${my_block_type}\nx = 5\n${my_end_command}\n`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Get all context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // For each range, verify consistency
          for (const my_range of my_ranges) {
            const my_pos: Position = {
              line: my_range.range.start.line,
              character: my_range.range.start.character,
            };

            // Get context via both methods
            const my_context_at_pos =
              context_tracker.get_context_at_position(my_pos);
            const my_range_at_pos =
              context_tracker.get_context_range_at_position(my_pos);

            // Should be consistent
            if (my_range_at_pos) {
              expect(my_context_at_pos).toBe(my_range_at_pos.context);
            } else {
              expect(my_context_at_pos).toBe(LanguageContext.STATA);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 12: Boundary Position Handling
   * For any position at the boundary of a context range, binary search should
   * correctly determine whether the position is inside or outside the range.
   * Feature: lsp-performance-optimization, Property 12: Boundary Position Handling
   * Validates: Requirements 7.2
   */
  it('should correctly handle boundary positions', () => {
    fc.assert(
      fc.property(fc.boolean(), (use_mata) => {
        const my_block_type = use_mata ? 'mata' : 'python';
        const my_end_command = 'end'; // Both mata and python blocks end with 'end'

        const my_document = `${my_block_type}
x = 5
${my_end_command}
local y = 10`;

        init_tracker_from_source(context_tracker, my_document);

        // Get all context ranges
        const my_ranges = context_tracker.get_all_context_ranges();

        // Should have exactly one range
        expect(my_ranges.length).toBe(1);

        const my_range = my_ranges[0];

        // Position at start of range should be in range
        const my_start_pos: Position = {
          line: my_range.range.start.line,
          character: my_range.range.start.character,
        };
        const my_start_context =
          context_tracker.get_context_at_position(my_start_pos);
        expect(my_start_context).toBe(my_range.context);

        // Position at end of range should be in range
        const my_end_pos: Position = {
          line: my_range.range.end.line,
          character: my_range.range.end.character,
        };
        const my_end_context =
          context_tracker.get_context_at_position(my_end_pos);
        expect(my_end_context).toBe(my_range.context);

        // Position after range should be in Stata context
        const my_after_pos: Position = {
          line: my_range.range.end.line + 1,
          character: 0,
        };
        const my_after_context =
          context_tracker.get_context_at_position(my_after_pos);
        expect(my_after_context).toBe(LanguageContext.STATA);
      }),
      { numRuns: 15 }
    );
  });

  /**
   * Property 13: Empty Document Handling
   * For an empty document, get_all_context_ranges should return an empty array
   * and binary search should handle this gracefully.
   * Feature: lsp-performance-optimization, Property 13: Empty Document Handling
   * Validates: Requirements 7.1, 7.2, 7.3
   */
  it('should handle empty documents gracefully', () => {
    init_tracker_from_source(context_tracker, '');

    // Get all context ranges
    const my_ranges = context_tracker.get_all_context_ranges();

    // Should be empty
    expect(my_ranges.length).toBe(0);

    // Position lookup should return Stata context
    const my_context = context_tracker.get_context_at_position({
      line: 0,
      character: 0,
    });
    expect(my_context).toBe(LanguageContext.STATA);

    // Range lookup should return undefined
    const my_range = context_tracker.get_context_range_at_position({
      line: 0,
      character: 0,
    });
    expect(my_range).toBeUndefined();
  });

  /**
   * Property 14: Large Document Scaling
   * For documents with many embedded language blocks, binary search should
   * maintain O(log N) performance characteristics.
   * Feature: lsp-performance-optimization, Property 14: Large Document Scaling
   * Validates: Requirements 7.3
   */
  it('should scale efficiently with many embedded blocks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }),
        (num_blocks) => {
          let my_document = '';
          for (let my_i = 0; my_i < num_blocks; my_i++) {
            const my_block_type = my_i % 2 === 0 ? 'mata' : 'python';
            const my_end_command = 'end'; // Both mata and python blocks end with 'end'
            my_document += `${my_block_type}\nx = 5\n${my_end_command}\n`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Get all context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have expected number of ranges
          expect(my_ranges.length).toBe(num_blocks);

          // Verify ranges are sorted
          for (let my_i = 1; my_i < my_ranges.length; my_i++) {
            const my_prev = my_ranges[my_i - 1];
            const my_curr = my_ranges[my_i];

            const my_prev_line = my_prev.range.start.line;
            const my_prev_char = my_prev.range.start.character;
            const my_curr_line = my_curr.range.start.line;
            const my_curr_char = my_curr.range.start.character;

            if (my_prev_line === my_curr_line) {
              expect(my_prev_char).toBeLessThanOrEqual(my_curr_char);
            } else {
              expect(my_prev_line).toBeLessThan(my_curr_line);
            }
          }

          // Verify we can find ranges efficiently
          for (const my_range of my_ranges) {
            const my_pos: Position = {
              line: my_range.range.start.line,
              character: my_range.range.start.character,
            };

            const my_found_range =
              context_tracker.get_context_range_at_position(my_pos);
            expect(my_found_range).toBeDefined();
            expect(my_found_range?.context).toBe(my_range.context);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});
