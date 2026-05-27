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

/**
 * Collapse a display-order list of original row indices into maximal
 * ascending-contiguous runs, preserving order. Each run can then be read
 * with a single `read_rows(start, len)` call. Scattered indices (typical
 * after a sort) stay as length-1 runs; ascending windows (typical of a
 * filter-only view) collapse into one read.
 */
export function group_contiguous_runs(
    indices: readonly number[]
): { start: number; len: number }[] {
    const the_runs: { start: number; len: number }[] = [];
    let i = 0;
    while (i < indices.length) {
        let my_len = 1;
        while (
            i + my_len < indices.length
            && indices[i + my_len] === indices[i] + my_len
        ) {
            my_len++;
        }
        the_runs.push({ start: indices[i], len: my_len });
        i += my_len;
    }
    return the_runs;
}
