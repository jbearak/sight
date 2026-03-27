// -----------------------------------------------------------
// strL (GSO) resolution
//
// strL variables store variable-length strings in a GSO
// (Generic String Object) block at the end of the file.
// In the data section, each strL cell is an 8-byte pointer
// (v, o) that references a GSO entry.
//
// Supports format versions 117, 118, and 119.
// -----------------------------------------------------------

import type { DtaMetadata } from './types';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

export interface GsoEntry {
    content_offset: number;  // byte offset of content
    content_length: number;  // bytes of content
    type: number;            // 129=binary, 130=ASCII
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const GSO_MARKER = [0x47, 0x53, 0x4F]; // "GSO"
const STRLS_TAG = '<strls>';
const STRLS_TAG_LENGTH = STRLS_TAG.length; // 7

const UTF8_DECODER = new TextDecoder('utf-8');

// -----------------------------------------------------------
// Implementation
// -----------------------------------------------------------

/**
 * Build an index of all GSO entries from the strls section.
 *
 * Returns a Map keyed by "v:o" string for O(1) lookup.
 * The map is empty when the dataset has no strL variables.
 */
export function build_gso_index(
    buffer: ArrayBuffer,
    metadata: DtaMetadata
): Map<string, GsoEntry> {
    const my_index = new Map<string, GsoEntry>();

    // Quick exit: no strL variables means no GSO entries
    const my_has_strl = metadata.variables.some(
        v => v.type === 'strL'
    );
    if (!my_has_strl) return my_index;

    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const little_endian = metadata.byte_order === 'LSF';

    // Position after the <strls> tag
    let pos = metadata.section_offsets.strls
        + STRLS_TAG_LENGTH;

    // The section ends at the value_labels offset
    const my_section_end =
        metadata.section_offsets.value_labels;

    while (pos + 3 <= my_section_end) {
        // Check for "GSO" marker
        if (
            bytes[pos] !== GSO_MARKER[0]
            || bytes[pos + 1] !== GSO_MARKER[1]
            || bytes[pos + 2] !== GSO_MARKER[2]
        ) {
            break;
        }
        pos += 3;

        // Read v (variable number, 1-indexed)
        const my_v = view.getUint32(pos, little_endian);
        pos += 4;

        // Read o (observation number, 1-indexed)
        // v117: uint32; v118/v119: uint64
        let my_o: number;
        if (metadata.format_version === 117) {
            my_o = view.getUint32(pos, little_endian);
            pos += 4;
        } else {
            // Read as two uint32s to avoid BigInt overhead
            if (little_endian) {
                my_o = view.getUint32(pos, true);
                // High 32 bits at pos+4; ignore for
                // practical observation counts
                pos += 8;
            } else {
                // Big-endian: high bytes first
                const my_hi = view.getUint32(pos, false);
                const my_lo = view.getUint32(
                    pos + 4, false
                );
                my_o = my_hi * 0x100000000 + my_lo;
                pos += 8;
            }
        }

        // type: 129=binary, 130=ASCII
        const my_type = bytes[pos];
        pos += 1;

        // len: content length (includes null terminator
        //      for ASCII type 130)
        const my_len = view.getUint32(pos, little_endian);
        pos += 4;

        const my_key = my_v + ':' + my_o;
        my_index.set(my_key, {
            content_offset: pos,
            content_length: my_len,
            type: my_type,
        });

        pos += my_len;
    }

    return my_index;
}

/**
 * Resolve a strL pointer at the given byte offset in the
 * data section. Returns the string content, or empty string
 * for a (v=0, o=0) null pointer, or null if the GSO entry
 * is not found.
 *
 * The pointer_offset must point to the first byte of an
 * 8-byte strL pointer field.
 */
export function resolve_strl(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    gso_index: Map<string, GsoEntry>,
    pointer_offset: number
): string | null {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const little_endian = metadata.byte_order === 'LSF';

    // Read the (v, o) pointer
    // v118/v119 pointer layout (LE):
    //   bytes 0-1: v (uint16)
    //   bytes 2-7: o (6-byte little-endian integer)
    // v117 pointer layout:
    //   bytes 0-3: v (uint32)
    //   bytes 4-7: o (uint32)
    let my_v: number;
    let my_o: number;

    if (metadata.format_version === 117) {
        my_v = view.getUint32(
            pointer_offset, little_endian
        );
        my_o = view.getUint32(
            pointer_offset + 4, little_endian
        );
    } else {
        // v118/v119: v is uint16, o is 6-byte int
        if (little_endian) {
            my_v = view.getUint16(pointer_offset, true);
            // 6-byte LE integer: read uint32 at +2 for
            // low bits, uint16 at +6 for high bits
            my_o = view.getUint32(
                pointer_offset + 2, true
            );
            // High 2 bytes are at pointer_offset+6;
            // ignore for practical observation counts
        } else {
            // Big-endian: v in first 2 bytes, o in next 6
            my_v = view.getUint16(pointer_offset, false);
            // Read 6 bytes big-endian
            const my_hi = view.getUint16(
                pointer_offset + 2, false
            );
            const my_lo = view.getUint32(
                pointer_offset + 4, false
            );
            my_o = my_hi * 0x100000000 + my_lo;
        }
    }

    // (v=0, o=0) means empty string
    if (my_v === 0 && my_o === 0) return '';

    const my_key = my_v + ':' + my_o;
    const my_entry = gso_index.get(my_key);
    if (!my_entry) return null;

    // Decode content
    if (my_entry.type === 130) {
        // ASCII: content_length includes null terminator
        const my_str_len = my_entry.content_length > 0
            ? my_entry.content_length - 1
            : 0;
        return UTF8_DECODER.decode(
            bytes.subarray(
                my_entry.content_offset,
                my_entry.content_offset + my_str_len
            )
        );
    }

    // Binary (type 129): return raw bytes as string
    return UTF8_DECODER.decode(
        bytes.subarray(
            my_entry.content_offset,
            my_entry.content_offset
                + my_entry.content_length
        )
    );
}
