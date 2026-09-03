import { describe, expect, it } from 'bun:test';
import {
    MAX_PAGE_CELLS,
    PAGE_SIZE,
    page_size_for_column_count,
} from '../../../client/src/data-browser/page-size';

describe('page_size_for_column_count', () => {
    it('uses the default page size for narrow datasets', () => {
        expect(page_size_for_column_count(1)).toBe(PAGE_SIZE);
        expect(page_size_for_column_count(50)).toBe(PAGE_SIZE);
        expect(page_size_for_column_count(MAX_PAGE_CELLS / PAGE_SIZE))
            .toBe(PAGE_SIZE);
    });

    it('shrinks the page so a page never exceeds the cell budget', () => {
        const my_columns = 1000;
        const my_page = page_size_for_column_count(my_columns);
        expect(my_page).toBeLessThan(PAGE_SIZE);
        expect(my_page * my_columns).toBeLessThanOrEqual(MAX_PAGE_CELLS);
        expect((my_page + 1) * my_columns).toBeGreaterThan(MAX_PAGE_CELLS);
    });

    it('never drops below one row', () => {
        expect(page_size_for_column_count(MAX_PAGE_CELLS * 4)).toBe(1);
    });

    it('treats zero or fractional column counts as one column', () => {
        expect(page_size_for_column_count(0)).toBe(PAGE_SIZE);
        expect(page_size_for_column_count(0.5)).toBe(PAGE_SIZE);
    });
});
