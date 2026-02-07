import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentDebounceManager } from '../../src/utils/debounce-manager';

describe('Debounce Wait Property Tests', () => {
    /**
     * Property 11: Debounce wait resolves correctly
     *
     * For any URI with no pending callback, wait_for_debounce(uri)
     * shall resolve immediately without delay.
     *
     * **Validates: Requirements 10.1, 10.3**
     */
    it('wait_for_debounce resolves immediately when no pending callback', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 30 }),
                async (uri_suffix) => {
                    const my_manager = new DocumentDebounceManager();
                    const my_uri =
                        `file:///no_pending_${uri_suffix}.do`;

                    // No callback scheduled — wait should resolve
                    // immediately
                    const start_ms = Date.now();
                    await my_manager.wait_for_debounce(my_uri);
                    const elapsed_ms = Date.now() - start_ms;

                    // Should resolve in under 50ms (essentially
                    // instant; generous for CI load)
                    expect(elapsed_ms).toBeLessThan(50);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 11 (continued): wait_for_debounce resolves only
     * after the callback has completed
     *
     * For any URI with a pending debounce callback,
     * wait_for_debounce(uri) shall resolve only after the
     * callback has completed.
     *
     * **Validates: Requirements 10.1, 10.3**
     */
    it('wait_for_debounce resolves after callback completes', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 5, max: 20 }),
                async (callback_delay_ms) => {
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(5);
                    const my_uri = 'file:///pending_test.do';

                    let callback_completed = false;
                    const my_callback = async () => {
                        // Simulate some async work
                        await new Promise((resolve) =>
                            setTimeout(resolve, callback_delay_ms)
                        );
                        callback_completed = true;
                    };

                    // Schedule a validation
                    my_manager.schedule_validation(
                        my_uri,
                        1,
                        my_callback
                    );

                    // Wait for debounce to complete
                    await my_manager.wait_for_debounce(my_uri);

                    // The callback must have completed by now
                    expect(callback_completed).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 11 (continued): wait_for_debounce resolves
     * immediately after dispose
     *
     * For any URI with a pending debounce callback, if dispose()
     * is called, wait_for_debounce(uri) shall resolve (because
     * dispose resolves pending promises).
     *
     * **Validates: Requirements 10.1, 10.3**
     */
    it('wait_for_debounce resolves after dispose', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }),
                async (num_uris) => {
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(500);

                    const the_uris: string[] = [];
                    const the_wait_promises: Promise<void>[] = [];

                    // Schedule validations for multiple URIs
                    for (let i = 0; i < num_uris; i++) {
                        const my_uri =
                            `file:///dispose_wait_${i}.do`;
                        the_uris.push(my_uri);
                        my_manager.schedule_validation(
                            my_uri,
                            1,
                            async () => {
                                // Long callback that won't complete
                                // before dispose
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 5000)
                                );
                            }
                        );
                    }

                    // Capture wait promises before dispose
                    for (const my_uri of the_uris) {
                        the_wait_promises.push(
                            my_manager.wait_for_debounce(my_uri)
                        );
                    }

                    // Dispose should resolve all pending promises
                    my_manager.dispose();

                    // All wait promises should resolve quickly
                    const timeout_promise = new Promise<string>(
                        (resolve) =>
                            setTimeout(
                                () => resolve('timeout'),
                                100
                            )
                    );
                    const result = await Promise.race([
                        Promise.all(the_wait_promises).then(
                            () => 'resolved'
                        ),
                        timeout_promise,
                    ]);
                    expect(result).toBe('resolved');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 11 (continued): wait_for_debounce for multiple
     * URIs are independent
     *
     * For any set of URIs with pending callbacks,
     * wait_for_debounce for one URI shall not block on another
     * URI's callback.
     *
     * **Validates: Requirements 10.1, 10.3**
     */
    it('wait_for_debounce is independent per URI', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 4 }),
                async (num_uris) => {
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(5);

                    const the_completed: Set<string> = new Set();

                    // Schedule validations with different delays
                    for (let i = 0; i < num_uris; i++) {
                        const my_uri =
                            `file:///independent_${i}.do`;
                        const my_delay = 5 + i * 5;
                        my_manager.schedule_validation(
                            my_uri,
                            1,
                            async () => {
                                await new Promise((resolve) =>
                                    setTimeout(
                                        resolve,
                                        my_delay
                                    )
                                );
                                the_completed.add(my_uri);
                            }
                        );
                    }

                    // Wait for the first URI — it should resolve
                    // without waiting for later URIs
                    const first_uri = 'file:///independent_0.do';
                    await my_manager.wait_for_debounce(first_uri);
                    expect(the_completed.has(first_uri)).toBe(true);

                    // Wait for all remaining URIs
                    for (let i = 1; i < num_uris; i++) {
                        const my_uri =
                            `file:///independent_${i}.do`;
                        await my_manager.wait_for_debounce(my_uri);
                        expect(the_completed.has(my_uri)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
