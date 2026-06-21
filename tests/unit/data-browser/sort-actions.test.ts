import { describe, expect, it } from 'bun:test';
import {
    active_direction,
    apply_sort_pick,
    flip_key,
    move_to_first,
    remove_key,
    sort_priority_map,
} from '../../../client/src/data-browser/webview/sort-actions';
import type { SortKey } from '../../../client/src/data-browser/types';

const k = (col: number, d: 'asc' | 'desc' = 'asc'): SortKey => ({
    col_index: col,
    direction: d,
});

describe('data-browser apply_sort_pick', () => {
    it('replaces the whole sort when not appending', () => {
        expect(apply_sort_pick([k(0), k(1)], 2, 'desc', false))
            .toEqual([k(2, 'desc')]);
    });
    it('appends a new column when appending', () => {
        expect(apply_sort_pick([k(0)], 1, 'asc', true))
            .toEqual([k(0), k(1)]);
    });
    it('sets the picked direction in place for an existing key', () => {
        expect(apply_sort_pick([k(0, 'asc'), k(1, 'asc')], 0, 'desc', true))
            .toEqual([k(0, 'desc'), k(1, 'asc')]);
    });
});

describe('data-browser active_direction', () => {
    it('reports the direction of a sorted column', () => {
        expect(active_direction([k(0, 'desc')], 0)).toBe('desc');
    });
    it('reports none for an unsorted column', () => {
        expect(active_direction([k(0)], 5)).toBe('none');
    });
});

describe('data-browser sort key mutations', () => {
    it('flips a key direction', () => {
        expect(flip_key([k(0, 'asc'), k(1, 'desc')], 1))
            .toEqual([k(0, 'asc'), k(1, 'asc')]);
    });
    it('removes a key', () => {
        expect(remove_key([k(0), k(1), k(2)], 1))
            .toEqual([k(0), k(2)]);
    });
    it('moves a key to first', () => {
        expect(move_to_first([k(0), k(1), k(2)], 2))
            .toEqual([k(2), k(0), k(1)]);
    });
    it('move_to_first is a no-op at index 0', () => {
        expect(move_to_first([k(0), k(1)], 0))
            .toEqual([k(0), k(1)]);
    });
});

describe('data-browser sort_priority_map', () => {
    it('maps each column to its 1-based priority and direction', () => {
        const m = sort_priority_map([k(3, 'desc'), k(1, 'asc')]);
        expect(m.get(3)).toEqual({ direction: 'desc', priority: 1 });
        expect(m.get(1)).toEqual({ direction: 'asc', priority: 2 });
        expect(m.has(0)).toBe(false);
    });
});
