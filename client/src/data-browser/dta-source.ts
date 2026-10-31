/**
 * The data browser's only view of dta-parser.
 *
 * {@link DtaSource} wraps a dta-parser 1.x reader with what the browser
 * needs: the variables under the names the rest of the browser uses,
 * value-label tables keyed as before, whole typed columns for sorts,
 * filters, histograms and copies, and pages of cells with bounded strL
 * previews. Every other data-browser module imports from here, so the
 * host, the reader thread, the step workers and the tests share one
 * adapter.
 *
 * dta-parser 1.x reads synchronously. The extension host opens a
 * DtaSource for metadata only; data reads happen in worker threads
 * (row-reader-worker.ts, compute-worker.ts) on the descriptor the host
 * opened, or in-process where no worker bundle exists (unit tests).
 *
 * Nothing here imports `vscode`.
 */

import {
    formatValue,
    isMissing,
    missingValue,
    type Cell,
    type Column,
    type DtaReader,
    type Missing,
    type MissingName,
    type PreviewColumn,
} from '@jbearak/dta-parser';
import { openDtaFile } from '@jbearak/dta-parser/node';
import { MISSING_LABEL_KEY_BASE, missing_label_key } from './label-keys.js';
import { group_contiguous_runs } from './permuted-rows.js';

export type { Cell, Column, Missing, MissingName };
export { isMissing as is_missing };

/** A variable, under the field names the browser has always used. */
export interface BrowserVariable {
    name: string;
    /** Storage type: byte, int, long, float, double, str1–str2045, strL. */
    type: string;
    format: string;
    label: string;
    /** Name of the attached value-label set; empty when there is none. */
    value_label_name: string;
}

export { MISSING_LABEL_KEY_BASE, missing_label_key };

/**
 * A strL longer than this is read and sent as a preview of its first
 * bytes (cut back to a whole character), with its full stored length.
 * strN values (at most 2,045 bytes) are always whole.
 */
export const STRL_PREVIEW_BYTES = 256;

/** A strL cell cut to {@link STRL_PREVIEW_BYTES}. */
export interface TextPreview {
    kind: 'preview';
    text: string;
    /** File row of the value, so its whole text can be asked for. */
    row: number;
    /** Full length in the file, in bytes. */
    stored_bytes: number;
}

/** A binary strL; its bytes are not sent to the grid. */
export interface BinaryPreview {
    kind: 'binary';
    stored_bytes: number;
}

/** A strL cell not read yet (the reader sends it in a second message). */
export interface PendingCell {
    kind: 'pending';
}

export const PENDING_CELL: PendingCell = Object.freeze({ kind: 'pending' });

/** One cell of a page: a full value, a strL preview, or not read yet. */
export type PageCell = Cell | TextPreview | BinaryPreview | PendingCell;

/** Which rows a page read covers, as original (file) row indices. */
export type PageRows =
    | { start: number; count: number }
    | { rows: ArrayLike<number> };

/**
 * The missing value for a code in a NumberColumn's `missing` array: 1 is
 * `.`, 2–27 are `.a`–`.z`.
 */
export function missing_cell(code: number): Missing {
    return missingValue(code);
}

/** Whether `value` is a strL preview or pending, not a plain cell. */
export function is_preview(
    value: PageCell
): value is TextPreview | BinaryPreview | PendingCell {
    return typeof value === 'object'
        && value !== null
        && !(value instanceof Uint8Array)
        && 'kind' in value;
}

/** `formatValue`, never throwing: a format it rejects shows the number. */
export function format_number(value: number, format: string): string {
    try {
        return formatValue(value, format);
    } catch {
        return String(value);
    }
}

/** Whether a variable's storage type is a string (strN or strL). */
export function is_string_type(type: string): boolean {
    return type === 'strL' || /^str\d+$/.test(type);
}

export class DtaSource {
    readonly nobs: number;
    readonly nvar: number;
    readonly variables: BrowserVariable[];
    readonly value_label_tables: Map<string, Map<number, string>>;

    private constructor(private readonly reader: DtaReader) {
        this.nobs = reader.info.nobs;
        this.nvar = reader.variables.length;
        this.variables = reader.variables.map(my_v => ({
            name: my_v.name,
            type: my_v.type,
            format: my_v.format,
            label: my_v.label,
            value_label_name: my_v.valueLabels,
        }));
        this.value_label_tables = new Map();
        for (const my_v of this.variables) {
            const my_name = my_v.value_label_name;
            if (my_name === '' || this.value_label_tables.has(my_name)) {
                continue;
            }
            const my_set = reader.valueLabels(my_name);
            if (!my_set) continue;
            const my_table = new Map<number, string>();
            for (const [my_key, my_text] of my_set) {
                my_table.set(
                    typeof my_key === 'number'
                        ? my_key
                        : missing_label_key(my_key.missing),
                    my_text
                );
            }
            this.value_label_tables.set(my_name, my_table);
        }
    }

    /**
     * Open by path, or on a descriptor the caller owns: closing the
     * source leaves a borrowed descriptor open.
     */
    static open(file: string | number): DtaSource {
        return new DtaSource(openDtaFile(file));
    }

    /** Whole columns, in one pass over the file. */
    read_columns(col_indices: readonly number[]): Map<number, Column> {
        const the_columns = this.reader.readColumns(col_indices);
        const the_by_index = new Map<number, Column>();
        col_indices.forEach((my_col, i) => {
            the_by_index.set(my_col, the_columns[i]);
        });
        return the_by_index;
    }

    /** Whether variable `col` is a strL. */
    is_strl(col: number): boolean {
        return this.variables[col]?.type === 'strL';
    }

    /**
     * Whether a read has touched a strL yet. The first one builds the
     * file's strL index (about 100 ms for a million strLs), so the row
     * reader sends a first page's other columns before its strLs.
     */
    get strl_index_built(): boolean {
        return this.read_strl;
    }

    private read_strl = false;

    /**
     * Cells of `columns` (variable indices, in that order) for the given
     * rows, in the order given. strL values longer than
     * {@link STRL_PREVIEW_BYTES} come back as previews, so a page never
     * reads or holds a whole large strL.
     */
    read_page(rows: PageRows, columns: readonly number[]): PageCell[][] {
        const the_plain: number[] = [];
        const the_plain_at: number[] = [];
        const the_strl: number[] = [];
        const the_strl_at: number[] = [];
        columns.forEach((my_col, j) => {
            if (this.is_strl(my_col)) {
                the_strl.push(my_col);
                the_strl_at.push(j);
            } else {
                the_plain.push(my_col);
                the_plain_at.push(j);
            }
        });

        let the_indices: number[] | null = null;
        let the_runs: { start: number; len: number }[];
        let my_count: number;
        if ('rows' in rows) {
            the_indices = Array.from(rows.rows);
            my_count = the_indices.length;
            the_runs = group_contiguous_runs(the_indices);
        } else {
            const my_start = Math.max(0, rows.start);
            my_count = Math.max(0, Math.min(rows.count, this.nobs - my_start));
            the_runs = my_count > 0 ? [{ start: my_start, len: my_count }] : [];
        }

        const the_page: PageCell[][] = Array.from(
            { length: my_count },
            () => new Array<PageCell>(columns.length)
        );

        if (the_plain.length > 0 && my_count > 0) {
            // One call either way: a contiguous window, or a sorted or
            // filtered page gathered by readRowsAt.
            const the_cells = the_indices
                ? this.reader.readRowsAt(the_indices, the_plain)
                : this.reader.readRows(the_runs[0].start, my_count, the_plain);
            the_cells.forEach((my_cells, i) => {
                const my_out = the_page[i];
                the_plain_at.forEach((my_at, j) => {
                    my_out[my_at] = my_cells[j];
                });
            });
        }

        if (the_strl.length > 0 && my_count > 0) {
            let my_row = 0;
            for (const my_run of the_runs) {
                const the_columns = this.reader.readColumns(the_strl, {
                    start: my_run.start,
                    count: my_run.len,
                    maxStringBytes: STRL_PREVIEW_BYTES,
                });
                the_strl_at.forEach((my_at, j) => {
                    const my_column = the_columns[j];
                    // strL variables always read as string columns.
                    if (my_column.kind !== 'string') return;
                    for (let i = 0; i < my_run.len; i++) {
                        the_page[my_row + i][my_at] =
                            strl_cell(my_column, i, my_run.start + i);
                    }
                });
                my_row += my_run.len;
            }
            this.read_strl = true;
        }
        return the_page;
    }

    /** Variable indices `[col_start, col_end)`, clamped to the file. */
    column_range(col_start = 0, col_end = this.nvar): number[] {
        const the_columns: number[] = [];
        for (
            let my_col = Math.max(0, col_start);
            my_col < Math.min(col_end, this.nvar);
            my_col++
        ) {
            the_columns.push(my_col);
        }
        return the_columns;
    }

    /**
     * Whole text of string cells, given by file row and column, in the
     * order given: what a page sent as a {@link TextPreview}. A binary
     * strL, or a cell that is not a string, gives "".
     */
    read_full_text(cells: readonly { row: number; col: number }[]): string[] {
        const the_texts: string[] = new Array(cells.length).fill('');
        const the_by_col = new Map<number, number[]>();
        cells.forEach((my_cell, i) => {
            const my_list = the_by_col.get(my_cell.col);
            if (my_list) my_list.push(i);
            else the_by_col.set(my_cell.col, [i]);
        });
        for (const [my_col, the_positions] of the_by_col) {
            const the_rows = this.reader.readRowsAt(
                the_positions.map(i => cells[i].row),
                [my_col]
            );
            the_positions.forEach((my_position, j) => {
                const my_value = the_rows[j][0];
                if (typeof my_value === 'string') {
                    the_texts[my_position] = my_value;
                }
            });
        }
        return the_texts;
    }

    /** Release the reader (a borrowed descriptor stays open). */
    close(): void {
        this.reader.close();
    }
}

function strl_cell(
    column: PreviewColumn,
    i: number,
    row: number
): PageCell {
    const my_value = column.values[i];
    const my_stored = column.storedBytes[i];
    if (my_value instanceof Uint8Array) {
        return { kind: 'binary', stored_bytes: my_stored };
    }
    return my_stored > STRL_PREVIEW_BYTES
        ? { kind: 'preview', text: my_value, row, stored_bytes: my_stored }
        : my_value;
}
