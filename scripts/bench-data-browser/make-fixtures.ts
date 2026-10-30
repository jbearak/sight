/**
 * Streaming writer for the data-browser benchmark fixtures.
 *
 * Writes release-118 (little-endian) .dta files row by row, so a
 * 1M x 500 survey-shaped file never has to exist in memory. Existing
 * writers (dta-parser 1.0's writeDta, Stata itself) take the whole
 * dataset at once or are not available on CI machines.
 *
 * Fixtures are deterministic (seeded PRNG) and Stata-shaped: labelled
 * byte questions with labelled extended missings (.d/.r/.n), skip-
 * pattern system missings, %td/%tc dates, strN and strL columns.
 *
 * Usage:
 *   bun scripts/bench-data-browser/make-fixtures.ts <out-dir> [narrow|wide|small|all] [--scale x]
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------
// Encoding constants (release 118)
// ---------------------------------------------------------------

const TYPE_DOUBLE = 65526;
const TYPE_FLOAT = 65527;
const TYPE_LONG = 65528;
const TYPE_INT = 65529;
const TYPE_BYTE = 65530;
const TYPE_STRL = 32768;

// Missing-code offsets: 0 is `.`, 1..26 are `.a`..`.z`.
const BYTE_MISSING_BASE = 101;
const INT_MISSING_BASE = 32741;
const LONG_MISSING_BASE = 2147483621;
const FLOAT_MISSING_BASE = 0x7f000000;
const FLOAT_MISSING_STEP = 0x800;

const utf8 = new TextEncoder();

export type MissingOffset = number; // 0 = '.', 1 = '.a', ... 26 = '.z'

const MISSING_D = 4;
const MISSING_N = 14;
const MISSING_R = 18;

// ---------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------

function make_rng(seed: number): () => number {
    let my_state = seed >>> 0;
    return () => {
        my_state = (my_state + 0x6d2b79f5) >>> 0;
        let my_t = my_state;
        my_t = Math.imul(my_t ^ (my_t >>> 15), my_t | 1);
        my_t ^= my_t + Math.imul(my_t ^ (my_t >>> 7), my_t | 61);
        return ((my_t ^ (my_t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------
// Column specs
// ---------------------------------------------------------------

/** A generated cell: a number, a missing offset, or a string. */
type Gen =
    | { kind: 'num'; value: number }
    | { kind: 'miss'; offset: MissingOffset }
    | { kind: 'str'; value: string };

interface ColumnSpec {
    name: string;
    type: number; // type code; 1..2045 for strN
    format: string;
    label: string;
    value_label_name: string;
    /** Generate the value for 0-based row `row`. */
    gen: (row: number, rng: () => number) => Gen;
}

interface ValueLabelSet {
    name: string;
    entries: [number, string][]; // code (long-encoded for missings) -> text
}

interface FixtureSpec {
    name: string;
    nobs: number;
    columns: ColumnSpec[];
    value_labels: ValueLabelSet[];
}

function missing_label_key(offset: MissingOffset): number {
    return LONG_MISSING_BASE + offset;
}

function byte_width(type: number): number {
    switch (type) {
        case TYPE_DOUBLE: return 8;
        case TYPE_FLOAT: return 4;
        case TYPE_LONG: return 4;
        case TYPE_INT: return 2;
        case TYPE_BYTE: return 1;
        case TYPE_STRL: return 8;
        default:
            if (type >= 1 && type <= 2045) return type;
            throw new Error(`bad type ${type}`);
    }
}

const num = (value: number): Gen => ({ kind: 'num', value });
const miss = (offset: MissingOffset): Gen => ({ kind: 'miss', offset });
const str = (value: string): Gen => ({ kind: 'str', value });

const WORDS = [
    'water', 'clinic', 'school', 'market', 'road', 'river', 'farm',
    'health', 'family', 'village', 'work', 'money', 'food', 'rain',
    'church', 'mosque', 'bus', 'phone', 'radio', 'doctor', 'nurse',
    'child', 'mother', 'father', 'house', 'land', 'cattle', 'maize',
    'Ünïcode', 'naïve', 'café', '東京', 'São Paulo', 'Zürich',
];

function words(rng: () => number, n: number): string {
    const the_parts: string[] = [];
    for (let i = 0; i < n; i++) {
        the_parts.push(WORDS[Math.floor(rng() * WORDS.length)]);
    }
    return the_parts.join(' ');
}

/** Truncate `s` to at most `width` UTF-8 bytes on a code-point boundary. */
function fit_bytes(s: string, width: number): string {
    let my_out = '';
    let my_used = 0;
    for (const my_char of s) {
        const my_n = utf8.encode(my_char).length;
        if (my_used + my_n > width) break;
        my_out += my_char;
        my_used += my_n;
    }
    return my_out;
}

// Stata day 0 = 1960-01-01. 2015-01-01 is day 20089.
const DAY_2015 = 20089;
const MS_PER_DAY = 86_400_000;

function narrow_spec(nobs: number): FixtureSpec {
    const the_districts: string[] = [];
    for (let i = 0; i < 5000; i++) {
        the_districts.push(`district_${i}`);
    }
    return {
        name: 'narrow',
        nobs,
        value_labels: [
            {
                name: 'region',
                entries: [
                    [1, 'North'], [2, 'North East'], [3, 'East'],
                    [4, 'South East'], [5, 'South'], [6, 'South West'],
                    [7, 'West'], [8, 'North West'], [9, 'Central'],
                    [10, 'Capital territory (special administrative area)'],
                    [missing_label_key(MISSING_D), "Don't know"],
                    [missing_label_key(MISSING_R), 'Refused'],
                ],
            },
            {
                name: 'yesno',
                entries: [
                    [0, 'No'], [1, 'Yes'],
                    [missing_label_key(MISSING_D), "Don't know"],
                ],
            },
        ],
        columns: [
            {
                name: 'id', type: TYPE_LONG, format: '%12.0g',
                label: 'Respondent ID', value_label_name: '',
                gen: (row) => num(row + 1),
            },
            {
                name: 'age', type: TYPE_BYTE, format: '%8.0g',
                label: 'Age in years', value_label_name: '',
                gen: (_row, rng) => rng() < 0.01
                    ? miss(0)
                    : num(15 + Math.floor(rng() * 35)),
            },
            {
                name: 'region', type: TYPE_BYTE, format: '%10.0g',
                label: 'Region of residence', value_label_name: 'region',
                gen: (_row, rng) => {
                    const my_u = rng();
                    if (my_u < 0.01) return miss(MISSING_D);
                    if (my_u < 0.015) return miss(MISSING_R);
                    return num(1 + Math.floor(rng() * 10));
                },
            },
            {
                name: 'income', type: TYPE_DOUBLE, format: '%10.2f',
                label: 'Monthly household income', value_label_name: '',
                gen: (_row, rng) => {
                    const my_u = rng();
                    if (my_u < 0.05) return miss(0);
                    if (my_u < 0.06) return miss(1);
                    if (my_u < 0.065) return miss(2);
                    return num(Math.round(Math.exp(6 + 1.5 * rng()) * 100) / 100);
                },
            },
            {
                name: 'weight', type: TYPE_FLOAT, format: '%9.0g',
                label: 'Sampling weight', value_label_name: '',
                gen: (_row, rng) => num(Math.fround(0.2 + rng() * 3)),
            },
            {
                name: 'interview_date', type: TYPE_LONG, format: '%td',
                label: 'Date of interview', value_label_name: '',
                gen: (_row, rng) => rng() < 0.002
                    ? miss(0)
                    : num(DAY_2015 + Math.floor(rng() * 3650)),
            },
            {
                name: 'interview_time', type: TYPE_DOUBLE, format: '%tc',
                label: 'Time of interview', value_label_name: '',
                gen: (_row, rng) => num(
                    (DAY_2015 + Math.floor(rng() * 3650)) * MS_PER_DAY
                    + Math.floor(rng() * MS_PER_DAY / 1000) * 1000
                ),
            },
            {
                name: 'score', type: TYPE_INT, format: '%8.0g',
                label: 'Test score', value_label_name: '',
                gen: (_row, rng) => rng() < 0.03
                    ? miss(MISSING_N)
                    : num(Math.floor(rng() * 1000)),
            },
            {
                name: 'district', type: 12, format: '%12s',
                label: 'District name', value_label_name: '',
                gen: (_row, rng) => rng() < 0.01
                    ? str('')
                    : str(the_districts[Math.floor(rng() * 5000)]),
            },
            {
                name: 'consent', type: TYPE_BYTE, format: '%8.0g',
                label: 'Consent given', value_label_name: 'yesno',
                gen: (_row, rng) => {
                    const my_u = rng();
                    if (my_u < 0.005) return miss(MISSING_D);
                    return num(my_u < 0.9 ? 1 : 0);
                },
            },
        ],
    };
}

const STRL_COLUMNS = 5;
const STRN_COLUMNS = 54;

function wide_spec(nobs: number): FixtureSpec {
    const the_columns: ColumnSpec[] = [];
    const the_sets: ValueLabelSet[] = [];
    const the_dk = (): [number, string][] => [
        [missing_label_key(MISSING_D), "Don't know"],
        [missing_label_key(MISSING_R), 'Refused'],
        [missing_label_key(MISSING_N), 'Not applicable'],
    ];
    the_sets.push({
        name: 'yesno',
        entries: [[0, 'No'], [1, 'Yes'], ...the_dk()],
    });
    the_sets.push({
        name: 'likert',
        entries: [
            [1, 'Strongly disagree'], [2, 'Disagree'],
            [3, 'Neither agree nor disagree'], [4, 'Agree'],
            [5, 'Strongly agree'], ...the_dk(),
        ],
    });
    the_sets.push({
        name: 'freq',
        entries: [
            [0, 'Never'], [1, 'Less than once a month'],
            [2, 'Monthly'], [3, 'Weekly'], [4, 'Daily'],
            [5, 'Several times a day'], [6, 'Constantly'],
            ...the_dk(),
        ],
    });
    const SET_CATEGORIES: Record<string, number[]> = {
        yesno: [0, 1], likert: [1, 2, 3, 4, 5], freq: [0, 1, 2, 3, 4, 5, 6],
    };
    const SET_NAMES = ['yesno', 'likert', 'freq'];

    the_columns.push({
        name: 'hhid', type: 16, format: '%16s',
        label: 'Household identifier', value_label_name: '',
        gen: (row) => str(`HH${String(row * 7919 % 100000000).padStart(8, '0')}`),
    });

    for (let q = 1; q <= 300; q++) {
        const my_set = SET_NAMES[q % SET_NAMES.length];
        const the_cats = SET_CATEGORIES[my_set];
        the_columns.push({
            name: `q${q}`, type: TYPE_BYTE, format: '%8.0g',
            label: `Question ${q}: ${words(make_rng(q), 6)}`,
            value_label_name: my_set,
            gen: (_row, rng) => {
                const my_u = rng();
                if (my_u < 0.10) return miss(0); // skip pattern
                if (my_u < 0.115) return miss(MISSING_D);
                if (my_u < 0.125) return miss(MISSING_R);
                if (my_u < 0.13) return miss(MISSING_N);
                return num(the_cats[Math.floor(rng() * the_cats.length)]);
            },
        });
    }
    for (let c = 1; c <= 80; c++) {
        the_columns.push({
            name: `n${c}`, type: TYPE_INT, format: '%8.0g',
            label: `Count ${c}`, value_label_name: '',
            gen: (_row, rng) => rng() < 0.05
                ? miss(0)
                : num(Math.floor(rng() * 40)),
        });
    }
    for (let c = 1; c <= 60; c++) {
        const my_is_double = c % 2 === 0;
        the_columns.push({
            name: `x${c}`,
            type: my_is_double ? TYPE_DOUBLE : TYPE_FLOAT,
            format: my_is_double ? '%10.2f' : '%9.0g',
            label: `Measure ${c}`, value_label_name: '',
            gen: (_row, rng) => {
                const my_u = rng();
                if (my_u < 0.04) return miss(0);
                if (my_u < 0.05) return miss(1 + (c % 26));
                const my_v = (rng() - 0.3) * 10 ** (c % 6);
                return num(my_is_double ? my_v : Math.fround(my_v));
            },
        });
    }
    for (let c = 1; c <= STRN_COLUMNS; c++) {
        const my_width = 8 + ((c * 13) % 33); // 8..40
        const the_pool: string[] = [];
        const my_pool_rng = make_rng(1000 + c);
        for (let i = 0; i < 200; i++) {
            the_pool.push(
                fit_bytes(words(my_pool_rng, 1 + (i % 4)), my_width)
            );
        }
        the_columns.push({
            name: `s${c}`, type: my_width, format: `%${my_width}s`,
            label: `Text field ${c}`, value_label_name: '',
            gen: (_row, rng) => rng() < 0.1
                ? str('')
                : str(the_pool[Math.floor(rng() * the_pool.length)]),
        });
    }
    for (let c = 1; c <= STRL_COLUMNS; c++) {
        the_columns.push({
            name: `open${c}`, type: TYPE_STRL, format: '%9s',
            label: `Open-ended response ${c}`, value_label_name: '',
            gen: (_row, rng) => {
                const my_u = rng();
                if (my_u < 0.6) return str('');
                if (my_u < 0.98) {
                    return str(words(rng, 2 + Math.floor(rng() * 18)));
                }
                // Long verbatim answer, beyond any strN width.
                return str(words(rng, 400 + Math.floor(rng() * 300)));
            },
        });
    }
    if (the_columns.length !== 500) {
        throw new Error(`wide spec has ${the_columns.length} columns`);
    }
    return { name: 'wide', nobs, columns: the_columns, value_labels: the_sets };
}

// ---------------------------------------------------------------
// Writer
// ---------------------------------------------------------------

class ByteSink {
    private readonly fd: number;
    private readonly buffer: Buffer;
    private used = 0;
    position = 0;

    constructor(fd: number, size_bytes: number) {
        this.fd = fd;
        this.buffer = Buffer.alloc(size_bytes);
    }

    reserve(n: number): number {
        if (this.used + n > this.buffer.length) this.flush();
        if (n > this.buffer.length) throw new Error('record too large');
        const my_at = this.used;
        this.used += n;
        this.position += n;
        return my_at;
    }

    get bytes(): Buffer {
        return this.buffer;
    }

    write(bytes: Uint8Array): void {
        if (bytes.length > this.buffer.length) {
            this.flush();
            fs.writeSync(this.fd, bytes);
            this.position += bytes.length;
            return;
        }
        const my_at = this.reserve(bytes.length);
        this.buffer.set(bytes, my_at);
    }

    text(s: string): void {
        this.write(utf8.encode(s));
    }

    u8(v: number): void { this.buffer.writeUInt8(v, this.reserve(1)); }
    u16(v: number): void { this.buffer.writeUInt16LE(v, this.reserve(2)); }
    u32(v: number): void { this.buffer.writeUInt32LE(v, this.reserve(4)); }
    i32(v: number): void { this.buffer.writeInt32LE(v, this.reserve(4)); }
    u64(v: number): void {
        this.buffer.writeBigUInt64LE(BigInt(v), this.reserve(8));
    }

    fixed(s: string, width: number): void {
        const my_bytes = utf8.encode(s);
        if (my_bytes.length > width) throw new Error(`"${s}" > ${width}`);
        const my_at = this.reserve(width);
        this.buffer.fill(0, my_at, my_at + width);
        this.buffer.set(my_bytes, my_at);
    }

    flush(): void {
        if (this.used > 0) {
            fs.writeSync(this.fd, this.buffer, 0, this.used);
            this.used = 0;
        }
    }
}

function write_fixture(spec: FixtureSpec, out_path: string): void {
    const my_started = performance.now();
    const my_fd = fs.openSync(out_path, 'w');
    const my_strl_path = `${out_path}.strls.tmp`;
    const my_strl_fd = fs.openSync(my_strl_path, 'w+');
    const sink = new ByteSink(my_fd, 8 << 20);
    const strl_sink = new ByteSink(my_strl_fd, 8 << 20);
    const my_k = spec.columns.length;
    const the_map: number[] = new Array(14).fill(0);

    sink.text('<stata_dta><header><release>118</release>');
    sink.text('<byteorder>LSF</byteorder><K>');
    sink.u16(my_k);
    sink.text('</K><N>');
    sink.u64(spec.nobs);
    sink.text('</N><label>');
    const my_label = utf8.encode(`Sight benchmark fixture: ${spec.name}`);
    sink.u16(my_label.length);
    sink.write(my_label);
    sink.text('</label><timestamp>');
    sink.u8(17);
    sink.text('30 Oct 2026 12:00');
    sink.text('</timestamp></header>');

    the_map[1] = sink.position;
    sink.text('<map>');
    const my_map_values_at = sink.position;
    for (let i = 0; i < 14; i++) sink.u64(0);
    sink.text('</map>');

    the_map[2] = sink.position;
    sink.text('<variable_types>');
    for (const my_col of spec.columns) sink.u16(my_col.type);
    sink.text('</variable_types>');

    the_map[3] = sink.position;
    sink.text('<varnames>');
    for (const my_col of spec.columns) sink.fixed(my_col.name, 129);
    sink.text('</varnames>');

    the_map[4] = sink.position;
    sink.text('<sortlist>');
    for (let i = 0; i <= my_k; i++) sink.u16(0);
    sink.text('</sortlist>');

    the_map[5] = sink.position;
    sink.text('<formats>');
    for (const my_col of spec.columns) sink.fixed(my_col.format, 57);
    sink.text('</formats>');

    the_map[6] = sink.position;
    sink.text('<value_label_names>');
    for (const my_col of spec.columns) {
        sink.fixed(my_col.value_label_name, 129);
    }
    sink.text('</value_label_names>');

    the_map[7] = sink.position;
    sink.text('<variable_labels>');
    for (const my_col of spec.columns) sink.fixed(my_col.label, 321);
    sink.text('</variable_labels>');

    the_map[8] = sink.position;
    sink.text('<characteristics></characteristics>');

    the_map[9] = sink.position;
    sink.text('<data>');
    const the_widths = spec.columns.map(my_col => byte_width(my_col.type));
    const my_row_width = the_widths.reduce((a, b) => a + b, 0);
    const rng = make_rng(0x5eed + spec.nobs + my_k);
    const my_buf = sink.bytes;
    let my_strl_count = 0;
    for (let row = 0; row < spec.nobs; row++) {
        let my_at = sink.reserve(my_row_width);
        for (let c = 0; c < my_k; c++) {
            const my_col = spec.columns[c];
            const my_cell = my_col.gen(row, rng);
            const my_type = my_col.type;
            if (my_type === TYPE_STRL) {
                const my_text = my_cell.kind === 'str' ? my_cell.value : '';
                if (my_text === '') {
                    my_buf.fill(0, my_at, my_at + 8);
                } else {
                    // v (2 bytes) | o (6 bytes), both 1-based.
                    my_buf.writeUInt16LE(c + 1, my_at);
                    my_buf.writeUIntLE(row + 1, my_at + 2, 6);
                    const my_payload = utf8.encode(my_text);
                    strl_sink.text('GSO');
                    strl_sink.u32(c + 1);
                    strl_sink.u64(row + 1);
                    strl_sink.u8(130);
                    strl_sink.u32(my_payload.length + 1);
                    strl_sink.write(my_payload);
                    strl_sink.u8(0);
                    my_strl_count++;
                }
            } else if (my_type <= 2045) {
                const my_text = my_cell.kind === 'str' ? my_cell.value : '';
                my_buf.fill(0, my_at, my_at + my_type);
                my_buf.set(utf8.encode(my_text), my_at);
            } else if (my_cell.kind === 'miss') {
                const my_off = my_cell.offset;
                switch (my_type) {
                    case TYPE_BYTE:
                        my_buf.writeInt8(BYTE_MISSING_BASE + my_off, my_at);
                        break;
                    case TYPE_INT:
                        my_buf.writeInt16LE(INT_MISSING_BASE + my_off, my_at);
                        break;
                    case TYPE_LONG:
                        my_buf.writeInt32LE(LONG_MISSING_BASE + my_off, my_at);
                        break;
                    case TYPE_FLOAT:
                        my_buf.writeUInt32LE(
                            FLOAT_MISSING_BASE + my_off * FLOAT_MISSING_STEP,
                            my_at
                        );
                        break;
                    case TYPE_DOUBLE:
                        my_buf.writeBigUInt64LE(
                            0x7fe0000000000000n + (BigInt(my_off) << 40n),
                            my_at
                        );
                        break;
                }
            } else {
                const my_value = my_cell.kind === 'num' ? my_cell.value : 0;
                switch (my_type) {
                    case TYPE_BYTE: my_buf.writeInt8(my_value, my_at); break;
                    case TYPE_INT: my_buf.writeInt16LE(my_value, my_at); break;
                    case TYPE_LONG: my_buf.writeInt32LE(my_value, my_at); break;
                    case TYPE_FLOAT: my_buf.writeFloatLE(my_value, my_at); break;
                    case TYPE_DOUBLE: my_buf.writeDoubleLE(my_value, my_at); break;
                }
            }
            my_at += the_widths[c];
        }
        if ((row & 0xfffff) === 0 && row > 0) {
            process.stderr.write(`  ${spec.name}: ${row} rows\r`);
        }
    }
    sink.text('</data>');

    the_map[10] = sink.position;
    sink.text('<strls>');
    strl_sink.flush();
    sink.flush();
    const my_strl_size = fs.fstatSync(my_strl_fd).size;
    const my_copy = Buffer.alloc(16 << 20);
    for (let my_off = 0; my_off < my_strl_size; my_off += my_copy.length) {
        const my_n = fs.readSync(my_strl_fd, my_copy, 0, my_copy.length, my_off);
        fs.writeSync(my_fd, my_copy, 0, my_n);
        sink.position += my_n;
    }
    fs.closeSync(my_strl_fd);
    fs.unlinkSync(my_strl_path);
    sink.text('</strls>');

    the_map[11] = sink.position;
    sink.text('<value_labels>');
    for (const my_set of spec.value_labels) {
        const the_texts = my_set.entries.map(([, t]) => utf8.encode(t));
        const my_n = my_set.entries.length;
        const my_txtlen = the_texts.reduce((a, t) => a + t.length + 1, 0);
        const my_len = 4 + 4 + 4 * my_n + 4 * my_n + my_txtlen;
        sink.text('<lbl>');
        sink.i32(my_len);
        sink.fixed(my_set.name, 129);
        sink.fixed('', 3);
        sink.i32(my_n);
        sink.i32(my_txtlen);
        let my_off = 0;
        for (const my_t of the_texts) {
            sink.i32(my_off);
            my_off += my_t.length + 1;
        }
        for (const [my_code] of my_set.entries) sink.i32(my_code);
        for (const my_t of the_texts) {
            sink.write(my_t);
            sink.u8(0);
        }
        sink.text('</lbl>');
    }
    sink.text('</value_labels>');

    the_map[12] = sink.position;
    sink.text('</stata_dta>');
    the_map[13] = sink.position;
    sink.flush();

    const my_map = Buffer.alloc(14 * 8);
    for (let i = 0; i < 14; i++) {
        my_map.writeBigUInt64LE(BigInt(the_map[i]), i * 8);
    }
    fs.writeSync(my_fd, my_map, 0, my_map.length, my_map_values_at);
    fs.closeSync(my_fd);
    const my_seconds = (performance.now() - my_started) / 1000;
    const my_size_mb = the_map[13] / (1 << 20);
    process.stderr.write(
        `wrote ${out_path}: ${spec.nobs} x ${my_k}, `
        + `${my_size_mb.toFixed(0)} MiB, ${my_strl_count} strLs, `
        + `${my_seconds.toFixed(1)} s\n`
    );
}

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

export const FIXTURES: Record<string, (scale: number) => FixtureSpec> = {
    small: () => narrow_spec(100_000),
    'small-wide': () => wide_spec(20_000),
    narrow: scale => narrow_spec(Math.round(10_000_000 * scale)),
    wide: scale => wide_spec(Math.round(1_000_000 * scale)),
};

/** File name of a fixture at a scale: `narrow.dta`, `narrow-0.1.dta`. */
export function fixture_file_name(name: string, scale: number): string {
    return scale === 1 ? `${name}.dta` : `${name}-${scale}.dta`;
}

/** Write one fixture into `out_dir` at `scale`; returns its path. */
export function make_fixture(
    out_dir: string,
    name: string,
    scale: number
): string {
    const my_make = FIXTURES[name];
    if (!my_make) throw new Error(`unknown fixture ${name}`);
    fs.mkdirSync(out_dir, { recursive: true });
    const my_path = path.join(out_dir, fixture_file_name(name, scale));
    write_fixture(my_make(scale), my_path);
    return my_path;
}

function main(): void {
    const the_args = process.argv.slice(2);
    let my_scale = 1;
    const my_scale_at = the_args.indexOf('--scale');
    if (my_scale_at >= 0) {
        my_scale = Number(the_args[my_scale_at + 1]);
        the_args.splice(my_scale_at, 2);
    }
    const [my_out_dir, my_which = 'all'] = the_args;
    if (!my_out_dir || !(my_scale > 0)) {
        console.error(
            'usage: make-fixtures.ts <out-dir> '
            + '[small|small-wide|narrow|wide|all] [--scale x]'
        );
        process.exit(2);
    }
    const the_names = my_which === 'all'
        ? Object.keys(FIXTURES)
        : my_which.split(',');
    for (const my_name of the_names) {
        make_fixture(my_out_dir, my_name, my_scale);
    }
}

if (import.meta.main) main();
