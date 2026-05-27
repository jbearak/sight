import { describe, expect, it } from 'bun:test';
import {
    build_predicate,
    default_form_state,
    predicate_to_kind_value,
    seed_from_entry,
} from '../../../client/src/data-browser/webview/filter-popover-seed';
import type { FilterPredicate } from '../../../client/src/data-browser/types';

// Round-trip a predicate through the form state: a persisted predicate
// should seed the form, and rebuilding from that form must reproduce it.
const round_trip = (
    p: FilterPredicate,
    set_uses_checklist = true
): FilterPredicate | null =>
    build_predicate(
        predicate_to_kind_value(p),
        seed_from_entry(p),
        { set_uses_checklist }
    );

describe('data-browser filter-popover-seed round-trip', () => {
    const cases: FilterPredicate[] = [
        { kind: 'isEmpty' },
        { kind: 'isNotEmpty' },
        // Falsy zero must survive String(0) -> parseFloat('0') -> 0.
        { kind: 'numCompare', op: '>', value: 0 },
        { kind: 'numCompare', op: '!=', value: -3.5 },
        { kind: 'numBetween', lo: 0, hi: 5, inclusive: true },
        { kind: 'numNotBetween', lo: 1, hi: 9, inclusive: false },
        { kind: 'setIn', values: [1, 3] },
        { kind: 'setNotIn', values: [2] },
        { kind: 'strContains', value: 'ab', case_sensitive: false, negate: false },
        { kind: 'strContains', value: 'ab', case_sensitive: true, negate: true },
        { kind: 'strStartsWith', value: 'pre', case_sensitive: false },
        { kind: 'strEndsWith', value: 'fix', case_sensitive: true },
        { kind: 'strCompare', op: '=', value: 'x', case_sensitive: false },
        { kind: 'strCompare', op: '!=', value: 'y', case_sensitive: true },
        { kind: 'strRegex', pattern: '^file', case_sensitive: true },
        { kind: 'dateCompare', op: '<=', value: '2024-01-01' },
        { kind: 'dateBetween', lo: '2024-01-01', hi: '2024-12-31', inclusive: true },
        { kind: 'dateNotBetween', lo: '2024-01-01', hi: '2024-12-31', inclusive: false },
    ];

    for (const p of cases) {
        it(`round-trips ${p.kind} ${JSON.stringify(p)}`, () => {
            expect(round_trip(p)).toEqual(p);
        });
    }

    it('round-trips a labelled set through the free-text path', () => {
        const p: FilterPredicate = { kind: 'setIn', values: [1, 3] };
        expect(round_trip(p, false)).toEqual(p);
    });
});

describe('data-browser build_predicate guards', () => {
    const blank = default_form_state();

    it('returns null for an empty numeric comparison', () => {
        expect(build_predicate('numCompare', blank, {
            set_uses_checklist: true,
        })).toBeNull();
    });

    it('returns null for an empty set', () => {
        expect(build_predicate('setIn', blank, {
            set_uses_checklist: true,
        })).toBeNull();
    });

    it('returns null for an empty string contains', () => {
        expect(build_predicate('strContains', blank, {
            set_uses_checklist: true,
        })).toBeNull();
    });

    it('returns null when the regex has a syntax error', () => {
        const form = default_form_state();
        form.str_regex = {
            pattern: '(', case_sensitive: true, regex_error: 'bad',
        };
        expect(build_predicate('strRegex', form, {
            set_uses_checklist: true,
        })).toBeNull();
    });

    it('parses comma/newline free-text codes into numbers', () => {
        const form = default_form_state();
        form.free_text = { text: '1, 2\n3' };
        expect(build_predicate('setIn', form, {
            set_uses_checklist: false,
        })).toEqual({ kind: 'setIn', values: [1, 2, 3] });
    });
});
