import { describe, it, expect } from 'bun:test';
import { parse_legacy_metadata } from '../../../src/dta-parser/legacy-header';

// -----------------------------------------------------------
// Legacy header parser unit tests (formats 113-115)
// -----------------------------------------------------------

/**
 * Build a minimal synthetic legacy .dta buffer with the
 * given parameters. No value labels. Data section follows
 * immediately after the expansion fields terminator.
 */
function build_legacy_buffer(opts: {
    version: 113 | 114 | 115;
    byte_order?: 'LSF' | 'MSF';
    nvar: number;
    nobs: number;
    label?: string;
    type_codes: number[];
    varnames: string[];
}): { buffer: ArrayBuffer; file_size: number } {
    const {
        version,
        byte_order = 'LSF',
        nvar,
        nobs,
        label = '',
        type_codes,
        varnames,
    } = opts;

    const little_endian = byte_order === 'LSF';
    const fmt_width = version === 113 ? 12 : 49;

    // Compute obs_length from type codes
    let obs_length = 0;
    for (const my_code of type_codes) {
        if (my_code >= 1 && my_code <= 244) {
            obs_length += my_code;
        } else if (my_code === 251) obs_length += 1;
        else if (my_code === 252) obs_length += 2;
        else if (my_code === 253) obs_length += 4;
        else if (my_code === 254) obs_length += 4;
        else if (my_code === 255) obs_length += 8;
    }

    const my_header_size = 109;
    const my_types_size = nvar;
    const my_varnames_size = nvar * 33;
    const my_sortlist_size = (nvar + 1) * 2;
    const my_formats_size = nvar * fmt_width;
    const my_vlabel_names_size = nvar * 33;
    const my_var_labels_size = nvar * 81;
    const my_expansion_size = 5; // terminator only
    const my_data_size = nobs * obs_length;

    const my_total = my_header_size
        + my_types_size
        + my_varnames_size
        + my_sortlist_size
        + my_formats_size
        + my_vlabel_names_size
        + my_var_labels_size
        + my_expansion_size
        + my_data_size;

    const my_buf = Buffer.alloc(my_total);
    const my_view = new DataView(
        my_buf.buffer,
        my_buf.byteOffset,
        my_buf.byteLength
    );

    // Fixed header
    my_buf[0] = version;
    my_buf[1] = little_endian ? 0x02 : 0x01;
    my_buf[2] = 0x01;
    my_buf[3] = 0x00;
    my_view.setUint16(4, nvar, little_endian);
    my_view.setUint32(6, nobs, little_endian);

    // Dataset label (81 bytes at offset 10)
    for (let i = 0; i < label.length && i < 80; i++) {
        my_buf[10 + i] = label.charCodeAt(i);
    }

    let pos = my_header_size;

    // Variable types
    for (let i = 0; i < nvar; i++) {
        my_buf[pos + i] = type_codes[i];
    }
    pos += nvar;

    // Varnames (33 bytes each)
    for (let i = 0; i < nvar; i++) {
        const my_name = varnames[i] || `v${i}`;
        for (let j = 0; j < my_name.length; j++) {
            my_buf[pos + i * 33 + j] =
                my_name.charCodeAt(j);
        }
    }
    pos += nvar * 33;

    // Sortlist
    pos += (nvar + 1) * 2;

    // Formats (fmt_width bytes each)
    for (let i = 0; i < nvar; i++) {
        const my_fmt = '%9.0g';
        for (let j = 0; j < my_fmt.length; j++) {
            my_buf[pos + i * fmt_width + j] =
                my_fmt.charCodeAt(j);
        }
    }
    pos += nvar * fmt_width;

    // Value label names (33 bytes each) — empty
    pos += nvar * 33;

    // Variable labels (81 bytes each) — empty
    pos += nvar * 81;

    // Expansion fields terminator (5 zero bytes)
    pos += 5;

    // Data section — fill with zeros (no observation data)

    return {
        buffer: my_buf.buffer.slice(
            my_buf.byteOffset,
            my_buf.byteOffset + my_buf.byteLength
        ),
        file_size: my_total,
    };
}

describe('parse_legacy_metadata', () => {

    it('parses format 115 header', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 115,
            nvar: 3,
            nobs: 10,
            label: 'Test dataset',
            type_codes: [255, 252, 5], // double, int, str5
            varnames: ['price', 'mpg', 'make'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.format_version).toBe(115);
        expect(my_meta.byte_order).toBe('LSF');
        expect(my_meta.nvar).toBe(3);
        expect(my_meta.nobs).toBe(10);
        expect(my_meta.dataset_label).toBe('Test dataset');
        expect(my_meta.variables.length).toBe(3);

        // Variable types
        expect(my_meta.variables[0].type).toBe('double');
        expect(my_meta.variables[0].byte_width).toBe(8);
        expect(my_meta.variables[1].type).toBe('int');
        expect(my_meta.variables[1].byte_width).toBe(2);
        expect(my_meta.variables[2].type).toBe('str5');
        expect(my_meta.variables[2].byte_width).toBe(5);

        // Variable names
        expect(my_meta.variables[0].name).toBe('price');
        expect(my_meta.variables[1].name).toBe('mpg');
        expect(my_meta.variables[2].name).toBe('make');

        // Obs length
        expect(my_meta.obs_length).toBe(8 + 2 + 5);
    });

    it('parses format 114 header', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 114,
            nvar: 2,
            nobs: 5,
            type_codes: [251, 253], // byte, long
            varnames: ['x', 'y'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.format_version).toBe(114);
        expect(my_meta.nvar).toBe(2);
        expect(my_meta.nobs).toBe(5);
        expect(my_meta.variables[0].type).toBe('byte');
        expect(my_meta.variables[1].type).toBe('long');
    });

    it('parses format 113 with 12-byte formats', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 113,
            nvar: 1,
            nobs: 3,
            type_codes: [254], // float
            varnames: ['z'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.format_version).toBe(113);
        expect(my_meta.nvar).toBe(1);
        expect(my_meta.variables[0].type).toBe('float');
        expect(my_meta.variables[0].format).toBe('%9.0g');
    });

    it('handles big-endian byte order', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 115,
            byte_order: 'MSF',
            nvar: 1,
            nobs: 2,
            type_codes: [255], // double
            varnames: ['val'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.byte_order).toBe('MSF');
        expect(my_meta.nvar).toBe(1);
        expect(my_meta.nobs).toBe(2);
    });

    it('handles empty dataset (nobs=0)', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 115,
            nvar: 2,
            nobs: 0,
            type_codes: [255, 252],
            varnames: ['a', 'b'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.nobs).toBe(0);
        expect(my_meta.nvar).toBe(2);
        // data offset = value_labels offset when nobs=0
        expect(my_meta.section_offsets.data).toBe(
            my_meta.section_offsets.value_labels
        );
    });

    it('computes correct byte offsets', () => {
        const { buffer, file_size } = build_legacy_buffer({
            version: 115,
            nvar: 4,
            nobs: 1,
            type_codes: [251, 252, 253, 255],
            varnames: ['a', 'b', 'c', 'd'],
        });

        const my_meta = parse_legacy_metadata(
            buffer, file_size
        );

        expect(my_meta.variables[0].byte_offset).toBe(0);
        expect(my_meta.variables[1].byte_offset).toBe(1);
        expect(my_meta.variables[2].byte_offset).toBe(3);
        expect(my_meta.variables[3].byte_offset).toBe(7);
        expect(my_meta.obs_length).toBe(15);
    });

    it('rejects invalid version byte', () => {
        const my_buf = Buffer.alloc(256);
        my_buf[0] = 112; // unsupported
        my_buf[1] = 0x02;
        my_buf[2] = 0x01;

        expect(() => {
            parse_legacy_metadata(
                my_buf.buffer.slice(
                    my_buf.byteOffset,
                    my_buf.byteOffset + my_buf.byteLength
                ),
                256
            );
        }).toThrow('Not a legacy .dta file');
    });
});
