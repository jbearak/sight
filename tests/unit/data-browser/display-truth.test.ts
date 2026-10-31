/**
 * Display-truth battery for the data browser.
 *
 * Each row is a cell as Stata's Data Editor would show it. Rows the
 * browser already gets right are asserted as such. Rows it gets wrong
 * today are pinned to today's output under a "known gap" name, citing
 * the redesign spec (specs/2026-10-30-data-browser-redesign.md, "What
 * the numbers say", item 7). When a phase fixes a gap, its test fails;
 * move the row to `MATCHES_STATA` with the Stata text.
 *
 * The pipeline under test is the one the grid uses today: the host's
 * `build_cell_value` and the webview's `get_cell_display_value`.
 */

import { describe, expect, it } from 'bun:test';
import { make_missing_value, type MissingType } from '@jbearak/dta-parser';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import { get_cell_display_value } from '../../../client/src/data-browser/webview/grid-model';

// Stata's value-label key for an extended missing value (the long
// encoding: `.` is 2147483621, `.a` is 2147483622, …).
const LONG_MISSING_BASE = 2147483621;
const MISSING_ORDER = '.abcdefghijklmnopqrstuvwxyz';
function missing_label_key(code: MissingType): number {
    return LONG_MISSING_BASE + (code === '.' ? 0 : MISSING_ORDER.indexOf(code[1]));
}

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
    value?: number | string;
    missing?: MissingType;
    labels?: Map<number, string>;
    mode: Mode;
    stata: string;
}

function display(row: Row): string {
    const my_raw = row.missing !== undefined
        ? make_missing_value(row.missing)
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

const MATCHES_STATA: Row[] = [
    { what: '%td date', type: 'long', format: '%td', value: 21521, mode: 'formats', stata: '03dec2018' },
    { what: '%tc datetime', type: 'double', format: '%tc', value: 1859529600000, mode: 'formats', stata: '04dec2018 08:00:00' },
    { what: '%9.2f', type: 'double', format: '%9.2f', value: 1234567.891, mode: 'formats', stata: '1234567.89' },
    { what: '%12.0fc thousands separators', type: 'double', format: '%12.0fc', value: 1234567.891, mode: 'formats', stata: '1,234,568' },
    { what: '%9.2e', type: 'double', format: '%9.2e', value: 3.14159, mode: 'formats', stata: '3.14e+00' },
    { what: '%tm monthly', type: 'int', format: '%tm', value: 700, mode: 'formats', stata: '2018m5' },
    { what: '%tq quarterly', type: 'int', format: '%tq', value: 235, mode: 'formats', stata: '2018q4' },
    { what: '%tw weekly', type: 'int', format: '%tw', value: 3051, mode: 'formats', stata: '2018w36' },
    { what: '%ty yearly', type: 'int', format: '%ty', value: 2018, mode: 'formats', stata: '2018' },
    { what: 'system missing', type: 'double', format: '%9.0g', missing: '.', mode: 'formats', stata: '.' },
    { what: 'extended missing, no label', type: 'double', format: '%9.0g', missing: '.z', mode: 'labels', stata: '.z' },
    { what: 'labelled extended missing, labels on', type: 'byte', format: '%8.0g', missing: '.d', labels: YESNO, mode: 'labels', stata: "Don't know" },
    { what: 'labelled extended missing, labels off', type: 'byte', format: '%8.0g', missing: '.d', labels: YESNO, mode: 'formats', stata: '.d' },
    { what: 'labelled value, labels on', type: 'byte', format: '%8.0g', value: 1, labels: YESNO, mode: 'labels', stata: 'Yes' },
    { what: 'labelled value, labels off', type: 'byte', format: '%8.0g', value: 1, labels: YESNO, mode: 'formats', stata: '1' },
    { what: 'unlabelled code in a labelled column', type: 'byte', format: '%8.0g', value: 7, labels: YESNO, mode: 'labels', stata: '7' },
    { what: 'string', type: 'str20', format: '%20s', value: 'São Paulo', mode: 'formats', stata: 'São Paulo' },
    { what: 'empty string (string missing) is blank, as in Stata', type: 'str20', format: '%20s', value: '', mode: 'formats', stata: '' },
];

interface Gap extends Row {
    /** What the browser shows today. */
    today: string;
}

const KNOWN_GAPS: Gap[] = [
    { what: '%td with a DD/NN/CCYY mask', type: 'long', format: '%tdDD/NN/CCYY', value: 21521, mode: 'formats', stata: '03/12/2018', today: '21521' },
    { what: '%td with a Mon_DD,_CCYY mask', type: 'long', format: '%tdMon_DD,_CCYY', value: 21521, mode: 'formats', stata: 'Dec 03, 2018', today: '21521' },
    { what: '%tc with an HH:MM mask', type: 'double', format: '%tcHH:MM', value: 1859529600000, mode: 'formats', stata: '08:00', today: '1859529600000' },
    { what: '%th half-yearly', type: 'int', format: '%th', value: 117, mode: 'formats', stata: '2018h2', today: '117' },
    { what: '%9.0g width limits digits', type: 'double', format: '%9.0g', value: 1234567.891, mode: 'formats', stata: '1234568', today: '1234567.891' },
    { what: '%9.0g drops the leading zero', type: 'double', format: '%9.0g', value: 0.5, mode: 'formats', stata: '.5', today: '0.5' },
];

describe('data browser display truth: matches Stata', () => {
    for (const my_row of MATCHES_STATA) {
        it(`${my_row.what}: ${my_row.format} ${String(my_row.value ?? my_row.missing)} → "${my_row.stata}"`, () => {
            expect(display(my_row)).toBe(my_row.stata);
        });
    }
});

describe('data browser display truth: known gaps (redesign spec, Phase 1b/2)', () => {
    for (const my_gap of KNOWN_GAPS) {
        it(`known gap: ${my_gap.what} shows "${my_gap.today}", Stata shows "${my_gap.stata}"`, () => {
            // Pinned to today's output; a fix makes this fail on purpose.
            expect(display(my_gap)).toBe(my_gap.today);
            expect(my_gap.today).not.toBe(my_gap.stata);
        });
    }
});
