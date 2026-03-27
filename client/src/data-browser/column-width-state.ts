import type { ExtensionContext } from 'vscode';
import type { VviewSidecar } from './types';

export const DATA_BROWSER_COLUMN_WIDTHS_KEY =
    'sight.dataBrowser.columnWidths';

const MAX_STORED_COLUMNS_PER_DATASET = 1000;

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
    get(dataset_key: string): Record<string, number>;
    set(
        dataset_key: string,
        widths: Record<string, number>
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
        my_sanitized[my_name] = Math.round(my_value);
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
    widths: Record<string, number>
): Promise<void> {
    if (!dataset_key) {
        return;
    }

    const my_all_widths = get_stored_column_widths(context);
    const my_sanitized = sanitize_column_widths(widths);

    if (Object.keys(my_sanitized).length === 0) {
        delete my_all_widths[dataset_key];
    } else {
        my_all_widths[dataset_key] = my_sanitized;
    }

    await context.globalState.update(
        DATA_BROWSER_COLUMN_WIDTHS_KEY,
        my_all_widths
    );
}

export function create_column_width_store(
    context: ExtensionContext
): DataBrowserColumnWidthStore {
    return {
        get(dataset_key: string): Record<string, number> {
            return get_stored_column_widths(context)[dataset_key]
                ?? {};
        },
        async set(
            dataset_key: string,
            widths: Record<string, number>
        ): Promise<void> {
            await set_stored_column_widths(
                context,
                dataset_key,
                widths
            );
        },
    };
}
