import { describe, expect, it } from 'bun:test';
import { RowRequestTracker } from '../../../client/src/data-browser/webview/row-request-tracker';

describe('data-browser RowRequestTracker', () => {
    it('rejects stale row responses after a page is cleared and re-requested', () => {
        const tracker = new RowRequestTracker();

        const first_request = tracker.track(0);
        tracker.clear();
        const second_request = tracker.track(0);

        expect(tracker.accepts(0, first_request)).toBe(false);
        expect(tracker.has_pending(0)).toBe(true);
        expect(tracker.accepts(0, second_request)).toBe(true);
        expect(tracker.has_pending(0)).toBe(false);
    });
});
