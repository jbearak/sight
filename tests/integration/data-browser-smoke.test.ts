import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { apply_display_format } from '@jbearak/dta-parser';
import { DtaFile } from '@jbearak/dta-parser/node';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/dta');

describe('data browser smoke test', () => {
    it('full pipeline: open, read metadata, read rows, format cells', async () => {
        const my_file = await DtaFile.open(path.join(FIXTURE_DIR, 'auto_v118.dta'));

        try {
            // Metadata
            expect(my_file.nobs).toBe(74);
            expect(my_file.nvar).toBe(12);
            expect(my_file.variables.length).toBe(12);

            // Read a page of rows
            const the_rows = await my_file.read_rows(0, 10);
            expect(the_rows.length).toBe(10);

            // Format a numeric cell
            const my_price_idx = my_file.variables.findIndex(v => v.name === 'price');
            const my_price_var = my_file.variables[my_price_idx];
            const my_raw_price = the_rows[0][my_price_idx] as number;
            const my_formatted = apply_display_format(my_raw_price, my_price_var.format);
            expect(my_formatted).toBeTruthy();
            expect(typeof my_formatted).toBe('string');

            // Value labels
            const my_foreign_var = my_file.variables.find(v => v.name === 'foreign');
            expect(my_foreign_var).toBeDefined();
            expect(my_foreign_var!.value_label_name).toBeTruthy();
            const my_table = my_file.value_label_tables.get(
                my_foreign_var!.value_label_name!
            );
            expect(my_table).toBeDefined();
            expect(my_table!.get(0)).toBeDefined();
            expect(my_table!.get(1)).toBeDefined();
        } finally {
            my_file.close();
        }
    });

    it('handles all fixture files without crashing', async () => {
        const the_fixtures = [
            'auto_v118.dta', 'auto_v117.dta', 'auto_v119.dta',
            'value_labels.dta', 'empty.dta',
            'wide.dta', 'missing_values.dta',
            'strl_test.dta', 'all_types.dta',
        ];

        for (const my_fixture of the_fixtures) {
            const my_file = await DtaFile.open(path.join(FIXTURE_DIR, my_fixture));

            try {
                expect(my_file.nvar).toBeGreaterThanOrEqual(0);
                expect(my_file.variables.length).toBe(my_file.nvar);

                if (my_file.nobs > 0) {
                    const the_rows = await my_file.read_rows(0, 1);
                    expect(the_rows.length).toBe(1);
                }
            } finally {
                my_file.close();
            }
        }
    });

    it('strL resolution works end-to-end', async () => {
        const my_file = await DtaFile.open(path.join(FIXTURE_DIR, 'strl_test.dta'));

        try {
            const the_rows = await my_file.read_rows(0, my_file.nobs);

            // Find the strL column
            const my_strl_idx = my_file.variables.findIndex(v => v.type === 'strL');
            expect(my_strl_idx).toBeGreaterThanOrEqual(0);

            // All strL values should be real strings, not "__strl__"
            for (const my_row of the_rows) {
                const my_val = my_row[my_strl_idx];
                if (my_val !== null && my_val !== '') {
                    expect(typeof my_val).toBe('string');
                    expect(my_val).not.toBe('__strl__');
                }
            }
        } finally {
            my_file.close();
        }
    });

    it('cross-version consistency: v117, v118, v119 auto.dta match', async () => {
        const my_v117 = await DtaFile.open(path.join(FIXTURE_DIR, 'auto_v117.dta'));
        const my_v118 = await DtaFile.open(path.join(FIXTURE_DIR, 'auto_v118.dta'));
        const my_v119 = await DtaFile.open(path.join(FIXTURE_DIR, 'auto_v119.dta'));

        try {
            // Same dimensions
            expect(my_v117.nobs).toBe(my_v118.nobs);
            expect(my_v118.nobs).toBe(my_v119.nobs);
            expect(my_v117.nvar).toBe(my_v118.nvar);

            // Same variable names
            for (let i = 0; i < my_v118.nvar; i++) {
                expect(my_v117.variables[i].name).toBe(my_v118.variables[i].name);
                expect(my_v118.variables[i].name).toBe(my_v119.variables[i].name);
            }

            // Same data (first 5 rows)
            const the_rows_117 = await my_v117.read_rows(0, 5);
            const the_rows_118 = await my_v118.read_rows(0, 5);
            const the_rows_119 = await my_v119.read_rows(0, 5);

            for (let i = 0; i < 5; i++) {
                for (let j = 0; j < my_v118.nvar; j++) {
                    // Allow float precision differences between versions
                    const my_v117_val = the_rows_117[i][j];
                    const my_v118_val = the_rows_118[i][j];
                    const my_v119_val = the_rows_119[i][j];

                    if (typeof my_v118_val === 'string') {
                        expect(my_v117_val).toBe(my_v118_val);
                        expect(my_v118_val).toBe(my_v119_val);
                    } else if (typeof my_v118_val === 'number') {
                        // Float values may differ slightly between format versions
                        expect(my_v117_val).toBeCloseTo(my_v118_val as number, 4);
                        expect(my_v118_val).toBeCloseTo(my_v119_val as number, 4);
                    } else {
                        // tagged missing values
                        expect(my_v117_val).toEqual(my_v118_val);
                        expect(my_v118_val).toEqual(my_v119_val);
                    }
                }
            }
        } finally {
            my_v117.close();
            my_v118.close();
            my_v119.close();
        }
    });

    it('fails fast for unsupported ancient .dta formats', async () => {
        const my_temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-dta-')
        );
        const my_ancient_path = path.join(
            my_temp_dir,
            'ancient_v112.dta'
        );

        try {
            // Format 112 (Stata 7) — unsupported
            const my_ancient_header = Buffer.alloc(128);
            my_ancient_header[0] = 0x70; // 112
            my_ancient_header[1] = 0x02;
            my_ancient_header[2] = 0x01;
            fs.writeFileSync(
                my_ancient_path,
                my_ancient_header
            );

            await expect(
                DtaFile.open(my_ancient_path)
            ).rejects.toThrow(
                'Unsupported .dta format: only ' +
                'Stata 8+ files (formats 113-115 ' +
                'and 117-119) are supported'
            );
        } finally {
            fs.rmSync(my_temp_dir, {
                recursive: true,
                force: true,
            });
        }
    });
});
