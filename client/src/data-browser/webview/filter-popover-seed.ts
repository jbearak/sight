/**
 * Pure seed/build helpers for the filter popover form — the bidirectional
 * mapping between a persisted FilterPredicate and the editor's per-kind
 * form state. Extracted from the popover (no React) so the round-trip
 * (predicate -> form state -> predicate) is unit-testable.
 *
 * Invariant: predicate_to_kind_value, seed_from_entry, and build_predicate
 * stay in lockstep with the FilterPredicate union in types.ts and the
 * kind-select option values in filter-column-kind.ts. Adding a predicate
 * kind means touching all three; the round-trip test guards it.
 *
 * Ported from Raven's filter-popover-seed.ts. Stata adaptations: no `bool`
 * kind; predicate fields are snake_case (case_sensitive); set membership
 * is numeric codes only (labelled-numeric columns), so set state holds
 * numbers and the free-text fallback parses codes into numbers.
 */

import type { FilterPredicate } from '../types.js';

type CompareOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

// ── Value-editor state shapes ──────────────────────────────────────────

export interface NumCompareState {
    op: CompareOp;
    value: string;
}
export interface NumBetweenState {
    lo: string;
    hi: string;
    inclusive: boolean;
}
export interface SetState {
    selected: number[];
}
export interface StrState {
    value: string;
    case_sensitive: boolean;
}
export interface StrRegexState {
    pattern: string;
    case_sensitive: boolean;
    regex_error: string | null;
}
export interface DateCompareState {
    op: CompareOp;
    value: string;
}
export interface DateBetweenState {
    lo: string;
    hi: string;
    inclusive: boolean;
}
export interface SetFreeTextState {
    text: string;
}

/**
 * The popover's full per-kind form state. Every sub-state is kept alive so
 * switching the kind-select and back doesn't lose typed values.
 */
export interface FormState {
    num_compare: NumCompareState;
    num_between: NumBetweenState;
    set: SetState;
    str: StrState;
    str_regex: StrRegexState;
    date_compare: DateCompareState;
    date_between: DateBetweenState;
    free_text: SetFreeTextState;
}

/** Blank state — what the popover opens with when adding a filter to an
 *  unfiltered column. */
export function default_form_state(): FormState {
    return {
        num_compare: { op: '=', value: '' },
        num_between: { lo: '', hi: '', inclusive: true },
        set: { selected: [] },
        str: { value: '', case_sensitive: false },
        str_regex: { pattern: '', case_sensitive: false, regex_error: null },
        date_compare: { op: '=', value: '' },
        date_between: { lo: '', hi: '', inclusive: true },
        free_text: { text: '' },
    };
}

/** Map a persisted FilterPredicate back to the kind-select option value. */
export function predicate_to_kind_value(p: FilterPredicate): string {
    switch (p.kind) {
        case 'numCompare': return 'numCompare';
        case 'numBetween': return 'numBetween';
        case 'numNotBetween': return 'numNotBetween';
        case 'setIn': return 'setIn';
        case 'setNotIn': return 'setNotIn';
        case 'strContains': return p.negate ? 'strNotContains' : 'strContains';
        case 'strStartsWith': return 'strStartsWith';
        case 'strEndsWith': return 'strEndsWith';
        case 'strCompare': return p.op === '=' ? 'strCompareEq' : 'strCompareNe';
        case 'strRegex': return 'strRegex';
        case 'dateCompare': return 'dateCompare';
        case 'dateBetween': return 'dateBetween';
        case 'dateNotBetween': return 'dateNotBetween';
        case 'isEmpty': return 'isEmpty';
        case 'isNotEmpty': return 'isNotEmpty';
    }
}

/** Recover the initial editor state from a persisted FilterPredicate. The
 *  matching sub-state is filled; all others keep their blank defaults. */
export function seed_from_entry(p: FilterPredicate): FormState {
    const base = default_form_state();
    switch (p.kind) {
        case 'numCompare':
            base.num_compare = { op: p.op, value: String(p.value) };
            break;
        case 'numBetween':
        case 'numNotBetween':
            base.num_between = {
                lo: String(p.lo),
                hi: String(p.hi),
                inclusive: p.inclusive,
            };
            break;
        case 'setIn':
        case 'setNotIn':
            base.set = { selected: p.values };
            base.free_text = { text: p.values.join('\n') };
            break;
        case 'strContains':
        case 'strStartsWith':
        case 'strEndsWith':
            base.str = { value: p.value, case_sensitive: p.case_sensitive };
            break;
        case 'strCompare':
            base.str = { value: p.value, case_sensitive: p.case_sensitive };
            break;
        case 'strRegex':
            base.str_regex = {
                pattern: p.pattern,
                case_sensitive: p.case_sensitive,
                regex_error: null,
            };
            break;
        case 'dateCompare':
            base.date_compare = { op: p.op, value: p.value };
            break;
        case 'dateBetween':
        case 'dateNotBetween':
            base.date_between = {
                lo: p.lo,
                hi: p.hi,
                inclusive: p.inclusive,
            };
            break;
        case 'isEmpty':
        case 'isNotEmpty':
            break;
    }
    return base;
}

/**
 * Resolve set-membership codes. Labelled-numeric columns use the checklist
 * (selected codes carried directly); the free-text fallback parses a
 * comma/newline list of codes into finite numbers.
 */
function effective_set_values(
    form: FormState,
    set_uses_checklist: boolean
): number[] {
    if (set_uses_checklist) {
        return form.set.selected;
    }
    return form.free_text.text
        .split(/[\n,]+/)
        .map(my_token => my_token.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
}

/**
 * Build the FilterPredicate from the form state, or null when the input is
 * incomplete (empty value, unparseable number, regex error, empty set).
 * `kind` is the kind-select option value; `set_uses_checklist` reflects the
 * column kind.
 */
export function build_predicate(
    kind: string,
    form: FormState,
    opts: { set_uses_checklist: boolean }
): FilterPredicate | null {
    switch (kind) {
        case 'isEmpty':
            return { kind: 'isEmpty' };
        case 'isNotEmpty':
            return { kind: 'isNotEmpty' };
        case 'numCompare': {
            const v = parseFloat(form.num_compare.value);
            // Reject NaN and ±Infinity (e.g. "1e999") — only finite bounds
            // make a sensible predicate.
            if (!Number.isFinite(v)) return null;
            return { kind: 'numCompare', op: form.num_compare.op, value: v };
        }
        case 'numBetween': {
            const lo = parseFloat(form.num_between.lo);
            const hi = parseFloat(form.num_between.hi);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
            return {
                kind: 'numBetween', lo, hi,
                inclusive: form.num_between.inclusive,
            };
        }
        case 'numNotBetween': {
            const lo = parseFloat(form.num_between.lo);
            const hi = parseFloat(form.num_between.hi);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
            return {
                kind: 'numNotBetween', lo, hi,
                inclusive: form.num_between.inclusive,
            };
        }
        case 'setIn': {
            const the_values = effective_set_values(
                form, opts.set_uses_checklist
            );
            if (the_values.length === 0) return null;
            return { kind: 'setIn', values: the_values };
        }
        case 'setNotIn': {
            const the_values = effective_set_values(
                form, opts.set_uses_checklist
            );
            if (the_values.length === 0) return null;
            return { kind: 'setNotIn', values: the_values };
        }
        case 'strContains':
            if (!form.str.value) return null;
            return {
                kind: 'strContains', value: form.str.value,
                case_sensitive: form.str.case_sensitive, negate: false,
            };
        case 'strNotContains':
            if (!form.str.value) return null;
            return {
                kind: 'strContains', value: form.str.value,
                case_sensitive: form.str.case_sensitive, negate: true,
            };
        case 'strStartsWith':
            if (!form.str.value) return null;
            return {
                kind: 'strStartsWith', value: form.str.value,
                case_sensitive: form.str.case_sensitive,
            };
        case 'strEndsWith':
            if (!form.str.value) return null;
            return {
                kind: 'strEndsWith', value: form.str.value,
                case_sensitive: form.str.case_sensitive,
            };
        case 'strCompareEq':
            if (!form.str.value) return null;
            return {
                kind: 'strCompare', op: '=', value: form.str.value,
                case_sensitive: form.str.case_sensitive,
            };
        case 'strCompareNe':
            if (!form.str.value) return null;
            return {
                kind: 'strCompare', op: '!=', value: form.str.value,
                case_sensitive: form.str.case_sensitive,
            };
        case 'strRegex':
            if (!form.str_regex.pattern || form.str_regex.regex_error) {
                return null;
            }
            return {
                kind: 'strRegex', pattern: form.str_regex.pattern,
                case_sensitive: form.str_regex.case_sensitive,
            };
        case 'dateCompare':
            if (!form.date_compare.value) return null;
            return {
                kind: 'dateCompare', op: form.date_compare.op,
                value: form.date_compare.value,
            };
        case 'dateBetween':
            if (!form.date_between.lo || !form.date_between.hi) return null;
            return {
                kind: 'dateBetween', lo: form.date_between.lo,
                hi: form.date_between.hi,
                inclusive: form.date_between.inclusive,
            };
        case 'dateNotBetween':
            if (!form.date_between.lo || !form.date_between.hi) return null;
            return {
                kind: 'dateNotBetween', lo: form.date_between.lo,
                hi: form.date_between.hi,
                inclusive: form.date_between.inclusive,
            };
        default:
            return null;
    }
}
