import { describe, expect, it } from 'bun:test';
import { make_missing_value, type RowCell } from '@jbearak/dta-parser';
import {
    compute_filtered_indices,
    iso_to_stata_date,
    type FilterColumn,
} from '../../../client/src/data-browser/filter';
import type { FilterEntry, FilterPredicate } from '../../../client/src/data-browser/types';

let id_counter = 0;
const entry = (
    col_index: number,
    predicate: FilterPredicate,
    include_missing = false,
    enabled = true
): FilterEntry => ({
    id: `e${id_counter++}`,
    col_index,
    predicate,
    enabled,
    include_missing,
});

const cols = (
    map: Record<number, RowCell[] | FilterColumn>
): Map<number, FilterColumn> => {
    const m = new Map<number, FilterColumn>();
    for (const [k, v] of Object.entries(map)) {
        m.set(Number(k), Array.isArray(v) ? { values: v } : v);
    }
    return m;
};

const run = (
    columns: Map<number, FilterColumn>,
    entries: FilterEntry[],
    nobs: number
): number[] | undefined => {
    const r = compute_filtered_indices(
        columns,
        { entries, labels_on_when_filtered: true },
        nobs
    );
    return r === undefined ? undefined : [...r];
};

describe('data-browser iso_to_stata_date', () => {
    it('maps daily dates to days since 1960-01-01', () => {
        expect(iso_to_stata_date('1960-01-01', false)).toBe(0);
        expect(iso_to_stata_date('1960-01-02', false)).toBe(1);
        expect(iso_to_stata_date('2024-01-01', false)).toBe(23376);
    });
    it('maps timestamps to ms since 1960-01-01', () => {
        expect(iso_to_stata_date('1960-01-01', true)).toBe(0);
        expect(iso_to_stata_date('1960-01-02', true)).toBe(86400000);
    });
    it('reads tz-less datetime-local input as UTC, not local time', () => {
        // The popover emits `datetime-local` strings (no zone) for %tc/%tC;
        // these must convert in UTC so the filter is timezone-independent.
        expect(iso_to_stata_date('1960-01-01T00:00', true)).toBe(0);
        expect(iso_to_stata_date('1960-01-01T01:00', true)).toBe(3600000);
        expect(iso_to_stata_date('1960-01-02T00:00', true)).toBe(86400000);
        // An explicit Z is honored unchanged.
        expect(iso_to_stata_date('1960-01-01T00:00Z', true)).toBe(0);
    });
    it('returns NaN for an unparseable date', () => {
        expect(Number.isNaN(iso_to_stata_date('nonsense', false)))
            .toBe(true);
    });
});

describe('data-browser compute_filtered_indices', () => {
    const mv = make_missing_value('.');

    it('returns undefined when no entry is enabled', () => {
        expect(run(cols({ 0: [1, 2] }), [], 2)).toBeUndefined();
        expect(run(
            cols({ 0: [1, 2] }),
            [entry(0, { kind: 'isNotEmpty' }, false, false)],
            2
        )).toBeUndefined();
    });

    it('numeric comparison excludes missing by default', () => {
        expect(run(
            cols({ 0: [5, mv, 20, 3] }),
            [entry(0, { kind: 'numCompare', op: '>', value: 4 })],
            4
        )).toEqual([0, 2]);
    });

    it('include_missing keeps missing rows', () => {
        expect(run(
            cols({ 0: [5, mv, 20, 3] }),
            [entry(0, { kind: 'numCompare', op: '>', value: 4 }, true)],
            4
        )).toEqual([0, 1, 2]);
    });

    it('numBetween inclusive vs exclusive', () => {
        expect(run(
            cols({ 0: [1, 2, 5, 6] }),
            [entry(0, {
                kind: 'numBetween', lo: 2, hi: 5, inclusive: true,
            })],
            4
        )).toEqual([1, 2]);
        expect(run(
            cols({ 0: [1, 2, 5, 6] }),
            [entry(0, {
                kind: 'numBetween', lo: 2, hi: 5, inclusive: false,
            })],
            4
        )).toEqual([]);
    });

    it('isEmpty matches only missing rows regardless of include flag', () => {
        expect(run(
            cols({ 0: [5, mv, 20] }),
            [entry(0, { kind: 'isEmpty' })],
            3
        )).toEqual([1]);
    });

    it('string contains is case-insensitive when asked', () => {
        expect(run(
            cols({ 0: ['Apple', 'banana', 'CAPE'] }),
            [entry(0, {
                kind: 'strContains', value: 'ap',
                case_sensitive: false, negate: false,
            })],
            3
        )).toEqual([0, 2]);
    });

    it('string regex matches; invalid regex matches nothing', () => {
        expect(run(
            cols({ 0: ['file_1', 'doc', 'file_2'] }),
            [entry(0, {
                kind: 'strRegex', pattern: '^file', case_sensitive: true,
            })],
            3
        )).toEqual([0, 2]);
        expect(run(
            cols({ 0: ['a', 'b'] }),
            [entry(0, {
                kind: 'strRegex', pattern: '(', case_sensitive: true,
            })],
            2
        )).toEqual([]);
    });

    it('date between converts ISO to the Stata day domain', () => {
        // 23376 = 2024-01-01, 23741 = 2024-12-31
        expect(run(
            cols({ 0: { values: [23376, 0, 23741], is_timestamp: false } }),
            [entry(0, {
                kind: 'dateBetween', lo: '2024-01-01', hi: '2024-12-31',
                inclusive: true,
            })],
            3
        )).toEqual([0, 2]);
    });

    it('setIn matches labelled-numeric codes', () => {
        expect(run(
            cols({ 0: [1, 2, 3, 1] }),
            [entry(0, { kind: 'setIn', values: [1, 3] })],
            4
        )).toEqual([0, 2, 3]);
    });

    it('intersects multiple enabled entries (AND)', () => {
        expect(run(
            cols({ 0: [1, 2, 3, 4], 1: [10, 20, 30, 40] }),
            [
                entry(0, { kind: 'numCompare', op: '>=', value: 2 }),
                entry(1, { kind: 'numCompare', op: '<', value: 40 }),
            ],
            4
        )).toEqual([1, 2]);
    });
});
