import { describe, expect, it } from 'bun:test';
import {
    create_empty_grid_selection,
    create_single_column_selection,
} from '../../../client/src/data-browser/webview/selection-model';

describe('data-browser selection model', () => {
    it('creates an empty grid selection', () => {
        const my_selection = create_empty_grid_selection();

        expect(my_selection.current).toBeUndefined();
        expect(my_selection.columns.length).toBe(0);
        expect(my_selection.rows.length).toBe(0);
        expect(my_selection.columns.toArray()).toEqual([]);
        expect(my_selection.rows.toArray()).toEqual([]);
    });

    it('creates a single-column selection for the requested column', () => {
        const my_selection = create_single_column_selection(3);

        expect(my_selection.current).toBeUndefined();
        expect(my_selection.columns.toArray()).toEqual([3]);
        expect(my_selection.columns.hasIndex(3)).toBe(true);
    });

    it('clears row selection when selecting a single column', () => {
        const my_selection = create_single_column_selection(5);

        expect(my_selection.rows.length).toBe(0);
        expect(my_selection.rows.toArray()).toEqual([]);
    });

    it('does not carry a stale current cell or range selection', () => {
        const my_selection = create_single_column_selection(1);

        expect('current' in my_selection).toBe(false);
        expect(my_selection.current).toBeUndefined();
    });
});
