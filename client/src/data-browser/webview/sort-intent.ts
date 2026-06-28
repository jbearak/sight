import type { SortKey, SortState } from '../types.js';

export interface SortAppliedOutcome {
    pending_sort: SortState | null;
    refetch_rows: boolean;
}

export function build_pending_sort(
    keys: readonly SortKey[],
    labels_on: boolean
): SortState {
    return {
        keys: keys.map(my_key => ({ ...my_key })),
        labels_on_when_sorted: labels_on,
    };
}

export function visible_sort_state(
    applied_sort: SortState,
    pending_sort: SortState | null
): SortState {
    return pending_sort ?? applied_sort;
}

function sort_states_equal(a: SortState, b: SortState): boolean {
    if (a.labels_on_when_sorted !== b.labels_on_when_sorted) {
        return false;
    }
    if (a.keys.length !== b.keys.length) return false;
    return a.keys.every((my_key, i) => {
        const my_other = b.keys[i];
        return my_key.col_index === my_other.col_index
            && my_key.direction === my_other.direction;
    });
}

export function pending_sort_after_applied(
    applied_sort: SortState,
    pending_sort: SortState | null
): SortState | null {
    if (!pending_sort) return null;
    return sort_states_equal(applied_sort, pending_sort)
        ? null
        : pending_sort;
}

export function sort_applied_outcome(
    applied_sort: SortState,
    pending_sort: SortState | null
): SortAppliedOutcome {
    const my_pending_sort =
        pending_sort_after_applied(applied_sort, pending_sort);
    return {
        pending_sort: my_pending_sort,
        refetch_rows: my_pending_sort === null,
    };
}

export function sort_work_pending(
    host_pending: boolean,
    pending_sort: SortState | null
): boolean {
    return host_pending || pending_sort !== null;
}
