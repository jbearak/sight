/**
 * Shared predicate-polling helper for tests that must wait on
 * asynchronous state (debounced validation, watcher events, terminal
 * side effects) without racing it.
 *
 * Extracted so test files stop growing bespoke copies with drifting
 * defaults (issue #287 review). Keep per-call timeouts BELOW the
 * enclosing test's timeout (bun's default is 5000ms unless the test
 * passes an explicit timeout to it()) so this helper's descriptive
 * error surfaces instead of bun's generic "test timed out".
 */
export async function wait_until(
    predicate: () => boolean,
    description: string,
    timeout_ms = 4000,
    interval_ms = 20
): Promise<void> {
    const deadline_ms = Date.now() + timeout_ms;
    while (!predicate()) {
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for: ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval_ms));
    }
}
