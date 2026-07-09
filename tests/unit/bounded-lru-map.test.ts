import { describe, it, expect } from 'bun:test';
import { BoundedLruMap } from '../../src/utils/lru-cache';

describe('BoundedLruMap', () => {
    it('evicts the least-recently-used entry when a new key exceeds capacity', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        expect(cache.has('a')).toBe(false);
        expect(cache.has('b')).toBe(true);
        expect(cache.has('c')).toBe(true);
        expect(cache.size).toBe(2);
    });

    it('get() promotes: a read key survives the next eviction', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.get('a')).toBe(1);
        cache.set('c', 3);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });

    it('touch() promotes without reading', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.touch('a');
        cache.set('c', 3);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });

    it('touch() of an absent key is a no-op', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.touch('missing');
        expect(cache.size).toBe(1);
        expect(cache.has('missing')).toBe(false);
    });

    it('peek() and has() do not promote', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.peek('a')).toBe(1);
        expect(cache.has('a')).toBe(true);
        cache.set('c', 3);
        // 'a' was only peeked, so it is still the LRU entry and gets evicted
        expect(cache.has('a')).toBe(false);
        expect(cache.has('b')).toBe(true);
    });

    it('iteration does not promote', () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        for (const [my_key, my_value] of cache) {
            expect(typeof my_key).toBe('string');
            expect(typeof my_value).toBe('number');
        }
        Array.from(cache.keys());
        Array.from(cache.values());
        Array.from(cache.entries());
        cache.set('c', 3);
        expect(cache.has('a')).toBe(false);
    });

    it('iteration order is LRU-first and stable across repeated iteration', () => {
        const cache = new BoundedLruMap<string, number>(3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.get('a'); // now order is b, c, a
        const first_pass = Array.from(cache.keys());
        const second_pass = Array.from(cache.keys());
        expect(first_pass).toEqual(['b', 'c', 'a']);
        expect(second_pass).toEqual(first_pass);
    });

    it('on_evict fires exactly once per capacity eviction with the evicted pair', () => {
        const the_evicted: Array<[string, number]> = [];
        const cache = new BoundedLruMap<string, number>(2, {
            on_evict: (key, value) => the_evicted.push([key, value]),
        });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        expect(the_evicted).toEqual([['a', 1]]);
    });

    it('on_evict does not fire on delete() or clear()', () => {
        const the_evicted: string[] = [];
        const cache = new BoundedLruMap<string, number>(2, {
            on_evict: (key) => the_evicted.push(key),
        });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.delete('a');
        cache.clear();
        expect(the_evicted).toEqual([]);
    });

    it('updating an existing key never evicts and promotes the key', () => {
        const the_evicted: string[] = [];
        const cache = new BoundedLruMap<string, number>(2, {
            on_evict: (key) => the_evicted.push(key),
        });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10);
        expect(the_evicted).toEqual([]);
        expect(cache.get('a')).toBe(10);
        cache.set('c', 3);
        // 'a' was promoted by the update, so 'b' is evicted
        expect(the_evicted).toEqual(['b']);
    });

    it('set_max_size shrink evicts LRU-first down to the new capacity', () => {
        const the_evicted: string[] = [];
        const cache = new BoundedLruMap<string, number>(4, {
            on_evict: (key) => the_evicted.push(key),
        });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4);
        cache.get('a'); // promote 'a' past b/c/d
        cache.set_max_size(2);
        expect(the_evicted).toEqual(['b', 'c']);
        expect(Array.from(cache.keys())).toEqual(['d', 'a']);
        expect(cache.capacity).toBe(2);
    });

    it('set_max_size grow is a no-op beyond the capacity update', () => {
        const the_evicted: string[] = [];
        const cache = new BoundedLruMap<string, number>(2, {
            on_evict: (key) => the_evicted.push(key),
        });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set_max_size(10);
        expect(the_evicted).toEqual([]);
        expect(cache.size).toBe(2);
        expect(cache.capacity).toBe(10);
    });

    it('capacity has a floor of 1', () => {
        const cache = new BoundedLruMap<string, number>(0);
        expect(cache.capacity).toBe(1);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.size).toBe(1);
        expect(cache.has('b')).toBe(true);
        cache.set_max_size(-5);
        expect(cache.capacity).toBe(1);
    });

    it('on_evict completes synchronously inside set()', () => {
        let evict_seen_before_set_returned = false;
        const cache = new BoundedLruMap<string, number>(1, {
            on_evict: () => {
                evict_seen_before_set_returned = true;
            },
        });
        cache.set('a', 1);
        cache.set('b', 2);
        expect(evict_seen_before_set_returned).toBe(true);
    });

    it('a throwing on_evict propagates fail-fast out of set() (documented contract)', () => {
        // No try/catch by design: hooks must be infallible. This pins the
        // CURRENT contract so a future change (e.g. swallowing errors) is
        // a conscious decision — the victim is already gone and the new
        // write is lost when the hook throws.
        const cache = new BoundedLruMap<string, number>(1, {
            on_evict: () => {
                throw new Error('hook failure');
            },
        });
        cache.set('a', 1);
        expect(() => cache.set('b', 2)).toThrow('hook failure');
        expect(cache.has('a')).toBe(false);
        expect(cache.has('b')).toBe(false);
    });

    it('stores undefined-tolerant values without breaking has/get distinction', () => {
        const cache = new BoundedLruMap<string, number | undefined>(2);
        cache.set('a', undefined);
        cache.set('b', 1);
        expect(cache.has('a')).toBe(true);
        expect(cache.get('a')).toBeUndefined();
        // The get() above must still have promoted 'a' past 'b'
        cache.set('c', 2);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });
});
