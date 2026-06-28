import { describe, expect, it } from 'bun:test';
import {
    build_pending_sort,
    pending_sort_after_applied,
    sort_applied_outcome,
    sort_work_pending,
    visible_sort_state,
} from '../../../client/src/data-browser/webview/sort-intent';
import type { SortState } from '../../../client/src/data-browser/types';

const sort_state = (
    cols: number[],
    labels_on_when_sorted = true
): SortState => ({
    keys: cols.map(col_index => ({
        col_index,
        direction: 'asc' as const,
    })),
    labels_on_when_sorted,
});

describe('data-browser sort intent', () => {
    it('shows the pending requested sort while the host computes it', () => {
        const applied = sort_state([]);
        const pending = sort_state([0]);

        expect(visible_sort_state(applied, pending)).toBe(pending);
    });

    it('falls back to the applied sort when no request is pending', () => {
        const applied = sort_state([1]);

        expect(visible_sort_state(applied, null)).toBe(applied);
    });

    it('builds a pending sort from requested keys and label mode', () => {
        expect(build_pending_sort([{
            col_index: 2,
            direction: 'desc',
        }], false)).toEqual({
            keys: [{ col_index: 2, direction: 'desc' }],
            labels_on_when_sorted: false,
        });
    });

    it('keeps a newer pending sort when an older sort applies', () => {
        const pending = sort_state([0, 1]);

        expect(
            pending_sort_after_applied(sort_state([0]), pending)
        ).toBe(pending);
    });

    it('clears pending sort once that exact sort applies', () => {
        const pending = sort_state([0, 1]);

        expect(
            pending_sort_after_applied(sort_state([0, 1]), pending)
        ).toBeNull();
    });

    it('treats a locally queued sort intent as pending work', () => {
        expect(sort_work_pending(false, sort_state([0]))).toBe(true);
        expect(sort_work_pending(true, null)).toBe(true);
        expect(sort_work_pending(false, null)).toBe(false);
    });

    it('does not refetch rows when an older sort applies under a newer pending sort', () => {
        const pending = sort_state([1]);

        expect(sort_applied_outcome(sort_state([0]), pending))
            .toEqual({
                pending_sort: pending,
                refetch_rows: false,
            });
    });

    it('refetches rows once the pending sort applies', () => {
        expect(sort_applied_outcome(sort_state([1]), sort_state([1])))
            .toEqual({
                pending_sort: null,
                refetch_rows: true,
            });
    });
});
