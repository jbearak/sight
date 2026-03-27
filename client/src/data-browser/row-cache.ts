/**
 * LRU cache for decoded row pages, keyed by start_row.
 *
 * Used by DataBrowserPanel to avoid re-reading rows from the
 * .dta file during rapid scrolling.
 */
export class RowCache {
    private readonly max_pages: number;
    private readonly cache: Map<number, (number | string | null)[][]>;

    constructor(max_pages: number = 10, _page_size: number = 200) {
        this.max_pages = max_pages;
        // Map insertion order tracks recency: oldest first.
        this.cache = new Map();
    }

    /**
     * Retrieve a cached page by its start_row.
     * Returns undefined on a miss. On a hit the page is
     * promoted to most-recently-used.
     */
    get_page(
        start_row: number
    ): (number | string | null)[][] | undefined {
        const my_rows = this.cache.get(start_row);
        if (my_rows === undefined) {
            return undefined;
        }
        // Re-insert to move to the end (most recent).
        this.cache.delete(start_row);
        this.cache.set(start_row, my_rows);
        return my_rows;
    }

    /**
     * Store a page of rows keyed by start_row.
     * If the cache is full the least-recently-used page is
     * evicted first.
     */
    set_page(
        start_row: number,
        rows: (number | string | null)[][]
    ): void {
        // If key already present, delete so re-insert lands
        // at the end.
        if (this.cache.has(start_row)) {
            this.cache.delete(start_row);
        } else if (this.cache.size >= this.max_pages) {
            // Evict LRU: the first key in iteration order.
            const my_lru_key = this.cache.keys().next().value;
            if (my_lru_key !== undefined) {
                this.cache.delete(my_lru_key);
            }
        }
        this.cache.set(start_row, rows);
    }

    /** Remove all cached pages. */
    clear(): void {
        this.cache.clear();
    }

    /** Number of pages currently cached. */
    get size(): number {
        return this.cache.size;
    }
}
