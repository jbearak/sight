import { describe, expect, it } from 'bun:test';
import { visible_cell_damage } from '../../../client/src/data-browser/webview/visible-cell-damage';

describe('data-browser visible_cell_damage', () => {
    it('returns every visible cell clamped to the effective row count', () => {
        expect(visible_cell_damage({
            column_count: 3,
            first_row: 4,
            row_count: 4,
            total_rows: 6,
        })).toEqual([
            { cell: [0, 4] },
            { cell: [1, 4] },
            { cell: [2, 4] },
            { cell: [0, 5] },
            { cell: [1, 5] },
            { cell: [2, 5] },
        ]);
    });
});
