import { describe, expect, it } from 'bun:test';
import { permuted_window_indices } from '../../../client/src/data-browser/permuted-rows';

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
