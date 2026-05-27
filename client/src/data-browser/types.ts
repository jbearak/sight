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

export type WebviewMessage =
    | RowRequest
    | ReadyMessage
    | ColumnWidthsChangedMessage
    | ColumnVisibilityChangedMessage
    | CopyColumnRequest
    | SetSortMessage
    | SetFiltersMessage
    | RequestHistogramMessage;

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
    dataset_label: string;
    name: string;
    dataset_key: string;
    schema_hash: string;
    stored_column_widths?: Record<string, number>;
    stored_hidden_columns?: string[];
    stored_sort?: SortState;
    stored_filter?: FilterState;
    source?: string;
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

export type ExtensionMessage =
    | RowResponse
    | MetadataMessage
    | SortAppliedMessage
    | SortStatusMessage
    | FilterAppliedMessage
    | FilterStatusMessage
    | HistogramDataMessage;

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
