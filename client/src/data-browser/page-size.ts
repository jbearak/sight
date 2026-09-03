/**
 * Row-page sizing shared by the extension host and the webview.
 *
 * A page is the unit the webview requests and the host caches. Wide
 * datasets would otherwise ship 200 rows x thousands of columns per
 * page, so the page shrinks to keep the cell count bounded, mirroring
 * the adaptive paging used by Table Viewer.
 */

/** Default and maximum rows per page. */
export const PAGE_SIZE = 200;

/** Upper bound on cells (rows x columns) shipped in one page. */
export const MAX_PAGE_CELLS = 64 * 1024;

/**
 * Rows per page for a dataset with `column_count` variables: the
 * default page size, reduced so a page never exceeds
 * {@link MAX_PAGE_CELLS} cells, and never below one row.
 */
export function page_size_for_column_count(column_count: number): number {
    const my_columns = Math.max(1, Math.floor(column_count));
    const my_bounded = Math.floor(MAX_PAGE_CELLS / my_columns);
    return Math.max(1, Math.min(PAGE_SIZE, my_bounded));
}
