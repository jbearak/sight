/**
 * Filter engine for the data browser. Produces a Uint32Array of surviving
 * original-row indices from a FilterState evaluated against in-memory
 * column values.
 *
 * Ported from Raven's data-viewer filter.ts, adapted to Stata's data
 * model: columns arrive as RowCell[] (number | string | MissingValue)
 * rather than Arrow batches, there are no factor/bool kinds, value labels
 * live only on numeric columns, and dates are numeric storage (Stata day
 * or clock counts) carrying a date display format.
 *
 * Invariants:
 *   - Empty / all-disabled state -> undefined (the panel skips filter
 *     storage and serves rows unfiltered).
 *   - Cross-entry AND: enabled entries intersect on a row mask; disabled
 *     entries are ignored.
 *   - Labelled-numeric set membership is code-based: setIn / setNotIn
 *     match the underlying numeric code, never the displayed label. Labels
 *     are display-only, so the filter survives a Labels toggle.
 *   - Format independence: the display format never affects the row index.
 *     Numeric and date predicates always match the raw stored value.
 *   - Missing semantics: a missing row fails any predicate unless
 *     include_missing is true on that entry, in which case the entry
 *     passes the missing row regardless of predicate value. isEmpty is the
 *     sole exception — it always passes missing rows (and only those).
 *
 * Performance: the row mask is a Uint8Array(nobs); enabled entries
 * short-circuit once the mask is all-zero; final compaction is O(nobs).
 */

import { is_missing_value_object, type RowCell } from '@jbearak/dta-parser';
import type { FilterEntry, FilterPredicate, FilterState } from './types';

export interface FilterColumn {
    values: readonly RowCell[];
    // True for %tc/%tC clock formats (ms since 1960-01-01); false/absent
    // for daily formats (days since 1960-01-01). Consulted only by date
    // predicates, to convert user-typed ISO strings into the column's
    // stored numeric domain.
    is_timestamp?: boolean;
}

const STATA_EPOCH_MS = Date.UTC(1960, 0, 1);
const MS_PER_DAY = 86_400_000;

/**
 * Force a datetime-local string (YYYY-MM-DDTHH:mm[:ss], from the popover's
 * `datetime-local` input) to be read as UTC. Date.parse reads such a
 * tz-less *date-time* as LOCAL time, which would shift %tc/%tC filters by
 * the user's UTC offset. A date-only string (no `T`) is already parsed as
 * UTC by Date.parse, and a string that already carries `Z` or an offset is
 * left alone.
 */
function normalize_iso_utc(iso: string): string {
    if (iso.includes('T') && !/([zZ]|[+-]\d\d:?\d\d)$/.test(iso)) {
        return `${iso}Z`;
    }
    return iso;
}

/**
 * Convert an ISO date string into the Stata numeric domain a date column
 * stores: days since 1960-01-01 for daily formats, milliseconds since
 * 1960-01-01 for clock (timestamp) formats. Returns NaN when the string
 * is unparseable so callers can treat it as a no-match.
 */
export function iso_to_stata_date(
    iso: string,
    is_timestamp: boolean
): number {
    const ms_since_unix = Date.parse(normalize_iso_utc(iso));
    if (!Number.isFinite(ms_since_unix)) return NaN;
    const ms_since_epoch = ms_since_unix - STATA_EPOCH_MS;
    return is_timestamp
        ? ms_since_epoch
        : Math.round(ms_since_epoch / MS_PER_DAY);
}

export function compute_filtered_indices(
    columns_by_index: Map<number, FilterColumn>,
    state: FilterState,
    nobs: number
): Uint32Array | undefined {
    const the_active = state.entries.filter(my_entry => my_entry.enabled);
    if (the_active.length === 0) return undefined;

    const mask = new Uint8Array(nobs);
    mask.fill(1);

    for (const my_entry of the_active) {
        apply_entry(columns_by_index, my_entry, mask);
        if (all_zero(mask)) break;
    }
    return compact(mask);
}

function apply_entry(
    columns_by_index: Map<number, FilterColumn>,
    entry: FilterEntry,
    mask: Uint8Array
): void {
    const my_column = columns_by_index.get(entry.col_index);
    if (!my_column) {
        throw new Error(
            `compute_filtered_indices: unknown col_index ${entry.col_index}`
        );
    }
    const nobs = mask.length;
    const the_predicate = entry.predicate;
    const accept = acceptor_for(my_column, the_predicate, nobs);
    // isEmpty targets missing values — they always pass, regardless of the
    // include_missing flag. Every other predicate honors the flag.
    const include_missing = the_predicate.kind === 'isEmpty'
        ? true
        : entry.include_missing;
    const the_missing = missing_mask(my_column, nobs);

    for (let i = 0; i < nobs; i++) {
        if (mask[i] === 0) continue;
        if (the_missing[i]) {
            mask[i] = include_missing ? 1 : 0;
            continue;
        }
        mask[i] = accept(i) ? 1 : 0;
    }
}

/**
 * Returns a fn `(row) => boolean` whose domain is the column's
 * non-missing rows (missing-row handling lives in apply_entry). Built once
 * per entry; per-row evaluation is an O(1) lookup against a preloaded
 * typed array.
 */
function acceptor_for(
    column: FilterColumn,
    predicate: FilterPredicate,
    nobs: number
): (row: number) => boolean {
    switch (predicate.kind) {
        case 'isEmpty':
            return () => false;
        case 'isNotEmpty':
            return () => true;

        case 'numCompare': {
            const the_values = to_numbers(column, nobs);
            const v = predicate.value;
            const my_op = predicate.op;
            switch (my_op) {
                case '=': return (i) => the_values[i] === v;
                case '!=': return (i) => the_values[i] !== v;
                case '<': return (i) => the_values[i] < v;
                case '<=': return (i) => the_values[i] <= v;
                case '>': return (i) => the_values[i] > v;
                case '>=': return (i) => the_values[i] >= v;
                default: {
                    // Exhaustive: guarantees this case returns, so the
                    // outer switch can't fall through to numBetween.
                    const _exhaustive: never = my_op;
                    throw new Error(
                        `filter: unhandled numCompare op ${_exhaustive}`
                    );
                }
            }
        }
        case 'numBetween': {
            const the_values = to_numbers(column, nobs);
            const { lo, hi, inclusive } = predicate;
            return inclusive
                ? (i) => the_values[i] >= lo && the_values[i] <= hi
                : (i) => the_values[i] > lo && the_values[i] < hi;
        }
        case 'numNotBetween': {
            const the_values = to_numbers(column, nobs);
            const { lo, hi, inclusive } = predicate;
            return inclusive
                ? (i) => the_values[i] < lo || the_values[i] > hi
                : (i) => the_values[i] <= lo || the_values[i] >= hi;
        }

        case 'strCompare': {
            const the_values = to_strings(column, nobs);
            const cs = predicate.case_sensitive;
            const needle = cs ? predicate.value : predicate.value.toLowerCase();
            const eq = predicate.op === '=';
            return (i) => {
                const hay = cs ? the_values[i] : the_values[i].toLowerCase();
                return eq ? hay === needle : hay !== needle;
            };
        }
        case 'strContains': {
            const the_values = to_strings(column, nobs);
            const cs = predicate.case_sensitive;
            const needle = cs ? predicate.value : predicate.value.toLowerCase();
            const neg = predicate.negate;
            return (i) => {
                const hay = cs ? the_values[i] : the_values[i].toLowerCase();
                const hit = hay.includes(needle);
                return neg ? !hit : hit;
            };
        }
        case 'strStartsWith': {
            const the_values = to_strings(column, nobs);
            const cs = predicate.case_sensitive;
            const needle = cs ? predicate.value : predicate.value.toLowerCase();
            return (i) =>
                (cs ? the_values[i] : the_values[i].toLowerCase())
                    .startsWith(needle);
        }
        case 'strEndsWith': {
            const the_values = to_strings(column, nobs);
            const cs = predicate.case_sensitive;
            const needle = cs ? predicate.value : predicate.value.toLowerCase();
            return (i) =>
                (cs ? the_values[i] : the_values[i].toLowerCase())
                    .endsWith(needle);
        }
        case 'strRegex': {
            const the_values = to_strings(column, nobs);
            const cs = predicate.case_sensitive;
            // The compiled pattern is user-supplied and r.test runs
            // synchronously over every row on the extension-host event
            // loop. A catastrophic-backtracking pattern on a large frame
            // could stall the host; this is user-self-inflicted and the
            // webview validates syntax before applying. An invalid pattern
            // (e.g. reaching here on restore after a code change) is
            // treated as a no-match rather than throwing.
            let rx: RegExp | null = null;
            try {
                rx = new RegExp(predicate.pattern, cs ? '' : 'i');
            } catch {
                rx = null;
            }
            if (!rx) return () => false;
            const r = rx;
            return (i) => r.test(the_values[i]);
        }

        case 'dateCompare': {
            const the_values = to_numbers(column, nobs);
            const v = iso_to_stata_date(
                predicate.value,
                column.is_timestamp ?? false
            );
            // Unparseable ISO -> no-match, mirroring the invalid-regex
            // fallback. Without this guard `!=` would keep every row, since
            // `x !== NaN` is always true.
            if (!Number.isFinite(v)) return () => false;
            const my_op = predicate.op;
            switch (my_op) {
                case '=': return (i) => the_values[i] === v;
                case '!=': return (i) => the_values[i] !== v;
                case '<': return (i) => the_values[i] < v;
                case '<=': return (i) => the_values[i] <= v;
                case '>': return (i) => the_values[i] > v;
                case '>=': return (i) => the_values[i] >= v;
                default: {
                    // Exhaustive: guarantees this case returns, so the
                    // outer switch can't fall through to dateBetween.
                    const _exhaustive: never = my_op;
                    throw new Error(
                        `filter: unhandled dateCompare op ${_exhaustive}`
                    );
                }
            }
        }
        case 'dateBetween': {
            const the_values = to_numbers(column, nobs);
            const is_ts = column.is_timestamp ?? false;
            const lo = iso_to_stata_date(predicate.lo, is_ts);
            const hi = iso_to_stata_date(predicate.hi, is_ts);
            return predicate.inclusive
                ? (i) => the_values[i] >= lo && the_values[i] <= hi
                : (i) => the_values[i] > lo && the_values[i] < hi;
        }
        case 'dateNotBetween': {
            const the_values = to_numbers(column, nobs);
            const is_ts = column.is_timestamp ?? false;
            const lo = iso_to_stata_date(predicate.lo, is_ts);
            const hi = iso_to_stata_date(predicate.hi, is_ts);
            return predicate.inclusive
                ? (i) => the_values[i] < lo || the_values[i] > hi
                : (i) => the_values[i] <= lo || the_values[i] >= hi;
        }

        case 'setIn':
        case 'setNotIn': {
            // Set membership is code-based for labelled-numeric columns:
            // the popover stores numeric codes, and labels are display-only
            // so the filter survives a Labels toggle.
            const want = new Set(predicate.values.map(Number));
            const the_values = to_numbers(column, nobs);
            return predicate.kind === 'setIn'
                ? (i) => want.has(the_values[i])
                : (i) => !want.has(the_values[i]);
        }

        default: {
            const _exhaustive: never = predicate;
            throw new Error(
                `filter: unhandled predicate `
                + `${(_exhaustive as { kind: string }).kind}`
            );
        }
    }
}

function to_numbers(column: FilterColumn, nobs: number): Float64Array {
    const out = new Float64Array(nobs);
    const the_values = column.values;
    for (let i = 0; i < nobs; i++) {
        const my_value = the_values[i];
        out[i] = typeof my_value === 'number' ? my_value : NaN;
    }
    return out;
}

function to_strings(column: FilterColumn, nobs: number): string[] {
    const out: string[] = new Array(nobs).fill('');
    const the_values = column.values;
    for (let i = 0; i < nobs; i++) {
        const my_value = the_values[i];
        if (typeof my_value === 'string') out[i] = my_value;
        else if (typeof my_value === 'number') out[i] = String(my_value);
    }
    return out;
}

function missing_mask(column: FilterColumn, nobs: number): Uint8Array {
    const out = new Uint8Array(nobs);
    const the_values = column.values;
    for (let i = 0; i < nobs; i++) {
        const my_value = the_values[i];
        if (my_value === null || my_value === undefined) {
            out[i] = 1;
        } else if (is_missing_value_object(my_value)) {
            out[i] = 1;
        } else if (typeof my_value === 'number' && Number.isNaN(my_value)) {
            out[i] = 1;
        }
    }
    return out;
}

function all_zero(mask: Uint8Array): boolean {
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== 0) return false;
    }
    return true;
}

function compact(mask: Uint8Array): Uint32Array {
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) count++;
    }
    const out = new Uint32Array(count);
    let j = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) out[j++] = i;
    }
    return out;
}
