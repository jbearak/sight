import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    CellValue,
    FilterAppliedMessage,
    FilterEntry,
    FilterState,
    FilterStatusMessage,
    HistogramBin,
    HistogramDataMessage,
    MetadataMessage,
    RestorePendingMessage,
    RowResponse,
    SortAppliedMessage,
    SortKey,
    SortState,
    SortStatusMessage,
    WebviewMessage,
} from '../types.js';
import { EMPTY_FILTER, EMPTY_SORT } from '../types.js';
import {
    get_needed_page_starts,
    PAGE_SIZE,
} from './grid-model.js';

/**
 * Delay before the "applying saved sort/filter" UI appears. A restore
 * that finishes faster than this (small/fast files) never flashes the
 * message; only a genuinely slow restore reveals it (and its Cancel).
 */
export const RESTORE_DEBOUNCE_MS = 200;

/** Which saved preferences a restore is reapplying. */
export interface RestorePendingState {
    restore_id: number;
    sort: boolean;
    filter: boolean;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface VsCodeApi {
    postMessage(message: WebviewMessage): void;
}

export interface UseRowLoaderResult {
    metadata: MetadataMessage | null;
    ensure_rows: (start_row: number, end_row: number) => void;
    get_row: (row_index: number) => CellValue[] | undefined;
    pages: Map<number, CellValue[][]>;
    vscode_api: VsCodeApi;
    sort: SortState;
    sort_pending: boolean;
    filter: FilterState;
    filter_pending: boolean;
    nobs_effective: number | undefined;
    apply_sort: (keys: SortKey[], labels_on: boolean) => void;
    apply_filter: (entries: FilterEntry[], labels_on: boolean) => void;
    histograms: Map<number, HistogramBin[]>;
    request_histogram: (col_index: number) => void;
    update_viewport: (start_row: number, end_row: number) => void;
    // Non-null (after the debounce) while a saved sort/filter is being
    // reapplied on open and the grid is not yet showing.
    restore_pending: RestorePendingState | null;
    restore_cancelling: boolean;
    cancel_restore: () => void;
}

type IncomingMessage =
    | MetadataMessage
    | RowResponse
    | SortAppliedMessage
    | SortStatusMessage
    | FilterAppliedMessage
    | FilterStatusMessage
    | HistogramDataMessage
    | RestorePendingMessage;

export function use_row_loader(): UseRowLoaderResult {
    const vscode_api = useMemo(() => acquireVsCodeApi(), []);
    const [metadata, set_metadata] = useState<MetadataMessage | null>(
        null
    );
    const [pages, set_pages] = useState<Map<number, CellValue[][]>>(
        () => new Map()
    );
    const [sort, set_sort] = useState<SortState>(EMPTY_SORT);
    const [sort_pending, set_sort_pending] = useState(false);
    const [filter, set_filter] = useState<FilterState>(EMPTY_FILTER);
    const [filter_pending, set_filter_pending] = useState(false);
    // The visible row count after sort+filter. Both sortApplied and
    // filterApplied carry the host's effective count, so a single state
    // tracks it regardless of which arrives last.
    const [nobs_effective, set_nobs_effective] =
        useState<number | undefined>(undefined);
    const [histograms, set_histograms] =
        useState<Map<number, HistogramBin[]>>(() => new Map());
    // Saved-preference restore UI: `restore_pending` is set only after
    // the debounce timer fires, so a fast restore never flashes it.
    const [restore_pending, set_restore_pending] =
        useState<RestorePendingState | null>(null);
    const [restore_cancelling, set_restore_cancelling] = useState(false);
    const restore_timer = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const restore_id_ref = useRef<number | null>(null);
    // Columns whose histogram has been requested (pending or arrived), so
    // opening a numeric filter popover repeatedly doesn't re-request.
    const requested_histograms = useRef<Set<number>>(new Set());
    const pending_pages = useRef<Set<number>>(new Set());
    const request_counter = useRef(0);
    // Last visible window [start, end), kept in a ref so the message
    // handler (registered once) can re-request it after a sort lands.
    const viewport_ref = useRef<{ start: number; end: number }>({
        start: 0,
        end: 0,
    });

    const request_page = useCallback(
        (page_start: number) => {
            pending_pages.current.add(page_start);
            request_counter.current += 1;
            vscode_api.postMessage({
                type: 'requestRows',
                start: page_start,
                count: PAGE_SIZE,
                request_id:
                    'req_' + String(request_counter.current),
            });
        },
        [vscode_api]
    );

    useEffect(() => {
        function on_message(event: MessageEvent) {
            const my_msg = event.data as IncomingMessage;

            if (my_msg.type === 'restorePending') {
                // Defer showing the UI until the debounce elapses; a
                // restore that completes sooner clears the timer on
                // 'metadata' below and never flashes the message.
                restore_id_ref.current = my_msg.restore_id;
                set_restore_cancelling(false);
                if (restore_timer.current !== null) {
                    clearTimeout(restore_timer.current);
                }
                const my_info: RestorePendingState = {
                    restore_id: my_msg.restore_id,
                    sort: my_msg.sort,
                    filter: my_msg.filter,
                };
                // If a banner is already visible (a prior restore whose
                // debounce elapsed), swap its wording to this restore at
                // once rather than showing stale text until the timer.
                set_restore_pending(my_prev =>
                    my_prev ? my_info : my_prev
                );
                restore_timer.current = setTimeout(() => {
                    set_restore_pending(my_info);
                    restore_timer.current = null;
                }, RESTORE_DEBOUNCE_MS);
                return;
            }

            if (my_msg.type === 'metadata') {
                // Both the normal and cancelled restore paths end by
                // posting metadata, so clear the restore UI here.
                if (restore_timer.current !== null) {
                    clearTimeout(restore_timer.current);
                    restore_timer.current = null;
                }
                set_restore_pending(null);
                set_restore_cancelling(false);
                restore_id_ref.current = null;

                set_metadata(my_msg);
                set_pages(new Map());
                pending_pages.current.clear();
                set_sort(my_msg.stored_sort ?? EMPTY_SORT);
                set_sort_pending(false);
                set_filter(my_msg.stored_filter ?? EMPTY_FILTER);
                set_filter_pending(false);
                set_nobs_effective(undefined);
                set_histograms(new Map());
                requested_histograms.current.clear();
                return;
            }

            if (my_msg.type === 'rowData') {
                pending_pages.current.delete(my_msg.start);
                set_pages(my_previous => {
                    const my_next = new Map(my_previous);
                    my_next.set(my_msg.start, my_msg.rows);
                    return my_next;
                });
                return;
            }

            if (my_msg.type === 'sortApplied') {
                set_sort(my_msg.sort);
                set_nobs_effective(my_msg.nobs_effective);
                set_pages(new Map());
                pending_pages.current.clear();
                set_sort_pending(false);
                // Re-request the current viewport in the new order;
                // the host has cleared its cache for this permutation.
                const my_viewport = viewport_ref.current;
                for (const my_start of get_needed_page_starts(
                    my_viewport.start,
                    my_viewport.end,
                    PAGE_SIZE
                )) {
                    request_page(my_start);
                }
                return;
            }

            if (my_msg.type === 'sortStatus') {
                set_sort_pending(my_msg.state === 'pending');
                return;
            }

            if (my_msg.type === 'filterApplied') {
                set_filter(my_msg.filter);
                set_nobs_effective(my_msg.nobs_filtered);
                set_pages(new Map());
                pending_pages.current.clear();
                set_filter_pending(false);
                // Re-request the current viewport in the new (filtered)
                // order; the host cleared its cache for this permutation.
                const my_viewport = viewport_ref.current;
                for (const my_start of get_needed_page_starts(
                    my_viewport.start,
                    my_viewport.end,
                    PAGE_SIZE
                )) {
                    request_page(my_start);
                }
                return;
            }

            if (my_msg.type === 'filterStatus') {
                set_filter_pending(my_msg.state === 'pending');
                return;
            }

            if (my_msg.type === 'histogramData') {
                set_histograms(my_previous => {
                    const my_next = new Map(my_previous);
                    my_next.set(my_msg.col_index, my_msg.bins);
                    return my_next;
                });
                return;
            }
        }

        window.addEventListener('message', on_message);
        vscode_api.postMessage({ type: 'ready' });
        return () => {
            window.removeEventListener('message', on_message);
            if (restore_timer.current !== null) {
                clearTimeout(restore_timer.current);
                restore_timer.current = null;
            }
        };
    }, [vscode_api, request_page]);

    const cancel_restore = useCallback(() => {
        const my_id = restore_id_ref.current;
        if (my_id === null) return;
        set_restore_cancelling(true);
        vscode_api.postMessage({
            type: 'cancelRestore',
            restore_id: my_id,
        });
    }, [vscode_api]);

    function ensure_rows(start_row: number, end_row: number) {
        const the_page_starts = get_needed_page_starts(
            start_row,
            end_row,
            PAGE_SIZE
        );

        for (const my_page_start of the_page_starts) {
            if (
                pages.has(my_page_start)
                || pending_pages.current.has(my_page_start)
            ) {
                continue;
            }
            request_page(my_page_start);
        }
    }

    const update_viewport = useCallback(
        (start_row: number, end_row: number) => {
            viewport_ref.current = {
                start: start_row,
                end: end_row,
            };
        },
        []
    );

    function get_row(row_index: number): CellValue[] | undefined {
        const my_page_start = Math.floor(row_index / PAGE_SIZE)
            * PAGE_SIZE;
        const my_page = pages.get(my_page_start);
        if (!my_page) {
            return undefined;
        }
        return my_page[row_index - my_page_start];
    }

    const apply_sort = useCallback(
        (keys: SortKey[], labels_on: boolean) => {
            vscode_api.postMessage({
                type: 'setSort',
                keys,
                labels_on,
            });
        },
        [vscode_api]
    );

    const apply_filter = useCallback(
        (entries: FilterEntry[], labels_on: boolean) => {
            vscode_api.postMessage({
                type: 'setFilters',
                entries,
                labels_on,
            });
        },
        [vscode_api]
    );

    const request_histogram = useCallback(
        (col_index: number) => {
            if (requested_histograms.current.has(col_index)) return;
            requested_histograms.current.add(col_index);
            vscode_api.postMessage({
                type: 'requestHistogram',
                col_index,
            });
        },
        [vscode_api]
    );

    return {
        metadata,
        ensure_rows,
        get_row,
        pages,
        vscode_api,
        sort,
        sort_pending,
        filter,
        filter_pending,
        nobs_effective,
        apply_sort,
        apply_filter,
        histograms,
        request_histogram,
        update_viewport,
        restore_pending,
        restore_cancelling,
        cancel_restore,
    };
}
