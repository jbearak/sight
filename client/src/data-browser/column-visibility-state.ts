import type { ExtensionContext } from 'vscode';
import {
    type DataBrowserColumnWidthContextLike,
    DEFAULT_MAX_STORED_LAYOUTS,
} from './column-width-state';

export const DATA_BROWSER_COLUMN_VISIBILITY_KEY =
    'sight.dataBrowser.columnVisibility';

const MAX_STORED_HIDDEN_COLUMNS_PER_DATASET = 1000;
const MAX_COLUMN_NAME_LENGTH = 64;

function evict_excess_layouts<T>(
    map: Record<string, T>,
    max_layouts: number
): void {
    const the_keys = Object.keys(map);
    const my_evict_count = the_keys.length - max_layouts;
    for (let i = 0; i < my_evict_count; i++) {
        delete map[the_keys[i]];
    }
}

export interface DataBrowserColumnVisibilityStore {
    get(
        dataset_key: string,
        alias_keys?: readonly string[]
    ): string[];
    set(
        dataset_key: string,
        hidden_columns: string[],
        alias_keys?: readonly string[]
    ): Promise<void>;
}

type StoredVisibilityMap = Record<string, string[]>;

export function sanitize_hidden_columns(
    value: unknown
): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const the_sanitized: string[] = [];

    for (const my_entry of value) {
        if (the_sanitized.length >= MAX_STORED_HIDDEN_COLUMNS_PER_DATASET) {
            break;
        }
        if (
            typeof my_entry !== 'string'
            || my_entry === ''
            || my_entry.length > MAX_COLUMN_NAME_LENGTH
        ) {
            continue;
        }
        the_sanitized.push(my_entry);
    }

    return the_sanitized;
}

export function get_stored_hidden_columns(
    context: DataBrowserColumnWidthContextLike
): StoredVisibilityMap {
    const my_stored = context.globalState.get<unknown>(
        DATA_BROWSER_COLUMN_VISIBILITY_KEY,
        {}
    );

    if (!my_stored || typeof my_stored !== 'object') {
        return {};
    }

    const my_result: StoredVisibilityMap = {};
    for (const [my_dataset_key, my_hidden] of Object.entries(
        my_stored
    )) {
        if (
            typeof my_dataset_key !== 'string'
            || my_dataset_key === ''
        ) {
            continue;
        }
        my_result[my_dataset_key] = sanitize_hidden_columns(
            my_hidden
        );
    }

    return my_result;
}

export async function set_stored_hidden_columns(
    context: DataBrowserColumnWidthContextLike,
    dataset_key: string,
    hidden_columns: string[],
    max_layouts: number = DEFAULT_MAX_STORED_LAYOUTS
): Promise<void> {
    if (!dataset_key) {
        return;
    }

    const my_all = get_stored_hidden_columns(context);
    const my_sanitized = sanitize_hidden_columns(hidden_columns);

    // LRU touch: delete before reinserting to move to
    // end of insertion order
    delete my_all[dataset_key];

    if (my_sanitized.length > 0) {
        my_all[dataset_key] = my_sanitized;
    }

    evict_excess_layouts(my_all, max_layouts);

    await context.globalState.update(
        DATA_BROWSER_COLUMN_VISIBILITY_KEY,
        my_all
    );
}

export function create_column_visibility_store(
    context: ExtensionContext,
    get_max_layouts?: () => number
): DataBrowserColumnVisibilityStore {
    const my_get_max = get_max_layouts
        ?? (() => DEFAULT_MAX_STORED_LAYOUTS);
    let my_pending_write: Promise<void> =
        Promise.resolve();

    return {
        get(
            dataset_key: string,
            alias_keys: readonly string[] = []
        ): string[] {
            const my_all =
                get_stored_hidden_columns(context);
            const the_lookup_keys = [
                dataset_key,
                ...alias_keys,
            ];

            for (const my_key of the_lookup_keys) {
                if (my_all[my_key] !== undefined) {
                    return my_all[my_key];
                }
            }

            return [];
        },
        async set(
            dataset_key: string,
            hidden_columns: string[],
            alias_keys: readonly string[] = []
        ): Promise<void> {
            // Serialize writes so each read-modify-write
            // sees the result of the previous write.
            my_pending_write = my_pending_write
                .catch(() => {})
                .then(async () => {
                    const my_sanitized =
                        sanitize_hidden_columns(
                            hidden_columns
                        );
                    const the_write_keys = [
                        dataset_key,
                        ...alias_keys,
                    ];
                    const my_max_layouts =
                        my_get_max();

                    const my_all =
                        get_stored_hidden_columns(
                            context
                        );
                    const my_has_entries =
                        my_sanitized.length > 0;

                    for (
                        const my_key of the_write_keys
                    ) {
                        if (!my_key) continue;
                        // LRU touch: delete before
                        // reinserting
                        delete my_all[my_key];
                        if (my_has_entries) {
                            my_all[my_key] =
                                my_sanitized;
                        }
                    }

                    evict_excess_layouts(
                        my_all,
                        my_max_layouts
                    );

                    await context.globalState.update(
                        DATA_BROWSER_COLUMN_VISIBILITY_KEY,
                        my_all
                    );
                }
            );
            await my_pending_write;
        },
    };
}
