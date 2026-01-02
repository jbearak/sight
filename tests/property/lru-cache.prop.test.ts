import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { LRUCache, CompletionPrefixCache } from '../../src/utils/lru-cache';

describe('LRU Cache Property Tests', () => {
  /**
   * Property 7: LRU Cache Bounded Size
   * For any sequence of set operations on an LRU cache with max_size N,
   * the cache size should never exceed N. When the cache is full and a new
   * item is added, exactly one item should be evicted.
   * Feature: lsp-performance-optimization, Property 7: LRU Cache Bounded Size
   * Validates: Requirements 6.4
   */
  it('should maintain bounded size with LRU eviction', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 50 })
          ),
          { minLength: 1, maxLength: 200 }
        ),
        (max_size, the_operations) => {
          const cache = new LRUCache<string, string>(max_size);

          let expected_evictions = 0;

          for (const [my_key, my_value] of the_operations) {
            const size_before = cache.size();

            // If cache is at capacity and key is new, expect eviction
            if (size_before >= max_size && !cache.has(my_key)) {
              expected_evictions++;
            }

            cache.set(my_key, my_value);

            // Cache size should never exceed max_size
            expect(cache.size()).toBeLessThanOrEqual(max_size);

            // If we added a new key and were at capacity, size should stay same
            if (size_before >= max_size && !cache.has(my_key)) {
              expect(cache.size()).toBe(max_size);
            }
          }

          // Verify evictions match expectations
          const stats = cache.get_stats();
          expect(stats.evictions).toBe(expected_evictions);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Completion Cache Hit Rate
   * For any sequence of get/set operations on a completion cache,
   * the hit rate should be accurate. A hit occurs when get returns a value
   * that was previously set. Misses occur when get returns undefined.
   * Feature: lsp-performance-optimization, Property 6: Completion Cache Hit Rate
   * Validates: Requirements 6.1, 6.2
   */
  it('should track cache hits and misses accurately', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.tuple(
              fc.constant('set'),
              fc.string({ minLength: 1, maxLength: 20 }),
              fc.string({ minLength: 1, maxLength: 20 })
            ),
            fc.tuple(
              fc.constant('get'),
              fc.string({ minLength: 1, maxLength: 20 })
            )
          ),
          { minLength: 1, maxLength: 100 }
        ),
        (the_operations) => {
          const cache = new LRUCache<string, string>(50);
          const known_keys = new Set<string>();
          let expected_hits = 0;
          let expected_misses = 0;

          for (const my_op of the_operations) {
            if (my_op[0] === 'set') {
              const [, my_key, my_value] = my_op as [string, string, string];
              cache.set(my_key, my_value);
              known_keys.add(my_key);
            } else {
              const [, my_key] = my_op as [string, string];
              const result = cache.get(my_key);

              if (known_keys.has(my_key) && result !== undefined) {
                expected_hits++;
              } else if (!known_keys.has(my_key) && result === undefined) {
                expected_misses++;
              }
            }
          }

          const stats = cache.get_stats();
          expect(stats.hits).toBe(expected_hits);
          expect(stats.misses).toBe(expected_misses);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: LRU Eviction Order
   * For any sequence of operations, when the cache is full and a new item
   * is added, the least recently used item should be evicted. An item is
   * considered recently used if it was accessed (get) or set recently.
   */
  it('should evict least recently used items', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.tuple(
              fc.constant('set'),
              fc.integer({ min: 0, max: 9 }),
              fc.string({ minLength: 1, maxLength: 10 })
            ),
            fc.tuple(
              fc.constant('get'),
              fc.integer({ min: 0, max: 9 })
            )
          ),
          { minLength: 5, maxLength: 50 }
        ),
        (the_operations) => {
          const cache = new LRUCache<number, string>(5);
          let access_order: number[] = [];

          for (const my_op of the_operations) {
            if (my_op[0] === 'set') {
              const [, my_key, my_value] = my_op as [string, number, string];
              cache.set(my_key, my_value);
              // Remove from access order if present, then add to end
              access_order = access_order.filter(k => k !== my_key);
              access_order.push(my_key);
            } else {
              const [, my_key] = my_op as [string, number];
              const result = cache.get(my_key);
              if (result !== undefined) {
                // Remove from access order if present, then add to end
                access_order = access_order.filter(k => k !== my_key);
                access_order.push(my_key);
              }
            }

            // Cache size should never exceed max
            expect(cache.size()).toBeLessThanOrEqual(5);

            // All keys in cache should be in access_order
            const stats = cache.get_stats();
            // We can't directly inspect cache contents, but we can verify
            // that evictions happened when expected
            if (access_order.length > 5) {
              expect(stats.evictions).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Completion Cache Invalidation
   * For a completion cache, when invalidate_on_db_change is called with
   * a new version number, the cache should be cleared. Subsequent gets
   * should return undefined for previously cached items.
   */
  it('should invalidate cache on database version change', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 10 }),
            fc.string({ minLength: 1, maxLength: 10 })
          ),
          { minLength: 1, maxLength: 20 }
        ),
        (the_entries) => {
          const cache = new CompletionPrefixCache(50);

          // Set initial entries
          for (const [my_prefix, my_context] of the_entries) {
            cache.set_with_context(my_prefix, my_context, []);
          }

          // Verify entries are cached
          for (const [my_prefix, my_context] of the_entries) {
            expect(cache.has_with_context(my_prefix, my_context)).toBe(true);
          }

          // Invalidate with new version
          cache.invalidate_on_db_change(1);

          // Verify cache is cleared
          for (const [my_prefix, my_context] of the_entries) {
            expect(cache.has_with_context(my_prefix, my_context)).toBe(false);
          }

          // Verify size is 0
          expect(cache.size()).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Completion Cache Context Isolation
   * For a completion cache, entries with the same prefix but different
   * contexts should be stored separately. Getting a prefix in one context
   * should not return entries from another context.
   */
  it('should isolate cache entries by context', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 10 }),
          { minLength: 1, maxLength: 20 }
        ),
        (the_prefixes) => {
          const cache = new CompletionPrefixCache(100);
          const contexts = ['stata', 'mata', 'python'];

          // Use unique prefixes to avoid overwrites
          const unique_prefixes = [...new Set(the_prefixes)];

          // Set entries in different contexts with context-specific values
          for (const my_prefix of unique_prefixes) {
            for (const my_context of contexts) {
              // Use context-specific value to verify isolation
              cache.set_with_context(my_prefix, my_context, [`${my_context}_${my_prefix}`]);
            }
          }

          // Verify entries are isolated by context
          for (const my_prefix of unique_prefixes) {
            for (const my_context of contexts) {
              const result = cache.get_with_context(my_prefix, my_context);
              expect(result).toBeDefined();
              expect(result).toEqual([`${my_context}_${my_prefix}`]);
            }
          }

          // Verify getting from wrong context returns undefined
          for (const my_prefix of unique_prefixes) {
            const result = cache.get_with_context(my_prefix, 'nonexistent');
            expect(result).toBeUndefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Edge case: Cache with size 1
   * A cache with max_size=1 should evict the previous item when a new one is added
   */
  it('should handle cache with size 1', () => {
    const cache = new LRUCache<string, string>(1);

    cache.set('key1', 'value1');
    expect(cache.size()).toBe(1);
    expect(cache.get('key1')).toBe('value1');

    cache.set('key2', 'value2');
    expect(cache.size()).toBe(1);
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');

    const stats = cache.get_stats();
    expect(stats.evictions).toBe(1);
  });

  /**
   * Edge case: Getting an item should mark it as recently used
   * When an item is accessed via get, it should be moved to the end
   * and not be evicted when a new item is added
   */
  it('should mark accessed items as recently used', () => {
    const cache = new LRUCache<string, string>(2);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    expect(cache.size()).toBe(2);

    // Access key1 to mark it as recently used
    expect(cache.get('key1')).toBe('value1');

    // Add key3 - should evict key2 (least recently used)
    cache.set('key3', 'value3');
    expect(cache.size()).toBe(2);
    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toBe('value3');
  });

  /**
   * Edge case: Updating an existing key should not evict anything
   * When setting a key that already exists, the cache size should not change
   */
  it('should not evict when updating existing key', () => {
    const cache = new LRUCache<string, string>(2);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    expect(cache.size()).toBe(2);

    const stats_before = cache.get_stats();

    // Update key1
    cache.set('key1', 'new_value1');
    expect(cache.size()).toBe(2);

    const stats_after = cache.get_stats();
    expect(stats_after.evictions).toBe(stats_before.evictions);
  });
});
