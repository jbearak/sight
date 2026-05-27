import { describe, expect, it } from 'bun:test';
import {
    col_kind,
    kind_options,
    labelled_choices,
} from '../../../client/src/data-browser/webview/filter-column-kind';
import type { VariableDescription } from '../../../client/src/data-browser/types';

const variable = (
    over: Partial<VariableDescription>
): VariableDescription => ({
    name: 'v',
    type: 'float',
    format: '%9.0g',
    label: '',
    has_value_labels: false,
    ...over,
});

describe('data-browser col_kind', () => {
    it('delegates to classify_sort_kind across the four kinds', () => {
        expect(col_kind(variable({ type: 'float', format: '%9.0g' })))
            .toBe('numeric');
        expect(col_kind(variable({ has_value_labels: true })))
            .toBe('labelledNumeric');
        expect(col_kind(variable({ format: '%td' }))).toBe('date');
        expect(col_kind(variable({ type: 'str12', format: '%12s' })))
            .toBe('string');
    });
});

describe('data-browser kind_options', () => {
    const values = (kind: ReturnType<typeof col_kind>) =>
        kind_options(kind).map(my_option => my_option.value);

    it('orders numeric options with comparisons first', () => {
        expect(values('numeric')).toEqual([
            'numCompare', 'numBetween', 'numNotBetween',
            'isEmpty', 'isNotEmpty',
        ]);
    });

    it('puts set membership first for labelled numerics', () => {
        expect(values('labelledNumeric')).toEqual([
            'setIn', 'setNotIn',
            'numCompare', 'numBetween', 'numNotBetween',
            'isEmpty', 'isNotEmpty',
        ]);
    });

    it('orders string options contains-first', () => {
        expect(values('string')).toEqual([
            'strContains', 'strNotContains',
            'strStartsWith', 'strEndsWith',
            'strCompareEq', 'strCompareNe', 'strRegex',
            'isEmpty', 'isNotEmpty',
        ]);
    });

    it('orders date options compare-first', () => {
        expect(values('date')).toEqual([
            'dateCompare', 'dateBetween', 'dateNotBetween',
            'isEmpty', 'isNotEmpty',
        ]);
    });

    it('gives every option a non-empty label', () => {
        for (const my_kind of
            ['numeric', 'labelledNumeric', 'string', 'date'] as const) {
            for (const my_option of kind_options(my_kind)) {
                expect(my_option.label.length).toBeGreaterThan(0);
            }
        }
    });
});

describe('data-browser labelled_choices', () => {
    it('returns code/label pairs sorted by code ascending', () => {
        const v = variable({
            has_value_labels: true,
            value_labels: { '3': 'High', '1': 'Low', '2': 'Mid' },
        });
        expect(labelled_choices(v)).toEqual([
            { code: 1, label: 'Low' },
            { code: 2, label: 'Mid' },
            { code: 3, label: 'High' },
        ]);
    });

    it('drops non-numeric codes and returns [] without a table', () => {
        const v = variable({
            has_value_labels: true,
            value_labels: { '5': 'Five', 'x': 'Bad' },
        });
        expect(labelled_choices(v)).toEqual([{ code: 5, label: 'Five' }]);
        expect(labelled_choices(variable({}))).toEqual([]);
    });
});
