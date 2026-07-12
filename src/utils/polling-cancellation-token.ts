import type { CancellationToken } from 'vscode-languageserver';

const no_op_cancellation_event: CancellationToken['onCancellationRequested'] =
    () => ({ dispose: () => undefined });

/**
 * Adapt a current-work predicate to APIs that poll a CancellationToken.
 * Both sources are exposed only through the polling getter. The event is a
 * no-op because some valid polling-only parent tokens throw when their event
 * property is read (for example shared-array cancellation tokens).
 */
export function polling_cancellation_token(
    should_continue: () => boolean,
    parent?: CancellationToken
): CancellationToken {
    return {
        get isCancellationRequested(): boolean {
            return parent?.isCancellationRequested === true
                || !should_continue();
        },
        onCancellationRequested: no_op_cancellation_event,
    };
}
