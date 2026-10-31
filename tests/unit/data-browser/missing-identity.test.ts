/**
 * Missing-identity battery: Stata's 27 numeric missing values (`.` and
 * `.a`–`.z`) must stay distinct from each other, and from the strings
 * "." and ".a", wherever the data browser handles a cell. After
 * table-viewer's `stata-missing-comparison.test.ts`.
 *
 * Display and filtering keep the codes distinct today. Sorting does
 * not order them among themselves (they tie and keep file order); that
 * is pinned as a known gap for the redesign (specs/
 * 2026-10-30-data-browser-redesign.md, "Sort", rule 2).
 */

import { describe, expect, it } from 'bun:test';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import type { Cell, MissingName } from '../../../client/src/data-browser/dta-source';
import { compute_filtered_indices } from '../../../client/src/data-browser/filter';
import {
    build_sort_column,
    compute_permutation,
} from '../../../client/src/data-browser/sort';
import type { FilterState } from '../../../client/src/data-browser/types';
import { get_cell_display_value } from '../../../client/src/data-browser/webview/grid-model';
import { ALL_MISSING_NAMES, column_of, miss } from './cells';

const ALL_CODES: MissingName[] = ALL_MISSING_NAMES;

const NUMERIC = { type: 'double', format: '%9.0g', value_label_name: '' };
const STRING = { type: 'str4', format: '%4s', value_label_name: '' };

function shown(raw: Cell, variable = NUMERIC): string {
    return get_cell_display_value(build_cell_value(raw, variable), false, true);
}

describe('missing identity: display', () => {
    it('has 27 codes', () => {
        expect(ALL_CODES).toHaveLength(27);
    });

    it('shows each code as itself, so all 27 are pairwise distinct', () => {
        const the_shown = ALL_CODES.map(my_c => shown(miss(my_c)));
        expect(the_shown).toEqual(ALL_CODES);
        expect(new Set(the_shown).size).toBe(27);
    });

    it('marks every code as missing, and the strings "." and ".a" as not', () => {
        for (const my_code of ALL_CODES) {
            const my_cell = build_cell_value(miss(my_code), NUMERIC);
            expect(my_cell.missing_type).toBe(my_code);
            expect(my_cell.raw).toBeNull();
        }
        for (const my_text of ['.', '.a']) {
            const my_cell = build_cell_value(my_text, STRING);
            expect(my_cell.missing_type).toBeUndefined();
            expect(my_cell.raw).toBe(my_text);
        }
    });
});

describe('missing identity: filter', () => {
    const the_values: Cell[] = [
        1,
        ...ALL_CODES.map(my_c => miss(my_c)),
    ];
    const filter_of = (predicate: FilterState['entries'][number]['predicate'],
        include_missing: boolean): FilterState => ({
        entries: [{
            id: 'f', col_index: 0, predicate, enabled: true, include_missing,
        }],
        labels_on_when_filtered: false,
    });
    const survivors = (state: FilterState) => [
        ...(compute_filtered_indices(
            new Map([[0, { column: column_of(the_values) }]]),
            state,
            the_values.length
        ) ?? []),
    ];

    it('isEmpty keeps every one of the 27 codes and nothing else', () => {
        expect(survivors(filter_of({ kind: 'isEmpty' }, false)))
            .toEqual(ALL_CODES.map((_, i) => i + 1));
    });

    it('a numeric predicate drops every code unless missing is included', () => {
        const my_gt = { kind: 'numCompare' as const, op: '>' as const, value: 0 };
        expect(survivors(filter_of(my_gt, false))).toEqual([0]);
        expect(survivors(filter_of(my_gt, true))).toHaveLength(28);
    });
});

describe('missing identity: sort', () => {
    // Codes in reverse Stata order, after two present values.
    const the_reversed = [...ALL_CODES].reverse();
    const the_values: Cell[] = [
        2,
        1,
        ...the_reversed.map(my_c => miss(my_c)),
    ];
    const order = (direction: 1 | -1) => [
        ...compute_permutation(
            [build_sort_column(column_of(the_values), 'numeric', undefined, false)],
            [direction],
            the_values.length
        ),
    ].map(my_row => {
        const my_value = the_values[my_row];
        return typeof my_value === 'number'
            ? String(my_value)
            : shown(my_value);
    });

    it('puts every missing code after every present value, both directions', () => {
        expect(order(1).slice(0, 2)).toEqual(['1', '2']);
        expect(order(-1).slice(0, 2)).toEqual(['2', '1']);
    });

    it('known gap: missing codes tie and keep file order instead of . < .a < … < .z', () => {
        // Pinned to today's order; Phase 2 sorts the missing partition
        // by code, which makes this fail on purpose.
        expect(order(1).slice(2)).toEqual(the_reversed);
        expect(order(1).slice(2)).not.toEqual(ALL_CODES);
    });
});
