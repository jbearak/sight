import { describe, it, expect, afterEach } from 'bun:test';
import * as path from 'path';
import {
    DtaFile,
    make_missing_value,
} from '../../../src/dta-parser/index';

// -----------------------------------------------------------
// DtaFile public API integration tests
// -----------------------------------------------------------

const FIXTURE_DIR = path.join(
    __dirname, '..', '..', 'fixtures', 'dta'
);

let my_file: DtaFile | null = null;

afterEach(() => {
    my_file?.close();
    my_file = null;
});

describe('DtaFile', () => {

    // ----- open + metadata -----

    describe('open and metadata', () => {
        it('opens and reads metadata from auto_v118.dta', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            expect(my_file.nobs).toBe(74);
            expect(my_file.nvar).toBe(12);
            expect(my_file.variables.length).toBe(12);
        });

        it('provides dataset label', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'value_labels.dta')
            );
            expect(my_file.dataset_label).toBe(
                'Value labels test dataset'
            );
        });

        it('provides variable names', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            const the_names = my_file.variables.map(
                v => v.name
            );
            expect(the_names).toEqual([
                'make', 'price', 'mpg', 'rep78',
                'headroom', 'trunk', 'weight', 'length',
                'turn', 'displacement', 'gear_ratio',
                'foreign',
            ]);
        });
    });

    // ----- read_rows -----

    describe('read_rows', () => {
        it('reads the first row', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            const the_rows = await my_file.read_rows(0, 1);
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

        it('reads all 74 rows', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            const the_rows = await my_file.read_rows(0, 74);
            expect(the_rows.length).toBe(74);

            for (const my_row of the_rows) {
                expect(my_row.length).toBe(12);
            }
        });

        it('clamps count past end of data', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            const the_rows = await my_file.read_rows(70, 10);
            expect(the_rows.length).toBe(4);
        });

        it('preserves extended missing values exactly', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'missing_values.dta')
            );
            const the_rows = await my_file.read_rows(0, 5);
            expect(the_rows[0][0]).toEqual(
                make_missing_value('.')
            );
            expect(the_rows[1][0]).toEqual(
                make_missing_value('.a')
            );
            expect(the_rows[2][0]).toEqual(
                make_missing_value('.b')
            );
            expect(the_rows[4][0]).toEqual(
                make_missing_value('.z')
            );
        });
    });

    // ----- column subsetting -----

    describe('column subsetting', () => {
        it('reads rows with column subsetting', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            // Only columns 0..3 (make, price, mpg)
            const the_rows = await my_file.read_rows(
                0, 1, 0, 3
            );
            expect(the_rows.length).toBe(1);
            expect(the_rows[0].length).toBe(3);

            // Verify values match full read
            const the_full = await my_file.read_rows(0, 1);
            expect(the_rows[0][0]).toEqual(the_full[0][0]);
            expect(the_rows[0][1]).toEqual(the_full[0][1]);
            expect(the_rows[0][2]).toEqual(the_full[0][2]);
        });
    });

    // ----- value labels -----

    describe('value label tables', () => {
        it('provides value label tables', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'value_labels.dta')
            );
            const my_tables = my_file.value_label_tables;
            expect(my_tables.size).toBeGreaterThan(0);

            // foreign_lbl: 0 = "Domestic", 1 = "Foreign"
            const my_foreign = my_tables.get('foreign_lbl');
            expect(my_foreign).toBeDefined();
            expect(my_foreign!.get(0)).toBe('Domestic');
            expect(my_foreign!.get(1)).toBe('Foreign');

            // rep_lbl has 5 entries
            const my_rep = my_tables.get('rep_lbl');
            expect(my_rep).toBeDefined();
            expect(my_rep!.size).toBe(5);
            expect(my_rep!.get(1)).toBe('Poor');
            expect(my_rep!.get(5)).toBe('Excellent');
        });
    });

    // ----- strL resolution -----

    describe('strL resolution', () => {
        it('resolves strL values (strl_test.dta)', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'strl_test.dta')
            );

            // Find the strL column index
            const my_strl_idx = my_file.variables
                .findIndex(v => v.type === 'strL');
            expect(my_strl_idx).toBeGreaterThanOrEqual(0);

            const the_rows = await my_file.read_rows(0, 5);
            expect(the_rows.length).toBe(5);

            // All strL cells should be resolved strings,
            // not the "__strl__" placeholder
            for (const my_row of the_rows) {
                const my_cell = my_row[my_strl_idx];
                expect(typeof my_cell).toBe('string');
                expect(my_cell).not.toBe('__strl__');
            }

            // Obs 1: "This is observation 1"
            expect(the_rows[0][my_strl_idx]).toBe(
                'This is observation 1'
            );

            // Obs 4 (index 3): empty string (v=0, o=0)
            expect(the_rows[3][my_strl_idx]).toBe('');

            // Obs 3 has extra padding
            expect(
                (the_rows[2][my_strl_idx] as string).length
            ).toBeGreaterThan(
                (the_rows[0][my_strl_idx] as string).length
            );
        });

        it('resolves strL values from v118 format', async () => {
            my_file = await DtaFile.open(
                path.join(
                    FIXTURE_DIR, 'strl_test_v118.dta'
                )
            );

            const my_strl_idx = my_file.variables
                .findIndex(v => v.type === 'strL');
            expect(my_strl_idx).toBeGreaterThanOrEqual(0);

            const the_rows = await my_file.read_rows(0, 1);
            const my_cell = the_rows[0][my_strl_idx];
            expect(typeof my_cell).toBe('string');
            expect(my_cell).not.toBe('__strl__');
            expect(
                (my_cell as string).length
            ).toBeGreaterThan(0);
        });

        it('resolves strL in all_types.dta', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'all_types.dta')
            );

            // v_strL is index 7
            const my_strl_idx = my_file.variables
                .findIndex(v => v.type === 'strL');
            expect(my_strl_idx).toBe(7);

            const the_rows = await my_file.read_rows(0, 5);
            for (let i = 0; i < 5; i++) {
                const my_cell = the_rows[i][my_strl_idx];
                expect(typeof my_cell).toBe('string');
                expect(my_cell).not.toBe('__strl__');
                expect(my_cell).toContain(
                    'strL value for obs ' + (i + 1)
                );
            }
        });
    });

    // ----- cross-version -----

    describe('cross-version compatibility', () => {
        it('handles v117 format', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v117.dta')
            );
            expect(my_file.nobs).toBe(74);
            expect(my_file.nvar).toBe(12);

            const the_rows = await my_file.read_rows(0, 1);
            expect(the_rows.length).toBe(1);
            expect(typeof the_rows[0][0]).toBe('string');
        });

        it('handles v119 format', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v119.dta')
            );
            expect(my_file.nobs).toBe(74);
            expect(my_file.nvar).toBe(12);

            const the_rows = await my_file.read_rows(0, 1);
            expect(the_rows.length).toBe(1);
            expect(typeof the_rows[0][0]).toBe('string');
        });

        it('produces same data across v117, v118, v119', async () => {
            const my_f117 = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v117.dta')
            );
            const my_f118 = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            const my_f119 = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v119.dta')
            );

            const the_rows_117 =
                await my_f117.read_rows(0, 5);
            const the_rows_118 =
                await my_f118.read_rows(0, 5);
            const the_rows_119 =
                await my_f119.read_rows(0, 5);

            expect(the_rows_117).toEqual(the_rows_118);
            expect(the_rows_118).toEqual(the_rows_119);

            my_f117.close();
            my_f118.close();
            my_f119.close();
        });
    });

    // ----- empty dataset -----

    describe('empty dataset', () => {
        it('handles empty dataset', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'empty.dta')
            );
            expect(my_file.nobs).toBe(0);
            expect(my_file.nvar).toBe(3);
            expect(my_file.variables.length).toBe(3);

            const the_rows = await my_file.read_rows(0, 10);
            expect(the_rows).toEqual([]);
        });
    });

    // ----- close -----

    describe('close', () => {
        it('releases resources on close', async () => {
            my_file = await DtaFile.open(
                path.join(FIXTURE_DIR, 'auto_v118.dta')
            );
            my_file.close();

            // After close, read_rows should return empty
            const the_rows = await my_file.read_rows(0, 1);
            expect(the_rows).toEqual([]);

            // Prevent afterEach double-close
            my_file = null;
        });
    });
});
