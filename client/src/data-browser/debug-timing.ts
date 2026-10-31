/**
 * Data-browser timing marks, recorded when `sight.dataBrowser.debugTiming`
 * is on.
 *
 * The host records when a panel opened and when it posted metadata and
 * the first rows; the webview reports when it received them and when the
 * first rows were painted. Marks are wall-clock milliseconds (Date.now)
 * on both sides, so they compare across the process boundary. Each
 * completed open is written to the extension log and kept (bounded) for
 * the `sight.dataBrowser.debugTimingSnapshot` command, which the
 * VS Code-hosted benchmark suite reads. The panel reads the setting;
 * this module has no `vscode` dependency so it tests headless.
 *
 * See specs/2026-10-30-data-browser-redesign.md, Phase 0.
 */

import type { TimingMark } from './types.js';

/** Most recent opens kept for the snapshot command. */
const MAX_RECORDS = 50;

export interface DebugTimingRecord {
    name: string;
    opened_epoch_ms: number;
    metadata_posted_epoch_ms?: number;
    first_rows_posted_epoch_ms?: number;
    metadata_received_epoch_ms?: number;
    first_rows_received_epoch_ms?: number;
    first_rows_painted_epoch_ms?: number;
}

const the_records: DebugTimingRecord[] = [];
let log_sink: ((msg: string) => void) | null = null;

export function set_debug_timing_log(log: (msg: string) => void): void {
    log_sink = log;
}

/** Start (and keep) a record for a panel open. */
export function begin_debug_timing(name: string): DebugTimingRecord {
    const my_record: DebugTimingRecord = {
        name,
        opened_epoch_ms: Date.now(),
    };
    the_records.push(my_record);
    if (the_records.length > MAX_RECORDS) the_records.shift();
    return my_record;
}

/** Record a mark the webview reported; logs the open once it is painted. */
export function record_webview_mark(
    record: DebugTimingRecord,
    mark: TimingMark,
    epoch_ms: number
): void {
    switch (mark) {
        case 'metadata_received':
            record.metadata_received_epoch_ms = epoch_ms;
            break;
        case 'first_rows_received':
            record.first_rows_received_epoch_ms = epoch_ms;
            break;
        case 'first_rows_painted':
            record.first_rows_painted_epoch_ms = epoch_ms;
            log_sink?.(describe_debug_timing(record));
            break;
    }
}

/** One log line: each mark as milliseconds since the panel opened. */
export function describe_debug_timing(record: DebugTimingRecord): string {
    const since = (epoch_ms: number | undefined) =>
        epoch_ms === undefined ? '?' : `${epoch_ms - record.opened_epoch_ms}`;
    return `Data browser timing (${record.name}): `
        + `metadata posted ${since(record.metadata_posted_epoch_ms)} ms, `
        + `received ${since(record.metadata_received_epoch_ms)} ms; `
        + `first rows posted ${since(record.first_rows_posted_epoch_ms)} ms, `
        + `received ${since(record.first_rows_received_epoch_ms)} ms, `
        + `painted ${since(record.first_rows_painted_epoch_ms)} ms`;
}

/** Copies of the recorded opens, oldest first. */
export function debug_timing_snapshot(): DebugTimingRecord[] {
    return the_records.map(my_record => ({ ...my_record }));
}
