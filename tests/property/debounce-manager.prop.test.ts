import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import {
    DocumentDebounceManager,
    DebounceMetrics,
} from '../../src/utils/debounce-manager';

describe('Debounce Manager Property Tests', () => {
    let debounce_manager: DocumentDebounceManager;

    beforeEach(() => {
        debounce_manager = new DocumentDebounceManager();
    });

    /**
     * Property 5: Debounce Batching
     * For any sequence of rapid document changes to the same URI within the
     * debounce window, the debounce manager should batch them into a single
     * parse operation, avoiding redundant work.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should batch rapid changes within debounce window', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 10 }),
                async (num_changes) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uri = 'file:///test.do';
                    let my_parse_count = 0;
                    const my_callback = async () => {
                        my_parse_count++;
                    };

                    // Schedule multiple rapid changes within debounce window
                    for (let my_i = 0; my_i < num_changes; my_i++) {
                        my_manager.schedule_validation(
                            my_uri,
                            my_i + 1,
                            my_callback
                        );
                    }

                    // Wait for debounce window to expire
                    await new Promise((resolve) =>
                        setTimeout(resolve, 200)
                    );

                    // Should have executed exactly once despite multiple changes
                    expect(my_parse_count).toBe(1);

                    // Metrics should show merged parses
                    const my_metrics = my_manager.get_metrics();
                    expect(my_metrics.merged_parses).toBe(num_changes - 1);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 6: Debounce Cancellation on New Change
     * For any pending debounced parse, scheduling a new change should cancel
     * the previous timer and schedule a new one, ensuring only the latest
     * version is parsed.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should cancel previous timer on new change', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 5 }),
                async (num_changes) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uri = 'file:///test.do';
                    const my_versions_parsed: number[] = [];
                    const my_callback = async () => {
                        // Record that a parse happened
                        my_versions_parsed.push(1);
                    };

                    // Schedule changes with increasing versions
                    for (let my_i = 0; my_i < num_changes; my_i++) {
                        my_manager.schedule_validation(
                            my_uri,
                            my_i + 1,
                            my_callback
                        );
                        // Small delay between changes (but less than debounce)
                        await new Promise((resolve) =>
                            setTimeout(resolve, 30)
                        );
                    }

                    // Wait for final debounce window to expire
                    await new Promise((resolve) =>
                        setTimeout(resolve, 200)
                    );

                    // Should have executed exactly once
                    expect(my_versions_parsed.length).toBe(1);

                    // Metrics should show merged parses
                    const my_metrics = my_manager.get_metrics();
                    expect(my_metrics.merged_parses).toBeGreaterThan(0);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 7: Debounce Metrics Accuracy
     * For any sequence of debounced operations, the metrics should accurately
     * track merged_parses, dropped_parses, and stale_parses.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should accurately track debounce metrics', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }),
                async (num_uris) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uris: string[] = [];
                    for (let my_i = 0; my_i < num_uris; my_i++) {
                        my_uris.push(`file:///test${my_i}.do`);
                    }

                    const my_callback = async () => {
                        // No-op callback
                    };

                    // Schedule multiple changes per URI
                    for (const my_uri of my_uris) {
                        for (let my_v = 1; my_v <= 3; my_v++) {
                            my_manager.schedule_validation(
                                my_uri,
                                my_v,
                                my_callback
                            );
                        }
                    }

                    // Wait for debounce window to expire
                    await new Promise((resolve) =>
                        setTimeout(resolve, 200)
                    );

                    // Check metrics
                    const my_metrics = my_manager.get_metrics();

                    // merged_parses should be (3 - 1) * num_uris = 2 * num_uris
                    expect(my_metrics.merged_parses).toBe(2 * num_uris);

                    // dropped_parses should be 0 (queue not full)
                    expect(my_metrics.dropped_parses).toBe(0);

                    // stale_parses should be 0 (no version staleness)
                    expect(my_metrics.stale_parses).toBe(0);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 8: Debounce is_pending Accuracy
     * For any document with a pending debounced parse, is_pending should
     * return true. After the parse completes, is_pending should return false.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should accurately report pending status', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }),
                async (uri_suffix) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uri = `file:///test_${uri_suffix}.do`;
                    const my_callback = async () => {
                        // No-op callback
                    };

                    // Before scheduling, should not be pending
                    expect(my_manager.is_pending(my_uri)).toBe(false);

                    // Schedule a change
                    my_manager.schedule_validation(
                        my_uri,
                        1,
                        my_callback
                    );

                    // Should be pending immediately
                    expect(my_manager.is_pending(my_uri)).toBe(true);

                    // Wait for debounce window to expire
                    await new Promise((resolve) =>
                        setTimeout(resolve, 200)
                    );

                    // Should no longer be pending
                    expect(my_manager.is_pending(my_uri)).toBe(false);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 9: Debounce Cancel Clears Pending
     * For any pending debounced parse, calling cancel should immediately
     * clear the pending status.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should clear pending status on cancel', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }),
                async (uri_suffix) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uri = `file:///test_${uri_suffix}.do`;
                    const my_callback = async () => {
                        // No-op callback
                    };

                    // Schedule a change
                    my_manager.schedule_validation(
                        my_uri,
                        1,
                        my_callback
                    );

                    // Should be pending
                    expect(my_manager.is_pending(my_uri)).toBe(true);

                    // Cancel
                    my_manager.cancel(my_uri);

                    // Should no longer be pending
                    expect(my_manager.is_pending(my_uri)).toBe(false);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 10: Debounce on_close Clears State
     * For any document with pending state, calling on_close should clear
     * all tracking for that document.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should clear all state on document close', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }),
                async (uri_suffix) => {
                    // Create fresh manager for each test
                    const my_manager = new DocumentDebounceManager();
                    const my_uri = `file:///test_${uri_suffix}.do`;
                    const my_callback = async () => {
                        // No-op callback
                    };

                    // Schedule a change
                    my_manager.schedule_validation(
                        my_uri,
                        1,
                        my_callback
                    );

                    // Should be pending
                    expect(my_manager.is_pending(my_uri)).toBe(true);

                    // Close document
                    my_manager.on_close(my_uri);

                    // Should no longer be pending
                    expect(my_manager.is_pending(my_uri)).toBe(false);

                    // Scheduling new change should work (no stale state)
                    my_manager.schedule_validation(
                        my_uri,
                        2,
                        my_callback
                    );
                    expect(my_manager.is_pending(my_uri)).toBe(true);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 11: Debounce Window Configuration
     * For any debounce window setting, the manager should respect the
     * configured window duration.
     * Feature: lsp-performance-optimization, Property 5: Debounce Batching
     * Validates: Requirements 5.1, 5.3
     */
    it('should respect configured debounce window', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 50, max: 200 }),
                async (debounce_ms) => {
                    // Create fresh manager with custom debounce window
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(debounce_ms);

                    const my_uri = 'file:///test.do';
                    let my_parse_count = 0;
                    const my_callback = async () => {
                        my_parse_count++;
                    };

                    // Schedule a change
                    my_manager.schedule_validation(
                        my_uri,
                        1,
                        my_callback
                    );

                    // Wait less than debounce window
                    await new Promise((resolve) =>
                        setTimeout(resolve, debounce_ms / 2)
                    );

                    // Should still be pending
                    expect(my_manager.is_pending(my_uri)).toBe(true);

                    // Wait for full debounce window
                    await new Promise((resolve) =>
                        setTimeout(resolve, debounce_ms)
                    );

                    // Should no longer be pending
                    expect(my_manager.is_pending(my_uri)).toBe(false);
                }
            ),
            { numRuns: 5 }
        );
    });
});
