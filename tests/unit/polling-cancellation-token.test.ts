import { describe, expect, it } from 'bun:test';
import type { CancellationToken } from 'vscode-languageserver';
import { polling_cancellation_token } from
    '../../src/utils/polling-cancellation-token';

describe('polling_cancellation_token', () => {
    it('does not read an event from a polling-only parent token', () => {
        let parent_is_cancelled = false;
        const polling_only_parent = {
            get isCancellationRequested(): boolean {
                return parent_is_cancelled;
            },
            get onCancellationRequested(): never {
                throw new Error('Polling-only token has no event');
            },
        } as CancellationToken;

        const token = polling_cancellation_token(
            () => true,
            polling_only_parent
        );
        expect(token.isCancellationRequested).toBe(false);

        parent_is_cancelled = true;
        expect(token.isCancellationRequested).toBe(true);
        expect(() => token.onCancellationRequested(() => undefined))
            .not.toThrow();
    });
});
