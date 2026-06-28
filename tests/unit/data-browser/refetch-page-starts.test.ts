import { describe, expect, it } from 'bun:test';
import { page_starts_to_refetch } from '../../../client/src/data-browser/webview/refetch-page-starts';

describe('data-browser page_starts_to_refetch', () => {
    it('uses viewport page starts when the visible region is known', () => {
        expect(page_starts_to_refetch({
            viewport_start: 50,
            viewport_end: 260,
            page_size: 200,
            loaded_page_starts: [0, 400],
        })).toEqual([0, 200]);
    });

    it('falls back to loaded pages when the viewport is empty', () => {
        expect(page_starts_to_refetch({
            viewport_start: 0,
            viewport_end: 0,
            page_size: 200,
            loaded_page_starts: [400, 0],
        })).toEqual([0, 400]);
    });
});
