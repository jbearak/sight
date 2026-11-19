import { beforeEach, describe, expect, it, mock } from 'bun:test';

// vscode is mocked so browser-panel can be imported headless.
let clipboard_writes: string[] = [];
let errors: string[] = [];
mock.module('vscode', () => ({
    ...VSCODE_MOCK_SHARED_EXPORTS,
    env: {
        clipboard: {
            writeText: async (text: string) => {
                clipboard_writes.push(text);
            },
        },
    },
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, default_value: unknown) => default_value,
        }),
    },
    window: {
        showErrorMessage: (message: string) => {
            errors.push(message);
            return undefined;
        },
        showWarningMessage: () => undefined,
    },
}));

import {
    getCopyBufferContents,
    GridCellKind,
    type GridCell,
} from '@glideapps/glide-data-grid';
import {
    create_copy_handler,
    type CopyGrid,
    type CopyMessage,
    type CopySelection,
} from '../../../client/src/data-browser/webview/copy-selection';
import {
    EMPTY_FILTER,
    EMPTY_SORT,
    type SortState,
} from '../../../client/src/data-browser/types';
import { VSCODE_MOCK_SHARED_EXPORTS } from '../../vscode-mock-shared-exports';

/**
 * A copy takes every row from one view (dataset, sort, filter). These
 * tests run the webview's copy against the real host panel: the grid
 * holds rows read in one view while the host has moved to another.
 * Before, the host read the rows the grid lacked in its newer order
 * and the clipboard got rows of two orders.
 */

const NOBS = 300;
const PAGE_SIZE = 200;

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(my_resolve => {
        resolve = my_resolve;
    });
    return { promise, resolve };
}

function sort_by(direction: 'asc' | 'desc'): {
    type: 'setSort';
    keys: { col_index: number; direction: 'asc' | 'desc' }[];
    labels_on: boolean;
} {
    return {
        type: 'setSort',
        keys: [{ col_index: 0, direction }],
        labels_on: true,
    };
}

/** Rows of `x` in file order; values are `offset + file row + 1`. */
function make_reader(offset: () => number) {
    return {
        read_page: async (
            rows: { start: number; count: number } | { rows: Uint32Array }
        ) => {
            const the_file_rows: number[] = [];
            if ('rows' in rows) {
                for (const my_row of rows.rows) the_file_rows.push(my_row);
            } else {
                const my_end = Math.min(rows.start + rows.count, NOBS);
                for (let i = rows.start; i < my_end; i++) {
                    the_file_rows.push(i);
                }
            }
            return {
                rows: the_file_rows.map(my_row => [{
                    raw: offset() + my_row + 1,
                }]),
            };
        },
    };
}

async function make_host() {
    const { DataBrowserPanel } = await import(
        '../../../client/src/data-browser/browser-panel'
    );
    const posted: any[] = [];
    const panel_like: any = Object.create(DataBrowserPanel.prototype);
    panel_like.dta_file = {
        nobs: NOBS,
        nvar: 1,
        variables: [{
            name: 'x', type: 'int', format: '%9.0g',
            label: '', value_label_name: '',
        }],
        value_label_tables: new Map(),
        close: () => undefined,
    };
    panel_like.disposed = false;
    panel_like.file_changed = false;
    panel_like.generation = 0;
    panel_like.view_generation = 0;
    panel_like.copy_seq = 0;
    panel_like.webview_copy = null;
    panel_like.sort = EMPTY_SORT;
    panel_like.permutation = null;
    panel_like.filter = EMPTY_FILTER;
    panel_like.filtered_indices = null;
    panel_like.effective_perm = null;
    panel_like.restore_abort = null;
    panel_like.restoring = false;
    panel_like.restore_id = -1;
    panel_like.action_chain = Promise.resolve();
    panel_like.refresh_chain = Promise.resolve();
    panel_like.histogram_cache = new Map();
    panel_like.dataset_key = 'k';
    panel_like.dataset_key_aliases = [];
    panel_like.sort_state_store = { set: async () => undefined };
    panel_like.filter_state_store = { set: async () => undefined };
    let my_offset = 0;
    panel_like.reader = make_reader(() => my_offset);
    panel_like.panel = {
        webview: {
            postMessage: (message: any) => {
                posted.push(message);
                return true;
            },
        },
    };
    // Each sort computes its order when `orders` lets it.
    const orders: {
        gate: Promise<void>;
    }[] = [];
    panel_like.compute_sort_permutation = async (sort: SortState) => {
        const my_wait = orders.shift();
        if (my_wait) await my_wait.gate;
        const the_order = Array.from({ length: NOBS }, (_, i) => i);
        if (sort.keys[0]?.direction === 'desc') the_order.reverse();
        return new Uint32Array(the_order);
    };
    return {
        panel_like,
        posted,
        orders,
        set_offset: (offset: number) => {
            my_offset = offset;
        },
    };
}

type Host = Awaited<ReturnType<typeof make_host>>;

/**
 * The webview's side, as use-row-loader and app.tsx keep it: pages of
 * rows with the host view each was read in, and a copy of column `x`
 * whose missing rows are read from the host.
 */
function make_webview(host: Host) {
    const pages = new Map<number, { values: number[]; view: number }>();
    let next_request = 0;

    const reply_to = (request_id: string): any => {
        const my_reply = host.posted.find(
            my_msg => my_msg.request_id === request_id
        );
        if (!my_reply) throw new Error(`no reply to ${request_id}`);
        return my_reply;
    };

    const load_page = async (start: number): Promise<void> => {
        const my_id = `rows-${next_request++}`;
        await host.panel_like.handle_message({
            type: 'requestRows',
            start,
            count: PAGE_SIZE,
            request_id: my_id,
        });
        const my_reply = reply_to(my_id);
        expect(my_reply.type).toBe('rowData');
        pages.set(start, {
            values: my_reply.rows.map((my_row: any[]) => my_row[0].raw),
            view: my_reply.view_generation,
        });
    };

    const value_of = (row: number): number | undefined => {
        const my_start = Math.floor(row / PAGE_SIZE) * PAGE_SIZE;
        return pages.get(my_start)?.values[row - my_start];
    };

    const text_cell = (value: number | undefined): GridCell => ({
        kind: GridCellKind.Text,
        data: value === undefined ? '' : String(value),
        displayData: value === undefined ? '' : String(value),
        allowOverlay: false,
    });

    const grid: CopyGrid<Map<number, number>> = {
        column_count: 1,
        row_count: NOBS,
        get_cells: (rect, loaded) => {
            const the_cells: GridCell[][] = [];
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                the_cells.push([text_cell(loaded?.get(y) ?? value_of(y))]);
            }
            return the_cells;
        },
        to_text: (cells, columns) =>
            getCopyBufferContents(cells, columns).textPlain,
        has_row: row => value_of(row) !== undefined,
        row_view: row => pages.get(
            Math.floor(row / PAGE_SIZE) * PAGE_SIZE
        )?.view,
        load_rows: async (rows, _columns, view) => {
            const my_id = `copy-${next_request++}`;
            await host.panel_like.handle_message({
                type: 'requestCopyRows',
                request_id: my_id,
                start: rows[0],
                count: rows.length,
                col_start: 0,
                col_end: 1,
                ...(view !== undefined && { view_generation: view }),
            });
            const my_reply = reply_to(my_id);
            if (!my_reply.rows) {
                throw new Error(my_reply.message ?? 'not read');
            }
            return new Map(my_reply.rows.map(
                (my_row: any[], i: number) => [rows[i], my_row[0].raw]
            ));
        },
        order_version: () => 0,
    };

    const the_posts: CopyMessage[] = [];
    const sent: Promise<void>[] = [];
    // Copy column x: what pressing Ctrl+C on the selected column does.
    const selection: CopySelection = {
        range: undefined,
        rows: [],
        columns: [0],
    };
    const on_copy = create_copy_handler({
        get_state: () => ({ selection, grid }),
        is_grid_focused: () => true,
        post: my_message => {
            the_posts.push(my_message);
            sent.push(host.panel_like.handle_message(my_message));
        },
    });
    const copy_column = async (): Promise<void> => {
        on_copy({
            preventDefault: () => undefined,
            stopImmediatePropagation: () => undefined,
        });
        // Let the copy read its rows and post its result.
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        await Promise.all(sent);
    };
    return { pages, load_page, copy_column, the_posts };
}

function count_up(from: number, to: number): string[] {
    const the_values: string[] = [];
    for (let i = from; i <= to; i++) the_values.push(String(i));
    return the_values;
}

beforeEach(() => {
    clipboard_writes = [];
    errors = [];
});

describe('a copy takes rows of one view', () => {
    it('fails, leaving the clipboard alone, when two sorts race the copy', async () => {
        // 300 values, rows 1-200 loaded.
        const host = await make_host();
        const webview = make_webview(host);
        await webview.load_page(0);

        // A descending sort lands on the host; the webview, already
        // asked for an ascending one, keeps its rows until that lands.
        await host.panel_like.handle_message(sort_by('desc'));
        const my_gate = deferred();
        host.orders.push({ gate: my_gate.promise });
        const my_ascending = host.panel_like.handle_message(sort_by('asc'));

        // Copy the column while the ascending sort is pending.
        await webview.copy_column();

        expect(clipboard_writes).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('changed during the copy');

        // Once the sort lands and the grid rereads its rows, the copy
        // is the column in that one order.
        my_gate.resolve();
        await my_ascending;
        webview.pages.clear();
        await webview.load_page(0);
        await webview.copy_column();
        expect(clipboard_writes).toEqual([
            count_up(1, NOBS).join('\n'),
        ]);
    });

    it('fails when a filter changes the rows the grid holds', async () => {
        const host = await make_host();
        const webview = make_webview(host);
        await webview.load_page(0);

        // The host applies a filter (rows 100-299 of the file) the
        // webview has not taken up yet.
        host.panel_like.compute_filter_indices = async () =>
            new Uint32Array(Array.from({ length: 200 }, (_, i) => i + 100));
        await host.panel_like.handle_message({
            type: 'setFilters',
            entries: [{
                id: 'f1',
                col_index: 0,
                predicate: { kind: 'isNotEmpty' },
                enabled: true,
                include_missing: false,
            }],
            labels_on: true,
        });
        await webview.copy_column();

        expect(clipboard_writes).toEqual([]);
        expect(errors[0]).toContain('changed during the copy');
    });

    it('fails when the dataset is reloaded in natural order', async () => {
        const host = await make_host();
        const webview = make_webview(host);
        await webview.load_page(0);

        // Another dataset at the same path: still natural order, but
        // other values.
        const my_dta_file = host.panel_like.dta_file;
        host.panel_like.release_file = async () => undefined;
        host.panel_like.begin_debug_timing = () => null;
        host.panel_like.initialize = async () => {
            host.panel_like.dta_file = my_dta_file;
            host.panel_like.reader = make_reader(() => 1000);
        };
        host.panel_like.dta_path = '/data/a.dta';
        host.panel_like.temp_file_kept = false;
        await host.panel_like.refresh(
            { name: 'a', subsetted: false },
            '/data/a.dta'
        );
        await webview.copy_column();

        expect(clipboard_writes).toEqual([]);
        expect(errors[0]).toContain('changed during the copy');
    });

    it('fails when the grid holds rows of two orders', async () => {
        const host = await make_host();
        const webview = make_webview(host);
        await webview.load_page(0);
        // A sort lands; the grid, waiting on another, keeps page 0 and
        // reads page 200 in the new order.
        await host.panel_like.handle_message(sort_by('desc'));
        await webview.load_page(200);

        await webview.copy_column();

        expect(clipboard_writes).toEqual([]);
        expect(errors[0]).toContain('changed during the copy');
    });

    it('copies when the host view is the one the grid holds', async () => {
        const host = await make_host();
        const webview = make_webview(host);
        // A sort that finishes before the grid reads its rows.
        await host.panel_like.handle_message(sort_by('desc'));
        await webview.load_page(0);

        await webview.copy_column();

        expect(errors).toEqual([]);
        expect(clipboard_writes).toEqual([
            count_up(1, NOBS).reverse().join('\n'),
        ]);
    });
});
