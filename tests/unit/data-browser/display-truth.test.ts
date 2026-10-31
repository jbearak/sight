/**
 * Display-truth battery for the data browser.
 *
 * Each row is a cell and the text the grid must show for it. Since
 * Phase 1b the browser formats with dta-parser 1.x's `formatValue`,
 * which shows values the way R's `format()` does, by decision (an R
 * user's browser should agree with R): `%td` dates as R Dates
 * (`2018-12-03`) and `%tc`/`%tC` as UTC date-times
 * (`2018-12-04 08:00:00`), whatever their display mask, and `%g` as R
 * shows a number (`0.5`, seven significant digits). Fixed (`%f`,
 * `%fc`), exponential (`%e`) and the other `%t` formats keep Stata's
 * text. The R-derived expectations below were taken from Rscript
 * (`format(as.Date(21521, origin = "1960-01-01"))`, `format(1234567.891)`
 * and so on), not from the code under test.
 *
 * The pipeline under test is the one the grid uses: `build_cell_value`
 * (run in the row reader thread) and the webview's
 * `get_cell_display_value`.
 */

import { describe, expect, it } from 'bun:test';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import {
    STRL_PREVIEW_BYTES,
    missing_label_key,
    type MissingName,
    type PageCell,
} from '../../../client/src/data-browser/dta-source';
import { get_cell_display_value } from '../../../client/src/data-browser/webview/grid-model';
import { miss } from './cells';

const YESNO = new Map<number, string>([
    [0, 'No'],
    [1, 'Yes'],
    [missing_label_key('.d'), "Don't know"],
]);

type Mode = 'values' | 'formats' | 'labels';

interface Row {
    what: string;
    type: string;
    format: string;
    /** The stored value; omitted for a missing value. */
    value?: PageCell;
    missing?: MissingName;
    labels?: Map<number, string>;
    mode: Mode;
    shows: string;
}

function display(row: Row): string {
    const my_raw = row.missing !== undefined
        ? miss(row.missing)
        : row.value;
    if (my_raw === undefined) throw new Error(`${row.what}: no value`);
    const my_cell = build_cell_value(
        my_raw,
        {
            type: row.type,
            format: row.format,
            value_label_name: row.labels ? 'set' : '',
        },
        row.labels
    );
    return get_cell_display_value(
        my_cell,
        row.mode === 'labels',
        row.mode !== 'values'
    );
}

const AS_R: Row[] = [
    { what: '%td date as an R Date', type: 'long', format: '%td', value: 21521, mode: 'formats', shows: '2018-12-03' },
    { what: '%td mask DD/NN/CCYY, shown as an R Date', type: 'long', format: '%tdDD/NN/CCYY', value: 21521, mode: 'formats', shows: '2018-12-03' },
    { what: '%td mask Mon_DD,_CCYY, shown as an R Date', type: 'long', format: '%tdMon_DD,_CCYY', value: 21521, mode: 'formats', shows: '2018-12-03' },
    { what: 'legacy %d as an R Date', type: 'long', format: '%d', value: 21521, mode: 'formats', shows: '2018-12-03' },
    { what: '%tc as a UTC date-time', type: 'double', format: '%tc', value: 1859529600000, mode: 'formats', shows: '2018-12-04 08:00:00' },
    { what: '%tc mask HH:MM, shown as a UTC date-time', type: 'double', format: '%tcHH:MM', value: 1859529600000, mode: 'formats', shows: '2018-12-04 08:00:00' },
    { what: '%9.0g as R shows it (seven digits)', type: 'double', format: '%9.0g', value: 1234567.891, mode: 'formats', shows: '1234568' },
    { what: '%9.0g keeps the leading zero, as R does', type: 'double', format: '%9.0g', value: 0.5, mode: 'formats', shows: '0.5' },
    { what: '%9.0g of a third', type: 'double', format: '%9.0g', value: 1 / 3, mode: 'formats', shows: '0.3333333' },
    { what: '%10.0g of a large integer, whole', type: 'double', format: '%10.0g', value: 123456789012, mode: 'formats', shows: '123456789012' },
    { what: '%9.3g: three significant digits', type: 'double', format: '%9.3g', value: 3.14159, mode: 'formats', shows: '3.14' },
];

const AS_STATA: Row[] = [
    { what: '%9.2f', type: 'double', format: '%9.2f', value: 1234567.891, mode: 'formats', shows: '1234567.89' },
    { what: '%12.0fc thousands separators', type: 'double', format: '%12.0fc', value: 1234567.891, mode: 'formats', shows: '1,234,568' },
    { what: '%9.2e', type: 'double', format: '%9.2e', value: 3.14159, mode: 'formats', shows: '3.14e+00' },
    { what: '%tm monthly', type: 'int', format: '%tm', value: 700, mode: 'formats', shows: '2018m5' },
    { what: '%tq quarterly', type: 'int', format: '%tq', value: 235, mode: 'formats', shows: '2018q4' },
    { what: '%tw weekly', type: 'int', format: '%tw', value: 3051, mode: 'formats', shows: '2018w36' },
    { what: '%th half-yearly', type: 'int', format: '%th', value: 117, mode: 'formats', shows: '2018h2' },
    { what: '%ty yearly', type: 'int', format: '%ty', value: 2018, mode: 'formats', shows: '2018' },
];

const VALUES_AND_LABELS: Row[] = [
    { what: 'Values mode shows the stored number', type: 'long', format: '%td', value: 21521, mode: 'values', shows: '21521' },
    { what: 'system missing', type: 'double', format: '%9.0g', missing: '.', mode: 'formats', shows: '.' },
    { what: 'extended missing, no label', type: 'double', format: '%9.0g', missing: '.z', mode: 'labels', shows: '.z' },
    { what: 'labelled extended missing, labels on', type: 'byte', format: '%8.0g', missing: '.d', labels: YESNO, mode: 'labels', shows: "Don't know" },
    { what: 'labelled extended missing, labels off', type: 'byte', format: '%8.0g', missing: '.d', labels: YESNO, mode: 'formats', shows: '.d' },
    { what: 'labelled value, labels on', type: 'byte', format: '%8.0g', value: 1, labels: YESNO, mode: 'labels', shows: 'Yes' },
    { what: 'labelled value, labels off', type: 'byte', format: '%8.0g', value: 1, labels: YESNO, mode: 'formats', shows: '1' },
    { what: 'unlabelled code in a labelled column', type: 'byte', format: '%8.0g', value: 7, labels: YESNO, mode: 'labels', shows: '7' },
    { what: 'string', type: 'str20', format: '%20s', value: 'São Paulo', mode: 'formats', shows: 'São Paulo' },
    { what: 'empty string (string missing) is blank, as in Stata', type: 'str20', format: '%20s', value: '', mode: 'formats', shows: '' },
    { what: 'a long strL shows its preview and an ellipsis', type: 'strL', format: '%9s', value: { kind: 'preview', text: 'abc', row: 4, stored_bytes: 5000 }, mode: 'formats', shows: 'abc…' },
    { what: 'a binary strL says so, with its size', type: 'strL', format: '%9s', value: { kind: 'binary', stored_bytes: 1204 }, mode: 'formats', shows: 'binary, 1,204 bytes' },
    { what: 'a short binary strL read whole says the same', type: 'strL', format: '%9s', value: new Uint8Array(3), mode: 'values', shows: 'binary, 3 bytes' },
];

describe('data browser display truth: dates and %g as R shows them', () => {
    for (const my_row of AS_R) {
        it(`${my_row.what}: ${my_row.format} ${String(my_row.value)} → "${my_row.shows}"`, () => {
            expect(display(my_row)).toBe(my_row.shows);
        });
    }
});

describe('data browser display truth: formats shown as Stata does', () => {
    for (const my_row of AS_STATA) {
        it(`${my_row.what}: ${my_row.format} ${String(my_row.value)} → "${my_row.shows}"`, () => {
            expect(display(my_row)).toBe(my_row.shows);
        });
    }
});

describe('data browser display truth: modes, missing values, strings', () => {
    for (const my_row of VALUES_AND_LABELS) {
        it(`${my_row.what} → "${my_row.shows}"`, () => {
            expect(display(my_row)).toBe(my_row.shows);
        });
    }

    it('a preview carries its file row and full length for copying', () => {
        const my_cell = build_cell_value(
            { kind: 'preview', text: 'abc', row: 4, stored_bytes: 5000 },
            { type: 'strL', format: '%9s', value_label_name: '' }
        );
        expect(my_cell).toMatchObject({
            raw: 'abc',
            truncated: true,
            file_row: 4,
            stored_bytes: 5000,
        });
        expect(STRL_PREVIEW_BYTES).toBe(256);
    });

    it('sends a string once, without display copies', () => {
        expect(build_cell_value(
            'São Paulo',
            { type: 'str20', format: '%20s', value_label_name: '' }
        )).toEqual({ raw: 'São Paulo' });
    });
});
