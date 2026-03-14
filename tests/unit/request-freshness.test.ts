/**
 * Unit tests for request freshness with debounce.
 *
 * Covers:
 * - Completion handler awaits wait_for_debounce before
 *   reading state (Req 10.2)
 * - Hover handler awaits wait_for_debounce before reading
 *   state (Req 10.2)
 * - Definition handler awaits wait_for_debounce before
 *   reading state (Req 10.2)
 * - References handler awaits wait_for_debounce before
 *   reading state (Req 10.2)
 * - wait_for_debounce resolves immediately when no debounce
 *   is pending (Req 10.3)
 *
 * Tests use the real handler factory functions from
 * server-handlers.ts with mock HandlerDependencies that
 * track wait_for_debounce calls.
 */

import { describe, it, expect } from 'bun:test';
import {
    create_completion_handler,
    create_hover_handler,
    create_definition_handler,
    create_references_handler,
} from '../../src/server-handlers';
import type { HandlerDependencies } from '../../src/server-handlers';
import type { DebounceManager } from '../../src/utils/debounce-manager';
import { DocumentStore } from '../../src/document-store';

/**
 * Create a mock DebounceManager that tracks
 * wait_for_debounce calls.
 */
function create_tracking_debounce_manager(): {
    manager: DebounceManager;
    wait_calls: string[];
} {
    const wait_calls: string[] = [];

    const manager: DebounceManager = {
        schedule_validation: () => {},
        cancel: () => {},
        on_close: () => {},
        get_debounce_ms: () => 100,
        set_debounce_ms: () => {},
        is_pending: () => false,
        get_metrics: () => ({
            merged_parses: 0,
            dropped_parses: 0,
            stale_parses: 0,
        }),
        wait_for_debounce: async (uri: string) => {
            wait_calls.push(uri);
        },
        dispose: () => {},
    };

    return { manager, wait_calls };
}

/**
 * Create mock HandlerDependencies with a tracking
 * debounce manager.
 */
function create_tracking_deps(): {
    deps: HandlerDependencies;
    wait_calls: string[];
} {
    const { manager, wait_calls } =
        create_tracking_debounce_manager();

    const document_store = new DocumentStore();

    const deps: HandlerDependencies = {
        debounce_manager: manager,
        document_store,
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () =>
            ({
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
            }) as any,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };

    return { deps, wait_calls };
}

/**
 * Create deps with call-order tracking on
 * wait_for_debounce, wait_for_update, and document_store.get.
 */
function create_order_tracking_deps(): {
    deps: HandlerDependencies;
    the_call_order: string[];
} {
    const the_call_order: string[] = [];

    const { manager } = create_tracking_debounce_manager();
    manager.wait_for_debounce = async () => {
        the_call_order.push('wait_for_debounce');
    };

    const document_store = new DocumentStore();
    const original_wait_for_update =
        document_store.wait_for_update.bind(document_store);
    document_store.wait_for_update = async (uri: string) => {
        the_call_order.push('wait_for_update');
        await original_wait_for_update(uri);
    };

    const original_get = document_store.get.bind(
        document_store
    );
    document_store.get = (uri: string) => {
        the_call_order.push('document_store.get');
        return original_get(uri);
    };

    const deps: HandlerDependencies = {
        debounce_manager: manager,
        document_store,
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => ({}) as any,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };

    return { deps, the_call_order };
}

/**
 * Assert that the full wait sequence is correct:
 * wait_for_debounce → wait_for_update → document_store.get
 */
function assert_debounce_before_get(
    the_call_order: string[]
): void {
    const debounce_idx = the_call_order.indexOf(
        'wait_for_debounce'
    );
    const update_idx = the_call_order.indexOf('wait_for_update');
    const get_idx = the_call_order.indexOf(
        'document_store.get'
    );

    // All three should be called
    expect(debounce_idx).toBeGreaterThanOrEqual(0);
    expect(update_idx).toBeGreaterThanOrEqual(0);
    expect(get_idx).toBeGreaterThanOrEqual(0);

    // Check correct ordering:
    // debounce < update < get
    expect(debounce_idx).toBeLessThan(update_idx);
    expect(update_idx).toBeLessThan(get_idx);
}

/**
 * Create minimal deps with null debounce_manager for
 * graceful degradation testing.
 */
function create_null_debounce_deps(): HandlerDependencies {
    const document_store = new DocumentStore();
    return {
        debounce_manager: null,
        document_store,
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => ({}) as any,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('Request Freshness', () => {
    /**
     * Req 10.2: Completion handler awaits wait_for_debounce
     * before reading document store state.
     */
    describe('Completion handler (Req 10.2)', () => {
        it('calls wait_for_debounce with the request URI', async () => {
            const { deps, wait_calls } =
                create_tracking_deps();

            const handler = create_completion_handler(deps);
            const my_uri = 'file:///completion_test.do';

            await handler(
                {
                    textDocument: { uri: my_uri },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(wait_calls).toContain(my_uri);
        });

        it('calls wait_for_debounce before accessing document state', async () => {
            const { deps, the_call_order } =
                create_order_tracking_deps();

            const handler = create_completion_handler(deps);
            await handler(
                {
                    textDocument: {
                        uri: 'file:///order_test.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            assert_debounce_before_get(the_call_order);
        });
    });

    /**
     * Req 10.2: Hover handler awaits wait_for_debounce
     * before reading document store state.
     */
    describe('Hover handler (Req 10.2)', () => {
        it('calls wait_for_debounce with the request URI', async () => {
            const { deps, wait_calls } =
                create_tracking_deps();

            const handler = create_hover_handler(deps);
            const my_uri = 'file:///hover_test.do';

            await handler(
                {
                    textDocument: { uri: my_uri },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(wait_calls).toContain(my_uri);
        });

        it('calls wait_for_debounce before accessing document state', async () => {
            const { deps, the_call_order } =
                create_order_tracking_deps();

            const handler = create_hover_handler(deps);
            await handler(
                {
                    textDocument: {
                        uri: 'file:///hover_order.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            assert_debounce_before_get(the_call_order);
        });
    });

    /**
     * Req 10.2: Definition handler awaits wait_for_debounce
     * before reading document store state.
     */
    describe('Definition handler (Req 10.2)', () => {
        it('calls wait_for_debounce with the request URI', async () => {
            const { deps, wait_calls } =
                create_tracking_deps();

            const handler = create_definition_handler(deps);
            const my_uri = 'file:///definition_test.do';

            await handler(
                {
                    textDocument: { uri: my_uri },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(wait_calls).toContain(my_uri);
        });

        it('calls wait_for_debounce before accessing document state', async () => {
            const { deps, the_call_order } =
                create_order_tracking_deps();

            const handler = create_definition_handler(deps);
            await handler(
                {
                    textDocument: {
                        uri: 'file:///def_order.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            assert_debounce_before_get(the_call_order);
        });
    });

    /**
     * Req 10.2: References handler awaits wait_for_debounce
     * before reading document store state.
     */
    describe('References handler (Req 10.2)', () => {
        it('calls wait_for_debounce with the request URI', async () => {
            const { deps, wait_calls } =
                create_tracking_deps();

            const handler = create_references_handler(deps);
            const my_uri = 'file:///references_test.do';

            await handler(
                {
                    textDocument: { uri: my_uri },
                    position: { line: 0, character: 0 },
                    context: {
                        includeDeclaration: true,
                    },
                },
                undefined
            );

            expect(wait_calls).toContain(my_uri);
        });

        it('calls wait_for_debounce before accessing document state', async () => {
            const { deps, the_call_order } =
                create_order_tracking_deps();

            const handler = create_references_handler(deps);
            await handler(
                {
                    textDocument: {
                        uri: 'file:///ref_order.do',
                    },
                    position: { line: 0, character: 0 },
                    context: {
                        includeDeclaration: true,
                    },
                },
                undefined
            );

            assert_debounce_before_get(the_call_order);
        });
    });

    /**
     * Req 10.3: wait_for_debounce resolves immediately when
     * no debounce is pending.
     */
    describe('Immediate resolution (Req 10.3)', () => {
        it('handler resolves when no debounce pending', async () => {
            const { deps } = create_tracking_deps();

            const handler = create_hover_handler(deps);

            // Should resolve without error when no
            // debounce is pending and no document state
            // exists
            const result = await handler(
                {
                    textDocument: {
                        uri: 'file:///no_pending.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(result).toBeNull();
        });
    });

    /**
     * Req 10.2: Handlers work correctly when
     * debounce_manager is null (graceful degradation).
     */
    describe('Null debounce_manager (graceful degradation)', () => {
        it('completion handler works without debounce_manager', async () => {
            const deps = create_null_debounce_deps();
            const handler = create_completion_handler(deps);

            // Should not throw when debounce_manager is null
            const result = await handler(
                {
                    textDocument: {
                        uri: 'file:///null_debounce.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(result).toBeDefined();
            expect(result.items).toBeDefined();
        });

        it('hover handler works without debounce_manager', async () => {
            const deps = create_null_debounce_deps();
            const handler = create_hover_handler(deps);

            // Should not throw when debounce_manager is null
            const result = await handler(
                {
                    textDocument: {
                        uri: 'file:///null_debounce.do',
                    },
                    position: { line: 0, character: 0 },
                },
                undefined
            );

            expect(result).toBeNull();
        });
    });
});
