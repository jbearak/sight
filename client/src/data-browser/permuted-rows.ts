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
 * Combine a filter survivor set with a sort permutation into the single
 * effective permutation handed to the row reader.
 *
 * `filtered_indices` is the surviving rows in ORIGINAL order; `permutation`
 * (when present) is a sort permutation over the ORIGINAL frame. When both
 * are active we walk the sort permutation keeping only survivors, so the
 * visible window reflects both — filtered set, in sorted order. `nobs` is
 * the full (unfiltered) row count, used to size the survivor lookup.
 *
 * Returns the filter set when only filtering, the permutation when only
 * sorting, and `null` when neither is active (caller reads rows in
 * identity order). Ported from Raven's panel `composeEffective`.
 */
export function compose_effective(
    filtered_indices: Uint32Array | null | undefined,
    permutation: Uint32Array | null | undefined,
    nobs: number
): Uint32Array | null {
    if (!filtered_indices) return permutation ?? null;
    if (!permutation) return filtered_indices;

    const the_survives = new Uint8Array(nobs);
    for (let i = 0; i < filtered_indices.length; i++) {
        the_survives[filtered_indices[i]] = 1;
    }
    const out = new Uint32Array(filtered_indices.length);
    let j = 0;
    for (let i = 0; i < permutation.length; i++) {
        if (the_survives[permutation[i]]) {
            out[j++] = permutation[i];
        }
    }
    // Normally every survivor appears once in the permutation, so
    // j === filtered_indices.length. If `nobs` is stale (smaller than a
    // survivor index) some survivors are missed; trim so the tail isn't
    // left as zeros (which would all alias original row 0).
    return j === out.length ? out : out.subarray(0, j);
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
