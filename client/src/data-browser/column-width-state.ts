import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import type { VviewSidecar } from './types';

export const DATA_BROWSER_COLUMN_WIDTHS_KEY =
    'sight.dataBrowser.columnWidths';

const MAX_STORED_COLUMNS_PER_DATASET = 1000;
export const DEFAULT_MAX_STORED_LAYOUTS = 10_000;

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

export interface DataBrowserColumnWidthContextLike {
    globalState: {
        get<T>(
            key: string,
            default_value?: T
        ): T | undefined;
        update(
            key: string,
            value: unknown
        ): Promise<void> | Thenable<void>;
    };
}

export interface DataBrowserColumnWidthStore {
    get(
        dataset_key: string,
        alias_keys?: readonly string[]
    ): Record<string, number>;
    set(
        dataset_key: string,
        widths: Record<string, number>,
        alias_keys?: readonly string[]
    ): Promise<void>;
}

type StoredWidthMap = Record<
    string,
    Record<string, number>
>;

export function build_dataset_key(
    dta_path: string,
    sidecar?: Pick<VviewSidecar, 'source'>
): string {
    const my_source = sidecar?.source?.trim();
    if (my_source) {
        return my_source;
    }
    return dta_path;
}

export function build_dataset_key_aliases(
    dta_path: string,
    sidecar?: Pick<VviewSidecar, 'source' | 'name'>
): string[] {
    const the_keys: string[] = [];
    const my_primary = build_dataset_key(dta_path, sidecar);
    const my_basename = path.basename(my_primary);
    const my_name = sidecar?.name?.trim();

    if (dta_path && dta_path !== my_primary) {
        the_keys.push(dta_path);
    }
    if (my_basename) {
        the_keys.push(`basename:${my_basename}`);
    }
    if (my_name) {
        the_keys.push(`name:${my_name}`);
    }

    return [...new Set(the_keys.filter(Boolean))];
}

export function sanitize_column_widths(
    widths: unknown
): Record<string, number> {
    if (!widths || typeof widths !== 'object') {
        return {};
    }

    const my_sanitized: Record<string, number> = {};
    let my_count = 0;

    for (const [my_name, my_value] of Object.entries(widths)) {
        if (my_count >= MAX_STORED_COLUMNS_PER_DATASET) {
            break;
        }
        if (typeof my_name !== 'string' || my_name === '') {
            continue;
        }
        if (
            typeof my_value !== 'number'
            || !Number.isFinite(my_value)
            || my_value <= 0
        ) {
            continue;
        }
        my_sanitized[my_name] = Math.max(
            1, Math.round(my_value)
        );
        my_count += 1;
    }

    return my_sanitized;
}

export function get_stored_column_widths(
    context: DataBrowserColumnWidthContextLike
): StoredWidthMap {
    const my_stored = context.globalState.get<unknown>(
        DATA_BROWSER_COLUMN_WIDTHS_KEY,
        {}
    );

    if (!my_stored || typeof my_stored !== 'object') {
        return {};
    }

    const my_result: StoredWidthMap = {};
    for (const [my_dataset_key, my_widths] of Object.entries(my_stored)) {
        if (
            typeof my_dataset_key !== 'string'
            || my_dataset_key === ''
        ) {
            continue;
        }
        my_result[my_dataset_key] = sanitize_column_widths(
            my_widths
        );
    }

    return my_result;
}

export async function set_stored_column_widths(
    context: DataBrowserColumnWidthContextLike,
    dataset_key: string,
    widths: Record<string, number>,
    max_layouts: number = DEFAULT_MAX_STORED_LAYOUTS
): Promise<void> {
    if (!dataset_key) {
        return;
    }

    const my_all_widths = get_stored_column_widths(context);
    const my_sanitized = sanitize_column_widths(widths);

    // LRU touch: delete before reinserting to move to
    // end of insertion order
    delete my_all_widths[dataset_key];

    if (Object.keys(my_sanitized).length > 0) {
        my_all_widths[dataset_key] = my_sanitized;
    }

    evict_excess_layouts(my_all_widths, max_layouts);

    await context.globalState.update(
        DATA_BROWSER_COLUMN_WIDTHS_KEY,
        my_all_widths
    );
}

export function create_column_width_store(
    context: ExtensionContext,
    get_max_layouts?: () => number
): DataBrowserColumnWidthStore {
    const my_get_max = get_max_layouts
        ?? (() => DEFAULT_MAX_STORED_LAYOUTS);
    let my_pending_write: Promise<void> =
        Promise.resolve();

    return {
        get(
            dataset_key: string,
            alias_keys: readonly string[] = []
        ): Record<string, number> {
            const my_all_widths =
                get_stored_column_widths(context);
            const the_lookup_keys = [
                dataset_key,
                ...alias_keys,
            ];

            for (const my_key of the_lookup_keys) {
                if (my_all_widths[my_key] !== undefined) {
                    return my_all_widths[my_key];
                }
            }

            return {};
        },
        async set(
            dataset_key: string,
            widths: Record<string, number>,
            alias_keys: readonly string[] = []
        ): Promise<void> {
            // Serialize writes so each read-modify-write
            // sees the result of the previous write.
            my_pending_write = my_pending_write
                .catch(() => {})
                .then(async () => {
                    const my_sanitized =
                        sanitize_column_widths(widths);
                    const the_write_keys = [
                        dataset_key,
                        ...alias_keys,
                    ];
                    const my_max_layouts =
                        my_get_max();

                    const my_all_widths =
                        get_stored_column_widths(
                            context
                        );
                    const my_has_entries =
                        Object.keys(my_sanitized)
                            .length > 0;

                    for (
                        const my_key of the_write_keys
                    ) {
                        if (!my_key) continue;
                        // LRU touch: delete before
                        // reinserting
                        delete my_all_widths[my_key];
                        if (my_has_entries) {
                            my_all_widths[my_key] =
                                my_sanitized;
                        }
                    }

                    evict_excess_layouts(
                        my_all_widths,
                        my_max_layouts
                    );

                    await context.globalState.update(
                        DATA_BROWSER_COLUMN_WIDTHS_KEY,
                        my_all_widths
                    );
                }
            );
            await my_pending_write;
        },
    };
}
