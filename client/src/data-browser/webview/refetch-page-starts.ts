import { get_needed_page_starts } from './grid-model.js';

interface PageStartsToRefetchArgs {
    viewport_start: number;
    viewport_end: number;
    page_size: number;
    loaded_page_starts: Iterable<number>;
}

export function page_starts_to_refetch({
    viewport_start,
    viewport_end,
    page_size,
    loaded_page_starts,
}: PageStartsToRefetchArgs): number[] {
    if (viewport_end > viewport_start) {
        return get_needed_page_starts(
            viewport_start,
            viewport_end,
            page_size
        );
    }

    return [...new Set(loaded_page_starts)].sort((a, b) => a - b);
}
