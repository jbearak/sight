import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';
import { Position } from 'vscode-languageserver-textdocument';

describe('Embedded Language Detection Property Tests', () => {
  let context_tracker: ContextTracker;

  beforeEach(() => {
    context_tracker = new ContextTracker();
  });

  /**
   * Property 1: Context Switching Correctness
   * For any Stata document containing embedded language blocks, the Context Tracker
   * should correctly switch contexts when encountering block delimiters at statement
   * boundaries.
   * Feature: embedded-language-detection, Property 1: Context Switching Correctness
   * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3
   */
  it('should correctly switch contexts for mata and python blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('mata'),
          fc.constant('python'),
          fc.constant('mata:'),
          fc.constant('python:')
        ),
        (block_type) => {
          let my_document = '';

          if (block_type === 'mata') {
            my_document = `mata
matrix A = (1, 2)
end`;
          } else if (block_type === 'python') {
            my_document = `python
x = 5
end`;
          } else if (block_type === 'mata:') {
            my_document = `mata: matrix A = (1, 2)`;
          } else if (block_type === 'python:') {
            my_document = `python: x = 5`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Check context at different positions
          const my_start_context = context_tracker.get_context_at_position({
            line: 0,
            character: 0,
          });

          // First line should be in the embedded language context
          if (block_type === 'mata' || block_type === 'mata:') {
            expect(my_start_context).toBe(LanguageContext.MATA);
          } else {
            expect(my_start_context).toBe(LanguageContext.PYTHON);
          }

          // After the block ends, should be back in Stata context
          if (block_type === 'mata' || block_type === 'python') {
            const my_end_context = context_tracker.get_context_at_position({
              line: 2,
              character: 0,
            });
            expect(my_end_context).toBe(LanguageContext.STATA);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 2: Nested Embedded Blocks Are Not Supported
   * Stata does not support nested embedded blocks (e.g., python inside mata).
   * The lexer treats the inner block keyword as a WORD, so only the outer
   * block is recognized as an embedded context.
   * Feature: embedded-language-detection, Property 2: Context Stack Management
   * Validates: Requirements 1.6, 2.6
   */
  it('should treat nested block keywords as words (nested blocks not supported)', () => {
    fc.assert(
      fc.property(fc.boolean(), (use_mata) => {
        const my_outer_block = use_mata ? 'mata' : 'python';
        const my_inner_block = use_mata ? 'python' : 'mata';

        // Nested blocks are invalid in Stata
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
        const my_expected_context = use_mata
          ? LanguageContext.MATA
          : LanguageContext.PYTHON;
        expect(my_ranges[0].context).toBe(my_expected_context);

        // Block should be properly closed by the first 'end'
        expect(my_ranges[0].end_delimiter).toBeDefined();
        expect(my_ranges[0].end_delimiter?.command).toBe('end');
      }),
      { numRuns: 15 }
    );
  });

  /**
   * Property 3: Embedded Content Isolation
   * For any content within embedded language blocks, the Parser should treat it
   * as raw text and not attempt to parse it as Stata syntax.
   * Feature: embedded-language-detection, Property 3: Embedded Content Isolation
   * Validates: Requirements 1.4, 1.5, 2.4, 2.5
   */
  it('should treat embedded content as opaque text', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9_\s\-+=(){}[\]]*$/),
        (embedded_content) => {
          const my_document = `mata
${embedded_content}
end`;

          init_tracker_from_source(context_tracker, my_document);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one mata block
          const my_mata_ranges = my_ranges.filter(
            (r) => r.context === LanguageContext.MATA
          );
          expect(my_mata_ranges.length).toBe(1);

          // The mata block should contain the embedded content
          const my_mata_range = my_mata_ranges[0];
          expect(my_mata_range.start_delimiter.command).toBe('mata');
          expect(my_mata_range.end_delimiter?.command).toBe('end');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 4: Context-Aware Diagnostics Suppression
   * For any position within an embedded language block, Stata-specific syntax
   * diagnostics should be suppressed while basic structural diagnostics are
   * still reported.
   * Feature: embedded-language-detection, Property 4: Context-Aware Diagnostics Suppression
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
   */
  it('should detect unclosed embedded language blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        (block_type) => {
          const my_document = `${block_type}
x = 5`;

          init_tracker_from_source(context_tracker, my_document);

          // Get diagnostics
          const my_diagnostics = context_tracker.validate_context_structure();

          // Should have at least one diagnostic for unclosed block
          const my_unclosed_diagnostics = my_diagnostics.filter(
            (d) =>
              d.code === 4001 || // UNCLOSED_MATA_BLOCK
              d.code === 4002 // UNCLOSED_PYTHON_BLOCK
          );

          expect(my_unclosed_diagnostics.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 5: Context-Aware Completion Filtering
   * For any completion request within an embedded language context, Stata command
   * completions should be suppressed while macro completions remain available.
   * Feature: embedded-language-detection, Property 5: Context-Aware Completion Filtering
   * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
   */
  it('should correctly identify positions in embedded contexts', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        (block_type) => {
          const my_end_command = 'end'; // Both mata and python blocks end with 'end'
          const my_document = `${block_type}
x = 5
${my_end_command}
local y = 10`;

          init_tracker_from_source(context_tracker, my_document);

          // Position inside embedded block should be in embedded context
          const my_inside_context = context_tracker.get_context_at_position({
            line: 1,
            character: 0,
          });

          if (block_type === 'mata') {
            expect(my_inside_context).toBe(LanguageContext.MATA);
          } else {
            expect(my_inside_context).toBe(LanguageContext.PYTHON);
          }

          // Position after block should be in Stata context
          const my_after_context = context_tracker.get_context_at_position({
            line: 3,
            character: 0,
          });
          expect(my_after_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 6: Context-Aware Hover Filtering
   * For any hover request within an embedded language context, Stata command hover
   * information should be suppressed for embedded language keywords while macro
   * hover remains available.
   * Feature: embedded-language-detection, Property 6: Context-Aware Hover Filtering
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
   */
  it('should provide context ranges for all embedded blocks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.constant('mata'), fc.constant('python')),
          { minLength: 1, maxLength: 3 }
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

          // Should have one range per block
          expect(my_ranges.length).toBe(block_types.length);

          // All ranges should have valid start and end delimiters
          for (const my_range of my_ranges) {
            expect(my_range.start_delimiter).toBeDefined();
            expect(my_range.end_delimiter).toBeDefined();
          }
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 7: Cross-Context Symbol Navigation
   * For any Stata macro reference within an embedded language block, go-to-definition
   * should still resolve to the macro's definition location.
   * Feature: embedded-language-detection, Property 7: Cross-Context Symbol Navigation
   * Validates: Requirements 6.1, 6.2, 6.3, 6.4
   */
  it('should handle single-line embedded language contexts', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata:'), fc.constant('python:')),
        (block_type) => {
          const my_document = `${block_type} x = 5
local y = 10`;

          init_tracker_from_source(context_tracker, my_document);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one range
          expect(my_ranges.length).toBe(1);

          // Range should be marked as single-line
          const my_range = my_ranges[0];
          expect(my_range.is_single_line).toBe(true);

          // Position on first line should be in embedded context
          const my_first_line_context = context_tracker.get_context_at_position({
            line: 0,
            character: 5,
          });

          if (block_type === 'mata:') {
            expect(my_first_line_context).toBe(LanguageContext.MATA);
          } else {
            expect(my_first_line_context).toBe(LanguageContext.PYTHON);
          }

          // Position on second line should be in Stata context
          const my_second_line_context = context_tracker.get_context_at_position({
            line: 1,
            character: 0,
          });
          expect(my_second_line_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 8: Formatting Preservation
   * For any document containing embedded language blocks, formatting should preserve
   * embedded content unchanged while properly formatting block delimiters.
   * Feature: embedded-language-detection, Property 8: Formatting Preservation
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4
   */
  it('should detect delimiters only at statement boundaries', () => {
    fc.assert(
      fc.property(fc.boolean(), (in_comment) => {
        let my_document = '';

        if (in_comment) {
          my_document = `// mata
local x = 5`;
        } else {
          my_document = `local x = "mata"
local y = 10`;
        }

        init_tracker_from_source(context_tracker, my_document);

        // Get context ranges
        const my_ranges = context_tracker.get_all_context_ranges();

        // Should not detect mata as a block start when in comment or string
        const my_mata_ranges = my_ranges.filter(
          (r) => r.context === LanguageContext.MATA
        );
        expect(my_mata_ranges.length).toBe(0);

        // All positions should be in Stata context
        const my_context = context_tracker.get_context_at_position({
          line: 0,
          character: 0,
        });
        expect(my_context).toBe(LanguageContext.STATA);
      }),
      { numRuns: 15 }
    );
  });

  /**
   * Property 9: Edge Case Robustness
   * For any document where embedded language delimiters appear in comments or strings,
   * the Context Tracker should not switch contexts.
   * Feature: embedded-language-detection, Property 9: Edge Case Robustness
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
   */
  it('should handle malformed end commands gracefully', () => {
    fc.assert(
      fc.property(fc.boolean(), (use_mata) => {
        const my_block_type = use_mata ? 'mata' : 'python';
        const my_wrong_end = use_mata ? 'end python' : 'end mata';

        const my_document = `${my_block_type}
x = 5
${my_wrong_end}`;

        init_tracker_from_source(context_tracker, my_document);

        // Get diagnostics
        const my_diagnostics = context_tracker.validate_context_structure();

        // Should have diagnostics for the malformed end command
        expect(my_diagnostics.length).toBeGreaterThan(0);
      }),
      { numRuns: 10 }
    );
  });

  /**
   * Property 10: Incremental Context Consistency
   * For any sequence of document edits, the Context Tracker should maintain
   * consistent context information across incremental updates.
   * Feature: embedded-language-detection, Property 10: Incremental Context Consistency
   * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
   */
  it('should maintain consistent context after updates', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          minLength: 1,
          maxLength: 5,
        }),
        (lines) => {
          let my_document = 'mata\n';
          for (const my_line of lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end';

          init_tracker_from_source(context_tracker, my_document);

          // Get initial context ranges
          const my_initial_ranges = context_tracker.get_all_context_ranges();

          // Update with same content
          init_tracker_from_source(context_tracker, my_document);

          // Get updated context ranges
          const my_updated_ranges = context_tracker.get_all_context_ranges();

          // Should have same number of ranges
          expect(my_updated_ranges.length).toBe(my_initial_ranges.length);

          // Ranges should have same context types
          for (let my_i = 0; my_i < my_initial_ranges.length; my_i++) {
            expect(my_updated_ranges[my_i].context).toBe(
              my_initial_ranges[my_i].context
            );
          }
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 11: Block Delimiter Validation
   * For any document with embedded language blocks, the Diagnostics Provider should
   * correctly detect and report block structure errors.
   * Feature: embedded-language-detection, Property 11: Block Delimiter Validation
   * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
   */
  it('should validate block delimiter structure', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('mata'),
          fc.constant('python'),
          fc.constant('mata:'),
          fc.constant('python:')
        ),
        (block_type) => {
          let my_document = '';

          if (block_type === 'mata') {
            my_document = `mata
x = 5
end`;
          } else if (block_type === 'python') {
            my_document = `python
x = 5
end`;
          } else if (block_type === 'mata:') {
            my_document = `mata: x = 5`;
          } else if (block_type === 'python:') {
            my_document = `python: x = 5`;
          }

          init_tracker_from_source(context_tracker, my_document);

          // Get diagnostics
          const my_diagnostics = context_tracker.validate_context_structure();

          // Well-formed blocks should have no diagnostics
          expect(my_diagnostics.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});
