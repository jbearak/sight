/**
 * Parse timeout wrapper for preventing pathological files from blocking
 * the parse queue.
 *
 * Wraps synchronous parse operations with a timeout to report completion
 * time and identify files that need special handling.
 *
 * NOTE: This assumes the operation is synchronous. If parse stages become
 * async in the future, wrap operation() in Promise.resolve() to handle both.
 */

const PARSE_TIMEOUT_MS = 5000; // 5 second timeout

/**
 * Result of a parse operation with timeout.
 *
 * Fields:
 * - success: true if operation completed without error
 * - result: the operation result (only present if success=true)
 * - error: error message (only present if success=false)
 * - timed_out: true if operation exceeded timeout
 */
export interface ParseResult<T> {
    success: boolean;
    result?: T;
    error?: string;
    timed_out: boolean;
}

/**
 * Execute a parse operation with timeout.
 * Returns early if operation exceeds timeout.
 *
 * @param operation - Synchronous function to execute
 * @param timeout_ms - Timeout in milliseconds (default: 5000ms)
 * @returns ParseResult with success, result, error, and timed_out fields
 *
 * Example:
 * ```typescript
 * const result = await with_parse_timeout(
 *     () => lexer.tokenize(source),
 *     5000
 * );
 * if (result.timed_out) {
 *     console.warn('Tokenization timed out');
 * } else if (result.success) {
 *     const tokens = result.result;
 * }
 * ```
 */
export async function with_parse_timeout<T>(
    operation: () => T,
    timeout_ms: number = PARSE_TIMEOUT_MS
): Promise<ParseResult<T>> {
    return new Promise((resolve) => {
        let completed = false;

        const timer = setTimeout(() => {
            if (!completed) {
                completed = true;
                resolve({
                    success: false,
                    timed_out: true,
                    error: `Parse operation timed out after ${timeout_ms}ms`,
                });
            }
        }, timeout_ms);

        // Run operation in next tick to allow timeout to be set up
        setImmediate(() => {
            if (completed) return;

            try {
                const result = operation();
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    resolve({ success: true, result, timed_out: false });
                }
            } catch (error) {
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    resolve({
                        success: false,
                        error: String(error),
                        timed_out: false,
                    });
                }
            }
        });
    });
}
