// -----------------------------------------------------------
// Value label table parsing
//
// The <value_labels> section contains zero or more label
// tables, each wrapped in <lbl>...</lbl> tags. Each table
// maps integer values to string labels.
//
// Supports format versions 117, 118, and 119.
// -----------------------------------------------------------

import type { DtaMetadata } from './types';

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const VALUE_LABELS_TAG = '<value_labels>';
const VALUE_LABELS_TAG_LENGTH = VALUE_LABELS_TAG.length;
const LBL_OPEN_TAG = '<lbl>';
const LBL_OPEN_TAG_LENGTH = LBL_OPEN_TAG.length; // 5
const LBL_CLOSE_TAG_LENGTH = 6; // "</lbl>"

// Label name field widths by format version
const LABEL_NAME_WIDTH: Record<number, number> = {
    117: 33,
    118: 129,
    119: 129,
};

const PADDING_BYTES = 3;

const UTF8_DECODER = new TextDecoder('utf-8');

// -----------------------------------------------------------
// Implementation
// -----------------------------------------------------------

/**
 * Parse all value label tables from the <value_labels>
 * section of a .dta file.
 *
 * Returns a Map of table_name to a Map of integer_value
 * to label_string.
 */
export function parse_value_labels(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    base_offset: number = 0
): Map<string, Map<number, string>> {
    const my_result = new Map<string, Map<number, string>>();

    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const little_endian = metadata.byte_order === 'LSF';

    const my_name_width =
        LABEL_NAME_WIDTH[metadata.format_version];

    // Position after the <value_labels> tag
    let pos = metadata.section_offsets.value_labels
        - base_offset
        + VALUE_LABELS_TAG_LENGTH;

    // Section ends before </value_labels> which is before
    // the stata_data_close tag
    const my_section_end =
        metadata.section_offsets.stata_data_close
        - base_offset;

    while (pos + LBL_OPEN_TAG_LENGTH <= my_section_end) {
        // Check for <lbl> opening tag
        if (
            bytes[pos] !== 0x3C     // '<'
            || bytes[pos + 1] !== 0x6C  // 'l'
            || bytes[pos + 2] !== 0x62  // 'b'
            || bytes[pos + 3] !== 0x6C  // 'l'
            || bytes[pos + 4] !== 0x3E  // '>'
        ) {
            break;
        }
        pos += LBL_OPEN_TAG_LENGTH;

        // table_length (int32): skip — we parse fields directly
        pos += 4;

        // label_name: null-terminated fixed-width string
        let my_name_end = pos;
        const my_name_limit = pos + my_name_width;
        while (
            my_name_end < my_name_limit
            && bytes[my_name_end] !== 0
        ) {
            my_name_end++;
        }
        const my_label_name = UTF8_DECODER.decode(
            bytes.subarray(pos, my_name_end)
        );
        pos += my_name_width;

        // 3 bytes padding (always 0x00)
        pos += PADDING_BYTES;

        // n (int32): number of entries
        const my_n = view.getInt32(pos, little_endian);
        pos += 4;

        // txt_len (int32): total bytes in the text block
        const my_txt_len = view.getInt32(pos, little_endian);
        pos += 4;

        // offsets[n]: byte offsets into text block
        const the_offsets: number[] = [];
        for (let i = 0; i < my_n; i++) {
            the_offsets.push(
                view.getInt32(pos, little_endian)
            );
            pos += 4;
        }

        // values[n]: integer values
        const the_values: number[] = [];
        for (let i = 0; i < my_n; i++) {
            the_values.push(
                view.getInt32(pos, little_endian)
            );
            pos += 4;
        }

        // text block: packed null-terminated strings
        const my_text_start = pos;
        const my_label_map = new Map<number, string>();

        for (let i = 0; i < my_n; i++) {
            const my_str_start =
                my_text_start + the_offsets[i];
            let my_str_end = my_str_start;
            const my_str_limit =
                my_text_start + my_txt_len;

            while (
                my_str_end < my_str_limit
                && bytes[my_str_end] !== 0
            ) {
                my_str_end++;
            }

            const my_label = UTF8_DECODER.decode(
                bytes.subarray(my_str_start, my_str_end)
            );
            my_label_map.set(the_values[i], my_label);
        }

        my_result.set(my_label_name, my_label_map);

        // Advance past text block
        pos = my_text_start + my_txt_len;

        // Skip </lbl> closing tag
        pos += LBL_CLOSE_TAG_LENGTH;
    }

    return my_result;
}
