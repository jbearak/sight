/**
 * Lease file for an open data browser panel's vview temp file.
 *
 * dta-parser 0.6 opens files by path only, so the panel's step workers
 * reopen the temp file for every sort, filter or copy, and the file must
 * stay on disk until the panel closes. Another VS Code window's startup
 * sweep (`prune_stale_browse_files`) deletes temp files older than 24
 * hours; a `<uuid>.lease` beside the file, refreshed while the panel is
 * open, tells it the file is still in use. The data file's own mtime is
 * never touched.
 *
 * Refreshes happen once an hour and before each step-worker spawn
 * (extensions cannot observe system resume, so the spawn is the reliable
 * trigger), throttled to once a minute and asynchronous. A refresh
 * recreates a lease the sweep deleted.
 */

import * as fs from 'fs';
import { lease_path_for } from './signal-watcher.js';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 60 * 1000;

export class BrowseLease {
    private readonly lease_path: string;
    private timer: ReturnType<typeof setInterval> | null = null;
    private last_refresh_ms = -Infinity;
    private stopped = false;

    constructor(
        dta_path: string,
        private readonly log: (message: string) => void = () => {}
    ) {
        this.lease_path = lease_path_for(dta_path);
    }

    /** Write the lease now and refresh it hourly until {@link stop}. */
    start(): void {
        this.write_sync();
        this.timer = setInterval(
            () => this.refresh(),
            REFRESH_INTERVAL_MS
        );
        // An hourly timer must not keep the extension host alive.
        this.timer.unref?.();
    }

    /** Refresh the lease unless one was written in the last minute. */
    refresh(): void {
        if (this.stopped) return;
        const my_now_ms = Date.now();
        if (my_now_ms - this.last_refresh_ms < MIN_REFRESH_GAP_MS) return;
        this.last_refresh_ms = my_now_ms;
        const my_time = new Date(my_now_ms);
        fs.promises.utimes(this.lease_path, my_time, my_time).catch(
            (my_err: NodeJS.ErrnoException) => {
                if (this.stopped) return;
                if (my_err.code === 'ENOENT') {
                    // The sweep deleted it; write a fresh one.
                    fs.promises.writeFile(this.lease_path, '').catch(
                        (my_write_err: unknown) => this.log(
                            `Could not recreate ${this.lease_path}: `
                            + String(my_write_err)
                        )
                    );
                    return;
                }
                // Retried at the next refresh.
                this.last_refresh_ms = -Infinity;
                this.log(
                    `Could not refresh ${this.lease_path}: ${my_err}`
                );
            }
        );
    }

    /** Stop refreshing and delete the lease. */
    stop(): void {
        this.stopped = true;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        try {
            fs.unlinkSync(this.lease_path);
        } catch {
            /* already gone */
        }
    }

    private write_sync(): void {
        this.last_refresh_ms = Date.now();
        try {
            fs.writeFileSync(this.lease_path, '');
        } catch (my_err) {
            this.log(`Could not write ${this.lease_path}: ${my_err}`);
        }
    }
}
