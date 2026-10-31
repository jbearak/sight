import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { format_page } from '../../client/src/data-browser/cell-format';
import { DtaSource } from '../../client/src/data-browser/dta-source';
import { get_cell_display_value } from '../../client/src/data-browser/webview/grid-model';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/dta');

function open_fixture(name: string): DtaSource {
    return DtaSource.open(path.join(FIXTURE_DIR, name));
}

describe('data browser smoke test', () => {
    it('full pipeline: open, read metadata, read a page, format cells', () => {
        const my_file = open_fixture('auto_v118.dta');
        try {
            expect(my_file.nobs).toBe(74);
            expect(my_file.nvar).toBe(12);
            expect(my_file.variables.length).toBe(12);

            const the_columns = my_file.column_range();
            const the_rows = format_page(
                my_file,
                my_file.read_page({ start: 0, count: 10 }, the_columns),
                the_columns
            );
            expect(the_rows.length).toBe(10);
            the_rows[0].forEach(my_cell => {
                expect(typeof get_cell_display_value(my_cell, true, true))
                    .toBe('string');
                expect(my_cell.pending).toBeUndefined();
            });

            const my_foreign_var = my_file.variables.find(
                my_v => my_v.name === 'foreign'
            );
            expect(my_foreign_var).toBeDefined();
            expect(my_foreign_var!.value_label_name).toBeTruthy();
            const my_table = my_file.value_label_tables.get(
                my_foreign_var!.value_label_name
            );
            expect(my_table?.get(0)).toBeDefined();
            expect(my_table?.get(1)).toBeDefined();
        } finally {
            my_file.close();
        }
    });

    it('handles all fixture files without crashing', () => {
        const the_fixtures = fs.readdirSync(FIXTURE_DIR)
            .filter(my_name => my_name.endsWith('.dta'));
        expect(the_fixtures.length).toBeGreaterThan(20);
        for (const my_fixture of the_fixtures) {
            const my_file = open_fixture(my_fixture);
            try {
                expect(my_file.variables.length).toBe(my_file.nvar);
                if (my_file.nobs > 0) {
                    const the_rows = my_file.read_page({ start: 0, count: 1 }, my_file.column_range());
                    expect(the_rows.length).toBe(1);
                    expect(the_rows[0].length).toBe(my_file.nvar);
                }
            } finally {
                my_file.close();
            }
        }
    });

    it('strL values arrive as strings', () => {
        const my_file = open_fixture('strl_test.dta');
        try {
            const my_strl_idx = my_file.variables.findIndex(
                my_v => my_v.type === 'strL'
            );
            expect(my_strl_idx).toBeGreaterThanOrEqual(0);
            const the_rows = my_file.read_page({ start: 0, count: my_file.nobs }, my_file.column_range());
            for (const my_row of the_rows) {
                expect(typeof my_row[my_strl_idx]).toBe('string');
            }
        } finally {
            my_file.close();
        }
    });

    it('a scattered page reads the rows asked for, in that order', () => {
        const my_file = open_fixture('auto_v118.dta');
        try {
            const the_all = my_file.read_page(
                { start: 0, count: 74 },
                my_file.column_range()
            );
            const the_rows = [73, 0, 5, 5, 6, 7, 40];
            expect(my_file.read_page({ rows: the_rows }, my_file.column_range()))
                .toEqual(the_rows.map(i => the_all[i]));
            // Some columns, in the order asked for.
            expect(my_file.read_page({ rows: the_rows }, [4, 2, 3]))
                .toEqual(the_rows.map(i => [4, 2, 3].map(j => the_all[i][j])));
        } finally {
            my_file.close();
        }
    });

    it('cross-version consistency: v117, v118, v119 auto.dta match', () => {
        const the_files = ['auto_v117.dta', 'auto_v118.dta', 'auto_v119.dta']
            .map(open_fixture);
        try {
            const [my_a, my_b, my_c] = the_files;
            expect(my_a.nobs).toBe(my_b.nobs);
            expect(my_b.nobs).toBe(my_c.nobs);
            expect(my_a.variables.map(my_v => my_v.name))
                .toEqual(my_b.variables.map(my_v => my_v.name));
            const the_pages = the_files.map(
                my_f => my_f.read_page({ start: 0, count: 5 }, my_f.column_range())
            );
            expect(the_pages[0]).toEqual(the_pages[1]);
            expect(the_pages[1]).toEqual(the_pages[2]);
        } finally {
            for (const my_f of the_files) my_f.close();
        }
    });

    it('fails fast for unsupported ancient .dta formats', () => {
        const my_temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-dta-'));
        const my_ancient_path = path.join(my_temp_dir, 'ancient_v112.dta');
        try {
            // Format 112 (Stata 7) is unsupported.
            const my_ancient_header = Buffer.alloc(128);
            my_ancient_header[0] = 0x70; // 112
            my_ancient_header[1] = 0x02;
            my_ancient_header[2] = 0x01;
            fs.writeFileSync(my_ancient_path, my_ancient_header);
            expect(() => DtaSource.open(my_ancient_path))
                .toThrow('unsupported .dta release 112');
        } finally {
            fs.rmSync(my_temp_dir, { recursive: true, force: true });
        }
    });
});
