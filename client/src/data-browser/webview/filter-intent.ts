import type {
    FilterEntry,
    FilterPredicate,
    FilterState,
} from '../types.js';

export interface FilterAppliedOutcome {
    pending_filter: FilterState | null;
    refetch_rows: boolean;
}

function clone_predicate(predicate: FilterPredicate): FilterPredicate {
    switch (predicate.kind) {
        case 'setIn':
        case 'setNotIn':
            return {
                ...predicate,
                values: [...predicate.values],
            };
        default:
            return { ...predicate };
    }
}

function clone_entry(entry: FilterEntry): FilterEntry {
    return {
        ...entry,
        predicate: clone_predicate(entry.predicate),
    };
}

export function build_pending_filter(
    entries: readonly FilterEntry[],
    labels_on: boolean
): FilterState {
    return {
        entries: entries.map(clone_entry),
        labels_on_when_filtered: labels_on,
    };
}

export function visible_filter_state(
    applied_filter: FilterState,
    pending_filter: FilterState | null
): FilterState {
    return pending_filter ?? applied_filter;
}

function arrays_equal(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length
        && a.every((my_value, i) => my_value === b[i]);
}

function predicate_values_equal(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a)
            && Array.isArray(b)
            && arrays_equal(a, b);
    }
    return a === b;
}

function predicates_equal(
    a: FilterPredicate,
    b: FilterPredicate
): boolean {
    if (a.kind !== b.kind) return false;
    const my_a = a as unknown as Record<string, unknown>;
    const my_b = b as unknown as Record<string, unknown>;
    const the_keys = Object.keys(my_a);
    if (the_keys.length !== Object.keys(my_b).length) return false;
    return the_keys.every(my_key =>
        predicate_values_equal(my_a[my_key], my_b[my_key])
    );
}

function entries_equal(a: FilterEntry, b: FilterEntry): boolean {
    return a.id === b.id
        && a.col_index === b.col_index
        && a.enabled === b.enabled
        && a.include_missing === b.include_missing
        && predicates_equal(a.predicate, b.predicate);
}

function filter_states_equal(a: FilterState, b: FilterState): boolean {
    if (a.labels_on_when_filtered !== b.labels_on_when_filtered) {
        return false;
    }
    if (a.entries.length !== b.entries.length) return false;
    return a.entries.every((my_entry, i) =>
        entries_equal(my_entry, b.entries[i])
    );
}

export function pending_filter_after_applied(
    applied_filter: FilterState,
    pending_filter: FilterState | null
): FilterState | null {
    if (!pending_filter) return null;
    return filter_states_equal(applied_filter, pending_filter)
        ? null
        : pending_filter;
}

export function filter_applied_outcome(
    applied_filter: FilterState,
    pending_filter: FilterState | null
): FilterAppliedOutcome {
    const my_pending_filter =
        pending_filter_after_applied(applied_filter, pending_filter);
    return {
        pending_filter: my_pending_filter,
        refetch_rows: my_pending_filter === null,
    };
}

export function filter_work_pending(
    host_pending: boolean,
    pending_filter: FilterState | null
): boolean {
    return host_pending || pending_filter !== null;
}
