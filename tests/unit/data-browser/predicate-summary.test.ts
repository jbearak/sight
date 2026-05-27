import { describe, expect, it } from 'bun:test';
import { summarize_predicate } from '../../../client/src/data-browser/webview/predicate-summary';
import type { FilterPredicate } from '../../../client/src/data-browser/types';

const col = (
    name: string,
    value_labels?: Record<string, string>
) => ({ name, value_labels });

const s = (p: FilterPredicate, value_labels?: Record<string, string>) =>
    summarize_predicate(p, col('x', value_labels));

describe('data-browser summarize_predicate', () => {
    it('summarizes universal predicates', () => {
        expect(s({ kind: 'isEmpty' })).toBe('x is empty');
        expect(s({ kind: 'isNotEmpty' })).toBe('x is not empty');
    });

    it('summarizes numeric comparisons with glyphs', () => {
        expect(s({ kind: 'numCompare', op: '>', value: 20 }))
            .toBe('x > 20');
        expect(s({ kind: 'numCompare', op: '!=', value: 6 }))
            .toBe('x ≠ 6');
        expect(s({ kind: 'numCompare', op: '<=', value: 0 }))
            .toBe('x ≤ 0');
    });

    it('summarizes numeric ranges', () => {
        expect(s({ kind: 'numBetween', lo: 1, hi: 5, inclusive: true }))
            .toBe('x 1–5');
        expect(s({ kind: 'numBetween', lo: 1, hi: 5, inclusive: false }))
            .toBe('x (1, 5)');
        expect(s({
            kind: 'numNotBetween', lo: 1, hi: 5, inclusive: true,
        })).toBe('x not in 1–5');
    });

    it('maps labelled-numeric set values to labels', () => {
        const labels = { '1': 'Male', '2': 'Female' };
        expect(s({ kind: 'setIn', values: [1, 2] }, labels))
            .toBe('x ∈ {Male, Female}');
        expect(s({ kind: 'setNotIn', values: [1] }, labels))
            .toBe('x ∉ {Male}');
    });

    it('shows bare codes when no labels', () => {
        expect(s({ kind: 'setIn', values: [1, 2] }))
            .toBe('x ∈ {1, 2}');
    });

    it('truncates large sets', () => {
        expect(s({ kind: 'setIn', values: [1, 2, 3, 4, 5, 6] }))
            .toBe('x ∈ {1, 2, 3, 4 +2 more}');
    });

    it('summarizes string predicates', () => {
        expect(s({
            kind: 'strCompare', op: '=', value: 'foo',
            case_sensitive: true,
        })).toBe('x = "foo"');
        expect(s({
            kind: 'strContains', value: 'foo',
            case_sensitive: false, negate: true,
        })).toBe('x not contains "foo"');
        expect(s({
            kind: 'strStartsWith', value: 'a', case_sensitive: true,
        })).toBe('x starts with "a"');
        expect(s({
            kind: 'strRegex', pattern: '^f', case_sensitive: false,
        })).toBe('x matches /^f/i');
        expect(s({
            kind: 'strRegex', pattern: '^f', case_sensitive: true,
        })).toBe('x matches /^f/');
    });

    it('summarizes date predicates', () => {
        expect(s({
            kind: 'dateCompare', op: '<', value: '2024-01-01',
        })).toBe('x < 2024-01-01');
        expect(s({
            kind: 'dateBetween', lo: '2024-01-01', hi: '2024-12-31',
            inclusive: true,
        })).toBe('x 2024-01-01–2024-12-31');
    });
});
