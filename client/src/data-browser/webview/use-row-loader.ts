import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    CellValue,
    MetadataMessage,
    RowResponse,
    SortAppliedMessage,
    SortKey,
    SortState,
    SortStatusMessage,
    WebviewMessage,
} from '../types';
import { EMPTY_SORT } from '../types';
import {
    get_needed_page_starts,
    PAGE_SIZE,
} from './grid-model';

declare function acquireVsCodeApi(): {
    postMessage(message: WebviewMessage): void;
};

type IncomingMessage =
    | MetadataMessage
    | RowResponse
    | SortAppliedMessage
    | SortStatusMessage;

export function use_row_loader() {
    const vscode_api = useMemo(() => acquireVsCodeApi(), []);
    const [metadata, set_metadata] = useState<MetadataMessage | null>(
        null
    );
    const [pages, set_pages] = useState<Map<number, CellValue[][]>>(
        () => new Map()
    );
    const [sort, set_sort] = useState<SortState>(EMPTY_SORT);
    const [sort_pending, set_sort_pending] = useState(false);
    const [nobs_effective, set_nobs_effective] =
        useState<number | undefined>(undefined);
    const [reload_token, set_reload_token] = useState(0);
    const pending_pages = useRef<Set<number>>(new Set());
    const request_counter = useRef(0);

    useEffect(() => {
        function on_message(event: MessageEvent) {
            const my_msg = event.data as IncomingMessage;

            if (my_msg.type === 'metadata') {
                set_metadata(my_msg);
                set_pages(new Map());
                pending_pages.current.clear();
                set_sort(my_msg.stored_sort ?? EMPTY_SORT);
                set_sort_pending(false);
                set_nobs_effective(undefined);
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
                // Force the visible window to be re-requested.
                set_reload_token(my_token => my_token + 1);
                return;
            }

            if (my_msg.type === 'sortStatus') {
                set_sort_pending(my_msg.state === 'pending');
                return;
            }
        }

        window.addEventListener('message', on_message);
        vscode_api.postMessage({ type: 'ready' });
        return () => {
            window.removeEventListener('message', on_message);
        };
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

            pending_pages.current.add(my_page_start);
            request_counter.current += 1;
            vscode_api.postMessage({
                type: 'requestRows',
                start: my_page_start,
                count: PAGE_SIZE,
                request_id:
                    'req_' + String(request_counter.current),
            });
        }
    }

    function get_row(row_index: number): CellValue[] | undefined {
        const my_page_start = Math.floor(row_index / PAGE_SIZE)
            * PAGE_SIZE;
        const my_page = pages.get(my_page_start);
        if (!my_page) {
            return undefined;
        }
        return my_page[row_index - my_page_start];
    }

    function apply_sort(keys: SortKey[], labels_on: boolean) {
        vscode_api.postMessage({
            type: 'setSort',
            keys,
            labels_on,
        });
    }

    return {
        metadata,
        ensure_rows,
        get_row,
        pages,
        vscode_api,
        sort,
        sort_pending,
        nobs_effective,
        reload_token,
        apply_sort,
    };
}
