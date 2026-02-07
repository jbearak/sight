import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentDebounceManager } from '../../src/utils/debounce-manager';

describe('Debounce Manager Dispose Property Tests', () => {
    /**
     * Property 1: Dispose clears debounce state
     *
     * For any DocumentDebounceManager with N pending timers and M
     * queued parse items, calling dispose() shall result in zero
     * pending timers, an empty parse queue, and any subsequent
     * schedule_validation call shall be a no-op (no timer created,
     * no callback enqueued).
     *
     * **Validates: Requirements 1.5**
     */
    it('dispose clears all pending timers and parse queue', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 5 }),
                async (num_uris, changes_per_uri) => {
                    const my_manager = new DocumentDebounceManager();
                    // Use minimal debounce to keep tests fast
                    my_manager.set_debounce_ms(5);

                    let callback_count = 0;
                    const my_callback = async () => {
                        callback_count++;
                    };

                    // Schedule validations for multiple URIs
                    // to create pending timers
                    for (let i = 0; i < num_uris; i++) {
                        const my_uri = `file:///test_${i}.do`;
                        for (let v = 1; v <= changes_per_uri; v++) {
                            my_manager.schedule_validation(
                                my_uri,
                                v,
                                my_callback
                            );
                        }
                    }

                    // Verify there are pending items before dispose
                    let has_pending = false;
                    for (let i = 0; i < num_uris; i++) {
                        if (my_manager.is_pending(`file:///test_${i}.do`)) {
                            has_pending = true;
                            break;
                        }
                    }
                    expect(has_pending).toBe(true);

                    // Dispose the manager
                    my_manager.dispose();

                    // After dispose: no URIs should be pending
                    for (let i = 0; i < num_uris; i++) {
                        expect(
                            my_manager.is_pending(`file:///test_${i}.do`)
                        ).toBe(false);
                    }

                    // Wait longer than debounce window to confirm
                    // no callbacks fire after dispose
                    await new Promise((resolve) =>
                        setTimeout(resolve, 20)
                    );
                    expect(callback_count).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): schedule_validation after dispose
     * is a no-op
     *
     * For any disposed DocumentDebounceManager, calling
     * schedule_validation shall not create a timer or enqueue
     * a callback.
     *
     * **Validates: Requirements 1.5**
     */
    it('schedule_validation after dispose is a no-op', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (num_post_dispose_calls) => {
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(5);

                    let callback_count = 0;
                    const my_callback = async () => {
                        callback_count++;
                    };

                    // Dispose immediately
                    my_manager.dispose();

                    // Try scheduling after dispose
                    for (let i = 0; i < num_post_dispose_calls; i++) {
                        const my_uri = `file:///post_dispose_${i}.do`;
                        my_manager.schedule_validation(
                            my_uri,
                            1,
                            my_callback
                        );
                        // Should not be pending — schedule was
                        // a no-op
                        expect(my_manager.is_pending(my_uri)).toBe(
                            false
                        );
                    }

                    // Wait longer than debounce window
                    await new Promise((resolve) =>
                        setTimeout(resolve, 20)
                    );

                    // No callbacks should have fired
                    expect(callback_count).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): dispose is idempotent
     *
     * Calling dispose() multiple times shall not throw and shall
     * leave the manager in the same disposed state.
     *
     * **Validates: Requirements 1.5**
     */
    it('dispose is idempotent', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }),
                fc.integer({ min: 2, max: 5 }),
                async (num_uris, dispose_calls) => {
                    const my_manager = new DocumentDebounceManager();
                    my_manager.set_debounce_ms(5);

                    let callback_count = 0;
                    const my_callback = async () => {
                        callback_count++;
                    };

                    // Schedule some validations
                    for (let i = 0; i < num_uris; i++) {
                        my_manager.schedule_validation(
                            `file:///test_${i}.do`,
                            1,
                            my_callback
                        );
                    }

                    // Call dispose multiple times — should not throw
                    for (let i = 0; i < dispose_calls; i++) {
                        my_manager.dispose();
                    }

                    // All URIs should be non-pending
                    for (let i = 0; i < num_uris; i++) {
                        expect(
                            my_manager.is_pending(`file:///test_${i}.do`)
                        ).toBe(false);
                    }

                    // Wait and confirm no callbacks fire
                    await new Promise((resolve) =>
                        setTimeout(resolve, 20)
                    );
                    expect(callback_count).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('Debounce Coalescing Property Tests', () => {
    /**
     * Property 3: Debounce coalesces rapid changes into single callback
     *
     * For any sequence of N document change events (N >= 2) for the
     * same URI arriving within the debounce window, the debounce
     * manager shall execute exactly one callback (the one with the
     * latest version).
     *
     * **Validates: Requirements 2.2, 3.2**
     */
    it(
        'coalesces N rapid changes into exactly one callback with latest version',
        async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 20 }),
                    async (num_changes) => {
                        const my_manager =
                            new DocumentDebounceManager();
                        // Use a small debounce window — all
                        // schedule_validation calls arrive within
                        // it because the loop is synchronous
                        my_manager.set_debounce_ms(10);
                        const my_uri =
                            'file:///coalesce_test.do';

                        let callback_count = 0;
                        let last_executed_version = -1;

                        // Schedule N validations for the same URI
                        // with increasing versions, all within the
                        // debounce window (synchronous loop)
                        for (let v = 1; v <= num_changes; v++) {
                            const captured_version = v;
                            my_manager.schedule_validation(
                                my_uri,
                                captured_version,
                                async () => {
                                    callback_count++;
                                    last_executed_version =
                                        captured_version;
                                }
                            );
                        }

                        // Wait for the debounce to fire and
                        // callback to complete
                        await my_manager.wait_for_debounce(
                            my_uri
                        );

                        // Exactly one callback should have
                        // executed
                        expect(callback_count).toBe(1);

                        // The executed callback should be the one
                        // with the latest version
                        expect(last_executed_version).toBe(
                            num_changes
                        );
                    }
                ),
                { numRuns: 100 }
            );
        },
        30_000
    );

    /**
     * Property 3 (continued): Coalescing across multiple URIs
     *
     * For any set of URIs, each receiving N >= 2 rapid changes
     * within the debounce window, the debounce manager shall
     * execute exactly one callback per URI (the one with the
     * latest version for that URI).
     *
     * **Validates: Requirements 2.2, 3.2**
     */
    it(
        'coalesces per-URI independently across multiple URIs',
        async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }),
                    fc.integer({ min: 2, max: 10 }),
                    async (num_uris, changes_per_uri) => {
                        const my_manager =
                            new DocumentDebounceManager();
                        my_manager.set_debounce_ms(10);

                        const callback_counts = new Map<
                            string,
                            number
                        >();
                        const executed_versions = new Map<
                            string,
                            number
                        >();

                        // Schedule changes for each URI
                        for (let u = 0; u < num_uris; u++) {
                            const my_uri =
                                `file:///multi_coalesce_${u}.do`;
                            callback_counts.set(my_uri, 0);

                            for (
                                let v = 1;
                                v <= changes_per_uri;
                                v++
                            ) {
                                const captured_version = v;
                                my_manager.schedule_validation(
                                    my_uri,
                                    captured_version,
                                    async () => {
                                        callback_counts.set(
                                            my_uri,
                                            (callback_counts.get(
                                                my_uri
                                            ) ?? 0) + 1
                                        );
                                        executed_versions.set(
                                            my_uri,
                                            captured_version
                                        );
                                    }
                                );
                            }
                        }

                        // Wait for all URIs to complete
                        const the_wait_promises: Promise<void>[] =
                            [];
                        for (let u = 0; u < num_uris; u++) {
                            const my_uri =
                                `file:///multi_coalesce_${u}.do`;
                            the_wait_promises.push(
                                my_manager.wait_for_debounce(
                                    my_uri
                                )
                            );
                        }
                        await Promise.all(the_wait_promises);

                        // Each URI should have exactly one callback
                        // executed with the latest version
                        for (let u = 0; u < num_uris; u++) {
                            const my_uri =
                                `file:///multi_coalesce_${u}.do`;
                            expect(
                                callback_counts.get(my_uri)
                            ).toBe(1);
                            expect(
                                executed_versions.get(my_uri)
                            ).toBe(changes_per_uri);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        },
        30_000
    );
});

