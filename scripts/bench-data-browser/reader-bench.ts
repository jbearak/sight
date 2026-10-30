/**
 * Column-read microbenchmark: what does one full-column scan of a .dta
 * cost with each available reader, and what is the floor?
 *
 *   v06    @jbearak/dta-parser 0.6 (what Sight ships): read_columns
 *   v1     @jbearak/dta-parser 1.0 (unpublished; wasm, columnar)
 *   floor  hand-written strided scan: fs.readSync 8 MiB chunks of the
 *          data section, decode one numeric column into Float64Array +
 *          Uint8Array missing codes (numeric columns only)
 *
 * One reader x operation per process so memory numbers are clean.
 *
 * Usage (bundled): node reader-bench.mjs <v06|v1|floor> <op> <fixture> [cols...]
 *   op: columns | page | page_warm | gather_warm
 *     page_warm / gather_warm time a second read, after a first read
 *     has paid one-time costs (the strL index)
 *   DTA_PARSER_V1=/path/to/dta-parser/js/dist/node.js for v1
 */

import * as fs from 'fs';
import { createRequire } from 'module';
import { DtaFile } from '@jbearak/dta-parser/node';

const PAGE_ROWS = 131;
const FLOOR_CHUNK_BYTES = 8 << 20;

function mib(n: number): number {
    return Math.round(n / (1 << 20));
}

function memory(): Record<string, number> {
    const my_m = process.memoryUsage();
    return {
        rss_mib: mib(my_m.rss),
        heap_used_mib: mib(my_m.heapUsed),
        external_mib: mib(my_m.external + my_m.arrayBuffers),
    };
}

interface V1Column {
    kind: 'number' | 'string';
    values: ArrayLike<unknown>;
}

interface V1Reader {
    info: { nobs: number };
    variables: readonly { name: string; type: string }[];
    readColumns(cols: readonly (number | string)[],
        range?: { start?: number; count?: number }): V1Column[];
    readRows(start: number, count: number,
        cols?: readonly (number | string)[]): unknown[][];
}

function open_v1(file: string): V1Reader {
    const my_path = process.env.DTA_PARSER_V1;
    if (!my_path) throw new Error('set DTA_PARSER_V1');
    const my_require = createRequire(import.meta.url);
    const my_mod = my_require(my_path) as {
        openDtaFile: (f: string) => V1Reader;
    };
    return my_mod.openDtaFile(file);
}

/** Byte-order-aware numeric decode for the floor reader (LSF only). */
function floor_scan(
    file: string,
    data_offset: number,
    row_len: number,
    nobs: number,
    var_offset: number,
    type: string
): { values: Float64Array; missing: Uint8Array } {
    const my_fd = fs.openSync(file, 'r');
    const values = new Float64Array(nobs);
    const missing = new Uint8Array(nobs);
    const my_rows_per_chunk = Math.max(1, Math.floor(FLOOR_CHUNK_BYTES / row_len));
    const my_buf = Buffer.allocUnsafe(my_rows_per_chunk * row_len);
    const my_view = new DataView(my_buf.buffer, my_buf.byteOffset, my_buf.byteLength);
    for (let my_row = 0; my_row < nobs; my_row += my_rows_per_chunk) {
        const my_n = Math.min(my_rows_per_chunk, nobs - my_row);
        fs.readSync(my_fd, my_buf, 0, my_n * row_len, data_offset + my_row * row_len);
        let my_at = var_offset;
        for (let i = 0; i < my_n; i++, my_at += row_len) {
            const my_out = my_row + i;
            switch (type) {
                case 'double': {
                    const my_hi = my_view.getUint32(my_at + 4, true);
                    if (my_hi >= 0x7fe00000 && my_hi < 0x80000000) {
                        missing[my_out] = 1 + ((my_hi - 0x7fe00000) >>> 8);
                        values[my_out] = NaN;
                    } else {
                        values[my_out] = my_view.getFloat64(my_at, true);
                    }
                    break;
                }
                case 'float': {
                    const my_bits = my_view.getUint32(my_at, true);
                    if (my_bits >= 0x7f000000 && my_bits < 0x80000000) {
                        missing[my_out] = 1 + ((my_bits - 0x7f000000) >>> 11);
                        values[my_out] = NaN;
                    } else {
                        values[my_out] = my_view.getFloat32(my_at, true);
                    }
                    break;
                }
                case 'long': {
                    const my_v = my_view.getInt32(my_at, true);
                    if (my_v > 2147483620) {
                        missing[my_out] = my_v - 2147483620;
                        values[my_out] = NaN;
                    } else values[my_out] = my_v;
                    break;
                }
                case 'int': {
                    const my_v = my_view.getInt16(my_at, true);
                    if (my_v > 32740) {
                        missing[my_out] = my_v - 32740;
                        values[my_out] = NaN;
                    } else values[my_out] = my_v;
                    break;
                }
                case 'byte': {
                    const my_v = my_view.getInt8(my_at);
                    if (my_v > 100) {
                        missing[my_out] = my_v - 100;
                        values[my_out] = NaN;
                    } else values[my_out] = my_v;
                    break;
                }
                default:
                    throw new Error(`floor: unsupported type ${type}`);
            }
        }
    }
    fs.closeSync(my_fd);
    return { values, missing };
}

/** Sum of finite numbers and count of everything else (after timing). */
function checksum(values: ArrayLike<unknown>): string {
    let my_sum = 0;
    let my_other = 0;
    for (let i = 0; i < values.length; i++) {
        const my_v = values[i];
        if (typeof my_v === 'number' && Number.isFinite(my_v)) my_sum += my_v;
        else my_other++;
    }
    return `${my_sum.toFixed(2)}/${my_other}`;
}

async function main(): Promise<void> {
    const [my_reader, my_op, my_file, ...my_cols] = process.argv.slice(2);
    const my_before = memory();
    const my_result: Record<string, unknown> = {
        reader: my_reader, op: my_op, cols: my_cols,
    };
    // Metadata from 0.6 (all three readers agree on it).
    const my_meta_file = await DtaFile.open(my_file);
    const the_indices = my_cols.map(my_name => {
        const my_i = my_meta_file.variables.findIndex(my_v => my_v.name === my_name);
        if (my_i < 0) throw new Error(`no column ${my_name}`);
        return my_i;
    });
    const my_nobs = my_meta_file.nobs;
    const my_t0 = performance.now();

    if (my_reader === 'v06') {
        if (my_op === 'columns') {
            const my_out = await my_meta_file.read_columns(the_indices);
            my_result.cells = [...my_out.values()].reduce((a, c) => a + c.length, 0);
            my_result.ms = Math.round(performance.now() - my_t0);
            my_result.checksum = checksum(my_out.get(the_indices[0]) ?? []);
        } else if (my_op === 'page' || my_op === 'page_warm') {
            if (my_op === 'page_warm') {
                await my_meta_file.read_rows(0, PAGE_ROWS);
                my_result.first_ms = Math.round(performance.now() - my_t0);
            }
            const my_t1 = performance.now();
            const my_rows = await my_meta_file.read_rows(
                Math.floor(my_nobs / 2), PAGE_ROWS
            );
            my_result.ms = Math.round(performance.now() - my_t1);
            my_result.cells = my_rows.length * (my_rows[0]?.length ?? 0);
        } else if (my_op === 'gather_warm') {
            await my_meta_file.read_rows(0, PAGE_ROWS);
            my_result.first_ms = Math.round(performance.now() - my_t0);
            const my_t1 = performance.now();
            // A sorted page: PAGE_ROWS scattered rows, one read each,
            // as browser-panel does for non-contiguous runs.
            let my_cells = 0;
            for (let i = 0; i < PAGE_ROWS; i++) {
                const my_row = Math.floor((i * 7919 * 104729) % my_nobs);
                const my_rows = await my_meta_file.read_rows(my_row, 1);
                my_cells += my_rows[0].length;
            }
            my_result.ms = Math.round(performance.now() - my_t1);
            my_result.cells = my_cells;
        }
    } else if (my_reader === 'v1') {
        const my_v1 = open_v1(my_file);
        my_result.open_ms = Math.round(performance.now() - my_t0);
        if (my_op === 'columns') {
            const my_out = my_v1.readColumns(the_indices);
            my_result.cells = my_out.reduce((a, c) => a + c.values.length, 0);
            my_result.ms = Math.round(performance.now() - my_t0);
            my_result.checksum = checksum(Array.from(my_out[0].values));
        } else if (my_op === 'page' || my_op === 'page_warm') {
            if (my_op === 'page_warm') {
                my_v1.readRows(0, PAGE_ROWS);
                my_result.first_ms = Math.round(performance.now() - my_t0);
            }
            const my_t1 = performance.now();
            const my_rows = my_v1.readRows(Math.floor(my_nobs / 2), PAGE_ROWS);
            my_result.ms = Math.round(performance.now() - my_t1);
            my_result.cells = my_rows.length * (my_rows[0]?.length ?? 0);
        } else if (my_op === 'gather_warm') {
            my_v1.readRows(0, PAGE_ROWS);
            my_result.first_ms = Math.round(performance.now() - my_t0);
            const my_t1 = performance.now();
            let my_cells = 0;
            for (let i = 0; i < PAGE_ROWS; i++) {
                const my_row = Math.floor((i * 7919 * 104729) % my_nobs);
                my_cells += my_v1.readRows(my_row, 1)[0].length;
            }
            my_result.ms = Math.round(performance.now() - my_t1);
            my_result.cells = my_cells;
        }
    } else if (my_reader === 'floor') {
        const my_meta = (my_meta_file as unknown as {
            _metadata: {
                section_offsets: { data: number };
                obs_length: number;
            };
        })._metadata;
        const my_data = my_meta.section_offsets.data + '<data>'.length;
        let my_cells = 0;
        for (const my_i of the_indices) {
            const my_var = my_meta_file.variables[my_i];
            const my_out = floor_scan(
                my_file, my_data, my_meta.obs_length, my_nobs,
                my_var.byte_offset, my_var.type
            );
            my_cells += my_out.values.length;
            if (my_i === the_indices[0]) {
                my_result.ms = Math.round(performance.now() - my_t0);
                my_result.checksum = checksum(Array.from(my_out.values));
            }
        }
        my_result.cells = my_cells;
    }
    my_result.ms ??= Math.round(performance.now() - my_t0);
    const my_after = memory();
    my_result.rss_delta_mib = my_after.rss_mib - my_before.rss_mib;
    my_result.heap_delta_mib = my_after.heap_used_mib - my_before.heap_used_mib;
    my_result.external_delta_mib = my_after.external_mib - my_before.external_mib;
    process.stdout.write(`RESULT ${JSON.stringify(my_result)}\n`);
    process.exit(0);
}

main().catch(my_err => {
    console.error(my_err);
    process.exit(1);
});
