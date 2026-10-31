import {
    format_number,
    is_missing,
    is_preview,
    type BrowserVariable,
    type PageCell,
} from './dta-source.js';
import { labels_shipped, missing_label_key } from './label-keys.js';
import type { CellValue } from './types.js';

/** How a binary strL of `bytes` bytes is shown. */
export function binary_strl_display(bytes: number): string {
    return `binary, ${bytes.toLocaleString('en-US')} bytes`;
}

/**
 * A cell as the grid's {@link CellValue}. Only what the webview cannot
 * derive is included: `raw_display` and `formatted_display` are left out
 * where they would repeat `raw` (see `get_cell_display_value`), and with
 * `include_label` false the label is left to the webview, which has the
 * column's label set from the metadata.
 */
export function build_cell_value(
    raw: PageCell,
    variable: {
        type: string;
        format: string;
        value_label_name: string;
    },
    value_label_table?: Map<number, string>,
    include_label = true
): CellValue {
    const my_table = include_label && variable.value_label_name
        ? value_label_table
        : undefined;

    if (is_missing(raw)) {
        const my_label = my_table?.get(missing_label_key(raw.missing));
        return {
            raw: null,
            missing_type: raw.missing,
            ...(my_label !== undefined && { label_display: my_label }),
        };
    }

    if (raw instanceof Uint8Array) {
        const my_display = binary_strl_display(raw.length);
        return {
            raw: null,
            raw_display: my_display,
            formatted_display: my_display,
            binary: true,
            stored_bytes: raw.length,
        };
    }

    if (is_preview(raw)) {
        if (raw.kind === 'pending') {
            return { raw: null, pending: true };
        }
        if (raw.kind === 'binary') {
            const my_display = binary_strl_display(raw.stored_bytes);
            return {
                raw: null,
                raw_display: my_display,
                formatted_display: my_display,
                binary: true,
                stored_bytes: raw.stored_bytes,
            };
        }
        // A long strL arrives cut (the grid adds an ellipsis).
        return {
            raw: raw.text,
            truncated: true,
            file_row: raw.row,
            stored_bytes: raw.stored_bytes,
        };
    }

    if (typeof raw === 'string') {
        return { raw };
    }

    const my_formatted = format_number(raw, variable.format);
    const my_label = my_table?.get(raw);
    return {
        raw,
        ...(my_formatted !== String(raw) && { formatted_display: my_formatted }),
        ...(my_label !== undefined && { label_display: my_label }),
    };
}

/**
 * A page read from `source` (cells of `columns`, in that order), as the
 * grid's cell values. Labels from sets the metadata ships are left to
 * the webview.
 */
export function format_page(
    source: {
        readonly variables: readonly BrowserVariable[];
        readonly value_label_tables: Map<string, Map<number, string>>;
    },
    page: PageCell[][],
    columns: readonly number[]
): CellValue[][] {
    const the_formats = columns.map(my_col => {
        const my_variable = source.variables[my_col];
        const my_table = source.value_label_tables.get(
            my_variable.value_label_name
        );
        return {
            variable: my_variable,
            table: my_table,
            include_label: my_table !== undefined && !labels_shipped(my_table),
        };
    });
    return page.map(my_row =>
        my_row.map((my_raw, j) => {
            const my_format = the_formats[j];
            return build_cell_value(
                my_raw,
                my_format.variable,
                my_format.table,
                my_format.include_label
            );
        })
    );
}
