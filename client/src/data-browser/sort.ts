/**
 * Sort engine for the data browser (pure; no I/O).
 *
 * `build_sort_column` turns one whole-column read (`RowCell[]`) plus its
 * variable metadata into a {@link SortColumn}; `compute_permutation`
 * lexicographically orders rows across one or more columns into a
 * `Uint32Array` permutation over original row indices.
 *
 * Invariants (ported from Raven's data-viewer sort.ts):
 *   - **Stable**: equal rows keep their original order (relies on
 *     `Array.prototype.sort` stability, guaranteed since ES2019).
 *   - **NA-last in both directions**: Stata missing values always sort
 *     after present values regardless of asc/desc. (Deliberate UX
 *     choice — not Stata's "missing == +infinity" semantics.)
 *   - **WYSIWYG labels**: labelled-numeric columns sort by the displayed
 *     label when Labels is on, by the underlying numeric code when off.
 *   - **Format independence**: display format never affects order.
 */

import {
    is_missing_value_object,
    type RowCell,
} from '@jbearak/dta-parser';

export type SortKind = 'numeric' | 'labelledNumeric' | 'date' | 'string';

export interface SortColumn {
    /** `missing[i]` is non-zero iff row `i` is a Stata missing value. */
    missing: Uint8Array;
    /** Signed comparator for two present rows, ascending convention. */
    compare: (a: number, b: number) => number;
}

// Stata date/time display formats that live on a day/millisecond domain
// an ISO string converts cleanly into: daily (%td, legacy %d) and clock
// (%tc, %tC). The other %t<x> formats (%tw weekly, %tm monthly, %tq
// quarterly, %th half-yearly, %ty yearly, %tg generic) store integer
// offsets in non-day units, so a date filter's ISO->days conversion would
// silently mis-match them. They classify as `numeric` and are
// sorted/filtered by the raw code (still monotonic in time). See
// iso_to_stata_date in filter.ts.
const DATE_FORMAT_PATTERN = /^%-?(t[cCd]|d)/;
const STRING_TYPE_PATTERN = /^(str\d+|strL)$/i;

const COLLATOR = new Intl.Collator(undefined, {
    sensitivity: 'variant',
    numeric: true,
});

export function classify_sort_kind(variable: {
    type: string;
    format: string;
    has_value_labels: boolean;
}): SortKind {
    if (STRING_TYPE_PATTERN.test(variable.type)) {
        return 'string';
    }
    if (variable.has_value_labels) {
        return 'labelledNumeric';
    }
    if (DATE_FORMAT_PATTERN.test(variable.format)) {
        return 'date';
    }
    return 'numeric';
}

/**
 * Build a {@link SortColumn} from a whole-column read.
 *
 * `labels_on` routes labelled-numeric columns by displayed label vs.
 * underlying code. A `labelledNumeric` column with `labels_on === false`
 * (or no `value_label_table`) sorts exactly like a `numeric` column.
 */
export function build_sort_column(
    values: readonly RowCell[],
    kind: SortKind,
    value_label_table: Map<number, string> | undefined,
    labels_on: boolean
): SortColumn {
    const my_count = values.length;
    const my_missing = new Uint8Array(my_count);

    const use_labels =
        kind === 'labelledNumeric'
        && labels_on
        && value_label_table !== undefined;

    if (kind === 'string' || use_labels) {
        const the_display: string[] = new Array(my_count);
        for (let i = 0; i < my_count; i++) {
            const my_value = values[i];
            if (is_missing_value_object(my_value)) {
                my_missing[i] = 1;
                the_display[i] = '';
                continue;
            }
            if (use_labels && typeof my_value === 'number') {
                const my_label = value_label_table!.get(my_value);
                the_display[i] = my_label !== undefined
                    ? my_label
                    : String(my_value);
            } else {
                the_display[i] = String(my_value);
            }
        }
        return {
            missing: my_missing,
            compare: (a, b) =>
                COLLATOR.compare(the_display[a], the_display[b]),
        };
    }

    // numeric / date / labelledNumeric-by-code
    const the_values = new Float64Array(my_count);
    for (let i = 0; i < my_count; i++) {
        const my_value = values[i];
        if (
            is_missing_value_object(my_value)
            || typeof my_value !== 'number'
        ) {
            my_missing[i] = 1;
            the_values[i] = 0;
        } else {
            the_values[i] = my_value;
        }
    }
    return {
        missing: my_missing,
        compare: (a, b) => Math.sign(the_values[a] - the_values[b]),
    };
}

/**
 * Build a stable, NA-last, multi-key lexicographic permutation.
 *
 * `directions[k]` is `1` for ascending, `-1` for descending. An empty
 * `columns` array yields the identity permutation.
 */
export function compute_permutation(
    columns: readonly SortColumn[],
    directions: readonly (1 | -1)[],
    nobs: number
): Uint32Array {
    const my_perm = new Uint32Array(nobs);
    for (let i = 0; i < nobs; i++) {
        my_perm[i] = i;
    }
    if (columns.length === 0) {
        return my_perm;
    }

    const the_index = Array.from(my_perm);
    the_index.sort((a, b) => compare_rows(a, b, columns, directions));
    for (let i = 0; i < nobs; i++) {
        my_perm[i] = the_index[i];
    }
    return my_perm;
}

function compare_rows(
    a: number,
    b: number,
    columns: readonly SortColumn[],
    directions: readonly (1 | -1)[]
): number {
    for (let k = 0; k < columns.length; k++) {
        const my_col = columns[k];
        const a_missing = my_col.missing[a] !== 0;
        const b_missing = my_col.missing[b] !== 0;
        if (a_missing && b_missing) continue;
        if (a_missing) return 1; // a missing -> after b
        if (b_missing) return -1; // b missing -> after a
        const my_cmp = my_col.compare(a, b);
        if (my_cmp !== 0) return my_cmp * directions[k];
    }
    return 0;
}
