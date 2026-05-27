import { describe, expect, it } from 'bun:test';
import {
    create_filter_state_store,
    DATA_BROWSER_FILTER_STATE_KEY,
} from '../../../client/src/data-browser/filter-state';
import { compose_effective } from '../../../client/src/data-browser/permuted-rows';
import type { FilterState } from '../../../client/src/data-browser/types';

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

const filter = (col: number): FilterState => ({
    entries: [{
        id: `e${col}`,
        col_index: col,
        predicate: { kind: 'isNotEmpty' },
        enabled: true,
        include_missing: false,
    }],
    labels_on_when_filtered: true,
});

describe('data-browser filter-state store', () => {
    it('round-trips a filter by dataset_key + schema_hash', async () => {
        const ctx = make_context();
        const s = create_filter_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', filter(2));
        expect(s.get('/data/a.dta', 'hash1')).toEqual(filter(2));
    });

    it('separates slots by schema_hash', async () => {
        const ctx = make_context();
        const s = create_filter_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', filter(2));
        expect(s.get('/data/a.dta', 'hash2')).toBeUndefined();
    });

    it('clears a slot when there are no entries', async () => {
        const ctx = make_context();
        const s = create_filter_state_store(ctx);
        await s.set('/data/a.dta', 'hash1', filter(2));
        await s.set('/data/a.dta', 'hash1', {
            entries: [],
            labels_on_when_filtered: true,
        });
        expect(s.get('/data/a.dta', 'hash1')).toBeUndefined();
    });

    it('drops malformed persisted blobs on read', async () => {
        const ctx = make_context();
        ctx._store.set(DATA_BROWSER_FILTER_STATE_KEY, {
            '/data/a.dta::h': { entries: 'not an array' },
        });
        const s = create_filter_state_store(ctx);
        expect(s.get('/data/a.dta', 'h')).toBeUndefined();
    });

    it('evicts the oldest entry past the cap', async () => {
        const ctx = make_context();
        const s = create_filter_state_store(ctx, () => 2);
        await s.set('a', 'h', filter(0));
        await s.set('b', 'h', filter(1));
        await s.set('c', 'h', filter(2));
        expect(s.get('a', 'h')).toBeUndefined();
        expect(s.get('b', 'h')).toEqual(filter(1));
        expect(s.get('c', 'h')).toEqual(filter(2));
    });
});

describe('data-browser compose_effective', () => {
    const u32 = (...xs: number[]) => Uint32Array.from(xs);

    it('returns the permutation when no filter is active (sort-only)', () => {
        const perm = u32(2, 0, 1);
        expect(compose_effective(null, perm, 3)).toBe(perm);
    });

    it('returns the filter survivors when no sort is active', () => {
        const survivors = u32(1, 3);
        expect(compose_effective(survivors, null, 4)).toBe(survivors);
    });

    it('returns null when neither is active', () => {
        expect(compose_effective(null, null, 5)).toBeNull();
    });

    it('orders survivors by the sort permutation when both active', () => {
        // perm reverses [0..3]; survivors {1,3} -> kept in perm order.
        const perm = u32(3, 2, 1, 0);
        const survivors = u32(1, 3);
        expect([...compose_effective(survivors, perm, 4)!])
            .toEqual([3, 1]);
    });

    it('trims (no trailing zeros) when nobs is stale/too small', () => {
        // nobs=2 can't cover survivor index 3, so only survivor 1 is
        // found; the result must be [1], not [1, 0].
        const perm = u32(3, 2, 1, 0);
        const survivors = u32(1, 3);
        expect([...compose_effective(survivors, perm, 2)!]).toEqual([1]);
    });
});
