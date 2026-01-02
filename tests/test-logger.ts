import type { ScopeResolverLogger } from '../src/types';

/**
 * Test logger for ScopeResolver.
 *
 * Default: silent (suppresses expected warnings in property/integration tests).
 * Opt-in: set STATA_LSP_TEST_LOG=1 to forward logs to console.
 */
export function create_test_scope_resolver_logger(): ScopeResolverLogger {
    const is_noisy = process.env.STATA_LSP_TEST_LOG === '1';

    if (is_noisy) {
        return {
            log: (message: string) => {
                console.log(message);
            },
            warn: (message: string) => {
                console.warn(message);
            },
        };
    }

    return {
        log: () => {},
        warn: () => {},
    };
}
