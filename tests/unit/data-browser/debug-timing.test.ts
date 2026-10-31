import { describe, expect, it } from 'bun:test';
import type { TimingMessage } from '../../../client/src/data-browser/types';
import { WebviewTiming } from '../../../client/src/data-browser/webview/debug-timing';

describe('WebviewTiming', () => {
    function make() {
        const posted: TimingMessage[] = [];
        const frames: (() => void)[] = [];
        const timing = new WebviewTiming(
            my_msg => posted.push(my_msg),
            my_cb => { frames.push(my_cb); }
        );
        const run_frames = () => {
            while (frames.length > 0) frames.shift()!();
        };
        return { posted, timing, run_frames };
    }

    it('posts nothing when timing is off', () => {
        const { posted, timing, run_frames } = make();
        timing.on_metadata(false);
        timing.on_rows();
        run_frames();
        expect(posted).toEqual([]);
    });

    it('marks metadata, first rows, then paint two frames later', () => {
        const { posted, timing, run_frames } = make();
        timing.on_metadata(true);
        timing.on_rows();
        expect(posted.map(my_m => my_m.mark)).toEqual([
            'metadata_received',
            'first_rows_received',
        ]);
        run_frames();
        expect(posted.map(my_m => my_m.mark)).toEqual([
            'metadata_received',
            'first_rows_received',
            'first_rows_painted',
        ]);
    });

    it('counts only the first rows after each metadata', () => {
        const { posted, timing, run_frames } = make();
        timing.on_metadata(true);
        timing.on_rows();
        timing.on_rows();
        run_frames();
        expect(posted).toHaveLength(3);
        // A reload re-sends metadata and re-arms.
        timing.on_metadata(true);
        timing.on_rows();
        run_frames();
        expect(posted).toHaveLength(6);
    });
});

describe('host debug timing', () => {
    it('records webview marks and logs the open once painted', async () => {
        const {
            begin_debug_timing,
            debug_timing_snapshot,
            record_webview_mark,
            set_debug_timing_log,
        } = await import('../../../client/src/data-browser/debug-timing');
        const the_lines: string[] = [];
        set_debug_timing_log(my_line => the_lines.push(my_line));

        const my_record = begin_debug_timing('auto.dta');
        const my_t0 = my_record.opened_epoch_ms;
        my_record.metadata_posted_epoch_ms = my_t0 + 2;
        my_record.first_rows_posted_epoch_ms = my_t0 + 5;
        record_webview_mark(my_record, 'metadata_received', my_t0 + 30);
        record_webview_mark(my_record, 'first_rows_received', my_t0 + 40);
        expect(the_lines).toEqual([]);
        record_webview_mark(my_record, 'first_rows_painted', my_t0 + 70);

        expect(the_lines).toEqual([
            'Data browser timing (auto.dta): metadata posted 2 ms, '
                + 'received 30 ms; first rows posted 5 ms, received 40 ms, '
                + 'painted 70 ms',
        ]);
        const my_snapshot = debug_timing_snapshot();
        expect(my_snapshot.at(-1)?.first_rows_painted_epoch_ms)
            .toBe(my_t0 + 70);
    });
});
