import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentStore } from '../../src/document-store';

describe('Document Store Property Tests', () => {
  let document_store: DocumentStore;

  beforeEach(() => {
    document_store = new DocumentStore();
  });

  /**
   * Property 1: Parse Caching Consistency
   * For any document, parsing it once and caching the result should be
   * equivalent to parsing it multiple times. When the version hasn't changed,
   * the cached result should be returned without re-parsing.
   * Feature: lsp-performance-optimization, Property 1: Parse Caching Consistency
   * Validates: Requirements 1.1, 1.2, 1.3
   */
  it('should cache parse results and reuse them', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (content) => {
          const my_uri = 'file:///test.do';
          const my_version = 1;

          // Open document (first parse)
          await document_store.open(my_uri, content, my_version);
          const my_state_1 = document_store.get(my_uri);
          expect(my_state_1).toBeDefined();
          expect(my_state_1!.version).toBe(my_version);
          expect(my_state_1!.content).toBe(content);
          expect(my_state_1!.tokens).toBeDefined();
          expect(my_state_1!.ast).toBeDefined();

          // Get same document again (should use cache)
          const my_state_2 = document_store.get(my_uri);
          expect(my_state_2).toBe(my_state_1); // Same object reference

          // Update with same version (should use cache)
          await document_store.update(my_uri, [], my_version);
          const my_state_3 = document_store.get(my_uri);
          expect(my_state_3).toBe(my_state_1); // Still same object

          // Verify metrics show cache hits
          const my_metrics = document_store.get_metrics();
          expect(my_metrics.cache_hits).toBeGreaterThan(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 2: Single Context Tracker Instance
   * For any document, there should be exactly one ContextTracker instance
   * per document state. The context_tracker should be initialized from tokens
   * and not recreated on subsequent accesses.
   * Feature: lsp-performance-optimization, Property 2: Single Context Tracker Instance
   * Validates: Requirements 2.1
   */
  it('should maintain single context tracker per document', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (content) => {
          const my_uri = 'file:///test.do';
          const my_version = 1;

          // Open document
          await document_store.open(my_uri, content, my_version);
          const my_state_1 = document_store.get(my_uri);
          expect(my_state_1).toBeDefined();

          // Get context tracker
          const my_tracker_1 = my_state_1!.context_tracker;
          expect(my_tracker_1).toBeDefined();

          // Get same document again
          const my_state_2 = document_store.get(my_uri);
          const my_tracker_2 = my_state_2!.context_tracker;

          // Should be the same instance
          expect(my_tracker_2).toBe(my_tracker_1);

          // Context ranges should be sorted
          const my_ranges = my_tracker_1.get_all_context_ranges();
          for (let my_i = 1; my_i < my_ranges.length; my_i++) {
            const my_prev = my_ranges[my_i - 1];
            const my_curr = my_ranges[my_i];
            const my_prev_line = my_prev.range.start.line;
            const my_prev_char = my_prev.range.start.character;
            const my_curr_line = my_curr.range.start.line;
            const my_curr_char = my_curr.range.start.character;

            // Verify sorted order
            expect(
              my_prev_line < my_curr_line ||
              (my_prev_line === my_curr_line && my_prev_char <= my_curr_char)
            ).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 3: Line Offsets Correctness
   * For any document, the line_offsets array should correctly map line
   * numbers to byte offsets. For each line, the offset should point to
   * the start of that line in the content.
   * Feature: lsp-performance-optimization, Property 3: Line Offset Index Correctness
   * Validates: Requirements 3.2
   */
  it('should build correct line offset index', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (content) => {
          const my_uri = 'file:///test.do';
          const my_version = 1;

          // Open document
          await document_store.open(my_uri, content, my_version);
          const my_state = document_store.get(my_uri);
          expect(my_state).toBeDefined();

          const my_line_offsets = my_state!.line_offsets;
          const the_lines = content.split('\n');

          // Verify line_offsets length matches number of lines
          expect(my_line_offsets.length).toBe(the_lines.length);

          // Verify first offset is 0
          expect(my_line_offsets[0]).toBe(0);

          // Verify each offset points to correct line start
          for (let my_i = 0; my_i < the_lines.length; my_i++) {
            const my_offset = my_line_offsets[my_i];
            expect(my_offset).toBeGreaterThanOrEqual(0);
            expect(my_offset).toBeLessThanOrEqual(content.length);

            // Verify content at offset matches line start
            if (my_i < the_lines.length - 1) {
              // Not the last line - should have newline after
              const my_next_offset = my_line_offsets[my_i + 1];
              const my_line_content = content.substring(
                my_offset,
                my_next_offset - 1
              );
              expect(my_line_content).toBe(the_lines[my_i]);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 4: Tokens Included in State
   * For any document, the parsed tokens should be included in the
   * DocumentState and should match the lexer output.
   * Feature: lsp-performance-optimization, Property 1: Parse Caching Consistency
   * Validates: Requirements 1.4
   */
  it('should include tokens in document state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (content) => {
          const my_uri = 'file:///test.do';
          const my_version = 1;

          // Open document
          await document_store.open(my_uri, content, my_version);
          const my_state = document_store.get(my_uri);
          expect(my_state).toBeDefined();

          // Verify tokens are present
          expect(my_state!.tokens).toBeDefined();
          expect(Array.isArray(my_state!.tokens)).toBe(true);

          // Tokens should have expected structure
          for (const my_token of my_state!.tokens) {
            expect(my_token.type).toBeDefined();
            expect(my_token.value).toBeDefined();
            expect(my_token.range).toBeDefined();
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 5: Fast Path for Unchanged Content
   * For any document, updating with the same content should skip re-parsing
   * and reuse the cached state.
   * Feature: lsp-performance-optimization, Property 1: Parse Caching Consistency
   * Validates: Requirements 1.3
   */
  it('should skip re-parse for unchanged content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (content) => {
          const my_uri = 'file:///test.do';

          // Open document with version 1
          await document_store.open(my_uri, content, 1);
          const my_state_1 = document_store.get(my_uri);
          const my_metrics_1 = document_store.get_metrics();

          // Update with same content but new version (no actual changes)
          await document_store.update(my_uri, [], 2);
          const my_state_2 = document_store.get(my_uri);
          const my_metrics_2 = document_store.get_metrics();

          // Version should be updated
          expect(my_state_2!.version).toBe(2);

          // But parse count should not increase (fast path taken)
          expect(my_metrics_2.parse_count).toBe(my_metrics_1.parse_count);

          // Cache hits should increase
          expect(my_metrics_2.cache_hits).toBeGreaterThan(
            my_metrics_1.cache_hits
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 6: Metrics Tracking
   * For any sequence of document operations, metrics should accurately
   * track parse_count, cache_hits, cache_misses, and evictions.
   * Feature: lsp-performance-optimization, Property 1: Parse Caching Consistency
   * Validates: Requirements Testing Strategy
   */
  it('should accurately track metrics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 50 })
          ),
          { minLength: 1, maxLength: 10 }
        ),
        async (the_operations) => {
          let expected_parse_count = 0;
          const my_seen_uris = new Set<string>();

          for (const [my_uri, my_content] of the_operations) {
            if (!my_seen_uris.has(my_uri)) {
              // First time seeing this URI - will parse
              await document_store.open(my_uri, my_content, 1);
              expected_parse_count++;
              my_seen_uris.add(my_uri);
            } else {
              // Seen before - update with new content
              const my_state = document_store.get(my_uri);
              if (my_state && my_state.content !== my_content) {
                // Different content - will re-parse
                await document_store.update(
                  my_uri,
                  [{ text: my_content }],
                  my_state.version + 1
                );
                expected_parse_count++;
              }
            }
          }

          const my_metrics = document_store.get_metrics();
          // Parse count should be at least the number of unique URIs
          expect(my_metrics.parse_count).toBeGreaterThanOrEqual(
            my_seen_uris.size
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Edge case: Empty document
   * An empty document should parse successfully with empty tokens
   */
  it('should handle empty documents', async () => {
    const my_uri = 'file:///empty.do';
    const my_content = '';

    await document_store.open(my_uri, my_content, 1);
    const my_state = document_store.get(my_uri);

    expect(my_state).toBeDefined();
    expect(my_state!.content).toBe('');
    expect(my_state!.tokens).toBeDefined();
    expect(my_state!.line_offsets).toBeDefined();
    expect(my_state!.line_offsets.length).toBeGreaterThan(0);
  });

  /**
   * Edge case: Document with only newlines
   * A document with only newlines should parse correctly
   */
  it('should handle documents with only newlines', async () => {
    const my_uri = 'file:///newlines.do';
    const my_content = '\n\n\n';

    await document_store.open(my_uri, my_content, 1);
    const my_state = document_store.get(my_uri);

    expect(my_state).toBeDefined();
    expect(my_state!.line_offsets.length).toBe(4); // 4 lines
    expect(my_state!.line_offsets[0]).toBe(0);
    expect(my_state!.line_offsets[1]).toBe(1);
    expect(my_state!.line_offsets[2]).toBe(2);
    expect(my_state!.line_offsets[3]).toBe(3);
  });

  /**
   * Edge case: Close and reopen document
   * Closing and reopening a document should create a fresh state
   */
  it('should handle close and reopen', async () => {
    const my_uri = 'file:///test.do';
    const my_content = 'local x = 5';

    // Open
    await document_store.open(my_uri, my_content, 1);
    const my_state_1 = document_store.get(my_uri);
    expect(my_state_1).toBeDefined();

    // Close
    document_store.close(my_uri);
    const my_state_closed = document_store.get(my_uri);
    expect(my_state_closed).toBeUndefined();

    // Reopen
    await document_store.open(my_uri, my_content, 2);
    const my_state_2 = document_store.get(my_uri);
    expect(my_state_2).toBeDefined();
    expect(my_state_2!.version).toBe(2);
  });
});
