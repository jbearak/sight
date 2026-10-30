/**
 * Webview half of the data-browser timing marks (see the host's
 * `debug-timing.ts`). When metadata says `debug_timing`, report when the
 * metadata and the first rows arrived, and when those rows were painted:
 * two animation frames after the rows were stored, since Glide draws its
 * canvas on the next frame.
 */

import type { TimingMark, TimingMessage } from '../types.js';

type FrameScheduler = (callback: () => void) => void;

export class WebviewTiming {
    private enabled = false;
    private awaiting_rows = false;

    constructor(
        private readonly post: (msg: TimingMessage) => void,
        private readonly next_frame: FrameScheduler =
            callback => { requestAnimationFrame(() => callback()); }
    ) {}

    /** Metadata arrived: (re)arm for this open if timing is on. */
    on_metadata(enabled: boolean): void {
        this.enabled = enabled;
        this.awaiting_rows = enabled;
        if (enabled) this.mark('metadata_received');
    }

    /** Rows were accepted; only the first rows after metadata count. */
    on_rows(): void {
        if (!this.enabled || !this.awaiting_rows) return;
        this.awaiting_rows = false;
        this.mark('first_rows_received');
        this.next_frame(() => {
            this.next_frame(() => this.mark('first_rows_painted'));
        });
    }

    private mark(mark: TimingMark): void {
        this.post({ type: 'timing', mark, epoch_ms: Date.now() });
    }
}
