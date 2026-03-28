import type { MissingType } from '../../../src/dta-parser';

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

export type WebviewMessage =
    | RowRequest
    | ReadyMessage
    | ColumnWidthsChangedMessage
    | ColumnVisibilityChangedMessage
    | CopyColumnRequest;

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
    stored_column_widths?: Record<string, number>;
    stored_hidden_columns?: string[];
    source?: string;
    subsetted?: boolean;
    varlist?: string[];
    if_condition?: string;
    in_condition?: string;
    missing_value_style?: MissingValueStyle;
}

export type ExtensionMessage =
    | RowResponse
    | MetadataMessage;

export interface VariableDescription {
    name: string;
    type: string;
    format: string;
    label: string;
    has_value_labels: boolean;
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
