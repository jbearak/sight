import type {
    CellArray,
    GridCell,
    Rectangle,
} from '@glideapps/glide-data-grid';

/**
 * Copying a selection that holds a long strL, whose whole value must
 * be fetched from the extension host first.
 *
 * Glide's own copy handler awaits such cells, then writes them to the
 * copy event's clipboardData. By then the event has been dispatched,
 * so the write does nothing and the clipboard keeps what it held. For
 * these selections, the handler below takes the copy event instead:
 * it stops it before Glide sees it, fetches the values, and hands the
 * text to the host to put on the clipboard. Glide still copies every
 * selection it can copy at once.
 */

/** What is selected, as the grid reports it (data coordinates). */
export interface CopySelection {
    range: Rectangle | undefined;
    rows: readonly number[];
    columns: readonly number[];
}

/** The cells once fetched, and whether every long strL was read. */
export interface FetchedCells {
    cells: CellArray;
    is_whole: boolean;
}

/**
 * The cells to copy in `rect`: at once, or, if it holds a long strL,
 * a fetch of them.
 */
export type GetCopyCells =
    (rect: Rectangle) => CellArray | (() => Promise<FetchedCells>);

export interface CopyGrid {
    get_cells: GetCopyCells;
    column_count: number;
    row_count: number;
    /** Glide's text for cells copied from `columns` (tab-separated). */
    to_text: (cells: CellArray, columns: readonly number[]) => string;
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

/** The cells a copy takes and their columns, as Glide's copy takes them. */
function plan_copy(
    selection: CopySelection,
    grid: CopyGrid
): { parts: CellPart[]; columns: number[]; by: 'rows' | 'columns' } | null {
    const my_range = selection.range;
    if (my_range !== undefined) {
        const the_columns: number[] = [];
        for (let i = 0; i < my_range.width; i++) {
            the_columns.push(my_range.x + i);
        }
        return {
            parts: [grid.get_cells(my_range)],
            columns: the_columns,
            by: 'rows',
        };
    }
    if (selection.rows.length > 0) {
        const the_columns: number[] = [];
        for (let i = 0; i < grid.column_count; i++) {
            the_columns.push(i);
        }
        return {
            parts: selection.rows.map(my_row => grid.get_cells({
                x: 0, y: my_row, width: grid.column_count, height: 1,
            })),
            columns: the_columns,
            by: 'rows',
        };
    }
    if (selection.columns.length > 0) {
        return {
            parts: selection.columns.map(my_col => grid.get_cells({
                x: my_col, y: 0, width: 1, height: grid.row_count,
            })),
            columns: [...selection.columns],
            by: 'columns',
        };
    }
    return null;
}

/** Glue fetched parts back into the grid of cells Glide would copy. */
function join_parts(
    the_parts: CellArray[],
    by: 'rows' | 'columns'
): CellArray {
    if (by === 'rows') {
        return the_parts.flatMap(my_part => my_part);
    }
    const my_first = the_parts[0] ?? [];
    return my_first.map((_, i) => the_parts.flatMap(
        my_part => my_part[i] ?? ([] as readonly GridCell[])));
}

/**
 * Take a copy of `selection` if it holds a long strL: stop `event`
 * before Glide's handler (it must be called while the event is being
 * dispatched), then resolve to the text to put on the clipboard.
 * Returns null, leaving the event alone, for a selection Glide copies
 * by itself.
 */
export function take_over_copy(
    event: CopyEventLike,
    selection: CopySelection,
    grid: CopyGrid
): Promise<CopyResult> | null {
    const my_plan = plan_copy(selection, grid);
    if (my_plan === null ||
        !my_plan.parts.some(my_part => typeof my_part === 'function')) {
        return null;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return (async (): Promise<CopyResult> => {
        try {
            let is_whole = true;
            const the_parts: CellArray[] = [];
            for (const my_part of my_plan.parts) {
                if (typeof my_part === 'function') {
                    const my_fetched = await my_part();
                    is_whole = is_whole && my_fetched.is_whole;
                    the_parts.push(my_fetched.cells);
                } else {
                    the_parts.push(my_part);
                }
            }
            return {
                kind: 'copied',
                text: grid.to_text(
                    join_parts(the_parts, my_plan.by), my_plan.columns),
                is_whole,
            };
        } catch (my_err) {
            return {
                kind: 'failed',
                message: my_err instanceof Error
                    ? my_err.message
                    : String(my_err),
            };
        }
    })();
}
