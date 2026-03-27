// -----------------------------------------------------------
// DtaFile — public API for reading .dta files
//
// Combines header parsing, data reading, strL resolution,
// and value label parsing into a single high-level class.
//
// Usage:
//   const file = await DtaFile.open('auto.dta');
//   console.log(file.nobs, file.nvar);
//   const rows = await file.read_rows(0, 100);
//   file.close();
// -----------------------------------------------------------

import * as fs from 'fs';
import { parse_metadata } from './header';
import { read_rows_from_buffer } from './data-reader';
import {
    build_gso_index,
    resolve_strl,
    type GsoEntry,
} from './strl-reader';
import { parse_value_labels } from './value-labels';
import type { DtaMetadata, VariableInfo, Row } from './types';

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const DATA_TAG_LENGTH = '<data>'.length; // 6

// -----------------------------------------------------------
// DtaFile class
// -----------------------------------------------------------

export class DtaFile {
    private _buffer: ArrayBuffer;
    private readonly _metadata: DtaMetadata;
    private _gso_index: Map<string, GsoEntry>;
    private _value_label_tables: Map<
        string,
        Map<number, string>
    >;
    private _closed: boolean;

    // Precomputed: column indices of strL variables
    private readonly _strl_col_indices: number[];

    private constructor(
        buffer: ArrayBuffer,
        metadata: DtaMetadata,
        gso_index: Map<string, GsoEntry>,
        value_label_tables: Map<
            string,
            Map<number, string>
        >
    ) {
        this._buffer = buffer;
        this._metadata = metadata;
        this._gso_index = gso_index;
        this._value_label_tables = value_label_tables;
        this._closed = false;

        // Pre-scan for strL column indices
        const the_indices: number[] = [];
        for (
            let i = 0;
            i < metadata.variables.length;
            i++
        ) {
            if (metadata.variables[i].type === 'strL') {
                the_indices.push(i);
            }
        }
        this._strl_col_indices = the_indices;
    }

    /**
     * Open a .dta file and parse all metadata.
     *
     * Reads the entire file into memory, then parses the
     * header, builds the GSO index, and parses value labels.
     */
    static async open(file_path: string): Promise<DtaFile> {
        const my_buf = fs.readFileSync(file_path);
        const my_array_buf = my_buf.buffer.slice(
            my_buf.byteOffset,
            my_buf.byteOffset + my_buf.byteLength
        ) as ArrayBuffer;

        const my_metadata = parse_metadata(my_array_buf);
        const my_gso_index = build_gso_index(
            my_array_buf, my_metadata
        );
        const my_labels = parse_value_labels(
            my_array_buf, my_metadata
        );

        return new DtaFile(
            my_array_buf,
            my_metadata,
            my_gso_index,
            my_labels
        );
    }

    // -------------------------------------------------------
    // Public accessors
    // -------------------------------------------------------

    /** Number of observations (rows). */
    get nobs(): number {
        return this._metadata.nobs;
    }

    /** Number of variables (columns). */
    get nvar(): number {
        return this._metadata.nvar;
    }

    /** Variable metadata array. */
    get variables(): VariableInfo[] {
        return this._metadata.variables;
    }

    /** Dataset label string. */
    get dataset_label(): string {
        return this._metadata.dataset_label;
    }

    /** Value label tables (table_name -> value -> label). */
    get value_label_tables(): Map<
        string,
        Map<number, string>
    > {
        return this._value_label_tables;
    }

    // -------------------------------------------------------
    // Data reading
    // -------------------------------------------------------

    /**
     * Read observation rows, resolving strL pointers.
     *
     * @param start - First row index (0-based)
     * @param count - Number of rows to read
     * @param col_start - First column (inclusive, optional)
     * @param col_end - Last column (exclusive, optional)
     */
    async read_rows(
        start: number,
        count: number,
        col_start?: number,
        col_end?: number
    ): Promise<Row[]> {
        if (this._closed) return [];

        const the_rows = read_rows_from_buffer(
            this._buffer,
            this._metadata,
            start,
            count,
            col_start,
            col_end
        );

        // Resolve strL placeholders if any strL columns
        // fall within the requested column range
        if (this._strl_col_indices.length > 0) {
            this._resolve_strls(
                the_rows,
                start,
                col_start ?? 0,
                col_end ?? this._metadata.nvar
            );
        }

        return the_rows;
    }

    // -------------------------------------------------------
    // Resource management
    // -------------------------------------------------------

    /**
     * Release the buffer and internal caches. After close,
     * read_rows returns empty arrays.
     */
    close(): void {
        this._closed = true;
        this._buffer = new ArrayBuffer(0);
        this._gso_index = new Map();
        this._value_label_tables = new Map();
    }

    // -------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------

    /**
     * Post-process rows to resolve strL placeholders.
     *
     * For each strL column in the requested range, compute
     * the pointer offset in the data section and call
     * resolve_strl() to replace the "__strl__" placeholder.
     */
    private _resolve_strls(
        the_rows: Row[],
        start: number,
        col_start: number,
        col_end: number
    ): void {
        const my_data_start =
            this._metadata.section_offsets.data
            + DATA_TAG_LENGTH;

        for (const my_abs_col of this._strl_col_indices) {
            // Skip columns outside the requested range
            if (
                my_abs_col < col_start
                || my_abs_col >= col_end
            ) {
                continue;
            }

            // Column index within the row array
            const my_row_col = my_abs_col - col_start;
            const my_var = this._metadata
                .variables[my_abs_col];

            for (let i = 0; i < the_rows.length; i++) {
                const my_pointer_offset = my_data_start
                    + (start + i)
                        * this._metadata.obs_length
                    + my_var.byte_offset;

                const my_resolved = resolve_strl(
                    this._buffer,
                    this._metadata,
                    this._gso_index,
                    my_pointer_offset
                );

                the_rows[i][my_row_col] =
                    my_resolved ?? '';
            }
        }
    }
}

// -----------------------------------------------------------
// Barrel exports
// -----------------------------------------------------------

export type {
    VariableInfo,
    Row,
    RowCell,
    MissingType,
    MissingValue,
    DtaMetadata,
    DtaType,
    FormatVersion,
    SectionOffsets,
} from './types';
export { apply_display_format } from './display-format';
export {
    classify_missing_value,
    classify_raw_float_missing,
    classify_raw_double_missing_at,
    is_missing_value,
    is_missing_value_object,
    make_missing_value,
    STATA_MISSING_B,
} from './missing-values';
