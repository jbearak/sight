import { describe, expect, it } from 'bun:test';
import {
    group_contiguous_runs,
    permuted_window_indices,
} from '../../../client/src/data-browser/permuted-rows';

describe('data-browser permuted_window_indices', () => {
    it('returns an identity slice when no permutation', () => {
        expect(permuted_window_indices(undefined, 2, 3, 10))
            .toEqual([2, 3, 4]);
    });

    it('clamps an identity slice to nobs', () => {
        expect(permuted_window_indices(undefined, 8, 5, 10))
            .toEqual([8, 9]);
    });

    it('returns [] when start is at or past nobs', () => {
        expect(permuted_window_indices(undefined, 10, 5, 10))
            .toEqual([]);
    });

    it('maps the window through the permutation', () => {
        const perm = Uint32Array.from([4, 0, 2, 1, 3]);
        expect(permuted_window_indices(perm, 1, 3, 5))
            .toEqual([0, 2, 1]);
    });

    it('clamps the window to the permutation length', () => {
        const perm = Uint32Array.from([4, 0, 2]);
        expect(permuted_window_indices(perm, 1, 10, 3))
            .toEqual([0, 2]);
    });
});

describe('data-browser group_contiguous_runs', () => {
    it('returns no runs for an empty list', () => {
        expect(group_contiguous_runs([])).toEqual([]);
    });

    it('groups a single index', () => {
        expect(group_contiguous_runs([5]))
            .toEqual([{ start: 5, len: 1 }]);
    });

    it('collapses an ascending contiguous run', () => {
        expect(group_contiguous_runs([0, 1, 2]))
            .toEqual([{ start: 0, len: 3 }]);
    });

    it('keeps scattered indices as length-1 runs', () => {
        expect(group_contiguous_runs([4, 0, 2, 1, 3])).toEqual([
            { start: 4, len: 1 },
            { start: 0, len: 1 },
            { start: 2, len: 1 },
            { start: 1, len: 1 },
            { start: 3, len: 1 },
        ]);
    });

    it('splits at gaps', () => {
        expect(group_contiguous_runs([0, 1, 2, 5, 6])).toEqual([
            { start: 0, len: 3 },
            { start: 5, len: 2 },
        ]);
    });
});
