import { describe, expect, it } from 'bun:test';
import {
    create_sort_state_store,
    DATA_BROWSER_SORT_STATE_KEY,
} from '../../../client/src/data-browser/sort-state';
import type { SortState } from '../../../client/src/data-browser/types';

function make_context() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get<T>(key: string, def?: T): T | undefined {
                return store.has(key) ? (store.get(key) as T) : def;
            },
            update(key: string, value: unknown): Promise<void> {
                if (value === undefined) store.delete(key);
                else store.set(key, value);
                return Promise.resolve();
            },
        },
        _store: store,
    };
}

const sort = (col: number): SortState => ({
    keys: [{ col_index: col, direction: 'asc' }],
    labels_on_when_sorted: true,
});

describe('data-browser sort-state store', () => {
    it('round-trips a sort by dataset_key + schema_hash', async () => {
        const ctx = make_context();
        const s = create_sort_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', sort(2));
        expect(s.get('/data/a.dta', 'hash1')).toEqual(sort(2));
    });

    it('separates slots by schema_hash', async () => {
        const ctx = make_context();
        const s = create_sort_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', sort(2));
        expect(s.get('/data/a.dta', 'hash2')).toBeUndefined();
    });

    it('clears a slot when keys are empty', async () => {
        const ctx = make_context();
        const s = create_sort_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', sort(2));
        await s.set('/data/a.dta', 'hash1', {
            keys: [],
            labels_on_when_sorted: true,
        });
        expect(s.get('/data/a.dta', 'hash1')).toBeUndefined();
    });

    it('evicts the oldest entry past the cap', async () => {
        const ctx = make_context();
        const s = create_sort_state_store(ctx, () => 2);
        await s.set('a', 'h', sort(0));
        await s.set('b', 'h', sort(1));
        await s.set('c', 'h', sort(2)); // evicts 'a::h'
        expect(s.get('a', 'h')).toBeUndefined();
        expect(s.get('b', 'h')).toEqual(sort(1));
        expect(s.get('c', 'h')).toEqual(sort(2));
    });

    it('stores everything under one globalState key', async () => {
        const ctx = make_context();
        const s = create_sort_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', sort(2));
        expect(ctx._store.has(DATA_BROWSER_SORT_STATE_KEY)).toBe(true);
    });
});
