import { describe, it, expect } from 'bun:test';
import { RowCache } from '../../../client/src/data-browser/row-cache';

describe('RowCache', () => {
    it('stores and retrieves a page', () => {
        const my_cache = new RowCache(10, 200);
        const my_rows = [[1, 'a'], [2, 'b']];
        my_cache.set_page(0, my_rows);
        expect(my_cache.get_page(0)).toEqual(my_rows);
    });

    it('returns undefined for missing pages', () => {
        const my_cache = new RowCache(10, 200);
        expect(my_cache.get_page(0)).toBeUndefined();
    });

    it('evicts oldest page when max is exceeded', () => {
        const my_cache = new RowCache(3, 200);
        my_cache.set_page(0, []);
        my_cache.set_page(200, []);
        my_cache.set_page(400, []);
        // Access page 0 to make it recently used
        my_cache.get_page(0);
        // Add a 4th page -- should evict page 200 (LRU)
        my_cache.set_page(600, []);
        expect(my_cache.get_page(0)).toBeDefined();
        expect(my_cache.get_page(200)).toBeUndefined();
        expect(my_cache.get_page(400)).toBeDefined();
        expect(my_cache.get_page(600)).toBeDefined();
    });

    it('clears all pages', () => {
        const my_cache = new RowCache(10, 200);
        my_cache.set_page(0, []);
        my_cache.set_page(200, []);
        my_cache.clear();
        expect(my_cache.get_page(0)).toBeUndefined();
        expect(my_cache.get_page(200)).toBeUndefined();
    });

    it('reports size correctly', () => {
        const my_cache = new RowCache(10, 200);
        expect(my_cache.size).toBe(0);
        my_cache.set_page(0, []);
        expect(my_cache.size).toBe(1);
        my_cache.set_page(200, []);
        expect(my_cache.size).toBe(2);
    });
});
