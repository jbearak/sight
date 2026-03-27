import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../../src/dta-parser/header';
import { read_rows_from_buffer } from '../../../src/dta-parser/data-reader';
import type { DtaMetadata } from '../../../src/dta-parser/types';

// -----------------------------------------------------------
// Data section row reader tests
// -----------------------------------------------------------

const FIXTURE_DIR = path.join(
    __dirname, '..', '..', 'fixtures', 'dta'
);

function load_fixture(name: string): {
    buffer: ArrayBuffer;
    metadata: DtaMetadata;
} {
    const my_buf = fs.readFileSync(
        path.join(FIXTURE_DIR, name)
    );
    const my_array_buf = my_buf.buffer.slice(
        my_buf.byteOffset,
        my_buf.byteOffset + my_buf.byteLength
    );
    const my_meta = parse_metadata(my_array_buf);
    return { buffer: my_array_buf, metadata: my_meta };
}

describe('read_rows_from_buffer', () => {

    // ----- auto_v118.dta basic reads -----

    describe('auto_v118.dta', () => {
        const { buffer, metadata } =
            load_fixture('auto_v118.dta');

        it('reads the first row', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows.length).toBe(1);
            const my_row = the_rows[0];
            // Row has 12 columns
            expect(my_row.length).toBe(12);
        });

        it('reads string values correctly (make is a non-empty string)', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            const my_make = the_rows[0][0];
            expect(typeof my_make).toBe('string');
            expect((my_make as string).length).toBeGreaterThan(0);
        });

        it('reads numeric values correctly (price > 0)', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            const my_price = the_rows[0][1];
            expect(typeof my_price).toBe('number');
            expect(my_price as number).toBeGreaterThan(0);
        });

        it('reads all 74 rows', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 74
            );
            expect(the_rows.length).toBe(74);

            // Every row should have 12 columns
            for (const my_row of the_rows) {
                expect(my_row.length).toBe(12);
            }

            // make should be a string in every row
            for (const my_row of the_rows) {
                expect(typeof my_row[0]).toBe('string');
            }
        });

        it('reads a middle page correctly (start=10, count=5)', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 10, 5
            );
            expect(the_rows.length).toBe(5);

            // Compare with individual reads to ensure
            // offset calculation is correct
            const the_all = read_rows_from_buffer(
                buffer, metadata, 0, 74
            );
            for (let i = 0; i < 5; i++) {
                expect(the_rows[i]).toEqual(the_all[10 + i]);
            }
        });

        it('handles reading past end of data (start=70, count=10)', () => {
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 70, 10
            );
            // 74 obs total, start=70 means 4 rows remain
            expect(the_rows.length).toBe(4);
        });
    });

    // ----- Empty dataset -----

    describe('empty dataset', () => {
        it('returns empty array for empty dataset', () => {
            const { buffer, metadata } =
                load_fixture('empty.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 100
            );
            expect(the_rows).toEqual([]);
        });
    });

    // ----- Missing values -----

    describe('missing values', () => {
        it('returns null for missing values (missing_values.dta)', () => {
            const { buffer, metadata } =
                load_fixture('missing_values.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 5
            );

            // Row 0 (_n==1): all five columns are .
            // (system missing)
            // Variables: x_double, x_byte, x_int, x_long,
            //            x_float
            const my_row0 = the_rows[0];
            expect(my_row0[0]).toBeNull();  // x_double = .
            expect(my_row0[1]).toBeNull();  // x_byte = .
            expect(my_row0[2]).toBeNull();  // x_int = .
            expect(my_row0[3]).toBeNull();  // x_long = .
            expect(my_row0[4]).toBeNull();  // x_float = .

            // Row 1 (_n==2): .a in all columns
            const my_row1 = the_rows[1];
            expect(my_row1[0]).toBeNull();  // x_double = .a
            expect(my_row1[1]).toBeNull();  // x_byte = .a
            expect(my_row1[2]).toBeNull();  // x_int = .a
            expect(my_row1[3]).toBeNull();  // x_long = .a
            expect(my_row1[4]).toBeNull();  // x_float = .a

            // Row 2 (_n==3): x_double = .b, x_byte = .z,
            // x_int = .z, x_long = .z, x_float = .z
            const my_row2 = the_rows[2];
            expect(my_row2[0]).toBeNull();  // x_double = .b
            expect(my_row2[1]).toBeNull();  // x_byte = .z
            expect(my_row2[2]).toBeNull();  // x_int = .z
            expect(my_row2[3]).toBeNull();  // x_long = .z
            expect(my_row2[4]).toBeNull();  // x_float = .z

            // Row 4 (_n==5): x_double = .z, others are
            // numeric (not null)
            const my_row4 = the_rows[4];
            expect(my_row4[0]).toBeNull();  // x_double = .z

            // x_byte for _n==5: gen byte x_byte = _n
            // if _n <= 100 => 5
            expect(my_row4[1]).toBe(5);
        });
    });

    // ----- Cross-version -----

    describe('cross-version compatibility', () => {
        it('reads v117 format correctly', () => {
            const { buffer, metadata } =
                load_fixture('auto_v117.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows.length).toBe(1);
            expect(the_rows[0].length).toBe(12);

            // make is a string
            expect(typeof the_rows[0][0]).toBe('string');
            expect(
                (the_rows[0][0] as string).length
            ).toBeGreaterThan(0);

            // price is numeric
            expect(typeof the_rows[0][1]).toBe('number');
            expect(
                the_rows[0][1] as number
            ).toBeGreaterThan(0);
        });

        it('reads v119 format correctly', () => {
            const { buffer, metadata } =
                load_fixture('auto_v119.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows.length).toBe(1);
            expect(the_rows[0].length).toBe(12);

            // make is a string
            expect(typeof the_rows[0][0]).toBe('string');
            expect(
                (the_rows[0][0] as string).length
            ).toBeGreaterThan(0);

            // price is numeric
            expect(typeof the_rows[0][1]).toBe('number');
            expect(
                the_rows[0][1] as number
            ).toBeGreaterThan(0);
        });

        it('produces same data across v117, v118, v119', () => {
            const my_v117 = load_fixture('auto_v117.dta');
            const my_v118 = load_fixture('auto_v118.dta');
            const my_v119 = load_fixture('auto_v119.dta');

            const the_rows_117 = read_rows_from_buffer(
                my_v117.buffer, my_v117.metadata, 0, 5
            );
            const the_rows_118 = read_rows_from_buffer(
                my_v118.buffer, my_v118.metadata, 0, 5
            );
            const the_rows_119 = read_rows_from_buffer(
                my_v119.buffer, my_v119.metadata, 0, 5
            );

            expect(the_rows_117).toEqual(the_rows_118);
            expect(the_rows_118).toEqual(the_rows_119);
        });
    });

    // ----- Column subsetting -----

    describe('column subsetting', () => {
        it('handles column subsetting (col_start=0, col_end=3)', () => {
            const { buffer, metadata } =
                load_fixture('auto_v118.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1, 0, 3
            );
            expect(the_rows.length).toBe(1);
            // Only 3 columns: make, price, mpg
            expect(the_rows[0].length).toBe(3);

            // Verify values match full read
            const the_full = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows[0][0]).toEqual(the_full[0][0]);
            expect(the_rows[0][1]).toEqual(the_full[0][1]);
            expect(the_rows[0][2]).toEqual(the_full[0][2]);
        });

        it('subsets middle columns correctly', () => {
            const { buffer, metadata } =
                load_fixture('auto_v118.dta');
            // Get columns 3..6 (rep78, headroom, trunk)
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1, 3, 6
            );
            expect(the_rows[0].length).toBe(3);

            const the_full = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows[0][0]).toEqual(the_full[0][3]);
            expect(the_rows[0][1]).toEqual(the_full[0][4]);
            expect(the_rows[0][2]).toEqual(the_full[0][5]);
        });
    });

    // ----- all_types.dta -----

    describe('all_types.dta', () => {
        it('reads all numeric types', () => {
            const { buffer, metadata } =
                load_fixture('all_types.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 5
            );
            expect(the_rows.length).toBe(5);

            // Variable order: v_byte, v_int, v_long,
            //   v_float, v_double, v_str5, v_str20, v_strL

            // Row 0 (_n==1): byte=1, int=100,
            //   long=100000, float~1.1, double~1.111111111
            const my_row0 = the_rows[0];
            expect(my_row0[0]).toBe(1);      // byte
            expect(my_row0[1]).toBe(100);    // int
            expect(my_row0[2]).toBe(100000); // long

            // float: 1.1 stored as float32 may lose
            // precision
            expect(typeof my_row0[3]).toBe('number');
            expect(
                Math.abs((my_row0[3] as number) - 1.1)
            ).toBeLessThan(0.01);

            // double: close to 1.111111111
            expect(typeof my_row0[4]).toBe('number');
            expect(
                Math.abs(
                    (my_row0[4] as number) - 1.111111111
                )
            ).toBeLessThan(0.0001);

            // Row 4 (_n==5): byte=5, int=500,
            //   long=500000
            const my_row4 = the_rows[4];
            expect(my_row4[0]).toBe(5);
            expect(my_row4[1]).toBe(500);
            expect(my_row4[2]).toBe(500000);
        });

        it('reads string types', () => {
            const { buffer, metadata } =
                load_fixture('all_types.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 5
            );

            // v_str5 (index 5): "s1" through "s5"
            expect(the_rows[0][5]).toBe('s1');
            expect(the_rows[1][5]).toBe('s2');
            expect(the_rows[4][5]).toBe('s5');

            // v_str20 (index 6): "longer_string_1" etc.
            expect(the_rows[0][6]).toBe('longer_string_1');
            expect(the_rows[4][6]).toBe('longer_string_5');

            // v_strL (index 7): placeholder for now
            expect(the_rows[0][7]).toBe('__strl__');
        });
    });

    // ----- wide.dta -----

    describe('wide.dta', () => {
        it('reads wide dataset (120 double vars)', () => {
            const { buffer, metadata } =
                load_fixture('wide.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 1
            );
            expect(the_rows.length).toBe(1);
            expect(the_rows[0].length).toBe(120);

            // All values should be numbers (doubles)
            for (const my_cell of the_rows[0]) {
                expect(typeof my_cell).toBe('number');
            }
        });
    });

    // ----- Edge cases -----

    describe('edge cases', () => {
        it('returns empty array when start >= nobs', () => {
            const { buffer, metadata } =
                load_fixture('auto_v118.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 100, 10
            );
            expect(the_rows).toEqual([]);
        });

        it('handles count of 0', () => {
            const { buffer, metadata } =
                load_fixture('auto_v118.dta');
            const the_rows = read_rows_from_buffer(
                buffer, metadata, 0, 0
            );
            expect(the_rows).toEqual([]);
        });
    });
});
