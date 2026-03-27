/**
 * Generate binary .dta test fixtures for the Sight Data Browser parser.
 *
 * Run with:  bun tests/fixtures/dta/generate-fixtures.ts
 *
 * Produces:
 *   auto_v118.dta   – Stata 14 (v118) format, ~12 vars, ~74 rows
 *   auto_v117.dta   – Stata 13 (v117) format version of above
 *   strl_test.dta   – Dataset with strL variables
 *   value_labels.dta – Dataset with value label tables
 *   empty.dta       – Zero observations, has variable definitions
 *   wide.dta        – 120 double variables, 20 observations
 *   missing_values.dta – Extended missing values (., .a .. .z)
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allocate a Buffer of `size` bytes filled with 0x00. */
function zero_buffer(size: number): Buffer {
    return Buffer.alloc(size);
}

/** Write a null-terminated string into `buf` at `offset`, truncating or
 *  padding with zeros to fit exactly `field_width` bytes. */
function write_fixed_string(
    buf: Buffer,
    offset: number,
    value: string,
    field_width: number,
): void {
    const the_bytes = Buffer.from(value, "utf-8");
    const copy_len = Math.min(the_bytes.length, field_width - 1);
    the_bytes.copy(buf, offset, 0, copy_len);
    // Remaining bytes are already 0x00 from zero_buffer.
}

// ---------------------------------------------------------------------------
// Type codes
// ---------------------------------------------------------------------------

const TYPE_V118 = {
    byte: 65530,
    int: 65529,
    long: 65528,
    float: 65527,
    double: 65526,
    strl: 32768,
    str: (width: number) => width, // str1..str2045
} as const;

const TYPE_V117 = {
    byte: 251,
    int: 252,
    long: 253,
    float: 254,
    double: 255,
    str: (width: number) => width, // str1..str244
} as const;

/** Byte width consumed by one value of `type_code` in the data section. */
function type_width_v118(type_code: number): number {
    if (type_code === 65530) return 1;
    if (type_code === 65529) return 2;
    if (type_code === 65528) return 4;
    if (type_code === 65527) return 4;
    if (type_code === 65526) return 8;
    if (type_code === 32768) return 8; // strL pointer
    if (type_code >= 1 && type_code <= 2045) return type_code;
    throw new Error(`Unknown v118 type code: ${type_code}`);
}

function type_width_v117(type_code: number): number {
    if (type_code === 251) return 1;
    if (type_code === 252) return 2;
    if (type_code === 253) return 4;
    if (type_code === 254) return 4;
    if (type_code === 255) return 8;
    if (type_code >= 1 && type_code <= 244) return type_code;
    throw new Error(`Unknown v117 type code: ${type_code}`);
}

// ---------------------------------------------------------------------------
// Missing value encodings
// ---------------------------------------------------------------------------

const MISSING = {
    byte: { dot: 101, a: 102 }, // .a=102 .. .z=127
    int: { dot: 32741, a: 32742 },
    long: { dot: 2147483621, a: 2147483622 },
    /** Float missing: IEEE 754 bit patterns. */
    float_dot: Buffer.from([0x00, 0x00, 0x00, 0x7f]), // 0x7F000000 LE
    /** Double missing: IEEE 754 bit patterns (LE). */
    double_dot_buf: (() => {
        const b = Buffer.alloc(8);
        // 0x7FE0_0000_0000_0000 in LE
        b[0] = 0x00;
        b[1] = 0x00;
        b[2] = 0x00;
        b[3] = 0x00;
        b[4] = 0x00;
        b[5] = 0x00;
        b[6] = 0xe0;
        b[7] = 0x7f;
        return b;
    })(),
} as const;

/** Return 8-byte LE buffer for double-missing with code offset (0=., 1=.a, .. 26=.z). */
function double_missing_buf(offset: number): Buffer {
    const b = Buffer.alloc(8);
    // Base: 0x7FE0_0000_0000_0000
    // With offset in lowest bytes.
    // LE layout: bytes [0..7] = 0x00 + offset, 0x00, 0x00, 0x00, 0x00, 0x00, 0xE0, 0x7F
    b.writeUInt8(offset, 0);
    b[6] = 0xe0;
    b[7] = 0x7f;
    return b;
}

/** Return 4-byte LE buffer for float-missing with code offset (0=., 1=.a, .. 26=.z). */
function float_missing_buf(offset: number): Buffer {
    const b = Buffer.alloc(4);
    // Base: 0x7F00_0000, offset goes in byte[1] for the sub-type.
    // Actually the Stata spec says 0x7F000000 for ., incrementing.
    // The increments are in the mantissa bits.
    // 0x7F000000 + (offset << 11)  -- each .a step is 0x800 apart in the
    // 32-bit representation.  Simpler: treat as uint32 LE.
    // Stata encodes float missing as: 0x7F000000 for ., then 0x7F000100 for .a
    // i.e., the low two bytes hold the offset in big-endian within the float.
    // In little-endian storage the bytes for . are 00 00 00 7F.
    // For .a: 00 01 00 7F   (i.e. byte[1] = offset).
    b[1] = offset;
    b[3] = 0x7f;
    return b;
}

// ---------------------------------------------------------------------------
// Variable definition helpers
// ---------------------------------------------------------------------------

interface VarDef {
    name: string;
    type_code: number;
    format: string;
    label: string;
    value_label_name: string;
}

// ---------------------------------------------------------------------------
// Value-label table builder
// ---------------------------------------------------------------------------

interface ValueLabelEntry {
    value: number;
    label: string;
}

interface ValueLabelTable {
    name: string;
    entries: ValueLabelEntry[];
}

function build_value_label_block(
    the_tables: ValueLabelTable[],
    name_width: number,
): Buffer {
    const the_parts: Buffer[] = [];
    for (const my_table of the_tables) {
        const my_lbl = build_single_lbl(my_table, name_width);
        the_parts.push(my_lbl);
    }
    return Buffer.concat(the_parts);
}

function build_single_lbl(
    table: ValueLabelTable,
    name_width: number,
): Buffer {
    const n = table.entries.length;

    // Build text block: concatenated null-terminated strings.
    const the_text_parts: Buffer[] = [];
    const the_offsets: number[] = [];
    let txt_offset = 0;
    for (const my_entry of table.entries) {
        the_offsets.push(txt_offset);
        const my_str_buf = Buffer.from(my_entry.label + "\0", "utf-8");
        the_text_parts.push(my_str_buf);
        txt_offset += my_str_buf.length;
    }
    const text_buf = Buffer.concat(the_text_parts);
    const txt_len = text_buf.length;

    // table_length = 4 (n) + 4 (txt_len) + 4*n (offsets) + 4*n (values) + txt_len
    const table_length = 4 + 4 + 4 * n + 4 * n + txt_len;

    // Build the <lbl>...</lbl> block.
    const lbl_open = Buffer.from("<lbl>", "utf-8");
    const lbl_close = Buffer.from("</lbl>", "utf-8");

    // Content: table_length(4) + name(name_width) + padding(3) + n(4) + txt_len(4) + offsets + values + text
    const content_size = 4 + name_width + 3 + 4 + 4 + 4 * n + 4 * n + txt_len;
    const content = zero_buffer(content_size);
    let pos = 0;

    content.writeInt32LE(table_length, pos);
    pos += 4;
    write_fixed_string(content, pos, table.name, name_width);
    pos += name_width;
    // 3 bytes padding (already zero)
    pos += 3;
    content.writeInt32LE(n, pos);
    pos += 4;
    content.writeInt32LE(txt_len, pos);
    pos += 4;
    for (let i = 0; i < n; i++) {
        content.writeInt32LE(the_offsets[i], pos);
        pos += 4;
    }
    for (let i = 0; i < n; i++) {
        content.writeInt32LE(table.entries[i].value, pos);
        pos += 4;
    }
    text_buf.copy(content, pos);

    return Buffer.concat([lbl_open, content, lbl_close]);
}

// ---------------------------------------------------------------------------
// GSO (strL) entry builder
// ---------------------------------------------------------------------------

interface GsoEntry {
    /** 1-indexed variable number. */
    v: number;
    /** 1-indexed observation number. */
    o: number;
    content: string;
}

function build_gso_block_v118(the_entries: GsoEntry[]): Buffer {
    const the_parts: Buffer[] = [];
    for (const my_entry of the_entries) {
        const my_content_buf = Buffer.from(my_entry.content + "\0", "utf-8");
        const my_len = my_content_buf.length;
        // GSO(3) + v(4) + o(8) + type(1) + len(4) + content
        const my_buf = Buffer.alloc(3 + 4 + 8 + 1 + 4 + my_len);
        let pos = 0;
        my_buf.write("GSO", pos, 3, "utf-8");
        pos += 3;
        my_buf.writeUInt32LE(my_entry.v, pos);
        pos += 4;
        // o as uint64 LE (write low 32 bits, high 32 bits)
        my_buf.writeUInt32LE(my_entry.o & 0xffffffff, pos);
        pos += 4;
        my_buf.writeUInt32LE(0, pos); // high 32 bits
        pos += 4;
        my_buf.writeUInt8(130, pos); // 130 = ASCII
        pos += 1;
        my_buf.writeUInt32LE(my_len, pos);
        pos += 4;
        my_content_buf.copy(my_buf, pos);
        the_parts.push(my_buf);
    }
    return Buffer.concat(the_parts);
}

function build_gso_block_v117(the_entries: GsoEntry[]): Buffer {
    const the_parts: Buffer[] = [];
    for (const my_entry of the_entries) {
        const my_content_buf = Buffer.from(my_entry.content + "\0", "utf-8");
        const my_len = my_content_buf.length;
        // GSO(3) + v(4) + o(4) + type(1) + len(4) + content
        const my_buf = Buffer.alloc(3 + 4 + 4 + 1 + 4 + my_len);
        let pos = 0;
        my_buf.write("GSO", pos, 3, "utf-8");
        pos += 3;
        my_buf.writeUInt32LE(my_entry.v, pos);
        pos += 4;
        my_buf.writeUInt32LE(my_entry.o, pos);
        pos += 4;
        my_buf.writeUInt8(130, pos); // 130 = ASCII
        pos += 1;
        my_buf.writeUInt32LE(my_len, pos);
        pos += 4;
        my_content_buf.copy(my_buf, pos);
        the_parts.push(my_buf);
    }
    return Buffer.concat(the_parts);
}

// ---------------------------------------------------------------------------
// Main .dta file builder
// ---------------------------------------------------------------------------

interface DtaSpec {
    release: "117" | "118";
    byte_order: "LSF";
    the_vars: VarDef[];
    num_obs: number;
    dataset_label: string;
    timestamp: string;
    /** Row writer: called for each observation, writes fixed-width row into buf at offset. */
    write_row: (buf: Buffer, offset: number, obs_index: number) => void;
    /** GSO entries for strL variables. */
    the_gso_entries?: GsoEntry[];
    /** Value label tables. */
    the_value_label_tables?: ValueLabelTable[];
}

function build_dta(spec: DtaSpec): Buffer {
    const is_v118 = spec.release === "118";
    const num_vars = spec.the_vars.length;
    const num_obs = spec.num_obs;

    // Field widths depend on version.
    const varname_width = is_v118 ? 129 : 33;
    const format_width = is_v118 ? 57 : 49;
    const vallbl_name_width = is_v118 ? 129 : 33;
    const varlabel_width = is_v118 ? 321 : 81;

    const type_width_fn = is_v118 ? type_width_v118 : type_width_v117;

    // Compute observation length.
    let obs_len = 0;
    for (const my_var of spec.the_vars) {
        obs_len += type_width_fn(my_var.type_code);
    }

    // ------------------------------------------------------------------
    // Build each section as a Buffer, then compute map offsets.
    // ------------------------------------------------------------------

    // --- Header ---
    const header_release = Buffer.from(
        `<release>${spec.release}</release>`,
        "utf-8",
    );
    const header_byteorder = Buffer.from(
        `<byteorder>${spec.byte_order}</byteorder>`,
        "utf-8",
    );

    // <K>uint16</K>
    const k_buf = zero_buffer(2);
    k_buf.writeUInt16LE(num_vars, 0);
    const header_k = Buffer.concat([
        Buffer.from("<K>", "utf-8"),
        k_buf,
        Buffer.from("</K>", "utf-8"),
    ]);

    // <N>uint32 or uint64</N>
    let n_buf: Buffer;
    if (is_v118) {
        n_buf = zero_buffer(4);
        n_buf.writeUInt32LE(num_obs, 0);
    } else {
        n_buf = zero_buffer(4);
        n_buf.writeUInt32LE(num_obs, 0);
    }
    const header_n = Buffer.concat([
        Buffer.from("<N>", "utf-8"),
        n_buf,
        Buffer.from("</N>", "utf-8"),
    ]);

    // <label>uint16 + bytes</label>
    const label_str_buf = Buffer.from(spec.dataset_label, "utf-8");
    const label_len_buf = zero_buffer(is_v118 ? 2 : 2);
    label_len_buf.writeUInt16LE(label_str_buf.length, 0);
    const header_label = Buffer.concat([
        Buffer.from("<label>", "utf-8"),
        label_len_buf,
        label_str_buf,
        Buffer.from("</label>", "utf-8"),
    ]);

    // <timestamp>uint8 + bytes</timestamp>
    const ts_str_buf = Buffer.from(spec.timestamp, "utf-8");
    const ts_len_buf = zero_buffer(1);
    ts_len_buf.writeUInt8(ts_str_buf.length, 0);
    const header_timestamp = Buffer.concat([
        Buffer.from("<timestamp>", "utf-8"),
        ts_len_buf,
        ts_str_buf,
        Buffer.from("</timestamp>", "utf-8"),
    ]);

    const header_open = Buffer.from("<header>", "utf-8");
    const header_close = Buffer.from("</header>", "utf-8");
    const header_section = Buffer.concat([
        header_open,
        header_release,
        header_byteorder,
        header_k,
        header_n,
        header_label,
        header_timestamp,
        header_close,
    ]);

    // --- Map placeholder (will be filled after we know all offsets) ---
    const map_open = Buffer.from("<map>", "utf-8");
    const map_close = Buffer.from("</map>", "utf-8");
    const map_data = zero_buffer(14 * 8); // 14 uint64 LE values
    const map_section = Buffer.concat([map_open, map_data, map_close]);

    // --- Variable types ---
    const vt_open = Buffer.from("<variable_types>", "utf-8");
    const vt_close = Buffer.from("</variable_types>", "utf-8");
    const vt_data = zero_buffer(num_vars * 2);
    for (let i = 0; i < num_vars; i++) {
        vt_data.writeUInt16LE(spec.the_vars[i].type_code, i * 2);
    }
    const vt_section = Buffer.concat([vt_open, vt_data, vt_close]);

    // --- Varnames ---
    const vn_open = Buffer.from("<varnames>", "utf-8");
    const vn_close = Buffer.from("</varnames>", "utf-8");
    const vn_data = zero_buffer(num_vars * varname_width);
    for (let i = 0; i < num_vars; i++) {
        write_fixed_string(
            vn_data,
            i * varname_width,
            spec.the_vars[i].name,
            varname_width,
        );
    }
    const vn_section = Buffer.concat([vn_open, vn_data, vn_close]);

    // --- Sortlist ---
    const sl_open = Buffer.from("<sortlist>", "utf-8");
    const sl_close = Buffer.from("</sortlist>", "utf-8");
    const sl_data = zero_buffer((num_vars + 1) * 2);
    const sl_section = Buffer.concat([sl_open, sl_data, sl_close]);

    // --- Formats ---
    const fmt_open = Buffer.from("<formats>", "utf-8");
    const fmt_close = Buffer.from("</formats>", "utf-8");
    const fmt_data = zero_buffer(num_vars * format_width);
    for (let i = 0; i < num_vars; i++) {
        write_fixed_string(
            fmt_data,
            i * format_width,
            spec.the_vars[i].format,
            format_width,
        );
    }
    const fmt_section = Buffer.concat([fmt_open, fmt_data, fmt_close]);

    // --- Value label names ---
    const vln_open = Buffer.from("<value_label_names>", "utf-8");
    const vln_close = Buffer.from("</value_label_names>", "utf-8");
    const vln_data = zero_buffer(num_vars * vallbl_name_width);
    for (let i = 0; i < num_vars; i++) {
        write_fixed_string(
            vln_data,
            i * vallbl_name_width,
            spec.the_vars[i].value_label_name,
            vallbl_name_width,
        );
    }
    const vln_section = Buffer.concat([vln_open, vln_data, vln_close]);

    // --- Variable labels ---
    const vl_open = Buffer.from("<variable_labels>", "utf-8");
    const vl_close = Buffer.from("</variable_labels>", "utf-8");
    const vl_data = zero_buffer(num_vars * varlabel_width);
    for (let i = 0; i < num_vars; i++) {
        write_fixed_string(
            vl_data,
            i * varlabel_width,
            spec.the_vars[i].label,
            varlabel_width,
        );
    }
    const vl_section = Buffer.concat([vl_open, vl_data, vl_close]);

    // --- Characteristics (empty) ---
    const ch_open = Buffer.from("<characteristics>", "utf-8");
    const ch_close = Buffer.from("</characteristics>", "utf-8");
    const ch_section = Buffer.concat([ch_open, ch_close]);

    // --- Data ---
    const data_open = Buffer.from("<data>", "utf-8");
    const data_close = Buffer.from("</data>", "utf-8");
    const data_buf = zero_buffer(num_obs * obs_len);
    for (let i = 0; i < num_obs; i++) {
        spec.write_row(data_buf, i * obs_len, i);
    }
    const data_section = Buffer.concat([data_open, data_buf, data_close]);

    // --- strls ---
    const strls_open = Buffer.from("<strls>", "utf-8");
    const strls_close = Buffer.from("</strls>", "utf-8");
    let strls_data = Buffer.alloc(0);
    if (spec.the_gso_entries && spec.the_gso_entries.length > 0) {
        strls_data = is_v118
            ? build_gso_block_v118(spec.the_gso_entries)
            : build_gso_block_v117(spec.the_gso_entries);
    }
    const strls_section = Buffer.concat([strls_open, strls_data, strls_close]);

    // --- Value labels ---
    const vallbl_open = Buffer.from("<value_labels>", "utf-8");
    const vallbl_close = Buffer.from("</value_labels>", "utf-8");
    let vallbl_data = Buffer.alloc(0);
    if (
        spec.the_value_label_tables &&
        spec.the_value_label_tables.length > 0
    ) {
        vallbl_data = build_value_label_block(
            spec.the_value_label_tables,
            vallbl_name_width,
        );
    }
    const vallbl_section = Buffer.concat([
        vallbl_open,
        vallbl_data,
        vallbl_close,
    ]);

    // --- File wrapper ---
    const file_open = Buffer.from("<stata_dta>", "utf-8");
    const file_close = Buffer.from("</stata_dta>", "utf-8");

    // Assemble all sections in order to compute map offsets.
    // Note: the map section contains a placeholder (all zeros) that we
    // patch in-place after concatenation.
    const the_sections = [
        file_open, // idx 0:  <stata_dta>
        header_section, // idx 1:  <header>...</header>
        map_section, // idx 2:  <map>...(zeros)...</map>
        vt_section, // idx 3:  <variable_types>
        vn_section, // idx 4:  <varnames>
        sl_section, // idx 5:  <sortlist>
        fmt_section, // idx 6:  <formats>
        vln_section, // idx 7:  <value_label_names>
        vl_section, // idx 8:  <variable_labels>
        ch_section, // idx 9:  <characteristics>
        data_section, // idx 10: <data>
        strls_section, // idx 11: <strls>
        vallbl_section, // idx 12: <value_labels>
        file_close, // idx 13: </stata_dta>
    ];

    // Compute cumulative byte offsets for each section.
    const the_section_offsets: number[] = [];
    let cumulative = 0;
    for (const my_section of the_sections) {
        the_section_offsets.push(cumulative);
        cumulative += my_section.length;
    }
    const total_file_length = cumulative;

    // Map the 14 map entries to section indices:
    //  map[0]  = stata_data       -> section 0  (<stata_dta>)
    //  map[1]  = map              -> section 2  (<map>)
    //  map[2]  = variable_types   -> section 3
    //  map[3]  = varnames         -> section 4
    //  map[4]  = sortlist         -> section 5
    //  map[5]  = formats          -> section 6
    //  map[6]  = value_label_names -> section 7
    //  map[7]  = variable_labels  -> section 8
    //  map[8]  = characteristics  -> section 9
    //  map[9]  = data             -> section 10
    //  map[10] = strls            -> section 11
    //  map[11] = value_labels     -> section 12
    //  map[12] = stata_data_close -> section 13 (</stata_dta>)
    //  map[13] = end_of_file      -> total_file_length
    const the_map_section_indices = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

    // Concatenate everything into one buffer first (map area is zeros).
    const result = Buffer.concat(the_sections);

    // Now patch the map data in-place inside the final buffer.
    // The map data starts at: offset-of-map-section + length-of-"<map>"-tag.
    const map_data_offset = the_section_offsets[2] + map_open.length;

    for (let i = 0; i < 13; i++) {
        const my_offset = the_section_offsets[the_map_section_indices[i]];
        result.writeUInt32LE(my_offset & 0xffffffff, map_data_offset + i * 8);
        result.writeUInt32LE(
            Math.floor(my_offset / 0x100000000),
            map_data_offset + i * 8 + 4,
        );
    }
    // Entry 13: end of file.
    result.writeUInt32LE(
        total_file_length & 0xffffffff,
        map_data_offset + 13 * 8,
    );
    result.writeUInt32LE(
        Math.floor(total_file_length / 0x100000000),
        map_data_offset + 13 * 8 + 4,
    );

    return result;
}

// ---------------------------------------------------------------------------
// Data helper: write typed value into buffer
// ---------------------------------------------------------------------------

function write_byte(buf: Buffer, offset: number, value: number): void {
    buf.writeInt8(value, offset);
}

function write_int16(buf: Buffer, offset: number, value: number): void {
    buf.writeInt16LE(value, offset);
}

function write_int32(buf: Buffer, offset: number, value: number): void {
    buf.writeInt32LE(value, offset);
}

function write_float(buf: Buffer, offset: number, value: number): void {
    buf.writeFloatLE(value, offset);
}

function write_double(buf: Buffer, offset: number, value: number): void {
    buf.writeDoubleLE(value, offset);
}

function write_str(
    buf: Buffer,
    offset: number,
    value: string,
    width: number,
): void {
    write_fixed_string(buf, offset, value, width);
}

/** Write a strL pointer (v, o) as 8 bytes in v118 format. */
function write_strl_ref_v118(
    buf: Buffer,
    offset: number,
    v: number,
    o: number,
): void {
    buf.writeUInt32LE(v, offset);
    buf.writeUInt32LE(o, offset + 4);
}

// ---------------------------------------------------------------------------
// Fixture 1: auto_v118.dta
// ---------------------------------------------------------------------------

interface AutoRow {
    make: string;
    price: number;
    mpg: number;
    rep78: number | null; // null = missing
    headroom: number;
    trunk: number;
    weight: number;
    length_in: number;
    turn: number;
    displacement: number;
    gear_ratio: number;
    foreign: number; // 0=Domestic, 1=Foreign
}

const THE_AUTO_ROWS: AutoRow[] = [
    { make: "AMC Concord", price: 4099, mpg: 22, rep78: 3, headroom: 2.5, trunk: 11, weight: 2930, length_in: 186, turn: 40, displacement: 121, gear_ratio: 3.58, foreign: 0 },
    { make: "AMC Pacer", price: 4749, mpg: 17, rep78: 3, headroom: 3.0, trunk: 11, weight: 3350, length_in: 173, turn: 40, displacement: 258, gear_ratio: 2.53, foreign: 0 },
    { make: "AMC Spirit", price: 3799, mpg: 22, rep78: null, headroom: 3.0, trunk: 12, weight: 2640, length_in: 168, turn: 35, displacement: 121, gear_ratio: 3.08, foreign: 0 },
    { make: "Buick Century", price: 4816, mpg: 20, rep78: 3, headroom: 4.5, trunk: 16, weight: 3250, length_in: 196, turn: 40, displacement: 196, gear_ratio: 2.93, foreign: 0 },
    { make: "Buick Electra", price: 7827, mpg: 15, rep78: 4, headroom: 4.0, trunk: 20, weight: 4080, length_in: 222, turn: 43, displacement: 350, gear_ratio: 2.41, foreign: 0 },
    { make: "Buick LeSabre", price: 5788, mpg: 18, rep78: 3, headroom: 4.0, trunk: 21, weight: 3670, length_in: 218, turn: 43, displacement: 231, gear_ratio: 2.73, foreign: 0 },
    { make: "Buick Opel", price: 4453, mpg: 26, rep78: null, headroom: 3.0, trunk: 10, weight: 2230, length_in: 170, turn: 34, displacement: 304, gear_ratio: 2.87, foreign: 0 },
    { make: "Buick Regal", price: 5189, mpg: 20, rep78: 3, headroom: 2.0, trunk: 16, weight: 3280, length_in: 200, turn: 42, displacement: 196, gear_ratio: 2.93, foreign: 0 },
    { make: "Buick Riviera", price: 10372, mpg: 16, rep78: 3, headroom: 3.5, trunk: 17, weight: 3880, length_in: 207, turn: 43, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Buick Skylark", price: 4082, mpg: 19, rep78: 3, headroom: 3.5, trunk: 13, weight: 3400, length_in: 200, turn: 42, displacement: 231, gear_ratio: 3.08, foreign: 0 },
    { make: "Cad. Deville", price: 11385, mpg: 14, rep78: 3, headroom: 4.0, trunk: 20, weight: 4330, length_in: 221, turn: 44, displacement: 425, gear_ratio: 2.28, foreign: 0 },
    { make: "Cad. Eldorado", price: 14500, mpg: 14, rep78: 2, headroom: 3.5, trunk: 16, weight: 3900, length_in: 204, turn: 43, displacement: 350, gear_ratio: 2.19, foreign: 0 },
    { make: "Cad. Seville", price: 15906, mpg: 21, rep78: 3, headroom: 3.0, trunk: 13, weight: 4290, length_in: 204, turn: 45, displacement: 350, gear_ratio: 2.24, foreign: 0 },
    { make: "Chev. Chevette", price: 3299, mpg: 29, rep78: 3, headroom: 2.5, trunk: 9, weight: 2110, length_in: 163, turn: 34, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Chev. Impala", price: 5705, mpg: 16, rep78: 4, headroom: 4.0, trunk: 20, weight: 3690, length_in: 212, turn: 43, displacement: 250, gear_ratio: 2.56, foreign: 0 },
    { make: "Chev. Malibu", price: 4504, mpg: 22, rep78: 3, headroom: 3.5, trunk: 17, weight: 3180, length_in: 193, turn: 31, displacement: 200, gear_ratio: 2.73, foreign: 0 },
    { make: "Chev. Monte Carlo", price: 5104, mpg: 22, rep78: 2, headroom: 2.0, trunk: 16, weight: 3220, length_in: 200, turn: 41, displacement: 200, gear_ratio: 2.73, foreign: 0 },
    { make: "Chev. Monza", price: 3667, mpg: 24, rep78: 2, headroom: 2.0, trunk: 7, weight: 2750, length_in: 179, turn: 40, displacement: 151, gear_ratio: 2.73, foreign: 0 },
    { make: "Chev. Nova", price: 3955, mpg: 19, rep78: 3, headroom: 3.5, trunk: 13, weight: 3430, length_in: 197, turn: 43, displacement: 250, gear_ratio: 2.56, foreign: 0 },
    { make: "Dodge Colt", price: 3984, mpg: 30, rep78: 5, headroom: 2.0, trunk: 8, weight: 2120, length_in: 163, turn: 35, displacement: 98, gear_ratio: 3.54, foreign: 0 },
    { make: "Dodge Diplomat", price: 4010, mpg: 18, rep78: 2, headroom: 4.0, trunk: 17, weight: 3600, length_in: 206, turn: 46, displacement: 318, gear_ratio: 2.47, foreign: 0 },
    { make: "Dodge Magnum", price: 5886, mpg: 16, rep78: 2, headroom: 4.0, trunk: 17, weight: 3600, length_in: 206, turn: 46, displacement: 318, gear_ratio: 2.47, foreign: 0 },
    { make: "Dodge St. Regis", price: 6342, mpg: 17, rep78: 2, headroom: 4.5, trunk: 21, weight: 3740, length_in: 220, turn: 46, displacement: 225, gear_ratio: 2.94, foreign: 0 },
    { make: "Ford Fiesta", price: 4389, mpg: 28, rep78: 4, headroom: 1.5, trunk: 9, weight: 1800, length_in: 147, turn: 33, displacement: 98, gear_ratio: 3.15, foreign: 0 },
    { make: "Ford Mustang", price: 4187, mpg: 21, rep78: 3, headroom: 2.0, trunk: 10, weight: 2650, length_in: 179, turn: 43, displacement: 140, gear_ratio: 3.08, foreign: 0 },
    { make: "Linc. Continental", price: 11497, mpg: 12, rep78: 3, headroom: 3.5, trunk: 22, weight: 4840, length_in: 233, turn: 51, displacement: 400, gear_ratio: 2.47, foreign: 0 },
    { make: "Linc. Mark V", price: 13594, mpg: 12, rep78: 3, headroom: 2.5, trunk: 18, weight: 4720, length_in: 230, turn: 48, displacement: 400, gear_ratio: 2.47, foreign: 0 },
    { make: "Linc. Versailles", price: 13466, mpg: 14, rep78: 3, headroom: 3.5, trunk: 15, weight: 3830, length_in: 201, turn: 41, displacement: 302, gear_ratio: 2.47, foreign: 0 },
    { make: "Merc. Bobcat", price: 3829, mpg: 22, rep78: 4, headroom: 3.0, trunk: 9, weight: 2580, length_in: 169, turn: 39, displacement: 140, gear_ratio: 2.73, foreign: 0 },
    { make: "Merc. Cougar", price: 5379, mpg: 14, rep78: 4, headroom: 3.5, trunk: 16, weight: 4060, length_in: 221, turn: 48, displacement: 302, gear_ratio: 2.75, foreign: 0 },
    { make: "Merc. Marquis", price: 6165, mpg: 15, rep78: 3, headroom: 3.5, trunk: 23, weight: 3720, length_in: 212, turn: 44, displacement: 302, gear_ratio: 2.26, foreign: 0 },
    { make: "Merc. Monarch", price: 4516, mpg: 18, rep78: 3, headroom: 3.0, trunk: 15, weight: 3370, length_in: 198, turn: 41, displacement: 250, gear_ratio: 2.43, foreign: 0 },
    { make: "Merc. XR-7", price: 6303, mpg: 14, rep78: 4, headroom: 3.0, trunk: 16, weight: 4130, length_in: 217, turn: 45, displacement: 302, gear_ratio: 2.75, foreign: 0 },
    { make: "Merc. Zephyr", price: 3291, mpg: 20, rep78: 3, headroom: 3.5, trunk: 17, weight: 2830, length_in: 195, turn: 43, displacement: 140, gear_ratio: 3.08, foreign: 0 },
    { make: "Olds 98", price: 8814, mpg: 21, rep78: 4, headroom: 4.0, trunk: 20, weight: 4060, length_in: 220, turn: 43, displacement: 350, gear_ratio: 2.41, foreign: 0 },
    { make: "Olds Cutl Supr", price: 5172, mpg: 19, rep78: 3, headroom: 2.0, trunk: 16, weight: 3310, length_in: 198, turn: 42, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Olds Cutlass", price: 4733, mpg: 19, rep78: 3, headroom: 4.5, trunk: 16, weight: 3300, length_in: 198, turn: 42, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Olds Delta 88", price: 4890, mpg: 18, rep78: 4, headroom: 4.0, trunk: 20, weight: 3690, length_in: 218, turn: 42, displacement: 231, gear_ratio: 2.73, foreign: 0 },
    { make: "Olds Omega", price: 4181, mpg: 19, rep78: 3, headroom: 4.5, trunk: 14, weight: 3370, length_in: 200, turn: 43, displacement: 231, gear_ratio: 3.08, foreign: 0 },
    { make: "Olds Starfire", price: 4195, mpg: 24, rep78: 1, headroom: 2.0, trunk: 10, weight: 2730, length_in: 180, turn: 40, displacement: 151, gear_ratio: 2.73, foreign: 0 },
    { make: "Olds Toronado", price: 10371, mpg: 16, rep78: 3, headroom: 3.5, trunk: 17, weight: 4030, length_in: 206, turn: 43, displacement: 350, gear_ratio: 2.41, foreign: 0 },
    { make: "Plym. Arrow", price: 4647, mpg: 28, rep78: 3, headroom: 2.0, trunk: 11, weight: 3260, length_in: 170, turn: 37, displacement: 156, gear_ratio: 3.05, foreign: 0 },
    { make: "Plym. Champ", price: 4425, mpg: 34, rep78: 5, headroom: 2.5, trunk: 11, weight: 1800, length_in: 157, turn: 33, displacement: 86, gear_ratio: 2.97, foreign: 0 },
    { make: "Plym. Horizon", price: 4482, mpg: 25, rep78: 3, headroom: 4.0, trunk: 17, weight: 2200, length_in: 165, turn: 36, displacement: 105, gear_ratio: 3.37, foreign: 0 },
    { make: "Plym. Sapporo", price: 6486, mpg: 26, rep78: null, headroom: 1.5, trunk: 8, weight: 2520, length_in: 182, turn: 38, displacement: 119, gear_ratio: 3.54, foreign: 0 },
    { make: "Plym. Volare", price: 4060, mpg: 18, rep78: 2, headroom: 5.0, trunk: 16, weight: 3330, length_in: 201, turn: 44, displacement: 225, gear_ratio: 3.23, foreign: 0 },
    { make: "Pont. Catalina", price: 5798, mpg: 18, rep78: 4, headroom: 4.0, trunk: 20, weight: 3700, length_in: 214, turn: 42, displacement: 231, gear_ratio: 2.73, foreign: 0 },
    { make: "Pont. Firebird", price: 4934, mpg: 18, rep78: 1, headroom: 1.5, trunk: 7, weight: 3470, length_in: 198, turn: 42, displacement: 231, gear_ratio: 3.08, foreign: 0 },
    { make: "Pont. Grand Prix", price: 5222, mpg: 19, rep78: 3, headroom: 2.0, trunk: 16, weight: 3210, length_in: 201, turn: 45, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Pont. Le Mans", price: 4723, mpg: 19, rep78: 3, headroom: 3.5, trunk: 17, weight: 3200, length_in: 199, turn: 40, displacement: 231, gear_ratio: 2.93, foreign: 0 },
    { make: "Pont. Phoenix", price: 4424, mpg: 19, rep78: null, headroom: 3.5, trunk: 13, weight: 3420, length_in: 203, turn: 43, displacement: 231, gear_ratio: 3.08, foreign: 0 },
    { make: "Pont. Sunbird", price: 4172, mpg: 24, rep78: 2, headroom: 2.0, trunk: 7, weight: 2690, length_in: 179, turn: 41, displacement: 151, gear_ratio: 2.73, foreign: 0 },
    // Foreign cars
    { make: "Audi 5000", price: 9690, mpg: 17, rep78: 5, headroom: 3.0, trunk: 15, weight: 2830, length_in: 189, turn: 37, displacement: 131, gear_ratio: 3.20, foreign: 1 },
    { make: "Audi Fox", price: 6295, mpg: 23, rep78: 3, headroom: 2.5, trunk: 11, weight: 2070, length_in: 174, turn: 36, displacement: 97, gear_ratio: 3.70, foreign: 1 },
    { make: "BMW 320i", price: 9735, mpg: 25, rep78: 4, headroom: 2.5, trunk: 12, weight: 2650, length_in: 177, turn: 34, displacement: 121, gear_ratio: 3.64, foreign: 1 },
    { make: "Datsun 200", price: 6229, mpg: 23, rep78: 4, headroom: 1.5, trunk: 6, weight: 2370, length_in: 170, turn: 35, displacement: 119, gear_ratio: 3.89, foreign: 1 },
    { make: "Datsun 210", price: 4589, mpg: 35, rep78: 5, headroom: 2.0, trunk: 8, weight: 2020, length_in: 165, turn: 32, displacement: 85, gear_ratio: 3.70, foreign: 1 },
    { make: "Datsun 510", price: 5079, mpg: 24, rep78: 4, headroom: 2.5, trunk: 8, weight: 2280, length_in: 170, turn: 34, displacement: 119, gear_ratio: 3.54, foreign: 1 },
    { make: "Datsun 810", price: 8129, mpg: 21, rep78: 4, headroom: 2.5, trunk: 8, weight: 2750, length_in: 184, turn: 38, displacement: 146, gear_ratio: 3.55, foreign: 1 },
    { make: "Fiat Strada", price: 4296, mpg: 21, rep78: 3, headroom: 2.5, trunk: 16, weight: 2130, length_in: 161, turn: 36, displacement: 105, gear_ratio: 3.37, foreign: 1 },
    { make: "Honda Accord", price: 5799, mpg: 25, rep78: 5, headroom: 3.0, trunk: 10, weight: 2240, length_in: 172, turn: 36, displacement: 107, gear_ratio: 3.05, foreign: 1 },
    { make: "Honda Civic", price: 4499, mpg: 28, rep78: 4, headroom: 2.5, trunk: 5, weight: 1760, length_in: 149, turn: 34, displacement: 91, gear_ratio: 3.30, foreign: 1 },
    { make: "Mazda GLC", price: 3995, mpg: 30, rep78: 4, headroom: 3.5, trunk: 11, weight: 1980, length_in: 154, turn: 33, displacement: 86, gear_ratio: 3.73, foreign: 1 },
    { make: "Peugeot 604", price: 12990, mpg: 14, rep78: null, headroom: 3.5, trunk: 14, weight: 3420, length_in: 192, turn: 38, displacement: 163, gear_ratio: 3.58, foreign: 1 },
    { make: "Renault Le Car", price: 3895, mpg: 26, rep78: 3, headroom: 3.0, trunk: 10, weight: 1830, length_in: 142, turn: 34, displacement: 79, gear_ratio: 3.72, foreign: 1 },
    { make: "Subaru", price: 3798, mpg: 35, rep78: 5, headroom: 2.5, trunk: 11, weight: 2050, length_in: 164, turn: 36, displacement: 97, gear_ratio: 3.81, foreign: 1 },
    { make: "Toyota Celica", price: 5899, mpg: 18, rep78: 5, headroom: 2.5, trunk: 14, weight: 2410, length_in: 174, turn: 36, displacement: 134, gear_ratio: 3.06, foreign: 1 },
    { make: "Toyota Corolla", price: 3748, mpg: 31, rep78: 5, headroom: 3.0, trunk: 9, weight: 2200, length_in: 165, turn: 35, displacement: 97, gear_ratio: 3.21, foreign: 1 },
    { make: "Toyota Corona", price: 5719, mpg: 18, rep78: 5, headroom: 2.0, trunk: 11, weight: 2670, length_in: 175, turn: 36, displacement: 134, gear_ratio: 3.05, foreign: 1 },
    { make: "VW Dasher", price: 7140, mpg: 23, rep78: 4, headroom: 2.5, trunk: 12, weight: 2160, length_in: 172, turn: 36, displacement: 97, gear_ratio: 3.74, foreign: 1 },
    { make: "VW Diesel", price: 5397, mpg: 41, rep78: 5, headroom: 3.0, trunk: 15, weight: 2040, length_in: 155, turn: 35, displacement: 90, gear_ratio: 3.78, foreign: 1 },
    { make: "VW Rabbit", price: 4697, mpg: 25, rep78: 4, headroom: 3.0, trunk: 15, weight: 1930, length_in: 155, turn: 35, displacement: 89, gear_ratio: 3.78, foreign: 1 },
    { make: "VW Scirocco", price: 6850, mpg: 25, rep78: 4, headroom: 2.0, trunk: 16, weight: 1990, length_in: 156, turn: 36, displacement: 97, gear_ratio: 3.78, foreign: 1 },
    { make: "Volvo 260", price: 11995, mpg: 17, rep78: 5, headroom: 2.5, trunk: 14, weight: 3170, length_in: 193, turn: 37, displacement: 163, gear_ratio: 2.98, foreign: 1 },
];

function build_auto_v118(): Buffer {
    const the_vars: VarDef[] = [
        { name: "make", type_code: TYPE_V118.str(18), format: "%18s", label: "Make and model", value_label_name: "" },
        { name: "price", type_code: TYPE_V118.int, format: "%8.0gc", label: "Price", value_label_name: "" },
        { name: "mpg", type_code: TYPE_V118.int, format: "%8.0g", label: "Mileage (mpg)", value_label_name: "" },
        { name: "rep78", type_code: TYPE_V118.int, format: "%8.0g", label: "Repair record 1978", value_label_name: "" },
        { name: "headroom", type_code: TYPE_V118.float, format: "%6.1f", label: "Headroom (in.)", value_label_name: "" },
        { name: "trunk", type_code: TYPE_V118.int, format: "%8.0g", label: "Trunk space (cu. ft.)", value_label_name: "" },
        { name: "weight", type_code: TYPE_V118.int, format: "%8.0gc", label: "Weight (lbs.)", value_label_name: "" },
        { name: "length", type_code: TYPE_V118.int, format: "%8.0g", label: "Length (in.)", value_label_name: "" },
        { name: "turn", type_code: TYPE_V118.int, format: "%8.0g", label: "Turn circle (ft.)", value_label_name: "" },
        { name: "displacement", type_code: TYPE_V118.int, format: "%8.0g", label: "Displacement (cu. in.)", value_label_name: "" },
        { name: "gear_ratio", type_code: TYPE_V118.float, format: "%6.2f", label: "Gear ratio", value_label_name: "" },
        { name: "foreign", type_code: TYPE_V118.byte, format: "%8.0g", label: "Car origin", value_label_name: "origin" },
    ];

    // Compute per-variable offsets within a row.
    const the_var_offsets: number[] = [];
    let row_offset = 0;
    for (const my_var of the_vars) {
        the_var_offsets.push(row_offset);
        row_offset += type_width_v118(my_var.type_code);
    }

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: THE_AUTO_ROWS.length,
        dataset_label: "1978 automobile data",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            const my_row = THE_AUTO_ROWS[obs_index];
            let pos = offset;
            // make (str18)
            write_str(buf, pos, my_row.make, 18);
            pos += 18;
            // price (int)
            write_int16(buf, pos, my_row.price);
            pos += 2;
            // mpg (int)
            write_int16(buf, pos, my_row.mpg);
            pos += 2;
            // rep78 (int, possibly missing)
            write_int16(buf, pos, my_row.rep78 === null ? MISSING.int.dot : my_row.rep78);
            pos += 2;
            // headroom (float)
            write_float(buf, pos, my_row.headroom);
            pos += 4;
            // trunk (int)
            write_int16(buf, pos, my_row.trunk);
            pos += 2;
            // weight (int)
            write_int16(buf, pos, my_row.weight);
            pos += 2;
            // length (int)
            write_int16(buf, pos, my_row.length_in);
            pos += 2;
            // turn (int)
            write_int16(buf, pos, my_row.turn);
            pos += 2;
            // displacement (int)
            write_int16(buf, pos, my_row.displacement);
            pos += 2;
            // gear_ratio (float)
            write_float(buf, pos, my_row.gear_ratio);
            pos += 4;
            // foreign (byte)
            write_byte(buf, pos, my_row.foreign);
        },
        the_value_label_tables: [
            {
                name: "origin",
                entries: [
                    { value: 0, label: "Domestic" },
                    { value: 1, label: "Foreign" },
                ],
            },
        ],
    });
}

// ---------------------------------------------------------------------------
// Fixture 2: auto_v117.dta
// ---------------------------------------------------------------------------

function build_auto_v117(): Buffer {
    const the_vars: VarDef[] = [
        { name: "make", type_code: TYPE_V117.str(18), format: "%18s", label: "Make and model", value_label_name: "" },
        { name: "price", type_code: TYPE_V117.int, format: "%8.0gc", label: "Price", value_label_name: "" },
        { name: "mpg", type_code: TYPE_V117.int, format: "%8.0g", label: "Mileage (mpg)", value_label_name: "" },
        { name: "rep78", type_code: TYPE_V117.int, format: "%8.0g", label: "Repair record 1978", value_label_name: "" },
        { name: "headroom", type_code: TYPE_V117.float, format: "%6.1f", label: "Headroom (in.)", value_label_name: "" },
        { name: "trunk", type_code: TYPE_V117.int, format: "%8.0g", label: "Trunk space (cu. ft.)", value_label_name: "" },
        { name: "weight", type_code: TYPE_V117.int, format: "%8.0gc", label: "Weight (lbs.)", value_label_name: "" },
        { name: "length", type_code: TYPE_V117.int, format: "%8.0g", label: "Length (in.)", value_label_name: "" },
        { name: "turn", type_code: TYPE_V117.int, format: "%8.0g", label: "Turn circle (ft.)", value_label_name: "" },
        { name: "displacement", type_code: TYPE_V117.int, format: "%8.0g", label: "Displacement (cu. in.)", value_label_name: "" },
        { name: "gear_ratio", type_code: TYPE_V117.float, format: "%6.2f", label: "Gear ratio", value_label_name: "" },
        { name: "foreign", type_code: TYPE_V117.byte, format: "%8.0g", label: "Car origin", value_label_name: "origin" },
    ];

    return build_dta({
        release: "117",
        byte_order: "LSF",
        the_vars,
        num_obs: THE_AUTO_ROWS.length,
        dataset_label: "1978 automobile data",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            const my_row = THE_AUTO_ROWS[obs_index];
            let pos = offset;
            write_str(buf, pos, my_row.make, 18);
            pos += 18;
            write_int16(buf, pos, my_row.price);
            pos += 2;
            write_int16(buf, pos, my_row.mpg);
            pos += 2;
            write_int16(buf, pos, my_row.rep78 === null ? MISSING.int.dot : my_row.rep78);
            pos += 2;
            write_float(buf, pos, my_row.headroom);
            pos += 4;
            write_int16(buf, pos, my_row.trunk);
            pos += 2;
            write_int16(buf, pos, my_row.weight);
            pos += 2;
            write_int16(buf, pos, my_row.length_in);
            pos += 2;
            write_int16(buf, pos, my_row.turn);
            pos += 2;
            write_int16(buf, pos, my_row.displacement);
            pos += 2;
            write_float(buf, pos, my_row.gear_ratio);
            pos += 4;
            write_byte(buf, pos, my_row.foreign);
        },
        the_value_label_tables: [
            {
                name: "origin",
                entries: [
                    { value: 0, label: "Domestic" },
                    { value: 1, label: "Foreign" },
                ],
            },
        ],
    });
}

// ---------------------------------------------------------------------------
// Fixture 3: strl_test.dta
// ---------------------------------------------------------------------------

function build_strl_test(): Buffer {
    // 3 variables: id (int), short_text (str20), long_text (strL)
    // 5 observations with varying strL content lengths.
    const the_vars: VarDef[] = [
        { name: "id", type_code: TYPE_V118.int, format: "%8.0g", label: "Observation ID", value_label_name: "" },
        { name: "short_text", type_code: TYPE_V118.str(20), format: "%20s", label: "Short text field", value_label_name: "" },
        { name: "long_text", type_code: TYPE_V118.strl, format: "%9s", label: "Long text field", value_label_name: "" },
    ];

    const the_long_texts = [
        "This is a short strL value.",
        "This is a longer strL value that contains multiple sentences. It demonstrates that strL variables can hold text of arbitrary length, unlike fixed-width string variables which are limited to 2045 bytes.",
        "Line 1\nLine 2\nLine 3",
        "", // Empty strL
        "Special chars: tab\there, quotes \"hello\", backslash \\, unicode \u00e9\u00e0\u00fc",
    ];

    const the_gso_entries: GsoEntry[] = [];
    for (let i = 0; i < the_long_texts.length; i++) {
        if (the_long_texts[i].length > 0) {
            the_gso_entries.push({
                v: 3, // 1-indexed variable number for long_text
                o: i + 1, // 1-indexed observation number
                content: the_long_texts[i],
            });
        }
    }

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: 5,
        dataset_label: "strL test dataset",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            let pos = offset;
            // id (int)
            write_int16(buf, pos, obs_index + 1);
            pos += 2;
            // short_text (str20)
            write_str(buf, pos, `Row ${obs_index + 1}`, 20);
            pos += 20;
            // long_text (strL pointer: v=3, o=obs_index+1)
            if (the_long_texts[obs_index].length > 0) {
                write_strl_ref_v118(buf, pos, 3, obs_index + 1);
            }
            // else leave as zeros (null strL)
        },
        the_gso_entries,
    });
}

// ---------------------------------------------------------------------------
// Fixture 4: value_labels.dta
// ---------------------------------------------------------------------------

function build_value_labels(): Buffer {
    // 3 variables with value labels:
    //   gender (byte, label "gender_lbl": 0=Male, 1=Female, 2=Other)
    //   education (byte, label "edu_lbl": 1=HS, 2=BA, 3=MA, 4=PhD)
    //   region (byte, label "region_lbl": 1=Northeast, 2=Midwest, 3=South, 4=West)
    const the_vars: VarDef[] = [
        { name: "id", type_code: TYPE_V118.int, format: "%8.0g", label: "Person ID", value_label_name: "" },
        { name: "gender", type_code: TYPE_V118.byte, format: "%8.0g", label: "Gender", value_label_name: "gender_lbl" },
        { name: "education", type_code: TYPE_V118.byte, format: "%12.0g", label: "Education level", value_label_name: "edu_lbl" },
        { name: "region", type_code: TYPE_V118.byte, format: "%12.0g", label: "Census region", value_label_name: "region_lbl" },
    ];

    const the_rows = [
        { id: 1, gender: 0, education: 2, region: 1 },
        { id: 2, gender: 1, education: 3, region: 2 },
        { id: 3, gender: 0, education: 4, region: 3 },
        { id: 4, gender: 1, education: 1, region: 4 },
        { id: 5, gender: 2, education: 2, region: 1 },
        { id: 6, gender: 0, education: 3, region: 2 },
        { id: 7, gender: 1, education: 4, region: 3 },
        { id: 8, gender: 0, education: 1, region: 4 },
    ];

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: the_rows.length,
        dataset_label: "Value labels test dataset",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            const my_row = the_rows[obs_index];
            let pos = offset;
            write_int16(buf, pos, my_row.id);
            pos += 2;
            write_byte(buf, pos, my_row.gender);
            pos += 1;
            write_byte(buf, pos, my_row.education);
            pos += 1;
            write_byte(buf, pos, my_row.region);
        },
        the_value_label_tables: [
            {
                name: "gender_lbl",
                entries: [
                    { value: 0, label: "Male" },
                    { value: 1, label: "Female" },
                    { value: 2, label: "Other" },
                ],
            },
            {
                name: "edu_lbl",
                entries: [
                    { value: 1, label: "High school" },
                    { value: 2, label: "Bachelor's" },
                    { value: 3, label: "Master's" },
                    { value: 4, label: "Doctorate" },
                ],
            },
            {
                name: "region_lbl",
                entries: [
                    { value: 1, label: "Northeast" },
                    { value: 2, label: "Midwest" },
                    { value: 3, label: "South" },
                    { value: 4, label: "West" },
                ],
            },
        ],
    });
}

// ---------------------------------------------------------------------------
// Fixture 5: empty.dta
// ---------------------------------------------------------------------------

function build_empty(): Buffer {
    const the_vars: VarDef[] = [
        { name: "id", type_code: TYPE_V118.int, format: "%8.0g", label: "Observation ID", value_label_name: "" },
        { name: "name", type_code: TYPE_V118.str(32), format: "%32s", label: "Name", value_label_name: "" },
        { name: "value", type_code: TYPE_V118.double, format: "%10.4f", label: "Value", value_label_name: "" },
    ];

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: 0,
        dataset_label: "Empty dataset with variable definitions",
        timestamp: "25 Mar 2026 10:00",
        write_row() {
            // No rows to write.
        },
    });
}

// ---------------------------------------------------------------------------
// Fixture 6: wide.dta
// ---------------------------------------------------------------------------

function build_wide(): Buffer {
    const num_wide_vars = 120;
    const num_wide_obs = 20;

    const the_vars: VarDef[] = [];
    for (let i = 0; i < num_wide_vars; i++) {
        the_vars.push({
            name: `x${i + 1}`,
            type_code: TYPE_V118.double,
            format: "%10.4f",
            label: `Variable ${i + 1}`,
            value_label_name: "",
        });
    }

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: num_wide_obs,
        dataset_label: "Wide dataset (120 variables)",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            for (let j = 0; j < num_wide_vars; j++) {
                // Value = obs_index * 1000 + j, gives unique values.
                write_double(buf, offset + j * 8, obs_index * 1000 + j);
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Fixture 7: missing_values.dta
// ---------------------------------------------------------------------------

function build_missing_values(): Buffer {
    // 5 variables: byte_val, int_val, long_val, float_val, double_val
    // 28 rows: row 0 = system missing (.), rows 1-26 = .a through .z, row 27 = non-missing
    const the_vars: VarDef[] = [
        { name: "byte_val", type_code: TYPE_V118.byte, format: "%8.0g", label: "Byte with missing", value_label_name: "" },
        { name: "int_val", type_code: TYPE_V118.int, format: "%8.0g", label: "Int with missing", value_label_name: "" },
        { name: "long_val", type_code: TYPE_V118.long, format: "%12.0g", label: "Long with missing", value_label_name: "" },
        { name: "float_val", type_code: TYPE_V118.float, format: "%9.0g", label: "Float with missing", value_label_name: "" },
        { name: "double_val", type_code: TYPE_V118.double, format: "%10.0g", label: "Double with missing", value_label_name: "" },
    ];

    return build_dta({
        release: "118",
        byte_order: "LSF",
        the_vars,
        num_obs: 28,
        dataset_label: "Extended missing values test",
        timestamp: "25 Mar 2026 10:00",
        write_row(buf: Buffer, offset: number, obs_index: number) {
            let pos = offset;
            if (obs_index === 27) {
                // Non-missing row: all values = 42
                write_byte(buf, pos, 42);
                pos += 1;
                write_int16(buf, pos, 42);
                pos += 2;
                write_int32(buf, pos, 42);
                pos += 4;
                write_float(buf, pos, 42.0);
                pos += 4;
                write_double(buf, pos, 42.0);
            } else {
                // obs_index 0 = system missing (.), 1 = .a, ..., 26 = .z
                const my_missing_offset = obs_index; // 0=., 1=.a, ..., 26=.z

                // byte: . = 101, .a = 102, ..., .z = 127
                write_byte(buf, pos, MISSING.byte.dot + my_missing_offset);
                pos += 1;
                // int: . = 32741, .a = 32742, ..., .z = 32767
                write_int16(buf, pos, MISSING.int.dot + my_missing_offset);
                pos += 2;
                // long: . = 2147483621, .a = 2147483622, ..., .z = 2147483647
                write_int32(buf, pos, MISSING.long.dot + my_missing_offset);
                pos += 4;
                // float: IEEE 754 pattern
                const my_float_buf = float_missing_buf(my_missing_offset);
                my_float_buf.copy(buf, pos);
                pos += 4;
                // double: IEEE 754 pattern
                const my_double_buf = double_missing_buf(my_missing_offset);
                my_double_buf.copy(buf, pos);
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Main: generate all fixtures
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function write_fixture(name: string, data: Buffer): void {
    const my_path = join(SCRIPT_DIR, name);
    writeFileSync(my_path, data);
    console.log(`  ${name}: ${data.length} bytes`);
}

console.log("Generating .dta test fixtures...\n");

write_fixture("auto_v118.dta", build_auto_v118());
write_fixture("auto_v117.dta", build_auto_v117());
write_fixture("strl_test.dta", build_strl_test());
write_fixture("value_labels.dta", build_value_labels());
write_fixture("empty.dta", build_empty());
write_fixture("wide.dta", build_wide());
write_fixture("missing_values.dta", build_missing_values());

console.log("\nDone. All fixtures generated.");
