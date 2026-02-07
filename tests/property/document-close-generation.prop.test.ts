import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentStore } from '../../src/document-store';

describe('Document Close Generation Safety Property Tests', () => {
    /**
     * Property 14: Closed documents are not reinserted
     *
     * For any document closed while an update is in-flight,
     * the completed update shall not reinsert document state
     * if the close generation is newer than the update's
     * generation.
     *
     * **Validates: Requirements 16.1, 16.2**
     */
    it('closed document is not reinserted by in-flight update', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }),
                async (num_updates_before_close) => {
                    const my_store = new DocumentStore();
                    const my_uri = 'file:///test_close.do';
                    const my_content = 'display "hello"';

                    // Open the document
                    await my_store.open(my_uri, my_content, 1);
                    expect(my_store.get(my_uri)).toBeDefined();

                    // Perform some updates to advance the
                    // generation counter
                    for (let i = 0; i < num_updates_before_close; i++) {
                        await my_store.update(
                            my_uri,
                            [{ text: `display "update ${i}"` }],
                            2 + i
                        );
                    }

                    // Now simulate the race: start an update
                    // (which captures a generation), then close
                    // the document before the update completes.
                    //
                    // We do this by calling close() while the
                    // update promise is in flight.
                    const update_promise = my_store.update(
                        my_uri,
                        [{ text: 'display "stale"' }],
                        100 + num_updates_before_close
                    );

                    // Close the document — this increments the
                    // generation past the update's captured
                    // generation
                    my_store.close(my_uri);

                    // Document should be gone immediately
                    expect(my_store.get(my_uri)).toBeUndefined();

                    // Wait for the in-flight update to complete
                    await update_promise;

                    // The document must still be absent — the
                    // stale update must not have reinserted it
                    expect(my_store.get(my_uri)).toBeUndefined();
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 14 (continued): close increments generation
     * and records closed generation
     *
     * For any document that is opened and then closed, the
     * store shall not contain the document after close.
     *
     * **Validates: Requirements 16.1, 16.2**
     */
    it('get returns undefined after close', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (num_documents) => {
                    const my_store = new DocumentStore();
                    const the_uris: string[] = [];

                    // Open multiple documents
                    for (let i = 0; i < num_documents; i++) {
                        const my_uri =
                            `file:///doc_${i}.do`;
                        the_uris.push(my_uri);
                        await my_store.open(
                            my_uri,
                            `display "doc ${i}"`,
                            1
                        );
                        expect(
                            my_store.get(my_uri)
                        ).toBeDefined();
                    }

                    // Close all documents
                    for (const my_uri of the_uris) {
                        my_store.close(my_uri);
                        expect(
                            my_store.get(my_uri)
                        ).toBeUndefined();
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 14 (continued): reopening after close works
     *
     * For any document that is closed and then reopened, the
     * new open shall succeed because the new generation is
     * greater than the closed generation.
     *
     * **Validates: Requirements 16.1, 16.2**
     */
    it('reopening after close succeeds with new generation', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }),
                async (num_close_reopen_cycles) => {
                    const my_store = new DocumentStore();
                    const my_uri = 'file:///reopen_test.do';

                    for (
                        let cycle = 0;
                        cycle < num_close_reopen_cycles;
                        cycle++
                    ) {
                        const my_content =
                            `display "cycle ${cycle}"`;

                        // Open the document
                        await my_store.open(
                            my_uri,
                            my_content,
                            cycle + 1
                        );
                        const my_state = my_store.get(my_uri);
                        expect(my_state).toBeDefined();
                        expect(my_state!.content).toBe(
                            my_content
                        );

                        // Close the document
                        my_store.close(my_uri);
                        expect(
                            my_store.get(my_uri)
                        ).toBeUndefined();
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 14 (continued): multiple in-flight updates
     * after close are all discarded
     *
     * For any number of updates started before a close, none
     * of them shall reinsert the document after close.
     *
     * **Validates: Requirements 16.1, 16.2**
     */
    it('multiple in-flight updates after close are all discarded', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 5 }),
                async (num_concurrent_updates) => {
                    const my_store = new DocumentStore();
                    const my_uri = 'file:///multi_update.do';

                    // Open the document
                    await my_store.open(
                        my_uri,
                        'display "initial"',
                        1
                    );
                    expect(my_store.get(my_uri)).toBeDefined();

                    // Start multiple updates concurrently
                    const the_update_promises: Promise<void>[] =
                        [];
                    for (
                        let i = 0;
                        i < num_concurrent_updates;
                        i++
                    ) {
                        the_update_promises.push(
                            my_store.update(
                                my_uri,
                                [
                                    {
                                        text: `display "concurrent ${i}"`,
                                    },
                                ],
                                10 + i
                            )
                        );
                    }

                    // Close the document while updates are
                    // in flight
                    my_store.close(my_uri);
                    expect(
                        my_store.get(my_uri)
                    ).toBeUndefined();

                    // Wait for all updates to complete
                    await Promise.allSettled(
                        the_update_promises
                    );

                    // Document must still be absent
                    expect(
                        my_store.get(my_uri)
                    ).toBeUndefined();
                }
            ),
            { numRuns: 100 }
        );
    });
});
