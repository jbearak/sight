/**
 * Test helpers: dta-parser 1.x cells and columns written as plain lists.
 */

import { MISSING } from '@jbearak/dta-parser';
import type {
    Cell,
    Column,
    Missing,
    MissingName,
} from '../../../client/src/data-browser/dta-source';
import { is_missing } from '../../../client/src/data-browser/dta-source';

/** The missing value `name` (`.` or `.a`–`.z`). */
export function miss(name: MissingName): Missing {
    const my_value = MISSING[name];
    if (!my_value) throw new Error(`no missing value ${name}`);
    return my_value;
}

/** Every missing value, `.` then `.a`–`.z`. */
export const ALL_MISSING_NAMES: MissingName[] = [
    '.',
    ...'abcdefghijklmnopqrstuvwxyz'.split('').map(
        my_c => `.${my_c}` as MissingName
    ),
];

/**
 * A column holding `cells`, as `readColumns` would return it: a string
 * column when any cell is a string or bytes, else a number column with
 * each missing value's code.
 */
export function column_of(cells: readonly Cell[]): Column {
    if (cells.some(my_c => typeof my_c === 'string' || my_c instanceof Uint8Array)) {
        return {
            kind: 'string',
            values: cells.map(my_c =>
                typeof my_c === 'string' || my_c instanceof Uint8Array
                    ? my_c
                    : String(my_c)
            ),
        };
    }
    const my_values = new Float64Array(cells.length);
    const my_missing = new Uint8Array(cells.length);
    cells.forEach((my_c, i) => {
        if (is_missing(my_c)) {
            my_values[i] = NaN;
            my_missing[i] = ALL_MISSING_NAMES.indexOf(my_c.missing) + 1;
        } else if (typeof my_c === 'number') {
            my_values[i] = my_c;
        }
    });
    return { kind: 'number', values: my_values, missing: my_missing };
}

/** A variable of a {@link fake_source}. */
export interface FakeVariable {
    name: string;
    type: string;
    format: string;
    label: string;
    value_label_name: string;
}

/**
 * An in-memory stand-in for a `DtaSource`: `rows[i][j]` is variable j of
 * file row i. `on_read_columns` sees each whole-column read.
 */
export function fake_source(options: {
    variables: FakeVariable[];
    rows: Cell[][];
    value_label_tables?: Map<string, Map<number, string>>;
    on_read_columns?: (col_indices: readonly number[]) => void;
}) {
    const { variables, rows } = options;
    return {
        nobs: rows.length,
        nvar: variables.length,
        variables,
        value_label_tables: options.value_label_tables ?? new Map(),
        read_columns(col_indices: readonly number[]): Map<number, Column> {
            options.on_read_columns?.(col_indices);
            return new Map(col_indices.map(my_col => [
                my_col,
                column_of(rows.map(my_row => my_row[my_col])),
            ]));
        },
        column_range(col_start = 0, col_end = variables.length): number[] {
            const the_columns: number[] = [];
            for (
                let j = Math.max(0, col_start);
                j < Math.min(col_end, variables.length);
                j++
            ) {
                the_columns.push(j);
            }
            return the_columns;
        },
        read_page(
            which: { start: number; count: number } | { rows: ArrayLike<number> },
            columns: readonly number[]
        ): Cell[][] {
            const the_indices = 'rows' in which
                ? Array.from(which.rows)
                : rows.slice(which.start, which.start + which.count)
                    .map((_, i) => which.start + i);
            return the_indices.map(i => columns.map(j => rows[i][j]));
        },
        read_full_text(): string[] {
            return [];
        },
        close(): void {
            /* nothing to release */
        },
    };
}
