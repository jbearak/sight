import type { MissingName } from './dta-source.js';

/** A Stata numeric missing value: `.` or `.a`–`.z`. */
export type MissingType = MissingName;

// -----------------------------------------------------------
// Data browser postMessage protocol types
//
// Shared between the extension host and the webview.
// -----------------------------------------------------------

// Webview → Extension messages

export interface RowRequest {
    type: 'requestRows';
    start: number;
    count: number;
    col_start?: number;
    col_end?: number;
    request_id: string;
}

export interface ReadyMessage {
    type: 'ready';
}

export interface ColumnWidthsChangedMessage {
    type: 'columnWidthsChanged';
    dataset_key: string;
    widths: Record<string, number>;
}

export interface ColumnVisibilityChangedMessage {
    type: 'columnVisibilityChanged';
    dataset_key: string;
    hidden_columns: string[];
}

export interface CopyColumnRequest {
    type: 'copyColumn';
    col_index: number;
    show_labels: boolean;
    show_formats: boolean;
}

export interface SetSortMessage {
    type: 'setSort';
    keys: SortKey[];
    labels_on: boolean;
}

export interface SetFiltersMessage {
    type: 'setFilters';
    entries: FilterEntry[];
    labels_on: boolean;
}

export interface RequestHistogramMessage {
    type: 'requestHistogram';
    col_index: number;
}

/**
 * Asks the host to abandon the in-progress restore of saved sort/filter
 * and show the data unsorted/unfiltered, forgetting the saved
 * preferences. `restore_id` echoes the value from the `restorePending`
 * the webview is cancelling, so a stale cancel from a prior lifecycle is
 * ignored by the host.
 */
export interface CancelRestoreMessage {
    type: 'cancelRestore';
    restore_id: number;
}

/**
 * Stop the running sort/filter and any queued one; the applied order
 * stays. The host answers with `computeCancelled`.
 */
export interface CancelComputeMessage {
    type: 'cancelCompute';
}

/**
 * Whole values of strLs the grid shows as previews (`truncated` cells),
 * for copying them. Cells are given by file row (`CellValue.file_row`)
 * and column index. Answered with `fullText`.
 */
export interface RequestFullTextMessage {
    type: 'requestFullText';
    request_id: string;
    cells: { row: number; col: number }[];
}

/** Webview timing marks, sent only when `debug_timing` is on. */
export type TimingMark =
    | 'metadata_received'
    | 'first_rows_received'
    | 'first_rows_painted';

export interface TimingMessage {
    type: 'timing';
    mark: TimingMark;
    /** Wall-clock milliseconds (Date.now) when the mark was taken. */
    epoch_ms: number;
}

export type WebviewMessage =
    | RowRequest
    | ReadyMessage
    | ColumnWidthsChangedMessage
    | ColumnVisibilityChangedMessage
    | CopyColumnRequest
    | SetSortMessage
    | SetFiltersMessage
    | RequestHistogramMessage
    | CancelRestoreMessage
    | CancelComputeMessage
    | RequestFullTextMessage
    | TimingMessage;

// Extension → Webview messages

export interface RowResponse {
    type: 'rowData';
    start: number;
    col_start?: number;
    rows: CellValue[][];
    request_id: string;
}

export type MissingValueStyle =
    | 'foreground'
    | 'background'
    | 'none';

export interface MetadataMessage {
    type: 'metadata';
    nobs: number;
    variables: VariableDescription[];
    /**
     * Rows per page the webview should request; shrinks for wide
     * datasets. Absent from older hosts, in which case the webview
     * falls back to the default page size.
     */
    page_size?: number;
    name: string;
    dataset_key: string;
    schema_hash: string;
    stored_column_widths?: Record<string, number>;
    stored_hidden_columns?: string[];
    stored_sort?: SortState;
    stored_filter?: FilterState;
    subsetted?: boolean;
    varlist?: string[];
    if_condition?: string;
    in_condition?: string;
    missing_value_style?: MissingValueStyle;
    // Report timing marks back to the host (sight.dataBrowser.debugTiming).
    debug_timing?: boolean;
}

export interface SortAppliedMessage {
    type: 'sortApplied';
    sort: SortState;
    nobs_effective: number;
}

export interface SortStatusMessage {
    type: 'sortStatus';
    state: 'pending' | 'idle';
}

export interface FilterAppliedMessage {
    type: 'filterApplied';
    filter: FilterState;
    nobs_filtered: number;
}

export interface FilterStatusMessage {
    type: 'filterStatus';
    state: 'pending' | 'idle';
}

export interface HistogramDataMessage {
    type: 'histogramData';
    col_index: number;
    bins: HistogramBin[];
}

/**
 * Sent before the host reads columns to reapply a saved sort/filter on
 * open, so the webview can explain the wait (instead of a bare
 * "Loading…") and offer a Cancel control. `restore_id` identifies this
 * restore so a `cancelRestore` can be matched to it. `sort` / `filter`
 * say which preferences are being applied (for the message wording).
 */
export interface RestorePendingMessage {
    type: 'restorePending';
    restore_id: number;
    sort: boolean;
    filter: boolean;
}

/**
 * Terminal signal for a paint-first restore: the host has finished
 * reapplying (or cancelling) the saved sort/filter that a matching
 * `restorePending` announced. Posted *after* the grid was already painted
 * in natural order, so this carries the final order to switch to. `sort`
 * / `filter` are EMPTY when the restore was cancelled, failed, or yielded
 * nothing. `restore_id` matches the `restorePending` so the webview
 * ignores a settle from a superseded lifecycle (reload/refresh).
 */
export interface RestoreSettledMessage {
    type: 'restoreSettled';
    restore_id: number;
    sort: SortState;
    filter: FilterState;
    nobs_effective: number;
}

/**
 * A requested sort/filter was cancelled, stopped at its deadline, or
 * could not run (the file changed): the webview drops its pending
 * chips and shows the applied state, which the order still matches.
 */
export interface ComputeCancelledMessage {
    type: 'computeCancelled';
    sort: SortState;
    filter: FilterState;
    nobs_effective: number;
}

/**
 * Cells that complete the page `rowData` sent for `request_id` with some
 * cells `pending` (the strLs of the first page that shows any, while the
 * file's strL index is built). `rows[i][j]` is variable `columns[j]` of
 * the page's row `i`. Ignored unless the page still holds that reply.
 */
export interface RowCellsMessage {
    type: 'rowCells';
    start: number;
    request_id: string;
    columns: number[];
    rows: CellValue[][];
}

/**
 * The page read for `request_id` was discarded because the order or
 * dataset changed while it ran; the webview may ask for the page again.
 */
export interface RowsStaleMessage {
    type: 'rowsStale';
    start: number;
    request_id: string;
}

/** The answer to `requestFullText`: null when the values could not be
 *  read. */
export interface FullTextMessage {
    type: 'fullText';
    request_id: string;
    texts: string[] | null;
}

/**
 * The open file was rewritten in place; the host serves nothing more
 * from it, and the dataset must be reopened.
 */
export interface FileChangedMessage {
    type: 'fileChanged';
}

export type ExtensionMessage =
    | RowResponse
    | MetadataMessage
    | SortAppliedMessage
    | SortStatusMessage
    | FilterAppliedMessage
    | FilterStatusMessage
    | HistogramDataMessage
    | RestorePendingMessage
    | RestoreSettledMessage
    | ComputeCancelledMessage
    | RowsStaleMessage
    | RowCellsMessage
    | FullTextMessage
    | FileChangedMessage;

export interface VariableDescription {
    name: string;
    type: string;
    format: string;
    label: string;
    has_value_labels: boolean;
    // Value-label table (code -> label), string-keyed for JSON. Present
    // only for value-labelled numeric columns; used by the filter UI to
    // show label checklists and by chip summaries.
    value_labels?: Record<string, string>;
}

export interface CellValue {
    raw: number | string | null;
    /**
     * How the value shows without and with its display format. Absent
     * where it would repeat `raw` (strings, a number shown as itself) or
     * `missing_type`, so a page carries each value once; see
     * `get_cell_display_value`.
     */
    raw_display?: string;
    formatted_display?: string;
    /**
     * The value's label. Absent when the value has none, and when the
     * column's label set is in the metadata (`value_labels`), where the
     * grid looks it up.
     */
    label_display?: string;
    missing_type?: MissingType;
    /**
     * A long strL sent as a preview: `raw` holds its first bytes, and it
     * shows with an ellipsis. Copying the cell asks the host for the
     * whole value (`requestFullText`).
     */
    truncated?: boolean;
    /** File row (0-based) of a truncated cell, for `requestFullText`. */
    file_row?: number;
    /** A binary strL: the displays say so, and `raw` is null. */
    binary?: boolean;
    /** A strL not read yet; a `rowCells` message fills it in. */
    pending?: boolean;
    /** Full stored length in bytes, for truncated and binary strLs. */
    stored_bytes?: number;
}

// Sidecar JSON written by vview.ado

export interface VviewSidecar {
    version: number;
    uuid: string;
    name: string;
    dtapath: string;
    N: number;
    k: number;
    replace: boolean;
    subsetted: boolean;
    timestamp?: string;
    source?: string;
    cwd?: string;
    varlist?: string[];
    if?: string;
    in?: string;
}

// -----------------------------------------------------------
// Sort
// -----------------------------------------------------------

export interface SortKey {
    col_index: number; // 0-based index into variables[]
    direction: 'asc' | 'desc';
}

export interface SortState {
    keys: SortKey[];
    labels_on_when_sorted: boolean;
}

export const EMPTY_SORT: SortState = {
    keys: [],
    labels_on_when_sorted: true,
};

// -----------------------------------------------------------
// Filter
// -----------------------------------------------------------

export type FilterPredicate =
    | { kind: 'isEmpty' }
    | { kind: 'isNotEmpty' }
    | { kind: 'numCompare';
        op: '=' | '!=' | '<' | '<=' | '>' | '>='; value: number }
    | { kind: 'numBetween'; lo: number; hi: number; inclusive: boolean }
    | { kind: 'numNotBetween';
        lo: number; hi: number; inclusive: boolean }
    | { kind: 'setIn'; values: number[] }
    | { kind: 'setNotIn'; values: number[] }
    | { kind: 'strCompare';
        op: '=' | '!='; value: string; case_sensitive: boolean }
    | { kind: 'strContains';
        value: string; case_sensitive: boolean; negate: boolean }
    | { kind: 'strStartsWith'; value: string; case_sensitive: boolean }
    | { kind: 'strEndsWith'; value: string; case_sensitive: boolean }
    | { kind: 'strRegex'; pattern: string; case_sensitive: boolean }
    | { kind: 'dateCompare';
        op: '=' | '!=' | '<' | '<=' | '>' | '>='; value: string }
    | { kind: 'dateBetween'; lo: string; hi: string; inclusive: boolean }
    | { kind: 'dateNotBetween';
        lo: string; hi: string; inclusive: boolean };

export interface FilterEntry {
    id: string;
    col_index: number;
    predicate: FilterPredicate;
    enabled: boolean;
    include_missing: boolean;
}

export interface FilterState {
    entries: FilterEntry[];
    labels_on_when_filtered: boolean;
}

export const EMPTY_FILTER: FilterState = {
    entries: [],
    labels_on_when_filtered: true,
};

export interface HistogramBin {
    lo: number;
    hi: number;
    count: number;
}
