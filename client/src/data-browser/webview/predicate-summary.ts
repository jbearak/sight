/**
 * Pure summarizer for FilterPredicates. Used by chip labels, aria labels,
 * and the status bar. Output is short (chips have limited width) and uses
 * Unicode glyphs (≠, ≤, ∈, ∉) so a chip reads like math without CSS.
 *
 * Set-membership summaries map numeric codes to value labels when the
 * column has a value-label table, and truncate after 4 values.
 *
 * Ported from Raven's predicate-summary (Stata has no boolean/factor
 * kinds; sets are numeric codes resolved through `value_labels`).
 */

import type { FilterPredicate } from '../types.js';

const SET_TRUNCATE_AT = 4;

interface SummaryColumn {
    name: string;
    value_labels?: Record<string, string>;
}

export function summarize_predicate(
    predicate: FilterPredicate,
    column: SummaryColumn
): string {
    const n = column.name;
    switch (predicate.kind) {
        case 'isEmpty':
            return `${n} is empty`;
        case 'isNotEmpty':
            return `${n} is not empty`;
        case 'numCompare':
            return `${n} ${num_op(predicate.op)} ${predicate.value}`;
        case 'numBetween':
            return predicate.inclusive
                ? `${n} ${predicate.lo}–${predicate.hi}`
                : `${n} (${predicate.lo}, ${predicate.hi})`;
        case 'numNotBetween':
            return predicate.inclusive
                ? `${n} not in ${predicate.lo}–${predicate.hi}`
                : `${n} not in (${predicate.lo}, ${predicate.hi})`;
        case 'setIn':
            return `${n} ∈ {${summarize_set(
                map_set_values(predicate.values, column)
            )}}`;
        case 'setNotIn':
            return `${n} ∉ {${summarize_set(
                map_set_values(predicate.values, column)
            )}}`;
        case 'strCompare':
            return `${n} ${predicate.op === '=' ? '=' : '≠'} `
                + `"${predicate.value}"`;
        case 'strContains':
            return `${n} ${predicate.negate ? 'not contains' : 'contains'} `
                + `"${predicate.value}"`;
        case 'strStartsWith':
            return `${n} starts with "${predicate.value}"`;
        case 'strEndsWith':
            return `${n} ends with "${predicate.value}"`;
        case 'strRegex':
            return `${n} matches /${predicate.pattern}/`
                + `${predicate.case_sensitive ? '' : 'i'}`;
        case 'dateCompare':
            return `${n} ${num_op(predicate.op)} ${predicate.value}`;
        case 'dateBetween':
            return predicate.inclusive
                ? `${n} ${predicate.lo}–${predicate.hi}`
                : `${n} (${predicate.lo}, ${predicate.hi})`;
        case 'dateNotBetween':
            return predicate.inclusive
                ? `${n} not in ${predicate.lo}–${predicate.hi}`
                : `${n} not in (${predicate.lo}, ${predicate.hi})`;
    }
}

function num_op(
    op: '=' | '!=' | '<' | '<=' | '>' | '>='
): string {
    switch (op) {
        case '=':
            return '=';
        case '!=':
            return '≠';
        case '<':
            return '<';
        case '<=':
            return '≤';
        case '>':
            return '>';
        case '>=':
            return '≥';
    }
}

/** Map each stored numeric code to its label when the column has a
 *  value-label table, falling back to the bare code when unmapped. */
function map_set_values(
    values: number[],
    column: SummaryColumn
): (string | number)[] {
    const my_labels = column.value_labels;
    if (!my_labels) return values;
    return values.map(my_value => my_labels[String(my_value)] ?? my_value);
}

function summarize_set(values: (string | number)[]): string {
    if (values.length <= SET_TRUNCATE_AT) {
        return values.join(', ');
    }
    const my_head = values.slice(0, SET_TRUNCATE_AT).join(', ');
    const my_rest = values.length - SET_TRUNCATE_AT;
    return `${my_head} +${my_rest} more`;
}
