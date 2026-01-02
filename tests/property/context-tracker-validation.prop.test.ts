import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext, ContextErrorCode } from '../../src/context-tracker/types';

describe('Context Tracker Validation Property Tests', () => {
  let context_tracker: ContextTracker;

  beforeEach(() => {
    context_tracker = new ContextTracker();
  });

  /**
   * Property 4: Context Tracker Valid Block Acceptance
   * For any valid embedded language block (mata or python) that ends with 'end',
   * the Context Tracker should accept it without generating diagnostics.
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  it('should accept valid blocks ending with end', () => {
    // Filter out strings that would be parsed as block terminators
    const safe_content = fc.string({ minLength: 1, maxLength: 20 }).filter(
      (s) => !/^(end|mata|python)\b/i.test(s.trim())
    );
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.array(safe_content, { minLength: 0, maxLength: 3 }),
        (block_type, content_lines) => {
          let my_document = `${block_type}\n`;
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end';

          init_tracker_from_source(context_tracker, my_document);
          const my_diagnostics = context_tracker.validate_context_structure();

          // Should have no diagnostics for valid blocks
          const my_block_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                   d.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK
          );
          expect(my_block_errors.length).toBe(0);

          // Should correctly identify the block
          const my_ranges = context_tracker.get_all_context_ranges();
          expect(my_ranges.length).toBe(1);
          
          const my_expected_context = block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
          expect(my_ranges[0].context).toBe(my_expected_context);
          expect(my_ranges[0].end_delimiter?.command).toBe('end');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 5: Invalid Syntax Diagnostic Detection
   * For any document containing 'end python' or 'end mata' syntax, the Context Tracker
   * should generate appropriate warning diagnostics suggesting 'end' instead.
   * Validates: Requirements 3.4, 6.1, 6.2
   */
  it('should detect invalid end syntax and suggest corrections', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('end python'), fc.constant('end mata')),
        (invalid_end) => {
          const my_document = `generate x = 1\n${invalid_end}`;

          init_tracker_from_source(context_tracker, my_document);
          const my_diagnostics = context_tracker.validate_context_structure();

          // Should have diagnostic for mismatched end command
          const my_mismatched_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.MISMATCHED_END_PYTHON ||
                   d.code === ContextErrorCode.INVALID_DELIMITER_POSITION
          );
          expect(my_mismatched_errors.length).toBeGreaterThan(0);

          // Message should suggest using 'end' instead
          const my_error = my_mismatched_errors[0];
          expect(my_error.message.toLowerCase()).toContain('use "end"');
        }
      ),
      { numRuns: 10 }
    );
  });
});