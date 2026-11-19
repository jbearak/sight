import { describe, expect, it } from 'bun:test';
import {
    getCopyBufferContents,
    GridCellKind,
    type CellArray,
    type GridCell,
    type Rectangle,
} from '@glideapps/glide-data-grid';
import {
    create_copy_handler,
    MAX_COPY_CELLS,
    take_over_copy,
    type CopyGrid,
    type CopyMessage,
    type CopySelection,
    type FetchedCells,
    type IndexList,
} from '../../../client/src/data-browser/webview/copy-selection';

/**
 * A copy of a selection holding a long strL is taken from Glide while
 * the copy event is still being dispatched, and resolves to the whole
 * text for the host to put on the clipboard. Glide's own handler
 * awaited the fetch and then wrote to the spent event, which left the
 * clipboard as it was.
 */

const PREVIEW = 'p'.repeat(256);
const FULL = 'f'.repeat(1000);

function text_cell(text: string): GridCell {
    return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: false,
    };
}

type Rows = ReadonlyMap<number, string[]>;

/**
 * A 3 x 2 grid; cell (1, 1) is a long strL whose preview shows. The
 * fetch fails if `is_readable` is false. Rows not in `loaded_rows`
 * aren't loaded; `load_rows` reads them (`r{y}c{x}` again, as fetched).
 */
function make_grid(
    is_readable = true,
    loaded_rows: ReadonlySet<number> = new Set([0, 1, 2])
): CopyGrid<Rows> & {
    fetch_count: number;
    the_loads: number[][];
    version: number;
    load_error: Error | null;
    on_load: () => void;
} {
    const my_grid = {
        fetch_count: 0,
        the_loads: [] as number[][],
        version: 0,
        load_error: null as Error | null,
        on_load: () => undefined as void,
        column_count: 2,
        row_count: 3,
        to_text: (cells: CellArray, columns: readonly number[]) =>
            getCopyBufferContents(cells, columns).textPlain,
        has_row: (row: number) => loaded_rows.has(row),
        load_rows: async (rows: readonly number[]): Promise<Rows> => {
            my_grid.the_loads.push([...rows]);
            my_grid.on_load();
            if (my_grid.load_error) throw my_grid.load_error;
            return new Map(rows.map(my_row => [
                my_row, [`r${my_row}c0`, `r${my_row}c1`],
            ]));
        },
        order_version: () => my_grid.version,
        get_cells: (rect: Rectangle, loaded?: Rows) => {
            const the_cells: GridCell[][] = [];
            let has_long = false;
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                const my_row: GridCell[] = [];
                for (let x = rect.x; x < rect.x + rect.width; x++) {
                    if (!loaded_rows.has(y)) {
                        // What the grid shows for a row not loaded.
                        my_row.push(text_cell(loaded?.get(y)?.[x] ?? ''));
                        continue;
                    }
                    const is_long = x === 1 && y === 1;
                    has_long = has_long || is_long;
                    my_row.push(text_cell(is_long ? PREVIEW : `r${y}c${x}`));
                }
                the_cells.push(my_row);
            }
            if (!has_long) return the_cells;
            return async (): Promise<FetchedCells> => {
                my_grid.fetch_count++;
                if (!is_readable) return { cells: the_cells, is_whole: false };
                const the_filled = the_cells.map(my_row => my_row.map(
                    my_cell => my_cell.kind === GridCellKind.Text &&
                        my_cell.data === PREVIEW
                        ? { ...my_cell, copyData: FULL }
                        : my_cell));
                return { cells: the_filled, is_whole: true };
            };
        },
    };
    return my_grid;
}

function make_event(): {
    preventDefault: () => void;
    stopImmediatePropagation: () => void;
    calls: string[];
} {
    const calls: string[] = [];
    return {
        calls,
        preventDefault: () => { calls.push('preventDefault'); },
        stopImmediatePropagation: () => {
            calls.push('stopImmediatePropagation');
        },
    };
}

function range(rect: Rectangle): CopySelection {
    return { range: rect, rows: [], columns: [] };
}

describe('copying a long strL', () => {
    it('takes the event at once and copies the whole value', async () => {
        const my_grid = make_grid();
        const my_event = make_event();
        const my_copy = take_over_copy(
            my_event, range({ x: 1, y: 1, width: 1, height: 1 }), my_grid);
        // Taken while the event is dispatched, before any await.
        expect(my_event.calls).toEqual([
            'preventDefault', 'stopImmediatePropagation',
        ]);
        expect(await my_copy).toEqual({
            kind: 'copied', text: FULL, is_whole: true,
        });
        expect(my_grid.fetch_count).toBe(1);
    });

    it('copies a mixed range as Glide lays it out', async () => {
        const my_copy = take_over_copy(make_event(),
            range({ x: 0, y: 0, width: 2, height: 2 }), make_grid());
        expect(await my_copy).toEqual({
            kind: 'copied',
            text: `r0c0\tr0c1\nr1c0\t${FULL}`,
            is_whole: true,
        });
    });

    it('copies selected rows and columns whole', async () => {
        expect(await take_over_copy(make_event(),
            { range: undefined, rows: [0, 1], columns: [] }, make_grid()
        )).toEqual({
            kind: 'copied',
            text: `r0c0\tr0c1\nr1c0\t${FULL}`,
            is_whole: true,
        });
        expect(await take_over_copy(make_event(),
            { range: undefined, rows: [], columns: [0, 1] }, make_grid()
        )).toEqual({
            kind: 'copied',
            text: `r0c0\tr0c1\nr1c0\t${FULL}\nr2c0\tr2c1`,
            is_whole: true,
        });
    });

    it('reports a value it could not read', async () => {
        const my_copy = take_over_copy(make_event(),
            range({ x: 1, y: 1, width: 1, height: 1 }), make_grid(false));
        expect(await my_copy).toEqual({
            kind: 'copied', text: PREVIEW, is_whole: false,
        });
    });

    it('reports a copy that fails', async () => {
        const my_grid = make_grid();
        my_grid.to_text = () => { throw new Error('no text'); };
        expect(await take_over_copy(make_event(),
            range({ x: 1, y: 1, width: 1, height: 1 }), my_grid
        )).toEqual({ kind: 'failed', message: 'no text' });
    });
});

describe('copying cells shown whole', () => {
    it('leaves the event to Glide', () => {
        const my_event = make_event();
        expect(take_over_copy(my_event,
            range({ x: 0, y: 0, width: 2, height: 1 }), make_grid()
        )).toBeNull();
        expect(my_event.calls).toEqual([]);
    });

    it('leaves an empty selection alone', () => {
        expect(take_over_copy(make_event(),
            { range: undefined, rows: [], columns: [] }, make_grid()
        )).toBeNull();
    });
});

describe('copying rows the grid has not loaded', () => {
    it('reads them first, then copies them with the rest', async () => {
        const my_grid = make_grid(true, new Set([0, 1]));
        const my_event = make_event();
        const my_copy = take_over_copy(my_event,
            { range: undefined, rows: [], columns: [0] }, my_grid);
        expect(my_event.calls).toEqual([
            'preventDefault', 'stopImmediatePropagation',
        ]);
        expect(await my_copy).toEqual({
            kind: 'copied', text: 'r0c0\nr1c0\nr2c0', is_whole: true,
        });
        expect(my_grid.the_loads).toEqual([[2]]);
    });

    it('fetches both the missing rows and the long strL', async () => {
        const my_grid = make_grid(true, new Set([1]));
        expect(await take_over_copy(make_event(),
            range({ x: 0, y: 0, width: 2, height: 2 }), my_grid
        )).toEqual({
            kind: 'copied',
            text: `r0c0\tr0c1\nr1c0\t${FULL}`,
            is_whole: true,
        });
        expect(my_grid.the_loads).toEqual([[0]]);
        expect(my_grid.fetch_count).toBe(1);
    });

    it('fails, copying nothing, if they cannot be read', async () => {
        const my_grid = make_grid(true, new Set([0]));
        my_grid.load_error = new Error('the file can no longer be read');
        expect(await take_over_copy(make_event(),
            range({ x: 0, y: 0, width: 1, height: 2 }), my_grid
        )).toEqual({
            kind: 'failed', message: 'the file can no longer be read',
        });
    });

    it('fails if the rows shown change order meanwhile', async () => {
        const my_grid = make_grid(true, new Set([0]));
        my_grid.on_load = () => {
            my_grid.version += 1;
        };
        const my_result = await take_over_copy(make_event(),
            range({ x: 0, y: 0, width: 1, height: 2 }), my_grid);
        expect(my_result?.kind).toBe('failed');
    });
});

/** Rows as Glide's CompactSelection holds them: listing is counted. */
function counted_rows(length: number): IndexList & { listed: number } {
    const my_rows = {
        length,
        listed: 0,
        *[Symbol.iterator](): Iterator<number> {
            for (let i = 0; i < length; i++) {
                my_rows.listed++;
                yield i;
            }
        },
    };
    return my_rows;
}

describe('copying a very large selection', () => {
    it('fails with a message, listing no rows and leaving the clipboard', async () => {
        const my_rows = counted_rows(10_000_000);
        const my_grid = make_grid();
        my_grid.row_count = 10_000_000;
        const my_event = make_event();
        const my_copy = take_over_copy(my_event,
            { range: undefined, rows: my_rows, columns: [] }, my_grid);
        // Taken, so Glide doesn't copy it either.
        expect(my_event.calls).toEqual([
            'preventDefault', 'stopImmediatePropagation',
        ]);
        const my_result = await my_copy;
        expect(my_result?.kind).toBe('failed');
        expect(my_result?.kind === 'failed' && my_result.message)
            .toContain('20,000,000 cells');
        expect(my_rows.listed).toBe(0);
        expect(my_grid.the_loads).toEqual([]);
    });

    it('lists the rows of a copy within the bound once, at copy time', async () => {
        const my_rows = counted_rows(3);
        const my_grid = make_grid();
        expect(MAX_COPY_CELLS).toBeGreaterThanOrEqual(1_000_000);
        await take_over_copy(make_event(),
            { range: undefined, rows: my_rows, columns: [] }, my_grid);
        expect(my_rows.listed).toBe(3);
    });
});

describe('the most recent copy wins', () => {
    it('drops an earlier copy that finishes after a later one', async () => {
        const my_grid = make_grid();
        let release: () => void = () => undefined;
        const my_gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const my_slow_grid: CopyGrid<Rows> = {
            ...my_grid,
            get_cells: (rect, loaded) => {
                const my_cells = my_grid.get_cells(rect, loaded);
                if (typeof my_cells !== 'function') return my_cells;
                return async () => {
                    await my_gate;
                    return my_cells();
                };
            },
        };
        let my_selection: CopySelection =
            range({ x: 1, y: 1, width: 1, height: 1 });
        const the_posts: CopyMessage[] = [];
        const on_copy = create_copy_handler<Rows>({
            get_state: () => ({ selection: my_selection, grid: my_slow_grid }),
            is_grid_focused: () => true,
            post: my_message => the_posts.push(my_message),
        });
        // A long strL, still being fetched...
        on_copy(make_event());
        // ...then an ordinary cell, which Glide copies at once.
        my_selection = range({ x: 0, y: 0, width: 1, height: 1 });
        const my_second = make_event();
        on_copy(my_second);
        expect(my_second.calls).toEqual([]);
        release();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(the_posts).toEqual([
            { type: 'copyStarted' }, { type: 'copyStarted' },
        ]);
    });

    it('posts the copy when no later one came', async () => {
        const the_posts: CopyMessage[] = [];
        const on_copy = create_copy_handler<Rows>({
            get_state: () => ({
                selection: range({ x: 1, y: 1, width: 1, height: 1 }),
                grid: make_grid(),
            }),
            is_grid_focused: () => true,
            post: my_message => the_posts.push(my_message),
        });
        on_copy(make_event());
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(the_posts).toEqual([
            { type: 'copyStarted' },
            { type: 'copyText', text: FULL, is_whole: true },
        ]);
    });
});
