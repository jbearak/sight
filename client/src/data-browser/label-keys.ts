/**
 * Value-label keys and limits shared by the host, the threads and the
 * webview. No dependencies, so the webview bundle can import it.
 */

/**
 * Value-label sets keep the numeric keys dta-parser 0.6 used, so stored
 * filters and the webview's label tables are unchanged: a number is its
 * own key, and missing value `.` is 2147483621, `.a` 2147483622, …, `.z`
 * 2147483647 (Stata's long missing codes).
 */
export const MISSING_LABEL_KEY_BASE = 2147483621;

/** The label-table key of a missing value (`.` or `.a`–`.z`). */
export function missing_label_key(name: string): number {
    return name === '.'
        ? MISSING_LABEL_KEY_BASE
        : MISSING_LABEL_KEY_BASE + name.charCodeAt(1) - 96;
}

/**
 * A value-label set with at most this many entries is sent to the
 * webview once, in the metadata, and the grid looks labels up there;
 * cells of a column with a larger set carry their own label.
 */
export const MAX_SHIPPED_VALUE_LABELS = 10_000;

/** Whether the webview gets `table` in the metadata. */
export function labels_shipped(table: Map<number, string>): boolean {
    return table.size <= MAX_SHIPPED_VALUE_LABELS;
}
