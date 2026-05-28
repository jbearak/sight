/**
 * Persisted filter state for the data browser.
 *
 * Mirrors `sort-state.ts`: one `globalState` blob mapping a composite key
 * to a {@link FilterState}, with LRU eviction governed by the
 * `sight.dataBrowser.maxStoredLayouts` setting and serialized writes.
 *
 * The composite key is `${dataset_key}::${schema_hash}` so a different
 * shape opened at the same path gets its own slot. Only the chip
 * descriptors are persisted — the survivor index is always recomputed on
 * restore against the current reader, since a matching schema hash is not
 * evidence that two datasets share values.
 */

import type { ExtensionContext } from 'vscode';
import type {
    FilterEntry,
    FilterPredicate,
    FilterState,
} from './types.js';

export const DATA_BROWSER_FILTER_STATE_KEY =
    'sight.dataBrowser.filterState';

export const DEFAULT_MAX_STORED_LAYOUTS = 10_000;

export interface DataBrowserFilterStateContextLike {
    globalState: {
        get<T>(key: string, default_value?: T): T | undefined;
        update(
            key: string,
            value: unknown
        ): Promise<void> | Thenable<void>;
    };
}

export interface DataBrowserFilterStateStore {
    get(
        dataset_key: string,
        schema_hash: string
    ): FilterState | undefined;
    set(
        dataset_key: string,
        schema_hash: string,
        filter: FilterState
    ): Promise<void>;
}

type StoredFilterMap = Record<string, FilterState>;

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

const COMPARE_OPS = new Set(['=', '!=', '<', '<=', '>', '>=']);

/**
 * Validate one persisted predicate. Returns the predicate unchanged when
 * well-formed, or undefined when any required field is missing or the
 * wrong type — a malformed entry is dropped rather than trusted, since the
 * blob may predate a code change or have been hand-edited.
 */
function sanitize_predicate(value: unknown): FilterPredicate | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const p = value as Record<string, unknown>;
    const is_str = (x: unknown): x is string => typeof x === 'string';
    const is_num = (x: unknown): x is number =>
        typeof x === 'number' && Number.isFinite(x);
    const is_bool = (x: unknown): x is boolean => typeof x === 'boolean';

    switch (p.kind) {
        case 'isEmpty':
        case 'isNotEmpty':
            return { kind: p.kind };
        case 'numCompare':
            if (COMPARE_OPS.has(p.op as string) && is_num(p.value)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'numBetween':
        case 'numNotBetween':
            if (is_num(p.lo) && is_num(p.hi) && is_bool(p.inclusive)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'setIn':
        case 'setNotIn':
            if (
                Array.isArray(p.values)
                && p.values.every(is_num)
                && p.values.length > 0
            ) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'strContains':
            if (is_str(p.value) && is_bool(p.case_sensitive)
                && is_bool(p.negate)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'strStartsWith':
        case 'strEndsWith':
            if (is_str(p.value) && is_bool(p.case_sensitive)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'strCompare':
            if ((p.op === '=' || p.op === '!=')
                && is_str(p.value) && is_bool(p.case_sensitive)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'strRegex':
            if (is_str(p.pattern) && is_bool(p.case_sensitive)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'dateCompare':
            if (COMPARE_OPS.has(p.op as string) && is_str(p.value)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        case 'dateBetween':
        case 'dateNotBetween':
            if (is_str(p.lo) && is_str(p.hi) && is_bool(p.inclusive)) {
                return p as unknown as FilterPredicate;
            }
            return undefined;
        default:
            return undefined;
    }
}

function sanitize_filter(value: unknown): FilterState | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const my_value = value as {
        entries?: unknown;
        labels_on_when_filtered?: unknown;
    };
    if (!Array.isArray(my_value.entries)) return undefined;

    const the_entries: FilterEntry[] = [];
    for (const my_entry of my_value.entries) {
        if (!my_entry || typeof my_entry !== 'object') continue;
        const my_e = my_entry as Record<string, unknown>;
        if (
            typeof my_e.id !== 'string'
            || typeof my_e.col_index !== 'number'
            || !Number.isInteger(my_e.col_index)
            || my_e.col_index < 0
            || typeof my_e.enabled !== 'boolean'
            || typeof my_e.include_missing !== 'boolean'
        ) {
            continue;
        }
        const my_predicate = sanitize_predicate(my_e.predicate);
        if (!my_predicate) continue;
        the_entries.push({
            id: my_e.id,
            col_index: my_e.col_index,
            predicate: my_predicate,
            enabled: my_e.enabled,
            include_missing: my_e.include_missing,
        });
    }
    if (the_entries.length === 0) return undefined;
    return {
        entries: the_entries,
        labels_on_when_filtered:
            my_value.labels_on_when_filtered !== false,
    };
}

function get_stored(
    context: DataBrowserFilterStateContextLike
): StoredFilterMap {
    const my_stored = context.globalState.get<unknown>(
        DATA_BROWSER_FILTER_STATE_KEY,
        {}
    );
    if (!my_stored || typeof my_stored !== 'object') return {};

    const my_result: StoredFilterMap = {};
    for (const [my_key, my_value] of Object.entries(my_stored)) {
        if (typeof my_key !== 'string' || my_key === '') continue;
        const my_filter = sanitize_filter(my_value);
        if (my_filter) my_result[my_key] = my_filter;
    }
    return my_result;
}

export function create_filter_state_store(
    context: ExtensionContext | DataBrowserFilterStateContextLike,
    get_max_layouts?: () => number
): DataBrowserFilterStateStore {
    const my_get_max =
        get_max_layouts ?? (() => DEFAULT_MAX_STORED_LAYOUTS);
    let my_pending_write: Promise<void> = Promise.resolve();

    return {
        get(
            dataset_key: string,
            schema_hash: string
        ): FilterState | undefined {
            const my_all = get_stored(context);
            return my_all[composite_key(dataset_key, schema_hash)];
        },
        async set(
            dataset_key: string,
            schema_hash: string,
            filter: FilterState
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
                    if (filter.entries.length > 0) {
                        my_all[my_key] = {
                            entries: filter.entries,
                            labels_on_when_filtered:
                                filter.labels_on_when_filtered,
                        };
                    }
                    evict_excess(my_all, my_get_max());
                    await context.globalState.update(
                        DATA_BROWSER_FILTER_STATE_KEY,
                        my_all
                    );
                });
            await my_pending_write;
        },
    };
}
