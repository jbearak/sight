// -----------------------------------------------------------
// .dta data section row reader
//
// Reads decoded observation data from the .dta data section
// using random-access seeks. Decodes raw bytes into
// JavaScript values based on each variable's storage type.
//
// Supports format versions 117, 118, and 119.
// -----------------------------------------------------------

import type { DtaMetadata, Row } from './types';

// The <data> tag that precedes observation bytes
const DATA_TAG = '<data>';
const DATA_TAG_LENGTH = DATA_TAG.length; // 6 bytes

// Stata float missing range (IEEE 754 uint32 values):
//   .  = 0x7F000000
//   .a = 0x7F000800 (each letter += 0x800)
//   .z = 0x7F00D000
// When getFloat32() promotes to a JS double, the bit
// pattern changes and is_double_missing() cannot detect
// it. We check the raw uint32 instead.
const FLOAT_MISSING_DOT = 0x7F000000;
const FLOAT_MISSING_Z = 0x7F00D000;

// Stata double missing range (big-endian byte patterns):
//   .  = 7F E0 00 00 00 00 00 00
//   .a = 7F E0 01 00 00 00 00 00
//   .z = 7F E0 1A 00 00 00 00 00
// The letter offset is in byte 2 (big-endian). We check
// the first two bytes (7F E0), then byte 2 for the
// range 0x00..0x1A, and bytes 3..7 must be zero.
const DOUBLE_PREFIX_HI = 0x7FE0;  // bytes 0-1
const DOUBLE_LETTER_MAX = 0x1A;   // max byte 2

const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * Check whether 8 bytes at `offset` represent a Stata
 * double missing value by examining the raw big-endian
 * bit pattern. The file may be LE or BE.
 */
function is_double_missing_at(
    view: DataView,
    offset: number,
    little_endian: boolean
): boolean {
    // Read the first 4 bytes as a big-endian uint32.
    // For LE files, read native then byte-swap.
    const my_hi = little_endian
        ? view.getUint32(offset + 4, true)
        : view.getUint32(offset, false);

    // Bytes 0-1 (BE) must be 0x7FE0
    if ((my_hi >>> 16) !== DOUBLE_PREFIX_HI) return false;

    // Byte 2 (BE) is the letter: 0x00 = ., 0x1A = .z
    const my_letter = (my_hi >>> 8) & 0xFF;
    if (my_letter > DOUBLE_LETTER_MAX) return false;

    // Byte 3 (BE) must be zero
    if ((my_hi & 0xFF) !== 0) return false;

    // Bytes 4-7 (BE) must all be zero
    const my_lo = little_endian
        ? view.getUint32(offset, true)
        : view.getUint32(offset + 4, false);
    return my_lo === 0;
}

/**
 * Read a fixed-width string field, stopping at the first
 * null byte. Returns the decoded UTF-8 string.
 */
function read_fixed_string(
    bytes: Uint8Array,
    offset: number,
    width: number
): string {
    let my_end = offset;
    const my_limit = offset + width;
    while (my_end < my_limit && bytes[my_end] !== 0) {
        my_end++;
    }
    return UTF8_DECODER.decode(
        bytes.subarray(offset, my_end)
    );
}

/**
 * Read a single cell value from the data section.
 *
 * Returns the decoded value: number, string, or null
 * (for missing values).
 */
function read_cell(
    view: DataView,
    bytes: Uint8Array,
    offset: number,
    type: string,
    width: number,
    little_endian: boolean
): number | string | null {
    switch (type) {
        case 'byte': {
            const my_val = view.getInt8(offset);
            if (my_val >= 101) return null;
            return my_val;
        }
        case 'int': {
            const my_val = view.getInt16(
                offset, little_endian
            );
            if (my_val >= 32741) return null;
            return my_val;
        }
        case 'long': {
            const my_val = view.getInt32(
                offset, little_endian
            );
            if (my_val >= 2147483621) return null;
            return my_val;
        }
        case 'float': {
            // Check the raw 32-bit pattern against Stata's
            // float missing sentinels. Reading as uint32
            // with the file's endianness gives the
            // canonical integer value (0x7F000000..1A).
            const my_raw = view.getUint32(
                offset, little_endian
            );
            if (
                my_raw >= FLOAT_MISSING_DOT
                && my_raw <= FLOAT_MISSING_Z
            ) {
                return null;
            }
            return view.getFloat32(
                offset, little_endian
            );
        }
        case 'double': {
            if (is_double_missing_at(
                view, offset, little_endian
            )) {
                return null;
            }
            return view.getFloat64(
                offset, little_endian
            );
        }
        case 'strL': {
            // strL pointers are 8-byte references into
            // the GSO block. Return placeholder for now.
            return '__strl__';
        }
        default: {
            // Fixed-length string: str1 through str2045
            return read_fixed_string(
                bytes, offset, width
            );
        }
    }
}

/**
 * Read observation rows from a .dta buffer.
 *
 * @param buffer - The full .dta file as an ArrayBuffer
 * @param metadata - Parsed metadata from parse_metadata()
 * @param start - First row index (0-based)
 * @param count - Number of rows to read
 * @param col_start - First column index (inclusive, optional)
 * @param col_end - Last column index (exclusive, optional)
 * @returns Array of rows, each row an array of cell values
 */
export function read_rows_from_buffer(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    start: number,
    count: number,
    col_start?: number,
    col_end?: number
): Row[] {
    // Handle empty dataset or out-of-range start
    if (metadata.nobs === 0 || start >= metadata.nobs) {
        return [];
    }

    // Clamp count so we don't read past the end
    const my_actual_count = Math.min(
        count, metadata.nobs - start
    );
    if (my_actual_count <= 0) return [];

    // Resolve column range
    const my_col_start = col_start ?? 0;
    const my_col_end = col_end ?? metadata.nvar;

    const little_endian = metadata.byte_order === 'LSF';
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Data starts after the <data> tag
    const my_data_start =
        metadata.section_offsets.data + DATA_TAG_LENGTH;

    const the_rows: Row[] = [];

    for (let i = 0; i < my_actual_count; i++) {
        const my_row_offset = my_data_start
            + (start + i) * metadata.obs_length;
        const my_row: Row = [];

        for (
            let j = my_col_start;
            j < my_col_end;
            j++
        ) {
            const my_var = metadata.variables[j];
            const my_cell_offset =
                my_row_offset + my_var.byte_offset;

            my_row.push(
                read_cell(
                    view,
                    bytes,
                    my_cell_offset,
                    my_var.type,
                    my_var.byte_width,
                    little_endian
                )
            );
        }

        the_rows.push(my_row);
    }

    return the_rows;
}
