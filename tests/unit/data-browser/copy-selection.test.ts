import { describe, expect, it } from 'bun:test';
import {
    getCopyBufferContents,
    GridCellKind,
    type CellArray,
    type GridCell,
    type Rectangle,
} from '@glideapps/glide-data-grid';
import {
    take_over_copy,
    type CopyGrid,
    type CopySelection,
    type FetchedCells,
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

/**
 * A 3 x 2 grid; cell (1, 1) is a long strL whose preview shows. The
 * fetch fails if `is_readable` is false.
 */
function make_grid(is_readable = true): CopyGrid & { fetch_count: number } {
    const my_grid = {
        fetch_count: 0,
        column_count: 2,
        row_count: 3,
        to_text: (cells: CellArray, columns: readonly number[]) =>
            getCopyBufferContents(cells, columns).textPlain,
        get_cells: (rect: Rectangle) => {
            const the_cells: GridCell[][] = [];
            let has_long = false;
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                const my_row: GridCell[] = [];
                for (let x = rect.x; x < rect.x + rect.width; x++) {
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
