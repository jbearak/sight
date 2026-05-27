/**
 * Map a visible row window to original row indices.
 *
 * When a sort/filter permutation is active, the row displayed at visible
 * position `i` is the original row `permutation[i]`. This helper returns
 * the list of original indices for the visible window `[start,
 * start+count)`, in display order. With `permutation === undefined`
 * (no sort/filter) it returns the identity slice clamped to `nobs`.
 */
export function permuted_window_indices(
    permutation: Uint32Array | undefined,
    start: number,
    count: number,
    nobs: number
): number[] {
    const my_start = Math.max(0, start);

    if (!permutation) {
        const my_end = Math.min(my_start + count, nobs);
        const the_indices: number[] = [];
        for (let i = my_start; i < my_end; i++) {
            the_indices.push(i);
        }
        return the_indices;
    }

    const my_end = Math.min(my_start + count, permutation.length);
    const the_indices: number[] = [];
    for (let i = my_start; i < my_end; i++) {
        the_indices.push(permutation[i]);
    }
    return the_indices;
}
