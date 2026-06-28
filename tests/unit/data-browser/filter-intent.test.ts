import { describe, expect, it } from 'bun:test';
import {
    build_pending_filter,
    filter_applied_outcome,
    filter_work_pending,
    pending_filter_after_applied,
    visible_filter_state,
} from '../../../client/src/data-browser/webview/filter-intent';
import type {
    FilterEntry,
    FilterState,
} from '../../../client/src/data-browser/types';

const entry = (
    id: string,
    col_index: number
): FilterEntry => ({
    id,
    col_index,
    predicate: { kind: 'isNotEmpty' },
    enabled: true,
    include_missing: false,
});

const filter_state = (
    entries: FilterEntry[],
    labels_on_when_filtered = true
): FilterState => ({
    entries,
    labels_on_when_filtered,
});

describe('data-browser filter intent', () => {
    it('shows the pending requested filter while the host computes it', () => {
        const applied = filter_state([]);
        const pending = filter_state([entry('f1', 0)]);

        expect(visible_filter_state(applied, pending)).toBe(pending);
    });

    it('falls back to the applied filter when no request is pending', () => {
        const applied = filter_state([entry('f2', 1)]);

        expect(visible_filter_state(applied, null)).toBe(applied);
    });

    it('builds a pending filter from requested entries and label mode', () => {
        const my_entry: FilterEntry = {
            id: 'f3',
            col_index: 2,
            predicate: { kind: 'setIn', values: [1, 3] },
            enabled: true,
            include_missing: true,
        };

        const my_pending = build_pending_filter([my_entry], false);

        expect(my_pending).toEqual({
            entries: [my_entry],
            labels_on_when_filtered: false,
        });
        expect(my_pending.entries[0]).not.toBe(my_entry);
        expect(my_pending.entries[0].predicate).not.toBe(
            my_entry.predicate
        );

        my_entry.predicate.values.push(5);
        expect(
            (my_pending.entries[0].predicate as { values: number[] })
            .values
        ).toEqual([1, 3]);
    });

    it('keeps a newer pending filter when an older filter applies', () => {
        const pending = filter_state([
            entry('f1', 0),
            entry('f2', 1),
        ]);

        expect(
            pending_filter_after_applied(
                filter_state([entry('f1', 0)]),
                pending
            )
        ).toBe(pending);
    });

    it('clears pending filter once that exact filter applies', () => {
        const pending = filter_state([
            entry('f1', 0),
            entry('f2', 1),
        ]);

        expect(
            pending_filter_after_applied(
                filter_state([entry('f1', 0), entry('f2', 1)]),
                pending
            )
        ).toBeNull();
    });

    it('treats a locally queued filter intent as pending work', () => {
        expect(filter_work_pending(false, filter_state([
            entry('f1', 0),
        ]))).toBe(true);
        expect(filter_work_pending(true, null)).toBe(true);
        expect(filter_work_pending(false, null)).toBe(false);
    });

    it('does not refetch rows when an older filter applies under a newer pending filter', () => {
        const pending = filter_state([entry('f2', 1)]);

        expect(
            filter_applied_outcome(
                filter_state([entry('f1', 0)]),
                pending
            )
        ).toEqual({
            pending_filter: pending,
            refetch_rows: false,
        });
    });

    it('refetches rows once the pending filter applies', () => {
        expect(
            filter_applied_outcome(
                filter_state([entry('f2', 1)]),
                filter_state([entry('f2', 1)])
            )
        ).toEqual({
            pending_filter: null,
            refetch_rows: true,
        });
    });
});
