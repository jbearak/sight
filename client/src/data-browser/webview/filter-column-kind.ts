/**
 * Pure column-type categorisation for the filter editor. Maps a variable
 * to its filter kind and supplies the ordered predicate-kind option list
 * the popover dropdown shows per kind. React-free so it stays unit-
 * testable under bun and the popover stays focused on rendering.
 *
 * Ported from Raven's filter-column-kind.ts, adapted to Stata: value
 * labels attach only to numerics and there is no Arrow Dictionary or
 * native Bool, so Raven's `factor` and `bool` kinds collapse. The kind set
 * is exactly the sort engine's {@link SortKind}, so `col_kind` delegates to
 * `classify_sort_kind` rather than duplicating the classification.
 */

import { classify_sort_kind, type SortKind } from '../sort.js';
import type { VariableDescription } from '../types.js';

export type ColKind = SortKind;

export function col_kind(variable: VariableDescription): ColKind {
    return classify_sort_kind(variable);
}

export interface KindOption {
    /** UI-level option value consumed by filter-popover-seed's
     *  build_predicate (e.g. `strNotContains`, `strCompareEq`), not always
     *  a raw FilterPredicate kind. */
    value: string;
    label: string;
}

const NUMERIC_OPTIONS: KindOption[] = [
    { value: 'numCompare', label: 'Compare (=, ≠, <, ≤, >, ≥)' },
    { value: 'numBetween', label: 'Between' },
    { value: 'numNotBetween', label: 'Not between' },
    { value: 'isEmpty', label: 'Is empty / missing' },
    { value: 'isNotEmpty', label: 'Is not empty' },
];

const LABELLED_NUMERIC_OPTIONS: KindOption[] = [
    { value: 'setIn', label: 'Is one of' },
    { value: 'setNotIn', label: 'Is not one of' },
    ...NUMERIC_OPTIONS,
];

const STRING_OPTIONS: KindOption[] = [
    { value: 'strContains', label: 'Contains' },
    { value: 'strNotContains', label: 'Does not contain' },
    { value: 'strStartsWith', label: 'Starts with' },
    { value: 'strEndsWith', label: 'Ends with' },
    { value: 'strCompareEq', label: 'Equals (=)' },
    { value: 'strCompareNe', label: 'Not equals (≠)' },
    { value: 'strRegex', label: 'Matches regex' },
    { value: 'isEmpty', label: 'Is empty / missing' },
    { value: 'isNotEmpty', label: 'Is not empty' },
];

const DATE_OPTIONS: KindOption[] = [
    { value: 'dateCompare', label: 'Compare (=, ≠, <, ≤, >, ≥)' },
    { value: 'dateBetween', label: 'Between' },
    { value: 'dateNotBetween', label: 'Not between' },
    { value: 'isEmpty', label: 'Is empty / missing' },
    { value: 'isNotEmpty', label: 'Is not empty' },
];

export function kind_options(kind: ColKind): KindOption[] {
    switch (kind) {
        case 'labelledNumeric':
            return LABELLED_NUMERIC_OPTIONS;
        case 'numeric':
            return NUMERIC_OPTIONS;
        case 'string':
            return STRING_OPTIONS;
        case 'date':
            return DATE_OPTIONS;
    }
}

/**
 * Checklist rows for a labelled-numeric column: one per labelled code,
 * sorted by numeric code ascending. The code is what the filter matches
 * on; the label is display-only. Non-numeric keys are dropped, and a
 * column with no value-label table yields `[]`.
 */
export function labelled_choices(
    variable: VariableDescription
): { code: number; label: string }[] {
    const the_labels = variable.value_labels;
    if (!the_labels) return [];
    return Object.entries(the_labels)
        .map(([code_str, my_label]) => ({
            code: Number(code_str),
            label: my_label,
        }))
        .filter(my_choice => Number.isFinite(my_choice.code))
        .sort((a, b) => a.code - b.code);
}
