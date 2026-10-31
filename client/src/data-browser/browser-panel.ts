/**
 * Data Browser Panel
 *
 * Manages a single webview panel for browsing a Stata .dta
 * dataset. Opens the file once, on a descriptor every worker thread
 * reads; reads metadata on the host and nothing else: pages come from
 * the row reader thread (row-reader.ts) and full-column work from step
 * workers (compute-runner.ts). Owns sort/filter state, the order shown
 * and temp file cleanup.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DtaSource, type BrowserVariable, type PageRows } from './dta-source.js';
import { classify_sort_kind } from './sort.js';
import { labels_shipped } from './label-keys.js';
import { compose_effective } from './permuted-rows.js';
import {
    can_compute_histogram,
    type ComputeJob,
    type ComputeResult,
    type OrderResult,
} from './compute-jobs.js';
import {
    ComputeDeadlineError,
    FileChangedError,
    InProcessComputeRunner,
    WorkerComputeRunner,
    type ComputePool,
    type ComputeRunner,
} from './compute-runner.js';
import { file_identity, type FileIdentity } from './compute-protocol.js';
import {
    InProcessPageReader,
    WorkerPageReader,
    type CellPatch,
    type PageRead,
    type PageReader,
} from './row-reader.js';
import {
    build_dataset_key,
    build_dataset_key_aliases,
    type DataBrowserColumnWidthStore,
} from './column-width-state.js';
import type {
    DataBrowserColumnVisibilityStore,
} from './column-visibility-state.js';
import type { DataBrowserSortStateStore } from './sort-state.js';
import type { DataBrowserFilterStateStore } from './filter-state.js';
import { should_unlink_data_browser_path } from './opening.js';
import { page_size_for_column_count } from './page-size.js';
import { schema_hash } from './schema-hash.js';
import {
    begin_debug_timing,
    record_webview_mark,
    type DebugTimingRecord,
} from './debug-timing.js';
import type {
    WebviewMessage,
    RowResponse,
    MetadataMessage,
    VviewSidecar,
    MissingValueStyle,
    SetSortMessage,
    SortState,
    SortAppliedMessage,
    SortStatusMessage,
    SetFiltersMessage,
    FilterState,
    FilterPredicate,
    FilterAppliedMessage,
    FilterStatusMessage,
    RequestHistogramMessage,
    HistogramDataMessage,
    HistogramBin,
    RestorePendingMessage,
    RestoreSettledMessage,
    CancelRestoreMessage,
    ComputeCancelledMessage,
    RowsStaleMessage,
    FullTextMessage,
    FileChangedMessage,
    RequestFullTextMessage,
    RowCellsMessage,
} from './types.js';
import { EMPTY_SORT, EMPTY_FILTER } from './types.js';

/**
 * A read aborted via AbortSignal (vs. a genuine read failure). Matches on
 * `name` rather than `instanceof Error` because the abort is thrown as a
 * `DOMException`, which is not an `Error` subclass on every runtime.
 */
function is_abort_error(err: unknown): boolean {
    return typeof err === 'object'
        && err !== null
        && (err as { name?: unknown }).name === 'AbortError';
}

/** Options a host passes when it can run worker threads. */
export interface DataBrowserPanelOptions {
    /**
     * Absolute path of the bundled compute worker
     * (dist/data-browser-worker.js). Without it, sorts, filters,
     * histograms and copies run in-process on the host.
     */
    compute_worker_path?: string;
    /**
     * Absolute path of the bundled row reader
     * (dist/data-browser-reader.js). Without it, pages are read on the
     * host.
     */
    reader_worker_path?: string;
    /** Diagnostic log for worker and descriptor problems. */
    log?: (message: string) => void;
}

/** Bundled worker entry points, beside the extension bundle. */
const COMPUTE_WORKER_BUNDLE = path.join('dist', 'data-browser-worker.js');
const READER_WORKER_BUNDLE = path.join('dist', 'data-browser-reader.js');

/**
 * Panel options for an installed extension: worker threads when their
 * bundles are present (they are in every packaged build; a source
 * checkout that has not run `bundle` falls back to in-process reads).
 */
export function panel_options_for_extension(
    extension_path: string
): DataBrowserPanelOptions {
    const my_options: DataBrowserPanelOptions = {};
    const my_compute = path.join(extension_path, COMPUTE_WORKER_BUNDLE);
    if (fs.existsSync(my_compute)) my_options.compute_worker_path = my_compute;
    const my_reader = path.join(extension_path, READER_WORKER_BUNDLE);
    if (fs.existsSync(my_reader)) my_options.reader_worker_path = my_reader;
    return my_options;
}

export class DataBrowserPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    // Metadata of the open file (data reads go through `reader`).
    private dta_file: DtaSource | null = null;
    // The descriptor every thread reads, and its identity at open; open
    // until every thread reading it has exited.
    private fd: number | null = null;
    private identity: FileIdentity | null = null;
    private reader: PageReader | null = null;
    // Set once a read finds the file rewritten in place: nothing more
    // is served from it.
    private file_changed = false;
    private disposables: vscode.Disposable[] = [];
    private sidecar: VviewSidecar;
    private dta_path: string;
    private dataset_key: string;
    private dataset_key_aliases: string[];
    private readonly column_width_store: DataBrowserColumnWidthStore;
    private readonly column_visibility_store: DataBrowserColumnVisibilityStore;
    private readonly sort_state_store: DataBrowserSortStateStore;
    private readonly filter_state_store: DataBrowserFilterStateStore;
    private disposed = false;
    private generation = 0;
    private sort: SortState = EMPTY_SORT;
    private permutation: Uint32Array | null = null;
    private sort_restored = false;
    private filter: FilterState = EMPTY_FILTER;
    private filtered_indices: Uint32Array | null = null;
    private filter_restored = false;
    // Saved-preference restore on open. Cancellation is carried by the
    // AbortController's signal (captured locally per send_metadata call),
    // not a shared boolean, so a concurrent send_metadata can't erase an
    // in-flight cancel. `restore_id` (the generation at restore start)
    // keys the restorePending/cancelRestore handshake so a stale or late
    // cancel is ignored; `restore_id === -1` means "no cancellable
    // restore". `restoring` gates the in-flight vs. already-completed
    // cancel paths.
    private restore_abort: AbortController | null = null;
    private restoring = false;
    private restore_id = -1;
    // The filter survivor set composed with the sort permutation: the
    // single effective permutation handed to the reader. Recomputed
    // whenever sort or filter changes (null === identity order).
    private effective_perm: Uint32Array | null = null;
    // Per-column histogram cache for the numeric filter brush, computed
    // lazily on `requestHistogram`. Keyed by column index; cleared on
    // refresh (the values change), not on sort/filter (the brush always
    // shows the full column distribution).
    private histogram_cache = new Map<number, HistogramBin[]>();
    // Timing marks for this open when sight.dataBrowser.debugTiming is
    // on (null otherwise); see debug-timing.ts.
    private debug_timing: DebugTimingRecord | null = null;
    // Where full-column jobs run: step workers once the file is open and
    // a worker bundle was given, else in-process (see compute_runner()).
    private compute: ComputeRunner | null = null;
    private readonly options: DataBrowserPanelOptions;
    // The running user sort/filter and how to stop it. A newer request
    // of the same kind supersedes it; Cancel stops it and every queued
    // action (cancel_seq, read by enqueue_user_action).
    private action_abort: AbortController | null = null;
    private running_action: 'sort' | 'filter' | null = null;
    private cancel_seq = 0;

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string,
        column_width_store: DataBrowserColumnWidthStore,
        column_visibility_store: DataBrowserColumnVisibilityStore,
        sort_state_store: DataBrowserSortStateStore,
        filter_state_store: DataBrowserFilterStateStore,
        options: DataBrowserPanelOptions = {}
    ) {
        this.options = options;
        this.panel = panel;
        this.sidecar = sidecar;
        this.dta_path = dta_path;
        this.dataset_key = build_dataset_key(
            dta_path,
            sidecar
        );
        this.dataset_key_aliases =
            build_dataset_key_aliases(
                dta_path,
                sidecar
            );
        this.column_width_store = column_width_store;
        this.column_visibility_store =
            column_visibility_store;
        this.sort_state_store = sort_state_store;
        this.filter_state_store = filter_state_store;
        this.debug_timing = this.begin_debug_timing(sidecar.name);

        panel.webview.html = webview_html;

        this.disposables.push(
            panel.webview.onDidReceiveMessage(
                (msg: WebviewMessage) => this.handle_message(msg)
            )
        );
        this.disposables.push(
            panel.onDidDispose(() => {
                this.dispose_core(false);
            })
        );
    }

    get name(): string {
        return this.sidecar.name;
    }

    on_did_dispose(callback: () => void): void {
        this.disposables.push(
            this.panel.onDidDispose(callback)
        );
    }

    reveal(column: vscode.ViewColumn): void {
        this.panel.reveal(column);
    }

    // Refreshes run one at a time: each releases the file the previous
    // one opened before opening its own.
    private refresh_chain: Promise<void> = Promise.resolve();

    refresh(sidecar: VviewSidecar, dta_path: string): Promise<void> {
        const my_next = this.refresh_chain
            .catch(() => {})
            .then(() => this.refresh_now(sidecar, dta_path));
        this.refresh_chain = my_next;
        return my_next;
    }

    private async refresh_now(
        sidecar: VviewSidecar,
        dta_path: string
    ): Promise<void> {
        this.generation++;
        // Abort any in-flight background restore BEFORE closing the file
        // (the generation bump above also makes the aborted restore
        // discard its result without forgetting prefs).
        this.abort_and_clear_restore();
        this.stop_running_actions();
        const my_old_path = this.dta_path;
        const my_kept = this.temp_file_kept;
        // Stop the old file's threads, then close its descriptor, before
        // deleting it, so none reads a file that is going away.
        this.dta_file?.close();
        this.dta_file = null;
        await this.release_file();
        // The panel may have closed meanwhile; dispose cleaned up the
        // old file, so don't reopen, and delete the incoming vview temp
        // file no panel will now own.
        if (this.disposed) {
            if (dta_path !== my_old_path) {
                this.unlink_kept_temp_file(dta_path);
            }
            return;
        }
        this.sort = EMPTY_SORT;
        this.permutation = null;
        this.sort_restored = false;
        this.filter = EMPTY_FILTER;
        this.filtered_indices = null;
        this.filter_restored = false;
        this.effective_perm = null;
        this.histogram_cache.clear();
        this.file_changed = false;
        this.page_error_reported = false;
        // (The in-flight restore was already aborted above, before the
        // file was closed; a fresh restore begins, if applicable, when
        // initialize() re-sends metadata.)

        // Clean up the old temp file before overwriting the path. It is
        // kept on disk while open only on Windows, which cannot unlink
        // an open file.
        if (my_kept && my_old_path !== dta_path) {
            this.unlink_kept_temp_file(my_old_path);
        }
        this.temp_file_kept = false;

        this.sidecar = sidecar;
        this.dta_path = dta_path;
        this.dataset_key = build_dataset_key(
            dta_path,
            sidecar
        );
        this.dataset_key_aliases =
            build_dataset_key_aliases(
                dta_path,
                sidecar
            );
        this.debug_timing = this.begin_debug_timing(sidecar.name);

        await this.initialize();
    }

    dispose(): void {
        this.dispose_core(true);
    }

    private dispose_core(
        dispose_panel: boolean
    ): void {
        if (this.disposed) return;
        this.disposed = true;

        // Under paint-first a restore can still be running when the
        // panel closes. Bump the generation and abort it, so the awaited
        // restore bails (its `this.disposed` / generation checks) instead
        // of surfacing an error dialog on a dead panel.
        this.generation++;
        this.abort_and_clear_restore();
        this.stop_running_actions();

        this.dta_file?.close();
        this.dta_file = null;

        // Stop the threads and close the descriptor, then delete the
        // temp .dta file if it was kept (Windows).
        const my_path = this.dta_path;
        const my_kept = this.temp_file_kept;
        void this.release_file().then(() => {
            if (my_kept) this.unlink_kept_temp_file(my_path);
        });

        for (const my_d of this.disposables) {
            my_d.dispose();
        }
        if (dispose_panel) {
            this.panel.dispose();
        }
    }

    // -------------------------------------------------------
    // Initialization
    // -------------------------------------------------------

    private async initialize(): Promise<void> {
        let my_fd: number | null = null;
        try {
            // One descriptor for the panel's life: the host reads
            // metadata from it, and every worker thread reads data from
            // it, so all of them read the same file whatever happens to
            // the path.
            my_fd = fs.openSync(this.dta_path, 'r');
            const my_identity = file_identity(fs.fstatSync(my_fd));
            const my_source = DtaSource.open(my_fd);
            if (this.disposed) {
                // Closed while the file was opening: nothing else will
                // close it or delete a vview temp file.
                my_source.close();
                fs.closeSync(my_fd);
                this.unlink_kept_temp_file(this.dta_path);
                return;
            }
            this.dta_file = my_source;
            this.fd = my_fd;
            this.identity = my_identity;
            this.start_threads();

            // A vview temp file is unlinked as soon as it is open: the
            // descriptor keeps it readable until the panel closes it.
            // Windows cannot unlink an open file, so there it stays on
            // disk until close.
            if (should_unlink_data_browser_path(this.dta_path)) {
                if (process.platform === 'win32') {
                    this.temp_file_kept = true;
                } else {
                    try {
                        fs.unlinkSync(this.dta_path);
                    } catch {
                        /* file may already be gone */
                    }
                }
            }
        } catch (my_err: unknown) {
            if (my_fd !== null && this.fd !== my_fd) {
                try {
                    fs.closeSync(my_fd);
                } catch {
                    /* nothing more to release */
                }
            }
            // Browse-dir temp files may be gone if another
            // VS Code window already claimed and deleted
            // the .dta file. Silently close the panel
            // instead of showing an error dialog.
            const my_code = (
                my_err as NodeJS.ErrnoException
            ).code;
            if (
                my_code === 'ENOENT'
                && should_unlink_data_browser_path(
                    this.dta_path
                )
            ) {
                this.dispose();
                return;
            }

            vscode.window.showErrorMessage(
                `Failed to open .dta file: ${my_err}`
            );
            return;
        }

        await this.send_metadata();
    }

    // Whether this panel still owns its vview temp file on disk and must
    // delete it when it closes or moves to another file (Windows only).
    private temp_file_kept = false;

    /** Start the row reader and step workers, where bundles exist. */
    private start_threads(): void {
        if (this.fd === null || this.identity === null) return;
        const my_reader_path = this.options?.reader_worker_path;
        if (my_reader_path) {
            try {
                this.reader = new WorkerPageReader({
                    script_path: my_reader_path,
                    fd: this.fd,
                    identity: this.identity,
                });
            } catch (my_err) {
                this.options?.log?.(
                    `Data browser: reading pages on the host (${my_err})`
                );
            }
        }
        const my_worker_path = this.options?.compute_worker_path;
        if (my_worker_path) {
            this.compute = new WorkerComputeRunner({
                script_path: my_worker_path,
                fd: this.fd,
                identity: this.identity,
            });
        }
    }

    /** Where pages are read: the row reader, or in-process on dta_file. */
    private page_reader(): PageReader | null {
        if (this.reader) return this.reader;
        return this.dta_file
            ? new InProcessPageReader(this.dta_file)
            : null;
    }

    /** Where jobs run: the step workers, or in-process on dta_file. */
    private compute_runner(): ComputeRunner | null {
        if (this.compute) return this.compute;
        return this.dta_file
            ? new InProcessComputeRunner(this.dta_file)
            : null;
    }

    /** Run a job, or reject when no file is open. */
    private run_job(
        job: ComputeJob,
        pool: ComputePool,
        signal?: AbortSignal
    ): Promise<ComputeResult> {
        const my_runner = this.compute_runner();
        if (!my_runner) {
            return Promise.reject(new Error('No dataset is open'));
        }
        const my_file = this.dta_file;
        // A step worker that finds the file rewritten stops the panel
        // reading it, whichever job it was running.
        return my_runner.run(job, pool, signal).catch((my_err: unknown) => {
            if (
                my_err instanceof FileChangedError
                && this.dta_file === my_file
            ) {
                this.mark_file_changed();
            }
            throw my_err;
        });
    }

    /**
     * Stop this file's threads, then close its descriptor. A thread
     * stuck in a read on a slow disk is abandoned after a bounded wait;
     * its descriptor is then left open (and logged) rather than closed
     * under it, and process exit reclaims it.
     */
    private async release_file(): Promise<void> {
        const my_compute = this.compute;
        const my_reader = this.reader;
        const my_fd = this.fd;
        this.compute = null;
        this.reader = null;
        this.fd = null;
        this.identity = null;
        const the_stopped = await Promise.all([
            my_compute?.dispose() ?? true,
            my_reader?.dispose() ?? true,
        ]);
        if (my_fd === null) return;
        if (the_stopped.every(Boolean)) {
            try {
                fs.closeSync(my_fd);
            } catch {
                /* already closed */
            }
        } else {
            this.options?.log?.(
                'Data browser: a worker did not stop; leaving its file '
                + 'descriptor open'
            );
        }
    }

    /** Delete a vview temp file this panel kept on disk. */
    private unlink_kept_temp_file(file_path: string): void {
        if (!should_unlink_data_browser_path(file_path)) return;
        try {
            fs.unlinkSync(file_path);
        } catch {
            /* file may already be gone */
        }
    }

    /**
     * Serialize metadata sends so two restores never overlap. Without
     * this, a webview reload (a second `ready`) during a slow restore
     * would start a concurrent send_metadata that overwrites the shared
     * restore AbortController, so a Cancel could abort the wrong restore
     * while an earlier one keeps reading. Chaining guarantees one restore
     * at a time; a Cancel (handled out of band) still aborts the active
     * one, which then completes and lets the next send proceed.
     */
    private send_metadata_chain: Promise<void> = Promise.resolve();

    private send_metadata(): Promise<void> {
        const my_next = this.send_metadata_chain
            .catch(() => {})
            .then(() => this.send_metadata_impl());
        this.send_metadata_chain = my_next;
        return my_next;
    }

    /**
     * Serialize expensive user actions that mutate the effective row
     * order. Without this, a filter and sort can overlap: the later
     * action bumps `generation`, the earlier action discards its result,
     * and its pending status is never cleared in the webview.
     */
    private action_chain: Promise<void> = Promise.resolve();

    private enqueue_user_action(
        action: () => Promise<void>
    ): Promise<void> {
        const my_dta_file = this.dta_file;
        const my_cancel_seq = this.cancel_seq;
        const my_next = this.action_chain
            .catch(() => {})
            .then(() => {
                // A queued action belongs to the dataset that produced
                // the webview message. If refresh/dispose swaps or clears
                // the file before this action starts, no pending status has
                // been posted for it yet, so silently drop the stale click.
                if (this.dta_file !== my_dta_file) return;
                // Cancel drops every action queued before it.
                if (this.cancel_seq !== my_cancel_seq) return;
                return action();
            });
        this.action_chain = my_next.catch(() => {});
        return my_next;
    }

    private async send_metadata_impl(): Promise<void> {
        if (!this.dta_file) return;

        // Snapshot the generation; a refresh or a webview-reload 'ready'
        // bumps it. If it changes while we read columns, this attempt is
        // stale — bail before posting so we never ship metadata for an
        // outdated dataset/schema (a newer queued send_metadata posts).
        const my_generation = this.generation;

        // --- Open / metadata phase. Errors here are genuine open/metadata
        // failures, so they surface the "Failed to open" dialog. ---
        let my_schema_hash: string;
        let my_applies: { sort: boolean; filter: boolean };
        try {
            const my_missing_style =
                vscode.workspace
                    .getConfiguration('sight.dataBrowser')
                    .get<MissingValueStyle>(
                        'missingValueStyle',
                        'foreground'
                    );

            const my_variables = this.dta_file.variables.map(
                (my_v: BrowserVariable) => {
                    const my_table =
                        my_v.value_label_name !== ''
                            ? this.dta_file!.value_label_tables.get(
                                my_v.value_label_name
                            )
                            : undefined;
                    let my_value_labels:
                        Record<string, string> | undefined;
                    // Ship the code->label map for the filter UI, but
                    // bound it so a pathological label set can't bloat
                    // the metadata message.
                    if (my_table && labels_shipped(my_table)) {
                        my_value_labels = {};
                        for (const [my_code, my_label] of my_table) {
                            my_value_labels[String(my_code)] =
                                my_label;
                        }
                    }
                    return {
                        name: my_v.name,
                        type: my_v.type,
                        format: my_v.format,
                        label: my_v.label,
                        has_value_labels: my_table !== undefined,
                        value_labels: my_value_labels,
                    };
                }
            );

            my_schema_hash = schema_hash(my_variables);

            // Paint-first: decide whether a restore will run, then post
            // metadata *immediately* so the grid renders in natural order
            // at once instead of staying blank until the (potentially
            // multi-second) column reads finish. When a restore is
            // pending we omit the stored sort/filter from metadata so the
            // grid shows natural order with no chips; the chips and the
            // sorted/filtered order arrive later via `restoreSettled`.
            my_applies = this.restore_applies(my_schema_hash);
            const my_will_restore = my_applies.sort || my_applies.filter;
            this.post_metadata(
                my_variables,
                my_schema_hash,
                my_missing_style,
                my_will_restore
            );
            if (this.disposed) return;
            if (!my_will_restore) {
                // No restore this send (first open with no prefs, or a
                // reload after the one-shot restore was already consumed).
                // If an in-memory filter is active (a reload that kept the
                // restored/user filter), the metadata above carried the
                // chips but reset nobs_effective, so re-announce the
                // effective (post-filter) count — otherwise the grid sizes
                // for the full dataset and scrolls into empty space. (Sort
                // alone never changes the row count, so it needs nothing.)
                if (this.filtered_indices) this.post_filter_applied();
                return;
            }
        } catch (my_err) {
            if (!this.disposed) {
                vscode.window.showErrorMessage(
                    `Failed to open .dta file: ${my_err}`
                );
            }
            return;
        }

        // --- Restore phase. The file is already open and the grid is
        // painted, so a failure here is NOT an open failure and must not
        // show that dialog. Begin the cancellable restore: this posts
        // `restorePending` (now *after* metadata) so the webview explains
        // the wait over the live grid and offers Skip. `my_abort` /
        // `my_restore_id` identify this restore so the finally and the
        // settle only act on their own restore, not one a refresh started.
        const my_began = this.maybe_begin_restore(my_applies);
        if (!my_began) return;
        const my_abort = this.restore_abort;
        const my_restore_id = this.restore_id;
        const is_cancelled = () => my_abort?.signal.aborted === true;
        // Whether the settle (which dismisses the webview banner) was
        // posted. If the catch fires before this, we must still dismiss the
        // banner so a settle-phase throw can't strand it on "Applying…".
        let my_settled = false;
        try {
            const my_signal = my_abort?.signal;
            let my_restore_order: OrderResult | undefined;
            try {
                my_restore_order =
                    await this.compute_restore_order(
                        my_schema_hash,
                        my_signal
                    );
            } catch (my_err) {
                // If the unified compute is aborted, the existing
                // maybe_restore_* paths observe the aborted signal and
                // settle/forget just as they did when their own reads were
                // interrupted. For a non-abort failure, fall back to
                // separate sort and filter computes so warning behavior
                // stays local to the phase that actually fails.
                if (!is_abort_error(my_err)) {
                    my_restore_order = undefined;
                }
            }
            if (!this.dta_file || this.disposed) return;
            if (my_generation !== this.generation) return;
            // Track sort/filter failure separately so the warning names
            // only what actually failed (the other may have applied).
            const my_sort_failed = await this.maybe_restore_sort(
                my_schema_hash, my_signal, my_restore_order
            );
            if (!this.dta_file || this.disposed) return;
            // A refresh/reload/user-sort during the sort read bumps
            // generation and supersedes this attempt; bail before
            // maybe_restore_filter consumes its one-shot flag, so the
            // queued send (or the user action) takes over. (A Skip does
            // not bump generation and falls through to settle.)
            if (my_generation !== this.generation) return;
            // A cancel during the sort read must not kick off a long
            // filter read; skip it and fall through to settle.
            let my_filter_failed = false;
            if (!is_cancelled()) {
                my_filter_failed = await this.maybe_restore_filter(
                    my_schema_hash, my_signal, my_restore_order
                );
                if (!this.dta_file || this.disposed) return;
            }
            // A refresh / reload / user action during the reads supersedes
            // this attempt. Bail before settling, leaving prefs intact for
            // the queued send (or the user's own sort/filter) to take over;
            // a Skip does NOT bump generation, so it still settles+forgets.
            if (my_generation !== this.generation) return;

            if (is_cancelled()) {
                // Undo any sort that completed before the Skip landed
                // (memory only here), so chips and effective order agree
                // on "natural" before we settle.
                this.reset_restored_prefs();
            }
            // Settle the restore.
            this.recompute_effective();
            // Only invalidate the natural-order pages cached / in flight
            // while the grid was live if the restore actually CHANGED the
            // order (same recipe as handle_set_sort: bump generation so any
            // in-flight natural read is discarded at its post-await check,
            // and clear the row cache). On a settle to natural order — Skip,
            // an empty restore, or a disabled-only filter — those pages stay
            // valid; bumping there would drop in-flight reads that the
            // webview (which keeps its pages on such settles) never
            // re-requests, stranding blank viewport slots. This mirrors the
            // webview's `my_order_changed` gate so the two sides agree.
            if (this.effective_perm !== null) {
                this.generation++;
            }
            this.post_restore_settled(my_restore_id);
            my_settled = true;

            // Suppress the failure warning when the user cancelled: a read
            // may have genuinely failed before the Skip landed, but the
            // user explicitly chose natural order, so a "couldn't reapply"
            // popup would be confusing noise.
            if (!is_cancelled()
                && (my_sort_failed || my_filter_failed)) {
                const what = my_sort_failed && my_filter_failed
                    ? 'sort and filter'
                    : my_sort_failed ? 'sort' : 'filter';
                vscode.window.showWarningMessage(
                    `Could not reapply the saved ${what} for this `
                    + 'dataset; it was not applied.'
                );
            }
            // Persist the "forget" only after the settle is posted, so a
            // store-write failure cannot strand the webview waiting on a
            // settle it never receives. A rejection here is caught below
            // (the settle already dismissed the banner).
            if (is_cancelled()) {
                await this.forget_persisted_prefs(my_schema_hash);
            }
        } catch {
            // Restore-phase failure on an already-open, painted grid. The
            // column reads handle their own failures inside
            // maybe_restore_*; realistically only a forget_persisted_prefs
            // store-write rejects here, after the settle was posted. Leave
            // the data in natural order — do NOT show "Failed to open".
            //
            // If the throw beat the settle (so the banner was never
            // dismissed), fall back to natural order and post a best-effort
            // EMPTY settle so the webview can't stay stuck on "Applying…".
            // (A duplicate settle after a real one is ignored by the
            // webview's restore_id guard.)
            if (!my_settled && !this.disposed
                && this.restore_abort === my_abort) {
                this.reset_restored_prefs();
                this.effective_perm = null;
                try {
                    this.post_restore_settled(my_restore_id);
                } catch {
                    /* webview gone; nothing to dismiss */
                }
            }
        } finally {
            // Consume the handshake and clear restore state when this
            // attempt ends and no newer restore has taken over. restore_id
            // is cleared HERE (not inline after the settle) so that even a
            // settle-phase throw consumes it — otherwise a Skip racing the
            // settle could still match handle_cancel_restore's late-cancel
            // branch and forget the just-restored prefs.
            if (my_began && this.restore_abort === my_abort) {
                this.restoring = false;
                this.restore_abort = null;
                this.restore_id = -1;
            }
        }
    }

    /**
     * Build and post the metadata message for the current dataset. When
     * `restore_pending` is true a paint-first restore is about to run, so
     * the stored sort/filter are omitted: the grid renders natural order
     * with no chips and the restored order/chips arrive via
     * `restoreSettled`. When false (e.g. a reload with sort/filter already
     * applied in memory) they are included so chips render immediately.
     */
    private post_metadata(
        variables: MetadataMessage['variables'],
        schema_hash_value: string,
        missing_value_style: MissingValueStyle,
        restore_pending: boolean
    ): void {
        if (!this.dta_file) return;
        const my_metadata: MetadataMessage = {
            type: 'metadata',
            nobs: this.dta_file.nobs,
            page_size: page_size_for_column_count(this.dta_file.nvar),
            missing_value_style: missing_value_style,
            variables: variables,
            schema_hash: schema_hash_value,
            // Omitted while a restore is pending (chips arrive on settle)
            // and after a cancel (EMPTY), so the webview renders no chips.
            stored_sort: !restore_pending && this.sort.keys.length > 0
                ? this.sort
                : undefined,
            stored_filter:
                !restore_pending && this.filter.entries.length > 0
                    ? this.filter
                    : undefined,
            name: this.sidecar.name,
            dataset_key: this.dataset_key,
            stored_column_widths:
                this.column_width_store.get(
                    this.dataset_key,
                    this.dataset_key_aliases
                ),
            stored_hidden_columns:
                this.column_visibility_store.get(
                    this.dataset_key,
                    this.dataset_key_aliases
                ),
            subsetted: this.sidecar.subsetted,
            varlist: this.sidecar.varlist,
            if_condition: this.sidecar.if,
            in_condition: this.sidecar.in,
            debug_timing: this.debug_timing !== null,
        };

        this.panel.webview.postMessage(my_metadata);
        // A reloaded webview clears its banner on metadata; restate it.
        if (this.file_changed) {
            const my_changed: FileChangedMessage = { type: 'fileChanged' };
            this.panel.webview.postMessage(my_changed);
        }
        if (
            this.debug_timing
            && this.debug_timing.metadata_posted_epoch_ms === undefined
        ) {
            this.debug_timing.metadata_posted_epoch_ms = Date.now();
        }
    }

    /**
     * Terminal message for a paint-first restore: switch the (already
     * painted, natural-order) grid to the restored sort/filter. Carries
     * EMPTY sort/filter when the restore was cancelled/failed/empty. The
     * `restore_id` lets the webview ignore a settle from a superseded
     * lifecycle (a reload/refresh started a newer restore).
     */
    private post_restore_settled(restore_id: number): void {
        const my_msg: RestoreSettledMessage = {
            type: 'restoreSettled',
            restore_id,
            sort: this.sort,
            filter: this.filter,
            nobs_effective: this.effective_nobs(),
        };
        this.panel.webview.postMessage(my_msg);
    }

    // -------------------------------------------------------
    // Saved-preference restore handshake
    // -------------------------------------------------------

    /**
     * Side-effect-free peek: which saved preferences (if any) a restore
     * would reapply now. Returned booleans feed both the paint-first
     * metadata (whether to omit chips) and {@link maybe_begin_restore}
     * (the single source of the begin/skip decision), so the two can
     * never disagree.
     *
     * Gated on the prefs *existing and fitting the schema* (a cheap store
     * peek) — not on whether they will ultimately yield rows, which can't
     * be known without the very read this explains.
     */
    private restore_applies(
        schema_hash_value: string
    ): { sort: boolean; filter: boolean } {
        // Restore happens once per lifetime; both flags are set together
        // on the first send_metadata and reset by refresh().
        if (this.sort_restored && this.filter_restored) {
            return { sort: false, filter: false };
        }
        return {
            sort: this.persist_sort_enabled()
                && this.has_applicable_stored_sort(schema_hash_value),
            filter: this.persist_filters_enabled()
                && this.has_applicable_stored_filter(schema_hash_value),
        };
    }

    /**
     * Start a cancellable restore for the preferences {@link restore_applies}
     * found: create the AbortController, stamp `restore_id`, and post
     * `restorePending` (now after the paint-first metadata) so the webview
     * can explain the wait over the live grid and offer Skip. Returns true
     * if a restore was begun.
     */
    private maybe_begin_restore(
        applies: { sort: boolean; filter: boolean }
    ): boolean {
        if (!applies.sort && !applies.filter) return false;

        // A fresh controller per restore; cancellation is read from its
        // signal, so there is no shared boolean to reset.
        this.restore_abort = new AbortController();
        this.restore_id = this.generation;
        this.restoring = true;

        const my_msg: RestorePendingMessage = {
            type: 'restorePending',
            restore_id: this.restore_id,
            sort: applies.sort,
            filter: applies.filter,
        };
        this.panel.webview.postMessage(my_msg);
        return true;
    }

    /** Whether a persisted sort with at least one key exists. */
    private has_applicable_stored_sort(
        schema_hash_value: string
    ): boolean {
        const my_stored = this.sort_state_store.get(
            this.dataset_key,
            schema_hash_value
        );
        return !!my_stored && my_stored.keys.length > 0;
    }

    /**
     * Whether a persisted filter exists with at least one entry whose
     * predicate still fits its column's current kind (mirrors the
     * keep-filter logic in maybe_restore_filter).
     */
    private has_applicable_stored_filter(
        schema_hash_value: string
    ): boolean {
        if (!this.dta_file) return false;
        const my_stored = this.filter_state_store.get(
            this.dataset_key,
            schema_hash_value
        );
        if (!my_stored) return false;
        return my_stored.entries.some(my_entry => {
            const my_var =
                this.dta_file!.variables[my_entry.col_index];
            return my_var !== undefined
                && this.predicate_fits_column(
                    my_entry.predicate,
                    my_var
                );
        });
    }

    /**
     * Drop the restored sort/filter from memory (synchronous). Setting
     * `restore_id = -1` consumes the handshake so a duplicate cancel is
     * ignored. The caller invalidates caches / posts updates and then
     * persists the forget via {@link forget_persisted_prefs}.
     *
     * A user superseding the restore goes through
     * {@link abort_and_clear_restore} instead, which also sets
     * `restore_id = -1` but must ALSO abort the in-flight reads (and does
     * not clear sort/filter, since the user is applying their own).
     */
    private reset_restored_prefs(): void {
        this.restore_id = -1;
        this.sort = EMPTY_SORT;
        this.permutation = null;
        this.filter = EMPTY_FILTER;
        this.filtered_indices = null;
    }

    /**
     * The user superseded an in-flight restore with their own sort/filter.
     * Discard any sort/filter the restore committed but never announced
     * ({@link reset_restored_prefs}), AND mark the one-shot restore
     * consumed so a later webview reload (which sees `restoring` already
     * false) does not start a fresh restore that resurrects a saved pref
     * the user never applied — e.g. the saved filter when they sorted
     * during the saved-sort read, before the filter was ever fetched.
     *
     * The persisted prefs are NOT forgotten: a full reopen (refresh)
     * re-arms both flags and reapplies them.
     */
    private supersede_restore_attempt(): void {
        this.reset_restored_prefs();
        this.sort_restored = true;
        this.filter_restored = true;
    }

    /**
     * Abort the in-flight restore's reads and clear the handshake. Used
     * by the lifecycle-interruption paths (a webview reload's `ready` and
     * `refresh()` to a new dataset): both bump the generation first, which
     * makes the aborted restore bail without forgetting prefs, while the
     * abort lets the serialized send_metadata chain advance at once
     * instead of waiting behind the old, still-running column read.
     */
    private abort_and_clear_restore(): void {
        this.restore_abort?.abort();
        this.restore_abort = null;
        this.restoring = false;
        this.restore_id = -1;
    }

    /** Forget the persisted sort/filter for this dataset×schema. */
    private async forget_persisted_prefs(
        schema_hash_value: string
    ): Promise<void> {
        if (this.persist_sort_enabled()) {
            await this.sort_state_store.set(
                this.dataset_key, schema_hash_value, EMPTY_SORT
            );
        }
        if (this.persist_filters_enabled()) {
            await this.filter_state_store.set(
                this.dataset_key, schema_hash_value, EMPTY_FILTER
            );
        }
    }

    /**
     * Handle a webview Cancel of the saved-preference restore. Ignores a
     * stale/consumed id. While the restore is in flight, aborts the
     * column reads (send_metadata's cancelled path forgets + posts
     * natural-order metadata). If the restore already completed (the
     * cross-window race), honors the click as an explicit clear-and-
     * forget so it is never silently dropped.
     */
    private async handle_cancel_restore(
        msg: CancelRestoreMessage
    ): Promise<void> {
        if (msg.restore_id !== this.restore_id) return;
        if (this.restoring) {
            // Abort the in-flight reads; send_metadata reads the same
            // signal and takes its cancelled path (forget + natural).
            this.restore_abort?.abort();
            return;
        }
        if (!this.dta_file) return;
        const my_schema_hash = this.current_schema_hash();
        // Invalidate and re-request synchronously BEFORE awaiting the
        // store writes, so no in-flight requestRows can land stale
        // sorted/filtered rows after the user has cancelled.
        this.reset_restored_prefs();
        this.generation++;
        this.recompute_effective();
        this.post_sort_applied();
        this.post_filter_applied();
        await this.forget_persisted_prefs(my_schema_hash);
    }

    // -------------------------------------------------------
    // Message handling
    // -------------------------------------------------------

    private async handle_message(
        msg: WebviewMessage
    ): Promise<void> {
        switch (msg.type) {
            case 'ready':
                if (!this.dta_file) {
                    await this.initialize();
                } else {
                    this.generation++;
                    // If a webview reload interrupts an in-flight
                    // restore, the bumped generation makes that restore
                    // discard its result — but it already consumed the
                    // one-shot restore flags. Clear them so the queued
                    // re-send reapplies the saved prefs instead of
                    // showing natural order. (When no restore is in
                    // flight, the in-memory sort/filter are already set
                    // and re-sent as-is — no re-read.)
                    if (this.restoring) {
                        // Re-arm the one-shot restore flags so the queued
                        // re-send reapplies the saved prefs, then abort the
                        // in-flight reads and clear the handshake so the
                        // serialized send_metadata chain advances at once
                        // (otherwise the reload's replacement restore and
                        // its Cancel banner can't start until the old read
                        // finishes, stranding the user on a bare "Loading…").
                        this.sort_restored = false;
                        this.filter_restored = false;
                        this.abort_and_clear_restore();
                    }
                    await this.send_metadata();
                }
                break;
            case 'columnWidthsChanged':
                if (msg.dataset_key !== this.dataset_key) break;
                await this.column_width_store.set(
                    this.dataset_key,
                    msg.widths,
                    this.dataset_key_aliases
                );
                break;
            case 'columnVisibilityChanged':
                if (msg.dataset_key !== this.dataset_key) break;
                await this.column_visibility_store.set(
                    this.dataset_key,
                    msg.hidden_columns,
                    this.dataset_key_aliases
                );
                break;
            case 'requestRows':
                await this.handle_row_request(msg);
                break;
            case 'setSort':
                // A newer sort replaces a running one, whose result would
                // be overwritten anyway; stop it rather than wait for it.
                if (this.running_action === 'sort') {
                    this.action_abort?.abort();
                }
                await this.enqueue_user_action(
                    () => this.handle_set_sort(msg)
                );
                break;
            case 'setFilters':
                if (this.running_action === 'filter') {
                    this.action_abort?.abort();
                }
                await this.enqueue_user_action(
                    () => this.handle_set_filters(msg)
                );
                break;
            case 'cancelCompute':
                this.handle_cancel_compute();
                break;
            case 'requestHistogram':
                await this.handle_request_histogram(msg);
                break;
            case 'cancelRestore':
                await this.handle_cancel_restore(msg);
                break;
            case 'timing':
                if (this.debug_timing) {
                    record_webview_mark(
                        this.debug_timing,
                        msg.mark,
                        msg.epoch_ms
                    );
                }
                break;
            case 'requestFullText':
                await this.handle_request_full_text(msg);
                break;
            case 'copyColumn':
                await this.handle_copy_column(
                    msg.col_index,
                    msg.show_labels,
                    msg.show_formats
                );
                break;
        }
    }

    // -------------------------------------------------------
    // Sorting
    // -------------------------------------------------------

    private async handle_set_sort(
        msg: SetSortMessage
    ): Promise<void> {
        if (!this.dta_file) return;
        // The user is superseding the restored prefs. With paint-first the
        // grid is live during a background restore, so a user sort can land
        // mid-restore: abort the in-flight restore reads and clear the
        // handshake (null-safe when no restore is running). The aborted
        // restore bails at its post-await generation check below (this
        // bumps generation), so it neither settles nor forgets prefs.
        //
        // Invariant: superseding does NOT forget saved prefs. This sort is
        // persisted (overwriting the saved sort); any saved filter that
        // had not yet applied this session stays stored and reapplies on
        // the next open.
        const my_was_restoring = this.restoring;
        this.abort_and_clear_restore();
        // Discard any sort/filter the aborted restore committed in memory
        // but never announced (the saved sort commits before the saved
        // filter read finishes) and mark the restore attempt consumed, so
        // the grid never renders an unannounced restored order and a later
        // reload cannot resurrect a not-yet-applied saved pref. Gated on
        // `my_was_restoring` so a normal sort over an existing user filter
        // is untouched.
        if (my_was_restoring) this.supersede_restore_attempt();

        // Bump the generation so any row request that is already
        // in-flight under the previous permutation is dropped instead of
        // posting stale rows after this sort lands. User sort/filter
        // messages are serialized by handle_message, so this generation
        // marks this action's row-order boundary.
        this.generation++;
        const my_generation = this.generation;
        this.post_sort_status('pending');

        const my_nvar = this.dta_file.nvar;
        const my_valid = msg.keys.every(
            my_key =>
                my_key.col_index >= 0
                && my_key.col_index < my_nvar
        );
        const my_sort: SortState = {
            keys: my_valid ? msg.keys : [],
            labels_on_when_sorted: msg.labels_on,
        };

        const my_abort = this.begin_action('sort');
        let my_permutation: Uint32Array | null = null;
        try {
            my_permutation = await this.compute_sort_permutation(
                my_sort,
                my_abort.signal
            );
        } catch (my_err) {
            if (this.stop_after_action_failure(my_err, 'sort')) {
                this.end_action(my_abort);
                return;
            }
            my_permutation = null;
        }
        this.end_action(my_abort);

        // Drop stale results after a refresh
        if (my_generation !== this.generation) return;

        this.sort = my_sort;
        this.permutation = my_permutation;
        this.recompute_effective();
        this.commit_order_change();

        this.post_sort_status('idle');
        this.post_sort_applied();

        if (this.persist_sort_enabled()) {
            await this.sort_state_store.set(
                this.dataset_key,
                this.current_schema_hash(),
                this.sort
            );
        }
    }

    private persist_sort_enabled(): boolean {
        return vscode.workspace
            .getConfiguration('sight.dataBrowser')
            .get<boolean>('persistSort', true) ?? true;
    }

    private current_schema_hash(): string {
        if (!this.dta_file) return '';
        return schema_hash(
            this.dta_file.variables.map(my_v => ({
                name: my_v.name,
                type: my_v.type,
            }))
        );
    }

    /**
     * On first metadata for a dataset, restore any persisted sort for
     * this dataset_key × schema_hash and recompute its permutation.
     * No-op on later metadata re-sends (the in-memory sort wins).
     * Returns true iff a genuine (non-abort) read failure occurred, so
     * the caller can warn and keep the saved pref.
     */
    private async maybe_restore_sort(
        schema_hash_value: string,
        signal?: AbortSignal,
        precomputed?: OrderResult
    ): Promise<boolean> {
        if (this.sort_restored) return false;
        this.sort_restored = true;
        if (!this.dta_file || !this.persist_sort_enabled()) return false;

        const my_stored = this.sort_state_store.get(
            this.dataset_key,
            schema_hash_value
        );
        if (!my_stored) return false;

        const my_generation = this.generation;
        let my_permutation: Uint32Array | null = null;
        try {
            my_permutation =
                await this.compute_sort_permutation(
                    my_stored, signal, precomputed
                );
        } catch (my_err) {
            // A user cancel aborts the read → natural order, silent. A
            // genuine read failure → natural order, but report so the
            // caller can warn and keep the saved pref for next time.
            return !is_abort_error(my_err);
        }
        if (my_generation !== this.generation) return false;
        if (my_permutation) {
            this.sort = my_stored;
            this.permutation = my_permutation;
        }
        return false;
    }

    /**
     * The saved sort and filter a restore would reapply, in one order
     * job so each column they reference is read once. Stale entries are
     * dropped as maybe_restore_* drops them; the compute treats an
     * invalid sort or filter as inapplicable.
     */
    private compute_restore_order(
        schema_hash_value: string,
        signal?: AbortSignal
    ): Promise<OrderResult> {
        let my_sort: SortState | null = null;
        if (!this.sort_restored && this.persist_sort_enabled()) {
            my_sort = this.sort_state_store.get(
                this.dataset_key,
                schema_hash_value
            ) ?? null;
        }
        let my_filter: FilterState | null = null;
        if (!this.filter_restored && this.persist_filters_enabled()) {
            const my_stored = this.filter_state_store.get(
                this.dataset_key,
                schema_hash_value
            );
            if (my_stored) {
                my_filter = {
                    entries: this.entries_fitting_columns(
                        my_stored.entries
                    ),
                    labels_on_when_filtered:
                        my_stored.labels_on_when_filtered,
                };
            }
        }
        return this.run_order_job(my_sort, my_filter, signal);
    }

    private async run_order_job(
        sort: SortState | null,
        filter: FilterState | null,
        signal?: AbortSignal
    ): Promise<OrderResult> {
        const my_result = await this.run_job(
            { kind: 'order', sort, filter },
            'transform',
            signal
        );
        if (my_result.kind !== 'order') {
            throw new Error(`Unexpected ${my_result.kind} result`);
        }
        return my_result;
    }

    /**
     * Build the sort permutation for a sort state, off the host. Returns
     * null for an empty or out-of-range sort. `precomputed` is a
     * restore's combined result. The caller is responsible for
     * re-checking `generation` after the await.
     */
    private async compute_sort_permutation(
        sort: SortState,
        signal?: AbortSignal,
        precomputed?: OrderResult
    ): Promise<Uint32Array | null> {
        if (precomputed) return precomputed.permutation;
        if (!this.dta_file || sort.keys.length === 0) {
            return null;
        }
        return (await this.run_order_job(sort, null, signal)).permutation;
    }

    private post_sort_status(
        state: 'pending' | 'idle'
    ): void {
        const my_msg: SortStatusMessage = {
            type: 'sortStatus',
            state,
        };
        this.panel.webview.postMessage(my_msg);
    }

    private post_sort_applied(): void {
        const my_msg: SortAppliedMessage = {
            type: 'sortApplied',
            sort: this.sort,
            // Sort never changes the row set, but a filter may already be
            // active, so report the effective (post-filter) count.
            nobs_effective: this.effective_nobs(),
        };
        this.panel.webview.postMessage(my_msg);
    }

    // -------------------------------------------------------
    // Filtering
    // -------------------------------------------------------

    private async handle_set_filters(
        msg: SetFiltersMessage
    ): Promise<void> {
        if (!this.dta_file) return;
        // The user is superseding the restored prefs (see handle_set_sort):
        // abort any in-flight background restore so it bails at its
        // generation check below without settling or forgetting prefs.
        // Superseding does NOT forget saved prefs; this filter is
        // persisted and any not-yet-applied saved sort reapplies next open.
        const my_was_restoring = this.restoring;
        this.abort_and_clear_restore();
        // Discard any restored sort committed in memory but not yet
        // announced (so the grid does not render sorted+filtered under a
        // filter-only chip) and mark the restore attempt consumed (so a
        // later reload cannot resurrect the not-yet-applied saved sort).
        // Gated on `my_was_restoring` so a normal filter over an existing
        // user sort is untouched.
        if (my_was_restoring) this.supersede_restore_attempt();

        // Bump the generation so an in-flight row request under the old
        // effective permutation is dropped rather than posting stale rows
        // after this filter lands. User sort/filter messages are
        // serialized by handle_message, so this generation marks this
        // action's row-order boundary.
        this.generation++;
        const my_generation = this.generation;
        this.post_filter_status('pending');

        const my_nvar = this.dta_file.nvar;
        // Drop entries whose column no longer exists (e.g. a stale chip
        // after the schema changed); keep the rest.
        const the_valid_entries = msg.entries.filter(
            my_entry =>
                my_entry.col_index >= 0
                && my_entry.col_index < my_nvar
        );
        const my_filter: FilterState = {
            entries: the_valid_entries,
            labels_on_when_filtered: msg.labels_on,
        };

        const my_abort = this.begin_action('filter');
        let my_indices: Uint32Array | null = null;
        try {
            my_indices = await this.compute_filter_indices(
                my_filter,
                my_abort.signal
            );
        } catch (my_err) {
            if (this.stop_after_action_failure(my_err, 'filter')) {
                this.end_action(my_abort);
                return;
            }
            my_indices = null;
        }
        this.end_action(my_abort);

        // Drop stale results after a refresh or a superseding filter.
        if (my_generation !== this.generation) return;

        this.filter = my_filter;
        this.filtered_indices = my_indices;
        this.recompute_effective();
        this.commit_order_change();

        this.post_filter_status('idle');
        this.post_filter_applied();

        if (this.persist_filters_enabled()) {
            await this.filter_state_store.set(
                this.dataset_key,
                this.current_schema_hash(),
                this.filter
            );
        }
    }

    private persist_filters_enabled(): boolean {
        return vscode.workspace
            .getConfiguration('sight.dataBrowser')
            .get<boolean>('persistFilters', true) ?? true;
    }

    /**
     * On first metadata for a dataset, restore any persisted filter for
     * this dataset_key × schema_hash and recompute its survivor set.
     * Unlike sort restore, the chip descriptors are restored even when the
     * recompute yields no index (e.g. all entries disabled), so disabled
     * chips reappear for the user to re-enable or edit. No-op on later
     * metadata re-sends (the in-memory filter wins).
     */
    private async maybe_restore_filter(
        schema_hash_value: string,
        signal?: AbortSignal,
        precomputed?: OrderResult
    ): Promise<boolean> {
        if (this.filter_restored) return false;
        this.filter_restored = true;
        if (!this.dta_file || !this.persist_filters_enabled()) {
            return false;
        }

        const my_stored = this.filter_state_store.get(
            this.dataset_key,
            schema_hash_value
        );
        if (!my_stored) return false;

        // The persistence key folds in column name + type but not the
        // display format, so a column re-saved with a different
        // date/numeric format keeps its slot. Drop entries whose predicate
        // no longer fits the column's current kind (e.g. a date filter on
        // a now-numeric column would convert ISO dates into the wrong
        // domain); showing the data unfiltered is safer than mis-filtering.
        const the_kept_entries =
            this.entries_fitting_columns(my_stored.entries);
        if (the_kept_entries.length === 0) return false;
        const my_filter: FilterState = {
            entries: the_kept_entries,
            labels_on_when_filtered: my_stored.labels_on_when_filtered,
        };

        const my_generation = this.generation;
        let my_indices: Uint32Array | null = null;
        try {
            my_indices = await this.compute_filter_indices(
                my_filter, signal, precomputed
            );
        } catch (my_err) {
            // Cancel → natural order silently; genuine failure →
            // natural order, reported so the caller can warn and keep
            // the saved filter. Either way, don't restore the chips.
            return !is_abort_error(my_err);
        }
        if (my_generation !== this.generation) return false;
        this.filter = my_filter;
        this.filtered_indices = my_indices;
        return false;
    }

    /**
     * Whether a (restored) predicate still makes sense for a column's
     * current kind. Mirrors `kind_options` in filter-column-kind.ts: each
     * predicate family is offered only for certain kinds, so a stale
     * persisted entry from before a format change is dropped rather than
     * applied with the wrong domain semantics.
     */
    private predicate_fits_column(
        predicate: FilterPredicate,
        variable: BrowserVariable
    ): boolean {
        if (!this.dta_file) return false;
        const my_kind = classify_sort_kind({
            type: variable.type,
            format: variable.format,
            has_value_labels:
                variable.value_label_name !== ''
                && this.dta_file.value_label_tables.has(
                    variable.value_label_name
                ),
        });
        switch (predicate.kind) {
            case 'isEmpty':
            case 'isNotEmpty':
                return true;
            case 'numCompare':
            case 'numBetween':
            case 'numNotBetween':
                return my_kind === 'numeric'
                    || my_kind === 'labelledNumeric';
            case 'setIn':
            case 'setNotIn':
                return my_kind === 'labelledNumeric';
            case 'strCompare':
            case 'strContains':
            case 'strStartsWith':
            case 'strEndsWith':
            case 'strRegex':
                return my_kind === 'string';
            case 'dateCompare':
            case 'dateBetween':
            case 'dateNotBetween':
                return my_kind === 'date';
        }
    }

    /** Entries whose column exists and whose predicate fits its kind. */
    private entries_fitting_columns(
        entries: readonly FilterState['entries'][number][]
    ): FilterState['entries'] {
        if (!this.dta_file) return [];
        return entries.filter(my_entry => {
            const my_var = this.dta_file!.variables[my_entry.col_index];
            return my_var !== undefined
                && this.predicate_fits_column(my_entry.predicate, my_var);
        });
    }

    /**
     * Compute the surviving original-row indices for a filter, off the
     * host. Returns null when no entry is enabled or any enabled column
     * is out of range — the caller treats null as "no filtering".
     * `precomputed` is a restore's combined result. The caller must
     * re-check `generation` after the await.
     */
    private async compute_filter_indices(
        filter: FilterState,
        signal?: AbortSignal,
        precomputed?: OrderResult
    ): Promise<Uint32Array | null> {
        if (precomputed) return precomputed.filtered_indices;
        if (!this.dta_file) return null;
        if (!filter.entries.some(my_entry => my_entry.enabled)) {
            return null;
        }
        return (await this.run_order_job(null, filter, signal))
            .filtered_indices;
    }

    // -------------------------------------------------------
    // Running and cancelling user sorts and filters
    // -------------------------------------------------------

    /** Mark a user sort/filter as running and return its controller. */
    private begin_action(kind: 'sort' | 'filter'): AbortController {
        const my_abort = new AbortController();
        this.action_abort = my_abort;
        this.running_action = kind;
        return my_abort;
    }

    private end_action(abort: AbortController): void {
        if (this.action_abort !== abort) return;
        this.action_abort = null;
        this.running_action = null;
    }

    /**
     * Whether a sort/filter compute failure ends the action without
     * applying anything. An abort (Cancel, a superseding request, a
     * refresh) is silent: whoever aborted has already told the webview.
     * A deadline or a changed file is reported, and the request reverts
     * to the applied state. Any other failure falls through to "no
     * order", as before.
     */
    private stop_after_action_failure(
        error: unknown,
        what: 'sort' | 'filter'
    ): boolean {
        if (is_abort_error(error)) return true;
        if (error instanceof ComputeDeadlineError) {
            vscode.window.showWarningMessage(
                `The ${what} was stopped after 10 minutes and was not `
                + 'applied.'
            );
            this.post_compute_cancelled();
            return true;
        }
        if (error instanceof FileChangedError) {
            // run_job already showed the banner and the message.
            this.post_compute_cancelled();
            return true;
        }
        return false;
    }

    /**
     * A new row order was committed: bump the generation so page reads
     * still in flight under the old order are discarded (each answered
     * with `rowsStale`).
     */
    private commit_order_change(): void {
        this.generation++;
    }

    /**
     * The webview's Cancel: stop the running sort/filter and drop every
     * queued one, leaving the applied order as it is.
     */
    private handle_cancel_compute(): void {
        this.cancel_seq++;
        this.action_abort?.abort();
        this.post_compute_cancelled();
    }

    /** Stop a running sort/filter and anything queued (refresh/dispose). */
    private stop_running_actions(): void {
        this.cancel_seq++;
        this.action_abort?.abort();
    }

    private post_compute_cancelled(): void {
        const my_msg: ComputeCancelledMessage = {
            type: 'computeCancelled',
            sort: this.sort,
            filter: this.filter,
            nobs_effective: this.effective_nobs(),
        };
        this.panel.webview.postMessage(my_msg);
    }

    private recompute_effective(): void {
        this.effective_perm = compose_effective(
            this.filtered_indices,
            this.permutation,
            this.dta_file?.nobs ?? 0
        );
    }

    /** Visible row count: the effective permutation length when sort or
     *  filter is active, else the full dataset size. */
    private effective_nobs(): number {
        if (this.effective_perm) return this.effective_perm.length;
        return this.dta_file?.nobs ?? 0;
    }

    private post_filter_status(
        state: 'pending' | 'idle'
    ): void {
        const my_msg: FilterStatusMessage = {
            type: 'filterStatus',
            state,
        };
        this.panel.webview.postMessage(my_msg);
    }

    private post_filter_applied(): void {
        const my_msg: FilterAppliedMessage = {
            type: 'filterApplied',
            filter: this.filter,
            nobs_filtered: this.effective_nobs(),
        };
        this.panel.webview.postMessage(my_msg);
    }

    private async handle_request_histogram(
        msg: RequestHistogramMessage
    ): Promise<void> {
        const post_empty = () => this.post_histogram(
            msg.col_index,
            []
        );
        if (!this.dta_file) {
            post_empty();
            return;
        }
        const my_col_index = msg.col_index;
        if (
            my_col_index < 0
            || my_col_index >= this.dta_file.nvar
            || !can_compute_histogram(this.dta_file, my_col_index)
        ) {
            post_empty();
            return;
        }

        let my_bins = this.histogram_cache.get(my_col_index);
        if (!my_bins) {
            // The histogram is over the full column and is independent of
            // sort/filter, so guard on the dataset identity (a refresh
            // swaps dta_file) rather than the sort/filter generation —
            // otherwise a concurrent sort/filter would drop the response
            // and the webview, having marked the column requested, would
            // never see a brush.
            const my_file = this.dta_file;
            let my_result: ComputeResult;
            try {
                my_result = await this.run_job(
                    { kind: 'histogram', col_index: my_col_index },
                    'action'
                );
            } catch {
                if (this.dta_file === my_file) post_empty();
                return;
            }
            if (this.dta_file !== my_file || !this.dta_file) {
                return;
            }
            my_bins = my_result.kind === 'histogram' ? my_result.bins : [];
            this.histogram_cache.set(my_col_index, my_bins);
        }

        this.post_histogram(my_col_index, my_bins);
    }

    private post_histogram(
        col_index: number,
        bins: HistogramBin[]
    ): void {
        const my_msg: HistogramDataMessage = {
            type: 'histogramData',
            col_index,
            bins,
        };
        this.panel.webview.postMessage(my_msg);
    }

    // -------------------------------------------------------
    // Row requests
    // -------------------------------------------------------

    private async handle_row_request(
        request: WebviewMessage & { type: 'requestRows' }
    ): Promise<void> {
        const my_reader = this.page_reader();
        if (!my_reader || this.file_changed) return;

        // Map the visible window to file rows. The effective permutation
        // folds in any active sort and filter; slice() copies the window
        // so only it, not the whole order, goes to the reader thread.
        const my_generation = this.generation;
        let my_rows: PageRows;
        if (this.effective_perm) {
            const my_start = Math.max(0, request.start);
            my_rows = {
                rows: this.effective_perm.slice(
                    my_start,
                    Math.min(my_start + request.count, this.effective_perm.length)
                ),
            };
        } else {
            my_rows = { start: request.start, count: request.count };
        }

        let my_read: PageRead;
        try {
            my_read = await my_reader.read_page(
                my_rows,
                request.col_start ?? 0,
                request.col_end ?? Number.MAX_SAFE_INTEGER
            );
        } catch (my_err) {
            if (this.disposed || my_generation !== this.generation) {
                this.post_rows_stale(request);
                return;
            }
            this.page_read_failed(my_err);
            return;
        }
        // Drop a page read under an order or file no longer shown.
        if (my_generation !== this.generation) {
            this.post_rows_stale(request);
            return;
        }

        const my_response: RowResponse = {
            type: 'rowData',
            start: request.start,
            col_start: request.col_start,
            rows: my_read.rows,
            request_id: request.request_id,
        };

        this.panel.webview.postMessage(my_response);
        this.note_rows_posted();
        if (my_read.rest) {
            await this.forward_rest_of_page(request, my_read.rest, my_read.rows);
        }
    }

    /**
     * Post the strL cells of a page that went out with them pending
     * (`pending`, as posted). If they cannot be read, they are posted as
     * unreadable rather than left pending.
     */
    private async forward_rest_of_page(
        request: WebviewMessage & { type: 'requestRows' },
        rest: Promise<CellPatch>,
        pending: RowResponse['rows']
    ): Promise<void> {
        let my_patch: CellPatch;
        try {
            my_patch = await rest;
        } catch (my_err) {
            if (this.disposed) return;
            this.page_read_failed(my_err);
            if (this.file_changed) return;
            my_patch = unreadable_patch(pending);
        }
        if (this.disposed) return;
        // Posted even if the order changed meanwhile: the webview applies
        // it only to a page still holding this request's reply, whose
        // rows the cells belong to (a cancelled sort keeps such pages).
        const my_msg: RowCellsMessage = {
            type: 'rowCells',
            start: request.start,
            request_id: request.request_id,
            columns: my_patch.columns,
            rows: my_patch.rows,
        };
        this.panel.webview.postMessage(my_msg);
    }

    /**
     * A page read failed. A file rewritten in place stops the panel
     * reading it (once, with a message and a banner); any other failure
     * is reported once per open file.
     */
    private page_read_failed(error: unknown): void {
        if (is_abort_error(error)) return;
        if (error instanceof FileChangedError) {
            this.mark_file_changed();
            return;
        }
        if (this.page_error_reported) return;
        this.page_error_reported = true;
        vscode.window.showErrorMessage(
            `The data browser could not read ${this.sidecar.name}: ${
                error instanceof Error ? error.message : String(error)}`
        );
    }

    private page_error_reported = false;

    /** The open file was rewritten in place: stop serving it. */
    private mark_file_changed(): void {
        if (this.file_changed || this.disposed) return;
        this.file_changed = true;
        const my_msg: FileChangedMessage = { type: 'fileChanged' };
        this.panel.webview.postMessage(my_msg);
        vscode.window.showWarningMessage(
            `${this.sidecar.name} changed on disk; reopen it to keep `
            + 'browsing.'
        );
    }

    /**
     * Whole values of long strLs the grid shows as previews, for copying
     * cells. Cells are given by file row, which the preview carries, so
     * an order change meanwhile does not matter.
     */
    private async handle_request_full_text(
        msg: RequestFullTextMessage
    ): Promise<void> {
        const my_reader = this.page_reader();
        let my_texts: string[] | null = null;
        if (my_reader && !this.file_changed) {
            try {
                my_texts = await my_reader.read_full_text(msg.cells);
            } catch (my_err) {
                if (my_err instanceof FileChangedError) {
                    this.mark_file_changed();
                }
                my_texts = null;
            }
        }
        if (this.disposed) return;
        const my_reply: FullTextMessage = {
            type: 'fullText',
            request_id: msg.request_id,
            texts: my_texts,
        };
        this.panel.webview.postMessage(my_reply);
    }

    /**
     * Tell the webview a page read was discarded because the order or
     * dataset changed while it ran, so it can ask again instead of
     * leaving the page pending until the next order change.
     */
    private post_rows_stale(
        request: WebviewMessage & { type: 'requestRows' }
    ): void {
        if (this.disposed) return;
        const my_msg: RowsStaleMessage = {
            type: 'rowsStale',
            start: request.start,
            request_id: request.request_id,
        };
        this.panel.webview.postMessage(my_msg);
    }

    /** A timing record for this open when debugTiming is on, else null. */
    private begin_debug_timing(name: string): DebugTimingRecord | null {
        const my_enabled = vscode.workspace
            .getConfiguration('sight.dataBrowser')
            .get<boolean>('debugTiming', false) ?? false;
        return my_enabled ? begin_debug_timing(name) : null;
    }

    /** Record the first rows posted for this open (debug timing). */
    private note_rows_posted(): void {
        if (
            this.debug_timing
            && this.debug_timing.first_rows_posted_epoch_ms === undefined
        ) {
            this.debug_timing.first_rows_posted_epoch_ms = Date.now();
        }
    }

    private async handle_copy_column(
        col_index: number,
        show_labels: boolean,
        show_formats: boolean
    ): Promise<void> {
        if (!this.dta_file) return;
        if (!this.dta_file.variables[col_index]) return;

        const my_file = this.dta_file;
        // Pin the order on screen when the user clicked: the job copies
        // in that order even if a sort or filter commits meanwhile.
        const my_order = this.effective_perm
            ? this.effective_perm.slice()
            : null;
        let my_result: ComputeResult;
        try {
            my_result = await this.run_job(
                {
                    kind: 'copy',
                    col_index,
                    show_labels,
                    show_formats,
                    order: my_order,
                },
                'action'
            );
        } catch (my_err) {
            if (
                is_abort_error(my_err)
                || my_err instanceof FileChangedError
                || this.disposed
            ) {
                return;
            }
            vscode.window.showErrorMessage(
                `Copy failed: ${my_err instanceof Error
                    ? my_err.message
                    : String(my_err)}`
            );
            return;
        }
        // A refresh to another dataset makes the copy moot.
        if (this.dta_file !== my_file || this.disposed) return;
        if (my_result.kind !== 'copy') return;
        await vscode.env.clipboard.writeText(my_result.text);
    }
}

/** Unreadable cells for the pending cells of `rows`. */
function unreadable_patch(rows: RowResponse['rows']): CellPatch {
    const the_columns: number[] = [];
    rows[0]?.forEach((my_cell, j) => {
        if (my_cell.pending) the_columns.push(j);
    });
    const my_cell = {
        raw: null,
        raw_display: '(unreadable)',
        formatted_display: '(unreadable)',
    };
    return {
        columns: the_columns,
        rows: rows.map(() => the_columns.map(() => my_cell)),
    };
}
