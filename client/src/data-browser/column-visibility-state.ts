import type { ExtensionContext } from 'vscode';
import {
    type DataBrowserColumnWidthContextLike,
} from './column-width-state';

export const DATA_BROWSER_COLUMN_VISIBILITY_KEY =
    'sight.dataBrowser.columnVisibility';

const MAX_STORED_HIDDEN_COLUMNS_PER_DATASET = 1000;
const MAX_COLUMN_NAME_LENGTH = 64;

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
    hidden_columns: string[]
): Promise<void> {
    if (!dataset_key) {
        return;
    }

    const my_all = get_stored_hidden_columns(context);
    const my_sanitized = sanitize_hidden_columns(hidden_columns);

    if (my_sanitized.length === 0) {
        delete my_all[dataset_key];
    } else {
        my_all[dataset_key] = my_sanitized;
    }

    await context.globalState.update(
        DATA_BROWSER_COLUMN_VISIBILITY_KEY,
        my_all
    );
}

export function create_column_visibility_store(
    context: ExtensionContext
): DataBrowserColumnVisibilityStore {
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
            const my_sanitized = sanitize_hidden_columns(
                hidden_columns
            );
            const the_write_keys = [
                dataset_key,
                ...alias_keys,
            ];

            for (const my_key of the_write_keys) {
                await set_stored_hidden_columns(
                    context,
                    my_key,
                    my_sanitized
                );
            }
        },
    };
}
