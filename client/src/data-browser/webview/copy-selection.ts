import type {
    CellArray,
    GridCell,
    Rectangle,
} from '@glideapps/glide-data-grid';

/**
 * Copying a selection Glide can't copy by itself while the copy event
 * is dispatched: one holding a long strL, whose whole value must be
 * fetched from the extension host, or rows the grid hasn't loaded.
 *
 * Glide's own copy handler awaits such cells, then writes them to the
 * copy event's clipboardData. By then the event has been dispatched,
 * so the write does nothing and the clipboard keeps what it held; and
 * it copies a row the grid hasn't loaded as empty. For these
 * selections, the handler below takes the copy event instead: it
 * stops it before Glide sees it, fetches what is missing, and hands
 * the text to the host to put on the clipboard. Glide still copies
 * every selection it can copy at once.
 *
 * A copy is bounded (MAX_COPY_CELLS); a larger one fails with a
 * message and leaves the clipboard alone. The selected rows are listed
 * only then, never on each render: a selection of ten million rows is
 * a few ranges until it is copied.
 */

/** The most cells one copy takes. */
export const MAX_COPY_CELLS = 1_000_000;

/** Indices as Glide's CompactSelection gives them, without expanding. */
export interface IndexList {
    readonly length: number;
    [Symbol.iterator](): Iterator<number>;
}

/** What is selected, as the grid reports it (data coordinates). */
export interface CopySelection {
    range: Rectangle | undefined;
    rows: IndexList;
    columns: IndexList;
}

/** The cells once fetched, and whether every long strL was read. */
export interface FetchedCells {
    cells: CellArray;
    is_whole: boolean;
}

/**
 * The cells to copy in `rect`: at once, or, if it holds a long strL,
 * a fetch of them. `rows` are rows `load_rows` read, for those the
 * grid hasn't loaded.
 */
export type GetCopyCells<TRows> = (
    rect: Rectangle,
    rows?: TRows
) => CellArray | (() => Promise<FetchedCells>);

export interface CopyGrid<TRows = unknown> {
    get_cells: GetCopyCells<TRows>;
    column_count: number;
    row_count: number;
    /** Glide's text for cells copied from `columns` (tab-separated). */
    to_text: (cells: CellArray, columns: readonly number[]) => string;
    /** Whether the grid has row `row`'s cells in `columns`, all read. */
    has_row: (row: number, columns: readonly number[]) => boolean;
    /**
     * Read rows the grid hasn't loaded (ascending), for `columns`.
     * Rejects, with why, if they can't be read.
     */
    load_rows: (
        rows: readonly number[],
        columns: readonly number[]
    ) => Promise<TRows>;
    /** Changes whenever the rows shown change order or dataset. */
    order_version: () => number;
}

/** The part of a copy event the handler uses. */
export interface CopyEventLike {
    preventDefault(): void;
    stopImmediatePropagation(): void;
}

export type CopyResult =
    | { kind: 'copied'; text: string; is_whole: boolean }
    | { kind: 'failed'; message: string };

type CellPart = CellArray | (() => Promise<FetchedCells>);

/** What a selection covers, worked out without listing it. */
interface CopyShape {
    by: 'range' | 'rows' | 'columns';
    cell_count: number;
}

/** The grid's size. */
interface GridSize {
    column_count: number;
    row_count: number;
}

function shape_of(
    selection: CopySelection,
    grid: GridSize
): CopyShape | null {
    const my_range = selection.range;
    if (my_range !== undefined) {
        return {
            by: 'range',
            cell_count: my_range.width * my_range.height,
        };
    }
    if (selection.rows.length > 0) {
        return {
            by: 'rows',
            cell_count: selection.rows.length * grid.column_count,
        };
    }
    if (selection.columns.length > 0) {
        return {
            by: 'columns',
            cell_count: selection.columns.length * grid.row_count,
        };
    }
    return null;
}

/** The selection's rows and columns, listed (once bounded). */
function list_selection(
    selection: CopySelection,
    shape: CopyShape,
    grid: GridSize
): { rows: number[]; columns: number[] } {
    const the_rows: number[] = [];
    const the_columns: number[] = [];
    const my_range = selection.range;
    if (shape.by === 'range' && my_range !== undefined) {
        for (let i = 0; i < my_range.height; i++) {
            the_rows.push(my_range.y + i);
        }
        for (let i = 0; i < my_range.width; i++) {
            the_columns.push(my_range.x + i);
        }
    } else if (shape.by === 'rows') {
        for (const my_row of selection.rows) the_rows.push(my_row);
        for (let i = 0; i < grid.column_count; i++) the_columns.push(i);
    } else {
        for (let i = 0; i < grid.row_count; i++) the_rows.push(i);
        for (const my_col of selection.columns) the_columns.push(my_col);
    }
    return { rows: the_rows, columns: the_columns };
}

/** The cells a copy takes, as Glide's copy takes them. */
function plan_parts<TRows>(
    selection: CopySelection,
    shape: CopyShape,
    listed: { rows: number[]; columns: number[] },
    grid: CopyGrid<TRows>,
    loaded: TRows | undefined
): CellPart[] {
    const my_range = selection.range;
    if (shape.by === 'range' && my_range !== undefined) {
        return [grid.get_cells(my_range, loaded)];
    }
    if (shape.by === 'rows') {
        return listed.rows.map(my_row => grid.get_cells({
            x: 0, y: my_row, width: grid.column_count, height: 1,
        }, loaded));
    }
    return listed.columns.map(my_col => grid.get_cells({
        x: my_col, y: 0, width: 1, height: grid.row_count,
    }, loaded));
}

/** Glue fetched parts back into the grid of cells Glide would copy. */
function join_parts(
    the_parts: CellArray[],
    by: CopyShape['by']
): CellArray {
    if (by !== 'columns') {
        return the_parts.flatMap(my_part => my_part);
    }
    const my_first = the_parts[0] ?? [];
    return my_first.map((_, i) => the_parts.flatMap(
        my_part => my_part[i] ?? ([] as readonly GridCell[])));
}

function error_message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function format_count(count: number): string {
    return count.toLocaleString('en-US');
}

const ORDER_CHANGED_MESSAGE =
    'the rows shown changed during the copy (a sort or filter); copy '
    + 'again.';

/**
 * Take a copy of `selection` if Glide can't make it at once (a long
 * strL, rows not loaded, or too many cells): stop `event` before
 * Glide's handler (it must be called while the event is being
 * dispatched), then resolve to the text to put on the clipboard, or
 * why there is none. Returns null, leaving the event alone, for a
 * selection Glide copies by itself.
 */
export function take_over_copy<TRows>(
    event: CopyEventLike,
    selection: CopySelection,
    grid: CopyGrid<TRows>
): Promise<CopyResult> | null {
    const my_shape = shape_of(selection, grid);
    if (my_shape === null) {
        return null;
    }
    const take_event = (): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    if (my_shape.cell_count > MAX_COPY_CELLS) {
        take_event();
        return Promise.resolve({
            kind: 'failed',
            message: `the selection has ${format_count(my_shape.cell_count)} `
                + `cells, and a copy takes at most `
                + `${format_count(MAX_COPY_CELLS)}. Select fewer, or use `
                + 'Copy Column for a whole column.',
        });
    }
    const my_listed = list_selection(selection, my_shape, grid);
    const the_missing = my_listed.rows.filter(
        my_row => my_row < grid.row_count
            && !grid.has_row(my_row, my_listed.columns)
    );
    let the_parts: CellPart[] | null = null;
    if (the_missing.length === 0) {
        the_parts = plan_parts(
            selection, my_shape, my_listed, grid, undefined
        );
        if (!the_parts.some(my_part => typeof my_part === 'function')) {
            return null;
        }
    }
    take_event();
    const my_version = grid.order_version();
    return (async (): Promise<CopyResult> => {
        try {
            if (the_parts === null) {
                const my_loaded = await grid.load_rows(
                    the_missing, my_listed.columns
                );
                if (grid.order_version() !== my_version) {
                    return { kind: 'failed', message: ORDER_CHANGED_MESSAGE };
                }
                the_parts = plan_parts(
                    selection, my_shape, my_listed, grid, my_loaded
                );
            }
            let is_whole = true;
            const the_cells: CellArray[] = [];
            for (const my_part of the_parts) {
                if (typeof my_part === 'function') {
                    const my_fetched = await my_part();
                    is_whole = is_whole && my_fetched.is_whole;
                    the_cells.push(my_fetched.cells);
                } else {
                    the_cells.push(my_part);
                }
            }
            if (grid.order_version() !== my_version) {
                return { kind: 'failed', message: ORDER_CHANGED_MESSAGE };
            }
            return {
                kind: 'copied',
                text: grid.to_text(
                    join_parts(the_cells, my_shape.by), my_listed.columns),
                is_whole,
            };
        } catch (my_err) {
            return { kind: 'failed', message: error_message(my_err) };
        }
    })();
}

/** What the copy handler posts to the host. */
export type CopyMessage =
    | { type: 'copyStarted' }
    | { type: 'copyText'; text: string; is_whole: boolean }
    | { type: 'copyFailed'; message: string };

export interface CopyHandlerOptions<TRows> {
    /** The selection and grid now, or null before the grid is up. */
    get_state: () => {
        selection: CopySelection;
        grid: CopyGrid<TRows>;
    } | null;
    /** Whether the copy is the grid's (not a text field's). */
    is_grid_focused: () => boolean;
    post: (message: CopyMessage) => void;
}

/**
 * The window's copy listener (capture phase). Every copy, the grid's
 * or not, is newer than the copies still being made: those then post
 * nothing, so the most recent copy wins the clipboard.
 */
export function create_copy_handler<TRows>(
    options: CopyHandlerOptions<TRows>
): (event: CopyEventLike) => void {
    let latest_copy = 0;
    return event => {
        latest_copy += 1;
        const my_copy_id = latest_copy;
        options.post({ type: 'copyStarted' });
        const my_state = options.get_state();
        if (!my_state || !options.is_grid_focused()) return;
        const my_copy = take_over_copy(
            event, my_state.selection, my_state.grid
        );
        if (!my_copy) return;
        void my_copy.then(my_result => {
            if (my_copy_id !== latest_copy) return;
            options.post(my_result.kind === 'copied'
                ? {
                    type: 'copyText',
                    text: my_result.text,
                    is_whole: my_result.is_whole,
                }
                : { type: 'copyFailed', message: my_result.message });
        });
    };
}
