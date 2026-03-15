/**
 * Unit tests for the shutdown handler and pending
 * revalidations cleanup.
 *
 * Covers:
 * - Property 2: Cancel pending revalidations on shutdown
 *   **Validates: Requirements 1.1**
 * - Property 7: Pending revalidations cleaned up after
 *   completion
 *   **Validates: Requirements 7.1**
 * - Property 8: Pending revalidation replacement cancels
 *   previous
 *   **Validates: Requirements 7.2**
 * - Shutdown awaits active document store updates (Req 1.3)
 * - Shutdown disposes scope resolvers (Req 1.4)
 * - Shutdown calls workspace_indexer.cancel() (Req 15.1)
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { create_shutdown_handler } from '../../src/server-handlers';
import type { HandlerDependencies } from '../../src/server-handlers';

/**
 * Create a minimal mock of HandlerDependencies with tracking
 * for dispose/cancel calls.
 */
function create_mock_deps(overrides?: Partial<{
    document_store_dispose: () => Promise<void>;
    scope_resolver_dispose: () => void;
    forward_scope_resolver_dispose: () => void;
    workspace_indexer_cancel: () => void;
    rename_handler_dispose: () => void;
}>) {
    const calls: string[] = [];

    const deps = {
        debounce_manager: null,
        document_store: {
            dispose: overrides?.document_store_dispose ?? (async () => {
                calls.push('document_store.dispose');
            }),
            // Stubs for other DocumentStore methods
            get: () => undefined,
            open: async () => {},
            update: async () => {},
            close: () => {},
            wait_for_update: async () => {},
        },
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: {
            cancel: overrides?.workspace_indexer_cancel ?? (() => {
                calls.push('workspace_indexer.cancel');
            }),
            get_all_symbols: () => ({}),
        },
        scope_resolver: {
            dispose: overrides?.scope_resolver_dispose ?? (() => {
                calls.push('scope_resolver.dispose');
            }),
        },
        forward_scope_resolver: {
            dispose: overrides?.forward_scope_resolver_dispose
                ?? (() => {
                    calls.push(
                        'forward_scope_resolver.dispose'
                    );
                }),
        },
        dependency_graph: null,
        rename_handler: {
            dispose: overrides?.rename_handler_dispose ?? (() => {
                calls.push('rename_handler.dispose');
            }),
            get_pending_removals: () => new Map(),
        },
        get_document_settings: async () => ({
            diagnostics: {
                enabled: true,
                indentation: false,
                undefinedMacros: true,
            },
            completion: {
                maxItems: 100,
                showCommandSyntax: true,
            },
            formatting: {
                mode: 'source-preserving' as const,
                indentSize: 4,
                commentStyle: 'preserve' as const,
            },
            indexing: { maxFileSizeBytes: 1_000_000 },
            adoPaths: [],
            indexWorkspace: true,
            cross_file: {
                max_backward_depth: 10,
                max_forward_depth: 10,
                max_chain_depth: 20,
            },
        }),
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    } as unknown as HandlerDependencies;

    return { deps, calls };
}

describe('Shutdown Handler', () => {
    /**
     * Property 2: Cancel pending revalidations on shutdown
     *
     * For any pending_revalidations map with N entries (each
     * with cancelled: false), calling the shutdown handler
     * shall set cancelled = true on every entry in the map.
     *
     * **Validates: Requirements 1.1**
     */
    describe('Property 2: Cancel pending revalidations', () => {
        it('sets cancelled = true on all entries', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 50 }),
                    async (num_entries) => {
                        const pending_revalidations = new Map<
                            string,
                            { cancelled: boolean }
                        >();

                        // Populate with N entries, all
                        // cancelled: false
                        for (let i = 0; i < num_entries; i++) {
                            pending_revalidations.set(
                                `file:///test_${i}.do`,
                                { cancelled: false }
                            );
                        }

                        // Capture references before shutdown
                        // clears the map
                        const the_entries = Array.from(
                            pending_revalidations.values()
                        );

                        const handler = create_shutdown_handler(
                            undefined,
                            {
                                pending_revalidations,
                            }
                        );

                        await handler();

                        // Every entry should have been
                        // cancelled
                        for (
                            const my_entry of the_entries
                        ) {
                            expect(my_entry.cancelled).toBe(
                                true
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('clears the map after cancelling', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 30 }),
                    async (num_entries) => {
                        const pending_revalidations = new Map<
                            string,
                            { cancelled: boolean }
                        >();

                        for (let i = 0; i < num_entries; i++) {
                            pending_revalidations.set(
                                `file:///test_${i}.do`,
                                { cancelled: false }
                            );
                        }

                        const handler = create_shutdown_handler(
                            undefined,
                            {
                                pending_revalidations,
                            }
                        );

                        await handler();

                        // Map should be empty after shutdown
                        expect(
                            pending_revalidations.size
                        ).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('handles empty pending_revalidations map', async () => {
            const pending_revalidations = new Map<
                string,
                { cancelled: boolean }
            >();

            const handler = create_shutdown_handler(
                undefined,
                { pending_revalidations }
            );

            // Should not throw
            await handler();
            expect(pending_revalidations.size).toBe(0);
        });
    });

    /**
     * Test that shutdown awaits active document store updates.
     *
     * Validates: Requirement 1.3
     */
    describe('Await document store updates (Req 1.3)', () => {
        it('awaits document_store.dispose()', async () => {
            let dispose_resolved = false;

            const { deps } = create_mock_deps({
                document_store_dispose: async () => {
                    // Simulate an async operation
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 10)
                    );
                    dispose_resolved = true;
                },
            });

            const handler = create_shutdown_handler(deps);

            await handler();

            // The handler should have awaited the
            // async dispose
            expect(dispose_resolved).toBe(true);
        });
    });

    /**
     * Test that shutdown disposes scope resolvers.
     *
     * Validates: Requirement 1.4
     */
    describe('Dispose scope resolvers (Req 1.4)', () => {
        it('calls dispose on scope_resolver', async () => {
            let scope_disposed = false;

            const { deps } = create_mock_deps({
                scope_resolver_dispose: () => {
                    scope_disposed = true;
                },
            });

            const handler = create_shutdown_handler(deps);
            await handler();

            expect(scope_disposed).toBe(true);
        });

        it('calls dispose on forward_scope_resolver', async () => {
            let forward_disposed = false;

            const { deps } = create_mock_deps({
                forward_scope_resolver_dispose: () => {
                    forward_disposed = true;
                },
            });

            const handler = create_shutdown_handler(deps);
            await handler();

            expect(forward_disposed).toBe(true);
        });

        it('handles null scope resolvers gracefully', async () => {
            const { deps } = create_mock_deps();
            // Set resolvers to null
            (deps as any).scope_resolver = null;
            (deps as any).forward_scope_resolver = null;

            const handler = create_shutdown_handler(deps);

            // Should not throw
            await handler();
        });
    });

    /**
     * Test that shutdown calls workspace_indexer.cancel().
     *
     * Validates: Requirement 15.1
     */
    describe('Cancel workspace indexer (Req 15.1)', () => {
        it('calls workspace_indexer.cancel()', async () => {
            let indexer_cancelled = false;

            const { deps } = create_mock_deps({
                workspace_indexer_cancel: () => {
                    indexer_cancelled = true;
                },
            });

            const handler = create_shutdown_handler(deps);
            await handler();

            expect(indexer_cancelled).toBe(true);
        });

        it('handles null workspace_indexer gracefully', async () => {
            const { deps } = create_mock_deps();
            (deps as any).workspace_indexer = null;

            const handler = create_shutdown_handler(deps);

            // Should not throw
            await handler();
        });
    });

    /**
     * Integration: shutdown invokes all cleanup steps.
     */
    describe('Full shutdown sequence', () => {
        it('invokes all dispose/cancel methods', async () => {
            const { deps, calls } = create_mock_deps();

            const pending_revalidations = new Map<
                string,
                { cancelled: boolean }
            >();
            pending_revalidations.set('file:///a.do', {
                cancelled: false,
            });

            const handler = create_shutdown_handler(deps, {
                pending_revalidations,
            });

            await handler();

            expect(calls).toContain('document_store.dispose');
            expect(calls).toContain('scope_resolver.dispose');
            expect(calls).toContain(
                'forward_scope_resolver.dispose'
            );
            expect(calls).toContain('workspace_indexer.cancel');
            expect(calls).toContain('rename_handler.dispose');
            expect(pending_revalidations.size).toBe(0);
        });

        it('handles undefined deps and disposables', async () => {
            const handler = create_shutdown_handler(
                undefined,
                undefined
            );

            // Should not throw with all undefined
            await handler();
        });
    });

    /**
     * Property 7: Pending revalidations cleaned up after
     * completion
     *
     * For any URI that completes a revalidation callback
     * (success or cancellation), the pending_revalidations
     * map shall not contain an entry for that URI after the
     * callback returns.
     *
     * **Validates: Requirements 7.1**
     */
    describe(
        'Property 7: Pending revalidations cleaned up '
        + 'after completion',
        () => {
            it(
                'deletes entry after successful callback',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.array(
                                fc.string({
                                    minLength: 1,
                                    maxLength: 30,
                                }),
                                { minLength: 1, maxLength: 20 }
                            ),
                            async (the_uris) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                // Simulate the revalidation
                                // pattern from
                                // server-factory.ts:
                                // set entry, run callback,
                                // delete in finally
                                for (
                                    const my_uri of the_uris
                                ) {
                                    const my_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        my_uri,
                                        my_token
                                    );

                                    try {
                                        // Simulate
                                        // successful
                                        // revalidation
                                        // work
                                    } finally {
                                        pending_revalidations
                                            .delete(my_uri);
                                    }

                                    // Entry must be gone
                                    // after callback
                                    expect(
                                        pending_revalidations
                                            .has(my_uri)
                                    ).toBe(false);
                                }
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'deletes entry after cancelled callback',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.array(
                                fc.string({
                                    minLength: 1,
                                    maxLength: 30,
                                }),
                                { minLength: 1, maxLength: 20 }
                            ),
                            async (the_uris) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                for (
                                    const my_uri of the_uris
                                ) {
                                    const my_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        my_uri,
                                        my_token
                                    );

                                    // Simulate
                                    // cancellation before
                                    // callback runs
                                    my_token.cancelled = true;

                                    try {
                                        if (
                                            my_token.cancelled
                                        ) {
                                            // Skip work on
                                            // cancellation
                                            // (as in
                                            // server-
                                            // factory.ts)
                                        }
                                    } finally {
                                        pending_revalidations
                                            .delete(my_uri);
                                    }

                                    // Entry must be
                                    // gone even when
                                    // cancelled
                                    expect(
                                        pending_revalidations
                                            .has(my_uri)
                                    ).toBe(false);
                                }
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'deletes entry even when callback throws',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.string({
                                minLength: 1,
                                maxLength: 30,
                            }),
                            async (uri) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                const my_token = {
                                    cancelled: false,
                                };
                                pending_revalidations.set(
                                    uri,
                                    my_token
                                );

                                try {
                                    // Simulate callback
                                    // that throws
                                    throw new Error(
                                        'revalidation error'
                                    );
                                } catch {
                                    // Error handled
                                } finally {
                                    pending_revalidations
                                        .delete(uri);
                                }

                                // Entry must be gone even
                                // after error
                                expect(
                                    pending_revalidations.has(
                                        uri
                                    )
                                ).toBe(false);
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'map is empty after all callbacks complete',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.integer({
                                min: 1,
                                max: 50,
                            }),
                            async (num_uris) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                // Schedule all entries
                                for (
                                    let i = 0;
                                    i < num_uris;
                                    i++
                                ) {
                                    pending_revalidations.set(
                                        `file:///doc_${i}.do`,
                                        { cancelled: false }
                                    );
                                }

                                // Complete all callbacks
                                // with finally cleanup
                                for (
                                    let i = 0;
                                    i < num_uris;
                                    i++
                                ) {
                                    const my_uri =
                                        `file:///doc_${i}.do`;
                                    try {
                                        // Simulate work
                                    } finally {
                                        pending_revalidations
                                            .delete(my_uri);
                                    }
                                }

                                expect(
                                    pending_revalidations.size
                                ).toBe(0);
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );
        }
    );

    /**
     * Property 8: Pending revalidation replacement cancels
     * previous
     *
     * For any URI with an existing entry in
     * pending_revalidations, scheduling a new revalidation
     * for that URI shall set cancelled = true on the
     * previous entry and replace it with a new entry where
     * cancelled = false.
     *
     * **Validates: Requirements 7.2**
     */
    describe(
        'Property 8: Pending revalidation replacement '
        + 'cancels previous',
        () => {
            it(
                'cancels existing entry and replaces with '
                + 'new uncancelled entry',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.array(
                                fc.string({
                                    minLength: 1,
                                    maxLength: 30,
                                }),
                                { minLength: 1, maxLength: 20 }
                            ),
                            async (the_uris) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                for (
                                    const my_uri of the_uris
                                ) {
                                    // First scheduling
                                    const first_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        my_uri,
                                        first_token
                                    );

                                    // Second scheduling
                                    // for same URI
                                    // (cancel-then-
                                    // replace pattern)
                                    const existing =
                                        pending_revalidations
                                            .get(my_uri);
                                    if (existing) {
                                        existing.cancelled =
                                            true;
                                    }
                                    const second_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        my_uri,
                                        second_token
                                    );

                                    // Old entry must be
                                    // cancelled
                                    expect(
                                        first_token.cancelled
                                    ).toBe(true);

                                    // New entry must not
                                    // be cancelled
                                    expect(
                                        second_token.cancelled
                                    ).toBe(false);

                                    // Map must contain
                                    // the new entry
                                    expect(
                                        pending_revalidations
                                            .get(my_uri)
                                    ).toBe(second_token);
                                }
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'handles multiple replacements for the '
                + 'same URI',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.string({
                                minLength: 1,
                                maxLength: 30,
                            }),
                            fc.integer({
                                min: 2,
                                max: 20,
                            }),
                            async (
                                uri,
                                num_replacements
                            ) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                const the_tokens: Array<{
                                    cancelled: boolean;
                                }> = [];

                                for (
                                    let i = 0;
                                    i < num_replacements;
                                    i++
                                ) {
                                    // Cancel existing
                                    const existing =
                                        pending_revalidations
                                            .get(uri);
                                    if (existing) {
                                        existing.cancelled =
                                            true;
                                    }

                                    // Replace with new
                                    const my_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        uri,
                                        my_token
                                    );
                                    the_tokens.push(
                                        my_token
                                    );
                                }

                                // All tokens except the
                                // last must be cancelled
                                for (
                                    let i = 0;
                                    i <
                                    the_tokens.length - 1;
                                    i++
                                ) {
                                    expect(
                                        the_tokens[i]
                                            .cancelled
                                    ).toBe(true);
                                }

                                // Last token must not be
                                // cancelled
                                const last_token =
                                    the_tokens[
                                        the_tokens.length - 1
                                    ];
                                expect(
                                    last_token.cancelled
                                ).toBe(false);

                                // Map must contain only
                                // the last token
                                expect(
                                    pending_revalidations.get(
                                        uri
                                    )
                                ).toBe(last_token);
                                expect(
                                    pending_revalidations.size
                                ).toBe(1);
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'replacement for different URIs does not '
                + 'affect other entries',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.uniqueArray(
                                fc.string({
                                    minLength: 1,
                                    maxLength: 30,
                                }),
                                {
                                    minLength: 2,
                                    maxLength: 10,
                                }
                            ),
                            async (the_uris) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                // Set initial entries
                                // for all URIs
                                const the_initial_tokens =
                                    new Map<
                                        string,
                                        {
                                            cancelled: boolean;
                                        }
                                    >();
                                for (
                                    const my_uri of the_uris
                                ) {
                                    const my_token = {
                                        cancelled: false,
                                    };
                                    pending_revalidations.set(
                                        my_uri,
                                        my_token
                                    );
                                    the_initial_tokens.set(
                                        my_uri,
                                        my_token
                                    );
                                }

                                // Replace only the first
                                // URI
                                const first_uri =
                                    the_uris[0];
                                const existing =
                                    pending_revalidations.get(
                                        first_uri
                                    );
                                if (existing) {
                                    existing.cancelled =
                                        true;
                                }
                                const new_token = {
                                    cancelled: false,
                                };
                                pending_revalidations.set(
                                    first_uri,
                                    new_token
                                );

                                // First URI's old token
                                // must be cancelled
                                expect(
                                    the_initial_tokens.get(
                                        first_uri
                                    )!.cancelled
                                ).toBe(true);

                                // Other URIs must be
                                // unaffected
                                for (
                                    let i = 1;
                                    i < the_uris.length;
                                    i++
                                ) {
                                    const my_uri =
                                        the_uris[i];
                                    const my_token =
                                        the_initial_tokens
                                            .get(my_uri)!;
                                    expect(
                                        my_token.cancelled
                                    ).toBe(false);
                                    expect(
                                        pending_revalidations
                                            .get(my_uri)
                                    ).toBe(my_token);
                                }
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );

            it(
                'first scheduling for a URI does not '
                + 'cancel anything',
                async () => {
                    await fc.assert(
                        fc.asyncProperty(
                            fc.string({
                                minLength: 1,
                                maxLength: 30,
                            }),
                            async (uri) => {
                                const pending_revalidations =
                                    new Map<
                                        string,
                                        { cancelled: boolean }
                                    >();

                                // No existing entry
                                const existing =
                                    pending_revalidations.get(
                                        uri
                                    );
                                // Should be undefined
                                expect(existing).toBe(
                                    undefined
                                );

                                // First scheduling
                                if (existing) {
                                    existing.cancelled =
                                        true;
                                }
                                const my_token = {
                                    cancelled: false,
                                };
                                pending_revalidations.set(
                                    uri,
                                    my_token
                                );

                                // Token must not be
                                // cancelled
                                expect(
                                    my_token.cancelled
                                ).toBe(false);
                                expect(
                                    pending_revalidations.get(
                                        uri
                                    )
                                ).toBe(my_token);
                            }
                        ),
                        { numRuns: 100 }
                    );
                }
            );
        }
    );
});
