/**
 * Pure numeric histogram for the filter popover brush.
 *
 * One uniform-width 50-bin histogram over the finite values of a column.
 * NaN/±Inf and missing values must be excluded by the caller or are
 * dropped here (missing rows filter via `include_missing`, not the
 * brush). Columns with no finite values yield `[]`; a single distinct
 * value collapses to one zero-width bin.
 *
 * Computed lazily on the host (per column, cached) when a numeric filter
 * popover opens — see `requestHistogram` handling in browser-panel.
 */

import type { HistogramBin } from './types';

const BIN_COUNT = 50;

export function compute_histogram(
    values: readonly number[]
): HistogramBin[] {
    let my_min = Number.POSITIVE_INFINITY;
    let my_max = Number.NEGATIVE_INFINITY;
    let my_count = 0;
    for (const my_value of values) {
        if (!Number.isFinite(my_value)) continue;
        if (my_value < my_min) my_min = my_value;
        if (my_value > my_max) my_max = my_value;
        my_count++;
    }

    if (my_count === 0) return [];
    if (my_min === my_max) {
        return [{ lo: my_min, hi: my_max, count: my_count }];
    }

    const my_width = (my_max - my_min) / BIN_COUNT;
    const the_bins: HistogramBin[] = new Array(BIN_COUNT);
    for (let i = 0; i < BIN_COUNT; i++) {
        the_bins[i] = {
            lo: my_min + i * my_width,
            hi: my_min + (i + 1) * my_width,
            count: 0,
        };
    }
    // Guard against float drift so the exact max lands in the last bin.
    the_bins[BIN_COUNT - 1].hi = my_max;

    for (const my_value of values) {
        if (!Number.isFinite(my_value)) continue;
        let my_idx = Math.floor((my_value - my_min) / my_width);
        if (my_idx >= BIN_COUNT) my_idx = BIN_COUNT - 1;
        if (my_idx < 0) my_idx = 0;
        the_bins[my_idx].count++;
    }
    return the_bins;
}
