/**
 * Persisted sort state for the data browser.
 *
 * Mirrors `column-width-state.ts`: one `globalState` blob mapping a
 * composite key to a {@link SortState}, with LRU eviction governed by the
 * `sight.dataBrowser.maxStoredLayouts` setting and serialized writes.
 *
 * The composite key is `${dataset_key}::${schema_hash}` so a different
 * shape opened at the same path gets its own slot. Only the sort keys
 * (column index + direction) are persisted — the permutation is always
 * recomputed on restore, since a matching schema hash is not evidence
 * that two datasets share values.
 */

import type { ExtensionContext } from 'vscode';
import type { SortKey, SortState } from './types';

export const DATA_BROWSER_SORT_STATE_KEY =
    'sight.dataBrowser.sortState';

export const DEFAULT_MAX_STORED_LAYOUTS = 10_000;

export interface DataBrowserSortStateContextLike {
    globalState: {
        get<T>(key: string, default_value?: T): T | undefined;
        update(
            key: string,
            value: unknown
        ): Promise<void> | Thenable<void>;
    };
}

export interface DataBrowserSortStateStore {
    get(
        dataset_key: string,
        schema_hash: string
    ): SortState | undefined;
    set(
        dataset_key: string,
        schema_hash: string,
        sort: SortState
    ): Promise<void>;
}

type StoredSortMap = Record<string, SortState>;

function composite_key(
    dataset_key: string,
    schema_hash: string
): string {
    return `${dataset_key}::${schema_hash}`;
}

function evict_excess<T>(
    map: Record<string, T>,
    max_layouts: number
): void {
    const the_keys = Object.keys(map);
    const my_evict_count = the_keys.length - max_layouts;
    for (let i = 0; i < my_evict_count; i++) {
        delete map[the_keys[i]];
    }
}

function sanitize_sort(value: unknown): SortState | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const my_value = value as { keys?: unknown;
        labels_on_when_sorted?: unknown };
    if (!Array.isArray(my_value.keys)) return undefined;

    const the_keys: SortKey[] = [];
    for (const my_key of my_value.keys) {
        if (!my_key || typeof my_key !== 'object') continue;
        const my_k = my_key as { col_index?: unknown;
            direction?: unknown };
        if (
            typeof my_k.col_index === 'number'
            && Number.isInteger(my_k.col_index)
            && my_k.col_index >= 0
            && (my_k.direction === 'asc'
                || my_k.direction === 'desc')
        ) {
            the_keys.push({
                col_index: my_k.col_index,
                direction: my_k.direction,
            });
        }
    }
    if (the_keys.length === 0) return undefined;
    return {
        keys: the_keys,
        labels_on_when_sorted:
            my_value.labels_on_when_sorted !== false,
    };
}

function get_stored(
    context: DataBrowserSortStateContextLike
): StoredSortMap {
    const my_stored = context.globalState.get<unknown>(
        DATA_BROWSER_SORT_STATE_KEY,
        {}
    );
    if (!my_stored || typeof my_stored !== 'object') return {};

    const my_result: StoredSortMap = {};
    for (const [my_key, my_value] of Object.entries(my_stored)) {
        if (typeof my_key !== 'string' || my_key === '') continue;
        const my_sort = sanitize_sort(my_value);
        if (my_sort) my_result[my_key] = my_sort;
    }
    return my_result;
}

export function create_sort_state_store(
    context: ExtensionContext | DataBrowserSortStateContextLike,
    get_max_layouts?: () => number
): DataBrowserSortStateStore {
    const my_get_max =
        get_max_layouts ?? (() => DEFAULT_MAX_STORED_LAYOUTS);
    let my_pending_write: Promise<void> = Promise.resolve();

    return {
        get(
            dataset_key: string,
            schema_hash: string
        ): SortState | undefined {
            const my_all = get_stored(context);
            return my_all[composite_key(dataset_key, schema_hash)];
        },
        async set(
            dataset_key: string,
            schema_hash: string,
            sort: SortState
        ): Promise<void> {
            my_pending_write = my_pending_write
                .catch(() => {})
                .then(async () => {
                    const my_key = composite_key(
                        dataset_key,
                        schema_hash
                    );
                    const my_all = get_stored(context);
                    // LRU touch: delete before reinserting.
                    delete my_all[my_key];
                    if (sort.keys.length > 0) {
                        my_all[my_key] = {
                            keys: sort.keys,
                            labels_on_when_sorted:
                                sort.labels_on_when_sorted,
                        };
                    }
                    evict_excess(my_all, my_get_max());
                    await context.globalState.update(
                        DATA_BROWSER_SORT_STATE_KEY,
                        my_all
                    );
                });
            await my_pending_write;
        },
    };
}
