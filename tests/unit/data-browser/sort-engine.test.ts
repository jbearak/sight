import { describe, expect, it } from 'bun:test';
import { make_missing_value, type RowCell } from '@jbearak/dta-parser';
import {
    build_sort_column,
    classify_sort_kind,
    compute_permutation,
} from '../../../client/src/data-browser/sort';

const perm = (
    values: RowCell[],
    kind: Parameters<typeof build_sort_column>[1],
    direction: 1 | -1,
    labels_on = true,
    table?: Map<number, string>
) => {
    const col = build_sort_column(values, kind, table, labels_on);
    return [...compute_permutation([col], [direction], values.length)];
};

describe('data-browser classify_sort_kind', () => {
    const v = (
        type: string,
        format: string,
        has_value_labels = false
    ) => ({ type, format, has_value_labels });

    it('classifies plain numerics', () => {
        expect(classify_sort_kind(v('float', '%9.0g'))).toBe('numeric');
        expect(classify_sort_kind(v('long', '%12.0g'))).toBe('numeric');
    });
    it('classifies daily/clock formats as date', () => {
        expect(classify_sort_kind(v('float', '%td'))).toBe('date');
        expect(classify_sort_kind(v('double', '%tc'))).toBe('date');
        expect(classify_sort_kind(v('double', '%tC'))).toBe('date');
        expect(classify_sort_kind(v('long', '%d'))).toBe('date');
    });
    it('classifies non-daily %t formats as numeric (no clean ISO map)', () => {
        // %tw/%tm/%tq/%th/%ty store offsets in non-day units; a date
        // filter would mis-convert ISO->days, so they stay numeric.
        expect(classify_sort_kind(v('int', '%tq'))).toBe('numeric');
        expect(classify_sort_kind(v('int', '%tm'))).toBe('numeric');
        expect(classify_sort_kind(v('int', '%tw'))).toBe('numeric');
    });
    it('classifies labelled numerics ahead of date', () => {
        expect(classify_sort_kind(v('byte', '%9.0g', true)))
            .toBe('labelledNumeric');
    });
    it('classifies strings', () => {
        expect(classify_sort_kind(v('str8', '%9s'))).toBe('string');
        expect(classify_sort_kind(v('strL', '%9s'))).toBe('string');
    });
});

describe('data-browser compute_permutation', () => {
    it('returns identity for no sort keys', () => {
        expect([...compute_permutation([], [], 3)]).toEqual([0, 1, 2]);
    });

    it('sorts numeric ascending, missing last', () => {
        const mv = make_missing_value('.');
        expect(perm([3, mv, 1], 'numeric', 1)).toEqual([2, 0, 1]);
    });

    it('keeps missing last in descending too', () => {
        const mv = make_missing_value('.');
        expect(perm([3, mv, 1], 'numeric', -1)).toEqual([0, 2, 1]);
    });

    it('breaks ties with a secondary key (stable, lexicographic)', () => {
        // primary: [1,1,0]; secondary: [9,2,5]
        const c1 = build_sort_column([1, 1, 0], 'numeric', undefined, true);
        const c2 = build_sort_column([9, 2, 5], 'numeric', undefined, true);
        // asc primary then asc secondary: row2(0,5), row1(1,2), row0(1,9)
        expect([...compute_permutation([c1, c2], [1, 1], 3)])
            .toEqual([2, 1, 0]);
    });

    it('is stable: equal rows keep input order', () => {
        const col = build_sort_column([5, 5, 5], 'numeric', undefined, true);
        expect([...compute_permutation([col], [1], 3)]).toEqual([0, 1, 2]);
    });

    it('sorts strings with numeric-aware collation', () => {
        // "file_2" should come before "file_10"
        expect(perm(['file_10', 'file_2'], 'string', 1)).toEqual([1, 0]);
    });

    it('sorts labelled numerics by label when labels on', () => {
        const table = new Map([[1, 'Zebra'], [2, 'Apple']]);
        // code 2 ("Apple") before code 1 ("Zebra")
        expect(perm([1, 2], 'labelledNumeric', 1, true, table))
            .toEqual([1, 0]);
    });

    it('sorts labelled numerics by code when labels off', () => {
        const table = new Map([[1, 'Zebra'], [2, 'Apple']]);
        expect(perm([1, 2], 'labelledNumeric', 1, false, table))
            .toEqual([0, 1]);
    });

    it('sorts date columns by the underlying day number', () => {
        expect(perm([100, 50, 200], 'date', 1)).toEqual([1, 0, 2]);
    });
});
