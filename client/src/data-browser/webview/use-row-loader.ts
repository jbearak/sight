import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    CellValue,
    CopyColumnResponse,
    MetadataMessage,
    RowResponse,
    WebviewMessage,
} from '../types';
import {
    get_needed_page_starts,
    PAGE_SIZE,
} from './grid-model';

declare function acquireVsCodeApi(): {
    postMessage(message: WebviewMessage): void;
};

export function use_row_loader() {
    const vscode_api = useMemo(() => acquireVsCodeApi(), []);
    const [metadata, set_metadata] = useState<MetadataMessage | null>(
        null
    );
    const [pages, set_pages] = useState<Map<number, CellValue[][]>>(
        () => new Map()
    );
    const pending_pages = useRef<Set<number>>(new Set());
    const request_counter = useRef(0);

    useEffect(() => {
        function on_message(event: MessageEvent) {
            const my_msg = event.data as
                | MetadataMessage
                | RowResponse
                | CopyColumnResponse;

            if (my_msg.type === 'metadata') {
                set_metadata(my_msg);
                set_pages(new Map());
                pending_pages.current.clear();
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

            if (my_msg.type === 'columnData') {
                navigator.clipboard.writeText(
                    my_msg.values.join('\n')
                );
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

    return {
        metadata,
        ensure_rows,
        get_row,
        pages,
        vscode_api,
    };
}
