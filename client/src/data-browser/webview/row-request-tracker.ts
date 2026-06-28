/**
 * Tracks outstanding row-page requests by both page start and request id.
 *
 * A page can be cleared and re-requested after sort/filter changes. If the
 * older response arrives late, the page start alone is ambiguous; the request
 * id lets the webview ignore stale rows instead of repainting an old order.
 */
export class RowRequestTracker {
    private readonly pending_by_page = new Map<number, string>();
    private request_counter = 0;

    track(page_start: number): string {
        this.request_counter += 1;
        const request_id = 'req_' + String(this.request_counter);
        this.pending_by_page.set(page_start, request_id);
        return request_id;
    }

    has_pending(page_start: number): boolean {
        return this.pending_by_page.has(page_start);
    }

    accepts(page_start: number, request_id: string): boolean {
        if (this.pending_by_page.get(page_start) !== request_id) {
            return false;
        }
        this.pending_by_page.delete(page_start);
        return true;
    }

    clear(): void {
        this.pending_by_page.clear();
    }
}
