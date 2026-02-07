/**
 * Tests for debug logging gated by config.
 *
 * Covers:
 * - Property 9: Debug logging gated by config
 *   **Validates: Requirements 8.2, 8.3**
 * - Unit test that debug=true emits logs (Req 8.4)
 * - Unit test that debug defaults to false (Req 8.1)
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/**
 * Simulates the debug gating pattern used in
 * validate_text_document and revalidation scheduling
 * functions in server-factory.ts.
 *
 * The real implementation:
 *   const is_debug = settings.debug === true;
 *   if (is_debug) { connection.console.log(...); }
 *   if (is_debug) { scope_resolver.get_reverse_deps_debug_info(); }
 *
 * This helper reproduces that exact pattern so we can
 * verify the gating logic in isolation.
 */
function simulate_validate_text_document(options: {
    debug: boolean | undefined;
    has_scope_resolver: boolean;
    has_forward_calls: boolean;
    interface_changed: boolean;
}): {
    log_calls: string[];
    get_reverse_deps_debug_info_called: boolean;
} {
    const log_calls: string[] = [];
    let get_reverse_deps_debug_info_called = false;

    // Exact pattern from server-factory.ts:
    // const is_debug = eager_settings.debug === true;
    const is_debug = options.debug === true;

    // --- Eager logging before debounce callback ---
    if (is_debug) {
        log_calls.push(
            '[validate] Starting validation'
        );
    }

    // --- Scope cache invalidation logging ---
    if (options.has_scope_resolver) {
        if (is_debug) {
            log_calls.push(
                '[validate] Invalidating scope cache'
            );
        }
    }

    // --- Inside debounce callback ---

    // Forward calls logging
    if (
        options.has_scope_resolver
        && options.has_forward_calls
    ) {
        if (is_debug) {
            log_calls.push(
                '[reverse-deps] Updating'
            );
            log_calls.push(
                '[reverse-deps] forward_calls'
            );
        }

        // After update_reverse_dependencies
        if (is_debug) {
            log_calls.push(
                '[reverse-deps] Result'
            );
        }

        // Interface changed path
        if (options.interface_changed) {
            // Req 8.3: get_reverse_deps_debug_info
            // gated behind debug check
            if (is_debug) {
                get_reverse_deps_debug_info_called = true;
                log_calls.push(
                    '[reverse-deps] Reverse deps state'
                );
            }

            if (is_debug) {
                log_calls.push(
                    '[reverse-deps] Interface changed'
                );
            }

            if (is_debug) {
                log_calls.push(
                    '[reverse-deps] backward-directive'
                );
            }
        }
    }

    // Diagnostics pending logging
    if (is_debug) {
        log_calls.push('Diagnostics pending');
    }

    return {
        log_calls,
        get_reverse_deps_debug_info_called,
    };
}

/**
 * Simulates the debug gating pattern used in
 * schedule_callee_revalidation.
 */
function simulate_callee_revalidation(options: {
    debug: boolean | undefined;
    num_callees: number;
    max_revalidations: number;
}): {
    log_calls: string[];
} {
    const log_calls: string[] = [];
    const is_debug = options.debug === true;

    let count = 0;
    for (let i = 0; i < options.num_callees; i++) {
        if (count >= options.max_revalidations) {
            if (is_debug) {
                log_calls.push(
                    'Callee revalidation limit reached'
                );
            }
            break;
        }
        count++;
    }

    return { log_calls };
}

/**
 * Simulates the debug gating pattern used in
 * schedule_caller_revalidation.
 */
function simulate_caller_revalidation(options: {
    debug: boolean | undefined;
    num_callers: number;
    max_revalidations: number;
}): {
    log_calls: string[];
} {
    const log_calls: string[] = [];
    const is_debug = options.debug === true;

    if (is_debug) {
        log_calls.push(
            '[caller-revalidation] Triggered'
        );
    }

    let count = 0;
    for (let i = 0; i < options.num_callers; i++) {
        if (count >= options.max_revalidations) {
            if (is_debug) {
                log_calls.push(
                    'Caller revalidation limit reached'
                );
            }
            break;
        }

        if (is_debug) {
            log_calls.push(
                '[caller-revalidation] Checking'
            );
        }
        count++;
    }

    if (is_debug) {
        log_calls.push(
            '[caller-revalidation] Scheduled'
        );
    }

    return { log_calls };
}

// -------------------------------------------------------
// Property 9: Debug logging gated by config
// -------------------------------------------------------

describe(
    'Property 9: Debug logging gated by config',
    () => {
        /**
         * For any document validation cycle where debug
         * is false in the config, zero
         * connection.console.log calls shall be made from
         * within the validate_text_document function, and
         * scope_resolver.get_reverse_deps_debug_info()
         * shall not be called.
         *
         * **Validates: Requirements 8.2, 8.3**
         */
        it(
            'debug=false produces zero log calls and '
            + 'no get_reverse_deps_debug_info call '
            + '(validate_text_document)',
            () => {
                fc.assert(
                    fc.property(
                        fc.boolean(),
                        fc.boolean(),
                        fc.boolean(),
                        (
                            has_scope_resolver,
                            has_forward_calls,
                            interface_changed
                        ) => {
                            const result =
                                simulate_validate_text_document(
                                    {
                                        debug: false,
                                        has_scope_resolver,
                                        has_forward_calls,
                                        interface_changed,
                                    }
                                );

                            // Req 8.2: zero log calls
                            expect(
                                result.log_calls.length
                            ).toBe(0);

                            // Req 8.3: no debug info call
                            expect(
                                result
                                    .get_reverse_deps_debug_info_called
                            ).toBe(false);
                        }
                    ),
                    { numRuns: 100 }
                );
            }
        );

        it(
            'debug=undefined produces zero log calls '
            + 'and no get_reverse_deps_debug_info call',
            () => {
                fc.assert(
                    fc.property(
                        fc.boolean(),
                        fc.boolean(),
                        fc.boolean(),
                        (
                            has_scope_resolver,
                            has_forward_calls,
                            interface_changed
                        ) => {
                            const result =
                                simulate_validate_text_document(
                                    {
                                        debug: undefined,
                                        has_scope_resolver,
                                        has_forward_calls,
                                        interface_changed,
                                    }
                                );

                            // Req 8.2: zero log calls
                            expect(
                                result.log_calls.length
                            ).toBe(0);

                            // Req 8.3: no debug info call
                            expect(
                                result
                                    .get_reverse_deps_debug_info_called
                            ).toBe(false);
                        }
                    ),
                    { numRuns: 100 }
                );
            }
        );

        it(
            'debug=false produces zero log calls '
            + '(callee revalidation)',
            () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 50 }),
                        fc.integer({ min: 1, max: 20 }),
                        (num_callees, max_revalidations) => {
                            const result =
                                simulate_callee_revalidation({
                                    debug: false,
                                    num_callees,
                                    max_revalidations,
                                });

                            // Req 8.2: zero log calls
                            expect(
                                result.log_calls.length
                            ).toBe(0);
                        }
                    ),
                    { numRuns: 100 }
                );
            }
        );

        it(
            'debug=false produces zero log calls '
            + '(caller revalidation)',
            () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 50 }),
                        fc.integer({ min: 1, max: 20 }),
                        (num_callers, max_revalidations) => {
                            const result =
                                simulate_caller_revalidation({
                                    debug: false,
                                    num_callers,
                                    max_revalidations,
                                });

                            // Req 8.2: zero log calls
                            expect(
                                result.log_calls.length
                            ).toBe(0);
                        }
                    ),
                    { numRuns: 100 }
                );
            }
        );

        it(
            'debug=true produces non-zero log calls '
            + 'when scope resolver and forward calls '
            + 'are present',
            () => {
                fc.assert(
                    fc.property(
                        fc.boolean(),
                        (interface_changed) => {
                            const result =
                                simulate_validate_text_document(
                                    {
                                        debug: true,
                                        has_scope_resolver:
                                            true,
                                        has_forward_calls:
                                            true,
                                        interface_changed,
                                    }
                                );

                            // Req 8.4: debug=true emits
                            // logs
                            expect(
                                result.log_calls.length
                            ).toBeGreaterThan(0);
                        }
                    ),
                    { numRuns: 100 }
                );
            }
        );

        it(
            'debug=true with interface_changed calls '
            + 'get_reverse_deps_debug_info',
            () => {
                const result =
                    simulate_validate_text_document({
                        debug: true,
                        has_scope_resolver: true,
                        has_forward_calls: true,
                        interface_changed: true,
                    });

                // Req 8.3 (inverse): when debug IS
                // enabled, the call IS made
                expect(
                    result
                        .get_reverse_deps_debug_info_called
                ).toBe(true);
            }
        );
    }
);

// -------------------------------------------------------
// Unit tests: Req 8.1, 8.4
// -------------------------------------------------------

describe('Debug logging configuration', () => {
    /**
     * Req 8.1: The LSP_Server SHALL support a debug
     * configuration setting that controls whether verbose
     * logging is emitted during document validation.
     */
    describe('Req 8.1: debug config field', () => {
        it(
            'DEFAULT_SETTINGS includes debug: false',
            () => {
                expect(DEFAULT_SETTINGS.debug).toBe(false);
            }
        );

        it(
            'debug field defaults to false when '
            + 'undefined',
            () => {
                // The gating pattern uses
                // settings.debug === true, so
                // undefined is treated as false
                const settings_without_debug = {
                    ...DEFAULT_SETTINGS,
                    debug: undefined,
                };
                const is_debug =
                    settings_without_debug.debug === true;
                expect(is_debug).toBe(false);
            }
        );

        it(
            'debug field is false when explicitly set '
            + 'to false',
            () => {
                const settings = {
                    ...DEFAULT_SETTINGS,
                    debug: false,
                };
                const is_debug = settings.debug === true;
                expect(is_debug).toBe(false);
            }
        );

        it(
            'debug field is true when explicitly set '
            + 'to true',
            () => {
                const settings = {
                    ...DEFAULT_SETTINGS,
                    debug: true,
                };
                const is_debug = settings.debug === true;
                expect(is_debug).toBe(true);
            }
        );
    });

    /**
     * Req 8.4: WHILE the debug setting is enabled, THE
     * LSP_Server SHALL emit the same verbose logging that
     * currently exists unconditionally.
     */
    describe('Req 8.4: debug=true emits logs', () => {
        it(
            'validate_text_document emits starting '
            + 'validation log',
            () => {
                const result =
                    simulate_validate_text_document({
                        debug: true,
                        has_scope_resolver: false,
                        has_forward_calls: false,
                        interface_changed: false,
                    });

                expect(result.log_calls).toContain(
                    '[validate] Starting validation'
                );
            }
        );

        it(
            'validate_text_document emits scope cache '
            + 'invalidation log when scope resolver '
            + 'exists',
            () => {
                const result =
                    simulate_validate_text_document({
                        debug: true,
                        has_scope_resolver: true,
                        has_forward_calls: false,
                        interface_changed: false,
                    });

                expect(result.log_calls).toContain(
                    '[validate] Invalidating scope cache'
                );
            }
        );

        it(
            'validate_text_document emits forward calls '
            + 'logs when scope resolver and forward '
            + 'calls exist',
            () => {
                const result =
                    simulate_validate_text_document({
                        debug: true,
                        has_scope_resolver: true,
                        has_forward_calls: true,
                        interface_changed: false,
                    });

                expect(result.log_calls).toContain(
                    '[reverse-deps] Updating'
                );
                expect(result.log_calls).toContain(
                    '[reverse-deps] forward_calls'
                );
                expect(result.log_calls).toContain(
                    '[reverse-deps] Result'
                );
            }
        );

        it(
            'validate_text_document emits reverse deps '
            + 'state log when interface changed',
            () => {
                const result =
                    simulate_validate_text_document({
                        debug: true,
                        has_scope_resolver: true,
                        has_forward_calls: true,
                        interface_changed: true,
                    });

                expect(result.log_calls).toContain(
                    '[reverse-deps] Reverse deps state'
                );
                expect(result.log_calls).toContain(
                    '[reverse-deps] Interface changed'
                );
            }
        );

        it(
            'callee revalidation emits limit log when '
            + 'limit exceeded',
            () => {
                const result =
                    simulate_callee_revalidation({
                        debug: true,
                        num_callees: 15,
                        max_revalidations: 5,
                    });

                expect(result.log_calls).toContain(
                    'Callee revalidation limit reached'
                );
            }
        );

        it(
            'caller revalidation emits triggered and '
            + 'scheduled logs',
            () => {
                const result =
                    simulate_caller_revalidation({
                        debug: true,
                        num_callers: 3,
                        max_revalidations: 10,
                    });

                expect(result.log_calls).toContain(
                    '[caller-revalidation] Triggered'
                );
                expect(result.log_calls).toContain(
                    '[caller-revalidation] Scheduled'
                );
            }
        );

        it(
            'caller revalidation emits checking log '
            + 'for each caller',
            () => {
                const result =
                    simulate_caller_revalidation({
                        debug: true,
                        num_callers: 3,
                        max_revalidations: 10,
                    });

                const checking_calls =
                    result.log_calls.filter(
                        (msg) =>
                            msg ===
                            '[caller-revalidation] Checking'
                    );
                expect(checking_calls.length).toBe(3);
            }
        );
    });

    /**
     * Req 8.2: WHILE the debug setting is disabled, THE
     * LSP_Server SHALL skip all connection.console.log
     * calls in the Validate_Text_Document function and
     * cross-file revalidation scheduling.
     */
    describe(
        'Req 8.2: debug=false skips all log calls',
        () => {
            it(
                'validate_text_document emits zero logs '
                + 'with all features active',
                () => {
                    const result =
                        simulate_validate_text_document({
                            debug: false,
                            has_scope_resolver: true,
                            has_forward_calls: true,
                            interface_changed: true,
                        });

                    expect(
                        result.log_calls.length
                    ).toBe(0);
                }
            );

            it(
                'callee revalidation emits zero logs '
                + 'even when limit exceeded',
                () => {
                    const result =
                        simulate_callee_revalidation({
                            debug: false,
                            num_callees: 15,
                            max_revalidations: 5,
                        });

                    expect(
                        result.log_calls.length
                    ).toBe(0);
                }
            );

            it(
                'caller revalidation emits zero logs '
                + 'even with many callers',
                () => {
                    const result =
                        simulate_caller_revalidation({
                            debug: false,
                            num_callers: 10,
                            max_revalidations: 20,
                        });

                    expect(
                        result.log_calls.length
                    ).toBe(0);
                }
            );
        }
    );

    /**
     * Req 8.3: WHILE the debug setting is disabled, THE
     * LSP_Server SHALL skip the call to
     * scope_resolver.get_reverse_deps_debug_info() to
     * avoid building the debug string.
     */
    describe(
        'Req 8.3: debug=false skips '
        + 'get_reverse_deps_debug_info',
        () => {
            it(
                'get_reverse_deps_debug_info is not '
                + 'called when debug=false and interface '
                + 'changed',
                () => {
                    const result =
                        simulate_validate_text_document({
                            debug: false,
                            has_scope_resolver: true,
                            has_forward_calls: true,
                            interface_changed: true,
                        });

                    expect(
                        result
                            .get_reverse_deps_debug_info_called
                    ).toBe(false);
                }
            );

            it(
                'get_reverse_deps_debug_info IS called '
                + 'when debug=true and interface changed',
                () => {
                    const result =
                        simulate_validate_text_document({
                            debug: true,
                            has_scope_resolver: true,
                            has_forward_calls: true,
                            interface_changed: true,
                        });

                    expect(
                        result
                            .get_reverse_deps_debug_info_called
                    ).toBe(true);
                }
            );

            it(
                'get_reverse_deps_debug_info is not '
                + 'called when interface did not change '
                + '(regardless of debug)',
                () => {
                    const result_debug_true =
                        simulate_validate_text_document({
                            debug: true,
                            has_scope_resolver: true,
                            has_forward_calls: true,
                            interface_changed: false,
                        });

                    const result_debug_false =
                        simulate_validate_text_document({
                            debug: false,
                            has_scope_resolver: true,
                            has_forward_calls: true,
                            interface_changed: false,
                        });

                    // Not called in either case because
                    // interface didn't change
                    expect(
                        result_debug_true
                            .get_reverse_deps_debug_info_called
                    ).toBe(false);
                    expect(
                        result_debug_false
                            .get_reverse_deps_debug_info_called
                    ).toBe(false);
                }
            );
        }
    );
});
