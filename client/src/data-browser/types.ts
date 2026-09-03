import type { MissingType } from '@jbearak/dta-parser';

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

export type WebviewMessage =
    | RowRequest
    | ReadyMessage
    | ColumnWidthsChangedMessage
    | ColumnVisibilityChangedMessage
    | CopyColumnRequest
    | SetSortMessage
    | SetFiltersMessage
    | RequestHistogramMessage
    | CancelRestoreMessage;

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

export type ExtensionMessage =
    | RowResponse
    | MetadataMessage
    | SortAppliedMessage
    | SortStatusMessage
    | FilterAppliedMessage
    | FilterStatusMessage
    | HistogramDataMessage
    | RestorePendingMessage
    | RestoreSettledMessage;

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
    raw_display: string;
    formatted_display: string;
    label_display?: string;
    missing_type?: MissingType;
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
