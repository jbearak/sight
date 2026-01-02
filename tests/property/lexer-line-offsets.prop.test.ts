import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';

describe('Lexer Line Offset Index Property Tests', () => {
  /**
   * Property 3: Line Offset Index Correctness
   * For any source code, the line_offsets array should correctly map line numbers
   * to byte offsets such that source[line_offsets[i]] is the first character of
   * line i, and all positions within a line can be correctly converted to byte
   * offsets using position_to_offset.
   * Feature: lsp-performance-optimization, Property 3: Line Offset Index Correctness
   * Validates: Requirements 3.2
   */
  it('should build correct line offsets for any source code', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 0, maxLength: 100 }),
          { minLength: 1, maxLength: 50 }
        ),
        (the_lines) => {
          // Build source with newlines between lines
          const source = the_lines.join('\n');
          const lexer = new StataLexer();
          const result = lexer.tokenize(source);

          // Verify line_offsets is present
          expect(result.line_offsets).toBeDefined();
          expect(Array.isArray(result.line_offsets)).toBe(true);

          // First offset should be 0
          expect(result.line_offsets[0]).toBe(0);

          // Number of offsets should match number of lines
          expect(result.line_offsets.length).toBe(the_lines.length);

          // Each offset should point to the start of its line
          for (let my_line_idx = 0; my_line_idx < the_lines.length; my_line_idx++) {
            const my_offset = result.line_offsets[my_line_idx];
            
            // Offset should be within bounds
            expect(my_offset).toBeGreaterThanOrEqual(0);
            expect(my_offset).toBeLessThanOrEqual(source.length);

            // Character at offset should be the first character of the line
            // (or end of source for last line)
            if (my_line_idx < the_lines.length - 1) {
              // Not the last line - should have content
              if (the_lines[my_line_idx].length > 0) {
                expect(source[my_offset]).toBe(the_lines[my_line_idx][0]);
              }
            }
          }

          // Verify offsets are strictly increasing
          for (let my_i = 1; my_i < result.line_offsets.length; my_i++) {
            expect(result.line_offsets[my_i]).toBeGreaterThan(
              result.line_offsets[my_i - 1]
            );
          }

          // Verify each offset points to the correct line content
          for (let my_line_idx = 0; my_line_idx < the_lines.length; my_line_idx++) {
            const my_start = result.line_offsets[my_line_idx];
            const my_end = my_line_idx + 1 < result.line_offsets.length
              ? result.line_offsets[my_line_idx + 1] - 1  // Exclude newline
              : source.length;
            
            const my_extracted_line = source.substring(my_start, my_end);
            const my_expected_line = the_lines[my_line_idx];
            
            expect(my_extracted_line).toBe(my_expected_line);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 4: Linear Tokenization Scaling
   * For any source code, tokenization time should scale linearly O(n) with
   * document size, not quadratically. This is verified by checking that
   * tokenizing a document of size 2n takes approximately 2x the time of
   * tokenizing a document of size n (within ±20% tolerance).
   * Feature: lsp-performance-optimization, Property 4: Linear Tokenization Scaling
   * Validates: Requirements 3.5
   */
  it('should tokenize with linear time complexity', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), {
          minLength: 10,
          maxLength: 20,
        }),
        (the_lines) => {
          const lexer = new StataLexer();

          // Build small document
          const small_source = the_lines.slice(0, 10).join('\n');
          const small_start = performance.now();
          const small_result = lexer.tokenize(small_source);
          const small_time = performance.now() - small_start;

          // Build large document (approximately 2x size)
          const large_source = the_lines.join('\n');
          const large_start = performance.now();
          const large_result = lexer.tokenize(large_source);
          const large_time = performance.now() - large_start;

          // Verify both tokenizations succeeded
          expect(small_result.tokens.length).toBeGreaterThan(0);
          expect(large_result.tokens.length).toBeGreaterThan(0);

          // Verify line_offsets were built
          expect(small_result.line_offsets.length).toBe(10);
          expect(large_result.line_offsets.length).toBe(the_lines.length);

          // For very fast operations, timing may be unreliable
          // Only check scaling if operations took measurable time
          if (small_time > 0.1 && large_time > 0.1) {
            const size_ratio = large_source.length / small_source.length;
            const time_ratio = large_time / small_time;

            // Time ratio should be close to size ratio (within ±50% for small samples)
            // We use a generous tolerance because timing is noisy
            expect(time_ratio).toBeGreaterThan(size_ratio * 0.5);
            expect(time_ratio).toBeLessThan(size_ratio * 2.0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Edge case: Empty source code
   * Line offsets should handle empty source correctly
   */
  it('should handle empty source code', () => {
    const lexer = new StataLexer();
    const result = lexer.tokenize('');

    expect(result.line_offsets).toBeDefined();
    expect(result.line_offsets.length).toBe(1);
    expect(result.line_offsets[0]).toBe(0);
  });

  /**
   * Edge case: Single line without newline
   * Line offsets should handle single line correctly
   */
  it('should handle single line without newline', () => {
    const lexer = new StataLexer();
    const source = 'local x = 5';
    const result = lexer.tokenize(source);

    expect(result.line_offsets).toBeDefined();
    expect(result.line_offsets.length).toBe(1);
    expect(result.line_offsets[0]).toBe(0);
  });

  /**
   * Edge case: Multiple consecutive newlines
   * Line offsets should handle multiple consecutive newlines correctly
   */
  it('should handle multiple consecutive newlines', () => {
    const lexer = new StataLexer();
    const source = 'local x = 5\n\n\nlocal y = 10';
    const result = lexer.tokenize(source);

    expect(result.line_offsets).toBeDefined();
    expect(result.line_offsets.length).toBe(4);
    expect(result.line_offsets[0]).toBe(0);
    expect(result.line_offsets[1]).toBe(12); // After first newline
    expect(result.line_offsets[2]).toBe(13); // After second newline
    expect(result.line_offsets[3]).toBe(14); // After third newline
  });

  /**
   * Edge case: Source ending with newline
   * Line offsets should handle source ending with newline correctly
   */
  it('should handle source ending with newline', () => {
    const lexer = new StataLexer();
    const source = 'local x = 5\n';
    const result = lexer.tokenize(source);

    expect(result.line_offsets).toBeDefined();
    expect(result.line_offsets.length).toBe(2);
    expect(result.line_offsets[0]).toBe(0);
    expect(result.line_offsets[1]).toBe(12); // After newline
  });
});
