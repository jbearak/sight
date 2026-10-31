/**
 * Full-column jobs for the data browser: sort permutations, filter
 * survivor sets, histograms and column copies.
 *
 * These are the computations that used to run on the extension host's
 * event loop (each blocking it for the whole operation: 3.5 s for a
 * 10M-row numeric sort, 29 s for a slow regex). They are pure functions
 * of a {@link ColumnSource}, so the same code runs in a step worker
 * (compute-worker.ts, opened on the file by path) and, where no worker
 * is available (unit tests), in-process on the panel's own reader.
 *
 * Nothing here imports `vscode`.
 */

import type { RowCell, VariableInfo } from '@jbearak/dta-parser';
import { build_cell_value } from './cell-format.js';
import {
    build_sort_column,
    classify_sort_kind,
    compute_permutation,
    type SortColumn,
} from './sort.js';
import {
    compute_filtered_indices,
    type FilterColumn,
} from './filter.js';
import { compute_histogram } from './histograms.js';
import type { FilterState, HistogramBin, SortState } from './types.js';

/** The part of dta-parser 0.6's `DtaFile` a job reads. */
export interface ColumnSource {
    readonly nobs: number;
    readonly nvar: number;
    readonly variables: VariableInfo[];
    readonly value_label_tables: Map<string, Map<number, string>>;
    read_columns(
        col_indices: number[],
        options?: { signal?: AbortSignal }
    ): Promise<Map<number, RowCell[]>>;
}

/**
 * Compute the sort permutation and/or filter survivor set for one
 * requested state, reading each referenced column once (a restore that
 * needs both reads them in one scan). A null spec is not computed.
 */
export interface OrderJob {
    kind: 'order';
    sort: SortState | null;
    filter: FilterState | null;
}

/** The 50-bin brush histogram of one numeric column. */
export interface HistogramJob {
    kind: 'histogram';
    col_index: number;
}

/**
 * One column as clipboard text, in `order` (display order) or, when
 * `order` is null, natural order.
 */
export interface CopyJob {
    kind: 'copy';
    col_index: number;
    show_labels: boolean;
    show_formats: boolean;
    order: Uint32Array | null;
}

export type ComputeJob = OrderJob | HistogramJob | CopyJob;

export interface OrderResult {
    kind: 'order';
    /** Null when the sort is empty, invalid or was not asked for. */
    permutation: Uint32Array | null;
    /** Null when no filter entry is enabled or it was not asked for. */
    filtered_indices: Uint32Array | null;
}

export interface HistogramResult {
    kind: 'histogram';
    bins: HistogramBin[];
}

export interface CopyResult {
    kind: 'copy';
    text: string;
}

export type ComputeResult = OrderResult | HistogramResult | CopyResult;

/** %tc / %tC store milliseconds since 1960; other date formats store
 *  days. Consulted when building a {@link FilterColumn} for date
 *  predicates so ISO strings convert into the column's stored domain. */
function is_timestamp_format(format: string): boolean {
    return /^%-?t[cC]/.test(format);
}

function has_value_labels(
    source: ColumnSource,
    variable: VariableInfo
): boolean {
    return variable.value_label_name !== ''
        && source.value_label_tables.has(variable.value_label_name);
}

/** Whether `requestHistogram` can be served for a column. */
export function can_compute_histogram(
    source: Pick<ColumnSource, 'variables' | 'value_label_tables'>,
    col_index: number
): boolean {
    const my_variable = source.variables[col_index];
    if (!my_variable) return false;
    const my_kind = classify_sort_kind({
        type: my_variable.type,
        format: my_variable.format,
        has_value_labels: my_variable.value_label_name !== ''
            && source.value_label_tables.has(
                my_variable.value_label_name
            ),
    });
    return my_kind === 'numeric' || my_kind === 'labelledNumeric';
}

/** Sort-key columns of a valid, non-empty sort; null otherwise. */
function sort_columns_needed(
    source: ColumnSource,
    sort: SortState | null
): number[] | null {
    if (!sort || sort.keys.length === 0) return null;
    for (const my_key of sort.keys) {
        if (my_key.col_index < 0 || my_key.col_index >= source.nvar) {
            return null;
        }
    }
    return sort.keys.map(my_key => my_key.col_index);
}

/** Columns of the enabled filter entries; null when none is enabled or
 *  any enabled entry is out of range (treated as "no filtering"). */
function filter_columns_needed(
    source: ColumnSource,
    filter: FilterState | null
): number[] | null {
    if (!filter) return null;
    const the_active = filter.entries.filter(my_entry => my_entry.enabled);
    if (the_active.length === 0) return null;
    for (const my_entry of the_active) {
        if (
            my_entry.col_index < 0
            || my_entry.col_index >= source.nvar
        ) {
            return null;
        }
    }
    return the_active.map(my_entry => my_entry.col_index);
}

async function run_order_job(
    job: OrderJob,
    source: ColumnSource,
    signal?: AbortSignal
): Promise<OrderResult> {
    const the_sort_columns = sort_columns_needed(source, job.sort);
    const the_filter_columns = filter_columns_needed(source, job.filter);
    const the_needed = [
        ...new Set([
            ...(the_sort_columns ?? []),
            ...(the_filter_columns ?? []),
        ]),
    ];
    const the_values = the_needed.length > 0
        ? await source.read_columns(
            the_needed,
            signal ? { signal } : undefined
        )
        : new Map<number, RowCell[]>();

    let my_permutation: Uint32Array | null = null;
    if (the_sort_columns && job.sort) {
        const the_columns: SortColumn[] = [];
        const the_directions: (1 | -1)[] = [];
        for (const my_key of job.sort.keys) {
            const my_var = source.variables[my_key.col_index];
            const my_kind = classify_sort_kind({
                type: my_var.type,
                format: my_var.format,
                has_value_labels: has_value_labels(source, my_var),
            });
            the_columns.push(build_sort_column(
                the_values.get(my_key.col_index) ?? [],
                my_kind,
                source.value_label_tables.get(my_var.value_label_name),
                job.sort.labels_on_when_sorted
            ));
            the_directions.push(my_key.direction === 'desc' ? -1 : 1);
        }
        my_permutation = compute_permutation(
            the_columns,
            the_directions,
            source.nobs
        );
    }

    let my_filtered: Uint32Array | null = null;
    if (the_filter_columns && job.filter) {
        const the_columns = new Map<number, FilterColumn>();
        for (const my_col_index of new Set(the_filter_columns)) {
            const my_var = source.variables[my_col_index];
            the_columns.set(my_col_index, {
                values: the_values.get(my_col_index) ?? [],
                is_timestamp: is_timestamp_format(my_var.format),
            });
        }
        my_filtered = compute_filtered_indices(
            the_columns,
            job.filter,
            source.nobs
        ) ?? null;
    }

    return {
        kind: 'order',
        permutation: my_permutation,
        filtered_indices: my_filtered,
    };
}

async function run_histogram_job(
    job: HistogramJob,
    source: ColumnSource,
    signal?: AbortSignal
): Promise<HistogramResult> {
    if (
        job.col_index < 0
        || job.col_index >= source.nvar
        || !can_compute_histogram(source, job.col_index)
    ) {
        return { kind: 'histogram', bins: [] };
    }
    const the_columns = await source.read_columns(
        [job.col_index],
        signal ? { signal } : undefined
    );
    const the_numbers: number[] = [];
    for (const my_value of the_columns.get(job.col_index) ?? []) {
        // Missing cells are MissingValue objects; only finite doubles
        // enter the brush distribution.
        if (typeof my_value === 'number') the_numbers.push(my_value);
    }
    return { kind: 'histogram', bins: compute_histogram(the_numbers) };
}

async function run_copy_job(
    job: CopyJob,
    source: ColumnSource,
    signal?: AbortSignal
): Promise<CopyResult> {
    const my_variable = source.variables[job.col_index];
    if (!my_variable) return { kind: 'copy', text: '' };
    const my_table = source.value_label_tables.get(
        my_variable.value_label_name
    );
    const display_for = (raw: RowCell): string => {
        const my_cell = build_cell_value(raw, my_variable, my_table);
        if (my_cell.missing_type) {
            return (job.show_labels && my_cell.label_display)
                ? my_cell.label_display
                : my_cell.missing_type;
        }
        if (job.show_labels && my_cell.label_display) {
            return my_cell.label_display;
        }
        return job.show_formats
            ? my_cell.formatted_display
            : my_cell.raw_display;
    };

    const the_columns = await source.read_columns(
        [job.col_index],
        signal ? { signal } : undefined
    );
    const the_column = the_columns.get(job.col_index) ?? [];
    const the_lines: string[] = [my_variable.name];
    if (job.order) {
        // Display (filtered + sorted) order, pinned when the user
        // clicked Copy, so the clipboard matches what was on screen.
        for (let i = 0; i < job.order.length; i++) {
            the_lines.push(display_for(the_column[job.order[i]]));
        }
    } else {
        for (let i = 0; i < the_column.length; i++) {
            the_lines.push(display_for(the_column[i]));
        }
    }
    return { kind: 'copy', text: the_lines.join('\n') };
}

/** Run one job against `source`. Rejects with the reader's AbortError
 *  when `signal` aborts during a column read. */
export function run_compute_job(
    job: ComputeJob,
    source: ColumnSource,
    signal?: AbortSignal
): Promise<ComputeResult> {
    switch (job.kind) {
        case 'order':
            return run_order_job(job, source, signal);
        case 'histogram':
            return run_histogram_job(job, source, signal);
        case 'copy':
            return run_copy_job(job, source, signal);
    }
}
