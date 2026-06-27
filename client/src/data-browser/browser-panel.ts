/**
 * Data Browser Panel
 *
 * Manages a single webview panel for browsing a Stata .dta
 * dataset.  Handles file opening, row requests from the
 * webview, cell value formatting, and temp file cleanup.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import {
    type VariableInfo,
    type Row,
    type RowCell,
} from '@jbearak/dta-parser';
import { DtaFile } from '@jbearak/dta-parser/node';
import { build_cell_value } from './cell-format.js';
import {
    build_sort_column,
    classify_sort_kind,
    compute_permutation,
    type SortColumn,
} from './sort.js';
import {
    compose_effective,
    group_contiguous_runs,
    permuted_window_indices,
} from './permuted-rows.js';
import {
    compute_filtered_indices,
    type FilterColumn,
} from './filter.js';
import { compute_histogram } from './histograms.js';
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
import { RowCache } from './row-cache.js';
import { schema_hash } from './schema-hash.js';
import type {
    WebviewMessage,
    RowResponse,
    MetadataMessage,
    CellValue,
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
    CancelRestoreMessage,
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

/** %tc / %tC store milliseconds since 1960; other date formats store
 *  days. Consulted when building a {@link FilterColumn} for date
 *  predicates so ISO strings convert into the column's stored domain. */
function is_timestamp_format(format: string): boolean {
    return /^%-?t[cC]/.test(format);
}

const PAGE_SIZE = 200;
const MAX_CACHED_PAGES = 10;
// Upper bound on value-label entries shipped per column to the webview.
const MAX_SHIPPED_VALUE_LABELS = 10_000;

function can_compute_histogram(
    dta_file: DtaFile,
    col_index: number
): boolean {
    const my_variable = dta_file.variables[col_index];
    if (!my_variable) return false;
    const my_has_value_labels =
        my_variable.value_label_name !== ''
        && dta_file.value_label_tables.has(
            my_variable.value_label_name
        );
    const my_kind = classify_sort_kind({
        type: my_variable.type,
        format: my_variable.format,
        has_value_labels: my_has_value_labels,
    });
    return my_kind === 'numeric' || my_kind === 'labelledNumeric';
}

export class DataBrowserPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private dta_file: DtaFile | null = null;
    private row_cache = new RowCache(MAX_CACHED_PAGES, PAGE_SIZE);
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

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string,
        column_width_store: DataBrowserColumnWidthStore,
        column_visibility_store: DataBrowserColumnVisibilityStore,
        sort_state_store: DataBrowserSortStateStore,
        filter_state_store: DataBrowserFilterStateStore
    ) {
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

    async refresh(
        sidecar: VviewSidecar,
        dta_path: string
    ): Promise<void> {
        this.generation++;
        const my_old_path = this.dta_path;
        this.dta_file?.close();
        this.dta_file = null;
        this.row_cache.clear();
        this.sort = EMPTY_SORT;
        this.permutation = null;
        this.sort_restored = false;
        this.filter = EMPTY_FILTER;
        this.filtered_indices = null;
        this.filter_restored = false;
        this.effective_perm = null;
        this.histogram_cache.clear();
        // Reset the saved-preference restore handshake; a fresh restore
        // begins (if applicable) when initialize() re-sends metadata. The
        // generation bump above makes any aborted in-flight restore bail
        // without forgetting prefs.
        this.abort_and_clear_restore();

        // Clean up the old temp file on Windows before
        // overwriting the path (other platforms unlink
        // eagerly in initialize()).
        if (
            process.platform === 'win32'
            && my_old_path !== dta_path
            && should_unlink_data_browser_path(my_old_path)
        ) {
            try {
                fs.unlinkSync(my_old_path);
            } catch {
                /* file may already be gone */
            }
        }

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

        this.dta_file?.close();
        this.dta_file = null;

        // On Windows the temp .dta file must be deleted
        // explicitly because unlinking an open file is not
        // supported.  On other platforms the file was already
        // unlinked in initialize().
        if (
            process.platform === 'win32'
            && should_unlink_data_browser_path(
                this.dta_path
            )
        ) {
            try {
                fs.unlinkSync(this.dta_path);
            } catch {
                /* file may already be gone */
            }
        }

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
        try {
            this.dta_file = await DtaFile.open(this.dta_path);

            // On non-Windows platforms, unlink the temp file
            // immediately.  The open file handle (held inside
            // DtaFile's buffer) keeps the data accessible
            // until close().
            if (
                process.platform !== 'win32'
                && should_unlink_data_browser_path(
                    this.dta_path
                )
            ) {
                try {
                    fs.unlinkSync(this.dta_path);
                } catch {
                    /* file may already be gone */
                }
            }
        } catch (my_err: unknown) {
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

    private async send_metadata_impl(): Promise<void> {
        if (!this.dta_file) return;

        // Snapshot the generation; a refresh or a webview-reload 'ready'
        // bumps it. If it changes while we read columns, this attempt is
        // stale — bail before posting so we never ship metadata for an
        // outdated dataset/schema (a newer queued send_metadata posts).
        const my_generation = this.generation;

        try {
            const my_missing_style =
                vscode.workspace
                    .getConfiguration('sight.dataBrowser')
                    .get<MissingValueStyle>(
                        'missingValueStyle',
                        'foreground'
                    );

            const my_variables = this.dta_file.variables.map(
                (my_v: VariableInfo) => {
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
                    if (
                        my_table
                        && my_table.size <= MAX_SHIPPED_VALUE_LABELS
                    ) {
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

            const my_schema_hash = schema_hash(my_variables);

            // Begin a cancellable restore if saved prefs apply. This
            // posts `restorePending` before the (potentially long)
            // column reads so the webview can explain the wait and offer
            // Cancel. `my_abort` identifies this restore's controller so
            // the finally only cleans up its own restore, not one a
            // concurrent refresh may have started.
            const my_began = this.maybe_begin_restore(my_schema_hash);
            // Cancellation is read from this restore's own AbortSignal
            // (null when no restore began), so a concurrent send_metadata
            // reassigning this.restore_abort can't change what THIS call
            // sees. `my_failed` aggregates non-abort read failures from
            // the restore helpers (returned, not stored on the instance).
            const my_abort = my_began ? this.restore_abort : null;
            const is_cancelled = () => my_abort?.signal.aborted === true;
            try {
                const my_signal = my_abort?.signal;
                // Track sort/filter failure separately so the warning
                // names only what actually failed (the other may have
                // applied successfully).
                const my_sort_failed = await this.maybe_restore_sort(
                    my_schema_hash, my_signal
                );
                if (!this.dta_file) return;
                // A refresh/reload during the sort read supersedes this
                // attempt; bail before maybe_restore_filter consumes its
                // one-shot flag, so the queued send re-restores fully.
                // (A user cancel does not bump generation and falls
                // through to the forget path below.)
                if (my_generation !== this.generation) return;
                // A cancel during the sort read must not kick off a long
                // filter read; skip it and fall through to forget.
                let my_filter_failed = false;
                if (!is_cancelled()) {
                    my_filter_failed = await this.maybe_restore_filter(
                        my_schema_hash, my_signal
                    );
                    if (!this.dta_file) return;
                }
                // A refresh / reload during the reads supersedes this
                // attempt. Bail before posting (and before forgetting),
                // leaving prefs intact for the queued send to reapply; a
                // user cancel does NOT bump generation, so it still falls
                // through to the forget path below.
                if (my_generation !== this.generation) return;

                if (is_cancelled()) {
                    // Undo any sort that completed before the cancel
                    // landed (memory only here), so chips and effective
                    // order agree on "natural" before metadata is posted.
                    this.reset_restored_prefs();
                }
                this.recompute_effective();

                this.post_metadata(my_variables, my_schema_hash, my_missing_style);

                // A restored filter changes the visible row count; the
                // webview learns the effective count from filterApplied
                // (metadata.nobs stays the full dataset size).
                if (!is_cancelled() && this.filtered_indices) {
                    this.post_filter_applied();
                }
                // Suppress the failure warning when the user cancelled:
                // a read may have genuinely failed before the cancel
                // landed, but the user explicitly chose natural order, so
                // a "couldn't reapply" popup would be confusing noise.
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
                // Persist the "forget" only after metadata is posted, so
                // a store-write failure cannot strand the webview waiting
                // on a metadata it never receives.
                if (is_cancelled()) {
                    await this.forget_persisted_prefs(my_schema_hash);
                }
            } finally {
                // Only the call that began this restore clears its
                // state, and only if a concurrent refresh hasn't already
                // swapped in a newer restore controller.
                if (my_began && this.restore_abort === my_abort) {
                    this.restoring = false;
                    this.restore_abort = null;
                }
            }
        } catch (my_err) {
            vscode.window.showErrorMessage(
                `Failed to open .dta file: ${my_err}`
            );
        }
    }

    /** Build and post the metadata message for the current dataset. */
    private post_metadata(
        variables: MetadataMessage['variables'],
        schema_hash_value: string,
        missing_value_style: MissingValueStyle
    ): void {
        if (!this.dta_file) return;
        const my_metadata: MetadataMessage = {
            type: 'metadata',
            nobs: this.dta_file.nobs,
            missing_value_style: missing_value_style,
            variables: variables,
            schema_hash: schema_hash_value,
            // After a cancel these are EMPTY, so stored_sort/filter
            // are omitted and the webview renders no chips.
            stored_sort: this.sort.keys.length > 0
                ? this.sort
                : undefined,
            stored_filter: this.filter.entries.length > 0
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
        };

        this.panel.webview.postMessage(my_metadata);
    }

    // -------------------------------------------------------
    // Saved-preference restore handshake
    // -------------------------------------------------------

    /**
     * If a saved sort and/or filter applies to this dataset×schema,
     * start a cancellable restore: reset the restore flags, create the
     * AbortController, stamp `restore_id`, and post `restorePending`
     * before the column reads. Returns true if a restore was begun.
     *
     * Gated on the prefs *existing and fitting the schema* (a cheap
     * store peek) — not on whether they will ultimately yield rows,
     * which can't be known without the very read this explains.
     */
    private maybe_begin_restore(
        schema_hash_value: string
    ): boolean {
        // Restore happens once per lifetime; both flags are set
        // together on the first send_metadata and reset by refresh().
        if (this.sort_restored && this.filter_restored) {
            return false;
        }
        const my_has_sort =
            this.persist_sort_enabled()
            && this.has_applicable_stored_sort(schema_hash_value);
        const my_has_filter =
            this.persist_filters_enabled()
            && this.has_applicable_stored_filter(schema_hash_value);
        if (!my_has_sort && !my_has_filter) return false;

        // A fresh controller per restore; cancellation is read from its
        // signal, so there is no shared boolean to reset.
        this.restore_abort = new AbortController();
        this.restore_id = this.generation;
        this.restoring = true;

        const my_msg: RestorePendingMessage = {
            type: 'restorePending',
            restore_id: this.restore_id,
            sort: my_has_sort,
            filter: my_has_filter,
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
     * This shares the `restore_id = -1` line with
     * {@link consume_restore_handshake} but is deliberately distinct: this
     * runs in the cancel/forget path and must ALSO clear sort/filter, so
     * the two must not be merged.
     */
    private reset_restored_prefs(): void {
        this.restore_id = -1;
        this.sort = EMPTY_SORT;
        this.permutation = null;
        this.filter = EMPTY_FILTER;
        this.filtered_indices = null;
    }

    /**
     * Consume the restore handshake because the user has superseded the
     * restored prefs (a new sort/filter). A later cancelRestore carrying
     * the old id then no longer reaches handle_cancel_restore's late
     * clear-and-forget branch, so it cannot wipe what the user applied.
     * Only a cancel that genuinely raced completion (no user change since)
     * still finds a matching id.
     */
    private consume_restore_handshake(): void {
        this.restore_id = -1;
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
        this.row_cache.clear();
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
                    this.row_cache.clear();
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
                await this.column_width_store.set(
                    this.dataset_key,
                    msg.widths,
                    this.dataset_key_aliases
                );
                break;
            case 'columnVisibilityChanged':
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
                await this.handle_set_sort(msg);
                break;
            case 'setFilters':
                await this.handle_set_filters(msg);
                break;
            case 'requestHistogram':
                await this.handle_request_histogram(msg);
                break;
            case 'cancelRestore':
                await this.handle_cancel_restore(msg);
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
        // Ignore sort commands while a saved-preference restore is in
        // flight: bumping generation here would make the restore discard
        // its result without posting metadata, stranding the panel. The
        // restore posts authoritative metadata momentarily; the user can
        // re-sort then. (During the initial restore there is no grid to
        // sort from; this guards the refresh-with-visible-grid case.)
        if (this.restoring) return;

        // The user is superseding the restored prefs, so the restore
        // handshake is over.
        this.consume_restore_handshake();

        // Bump the generation so any row request that is already
        // in-flight under the previous permutation is dropped instead of
        // posting stale rows after this sort lands, and so that a later
        // setSort supersedes an earlier (slower) one rather than racing.
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

        let my_permutation: Uint32Array | null = null;
        try {
            my_permutation =
                await this.compute_sort_permutation(my_sort);
        } catch {
            my_permutation = null;
        }

        // Drop stale results after a refresh
        if (my_generation !== this.generation) return;

        this.sort = my_sort;
        this.permutation = my_permutation;
        this.recompute_effective();
        this.row_cache.clear();

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
        signal?: AbortSignal
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
                    my_stored, signal
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
     * Read one full column as raw cells (length === nobs).
     *
     * When `signal` is provided, the read is chunked and cancellable:
     * aborting rejects with an `AbortError`. This is what makes a saved-
     * preference restore interruptible; the viewport reads pass no signal
     * and keep the single-shot fast path.
     */
    private async read_full_column(
        col_index: number,
        signal?: AbortSignal
    ): Promise<RowCell[]> {
        if (!this.dta_file) return [];
        const the_rows = await this.dta_file.read_rows(
            0,
            this.dta_file.nobs,
            col_index,
            col_index + 1,
            signal ? { signal } : undefined
        );
        return the_rows.map(my_row => my_row[0]);
    }

    /**
     * Build the sort permutation for a sort state, reading each
     * sort-key column once. Returns null for an empty or out-of-range
     * sort. The caller is responsible for re-checking `generation`
     * after the await, since column reads are asynchronous.
     */
    private async compute_sort_permutation(
        sort: SortState,
        signal?: AbortSignal
    ): Promise<Uint32Array | null> {
        if (!this.dta_file || sort.keys.length === 0) {
            return null;
        }
        const my_nvar = this.dta_file.nvar;
        for (const my_key of sort.keys) {
            if (
                my_key.col_index < 0
                || my_key.col_index >= my_nvar
            ) {
                return null;
            }
        }

        const the_columns: SortColumn[] = [];
        const the_directions: (1 | -1)[] = [];
        for (const my_key of sort.keys) {
            const my_var =
                this.dta_file.variables[my_key.col_index];
            const my_has_value_labels =
                my_var.value_label_name !== ''
                && this.dta_file.value_label_tables.has(
                    my_var.value_label_name
                );
            const my_kind = classify_sort_kind({
                type: my_var.type,
                format: my_var.format,
                has_value_labels: my_has_value_labels,
            });
            const my_values = await this.read_full_column(
                my_key.col_index,
                signal
            );
            // A refresh during the await nulls dta_file; bail so the
            // caller's generation check discards this stale result.
            if (!this.dta_file) return null;
            const my_table =
                this.dta_file.value_label_tables.get(
                    my_var.value_label_name
                );
            the_columns.push(
                build_sort_column(
                    my_values,
                    my_kind,
                    my_table,
                    sort.labels_on_when_sorted
                )
            );
            the_directions.push(
                my_key.direction === 'desc' ? -1 : 1
            );
        }
        return compute_permutation(
            the_columns,
            the_directions,
            this.dta_file.nobs
        );
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
        // Ignore filter commands while a saved-preference restore is in
        // flight (see handle_set_sort): a generation bump here would
        // strand the restore with no metadata posted.
        if (this.restoring) return;

        // The user is superseding the restored prefs, so the restore
        // handshake is over (see handle_set_sort).
        this.consume_restore_handshake();

        // Bump the generation so an in-flight row request under the old
        // effective permutation is dropped rather than posting stale rows
        // after this filter lands, and so a later setFilters supersedes an
        // earlier (slower) one.
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

        let my_indices: Uint32Array | null = null;
        try {
            my_indices = await this.compute_filter_indices(my_filter);
        } catch {
            my_indices = null;
        }

        // Drop stale results after a refresh or a superseding filter.
        if (my_generation !== this.generation) return;

        this.filter = my_filter;
        this.filtered_indices = my_indices;
        this.recompute_effective();
        this.row_cache.clear();

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
        signal?: AbortSignal
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
        const the_kept_entries = my_stored.entries.filter(my_entry => {
            const my_var =
                this.dta_file!.variables[my_entry.col_index];
            return my_var !== undefined
                && this.predicate_fits_column(
                    my_entry.predicate,
                    my_var
                );
        });
        if (the_kept_entries.length === 0) return false;
        const my_filter: FilterState = {
            entries: the_kept_entries,
            labels_on_when_filtered: my_stored.labels_on_when_filtered,
        };

        const my_generation = this.generation;
        let my_indices: Uint32Array | null = null;
        try {
            my_indices = await this.compute_filter_indices(
                my_filter, signal
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
        variable: VariableInfo
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

    /**
     * Compute the surviving original-row indices for a filter, reading
     * each referenced (enabled) column once. Returns null when no entry is
     * enabled or any enabled column is out of range — the caller treats
     * null as "no filtering". The caller must re-check `generation` after
     * the await, since column reads are asynchronous.
     */
    private async compute_filter_indices(
        filter: FilterState,
        signal?: AbortSignal
    ): Promise<Uint32Array | null> {
        if (!this.dta_file) return null;
        const the_active = filter.entries.filter(
            my_entry => my_entry.enabled
        );
        if (the_active.length === 0) return null;

        const my_nvar = this.dta_file.nvar;
        const the_needed = new Set<number>();
        for (const my_entry of the_active) {
            if (
                my_entry.col_index < 0
                || my_entry.col_index >= my_nvar
            ) {
                return null;
            }
            the_needed.add(my_entry.col_index);
        }

        const the_columns = new Map<number, FilterColumn>();
        for (const my_col_index of the_needed) {
            const my_values = await this.read_full_column(
                my_col_index,
                signal
            );
            // A refresh during the await nulls dta_file; bail so the
            // caller's generation check discards this stale result.
            if (!this.dta_file) return null;
            const my_var =
                this.dta_file.variables[my_col_index];
            the_columns.set(my_col_index, {
                values: my_values,
                is_timestamp: is_timestamp_format(my_var.format),
            });
        }

        return compute_filtered_indices(
            the_columns,
            filter,
            this.dta_file.nobs
        ) ?? null;
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
            let the_values: RowCell[];
            try {
                the_values = await this.read_full_column(
                    my_col_index
                );
            } catch {
                post_empty();
                return;
            }
            if (this.dta_file !== my_file || !this.dta_file) {
                return;
            }
            const the_numbers: number[] = [];
            for (const my_value of the_values) {
                // Missing cells are MissingValue objects; only finite
                // doubles enter the brush distribution.
                if (typeof my_value === 'number') {
                    the_numbers.push(my_value);
                }
            }
            my_bins = compute_histogram(the_numbers);
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
        if (!this.dta_file) return;

        // Check cache first. Cached pages already reflect the active
        // permutation (the cache is cleared whenever sort changes).
        const my_cached = this.row_cache.get_page(
            request.start
        );
        if (my_cached) {
            const my_response: RowResponse = {
                type: 'rowData',
                start: request.start,
                rows: this.format_rows(
                    my_cached,
                    request.col_start
                ),
                request_id: request.request_id,
            };
            this.panel.webview.postMessage(my_response);
            return;
        }

        // Cache miss — read from the .dta file
        const my_generation = this.generation;
        let the_raw_rows: Row[];

        if (this.effective_perm) {
            // Map the visible window to original rows (display order)
            // and read them, batching ascending-contiguous runs. The
            // effective permutation already folds in any active filter.
            const the_indices = permuted_window_indices(
                this.effective_perm,
                request.start,
                request.count,
                this.effective_nobs()
            );
            the_raw_rows = new Array(the_indices.length);
            let my_pos = 0;
            for (
                const my_run of group_contiguous_runs(the_indices)
            ) {
                const my_chunk = await this.dta_file.read_rows(
                    my_run.start,
                    my_run.len,
                    request.col_start,
                    request.col_end
                );
                if (my_generation !== this.generation) return;
                for (let j = 0; j < my_chunk.length; j++) {
                    the_raw_rows[my_pos++] = my_chunk[j];
                }
            }
        } else {
            the_raw_rows = await this.dta_file.read_rows(
                request.start,
                request.count,
                request.col_start,
                request.col_end
            );
            // Drop stale responses after a refresh
            if (my_generation !== this.generation) return;
        }

        // Cache the (display-order) raw rows for future requests
        this.row_cache.set_page(request.start, the_raw_rows);

        const my_response: RowResponse = {
            type: 'rowData',
            start: request.start,
            col_start: request.col_start,
            rows: this.format_rows(
                the_raw_rows,
                request.col_start
            ),
            request_id: request.request_id,
        };

        this.panel.webview.postMessage(my_response);
    }

    private async handle_copy_column(
        col_index: number,
        show_labels: boolean,
        show_formats: boolean
    ): Promise<void> {
        if (!this.dta_file) return;

        const my_variable =
            this.dta_file.variables[col_index];
        if (!my_variable) return;

        const my_generation = this.generation;
        const the_values: string[] = [my_variable.name];
        const my_nobs = this.dta_file.nobs;

        const display_for = (raw: RowCell): string => {
            const my_cell = this.format_cell(raw, my_variable);
            if (my_cell.missing_type) {
                return (show_labels && my_cell.label_display)
                    ? my_cell.label_display
                    : my_cell.missing_type;
            }
            if (show_labels && my_cell.label_display) {
                return my_cell.label_display;
            }
            return show_formats
                ? my_cell.formatted_display
                : my_cell.raw_display;
        };

        if (this.effective_perm) {
            // Copy in display (filtered + sorted) order so the clipboard
            // matches what the user sees.
            const the_column = await this.read_full_column(
                col_index
            );
            if (my_generation !== this.generation) return;
            for (let i = 0; i < this.effective_perm.length; i++) {
                the_values.push(
                    display_for(the_column[this.effective_perm[i]])
                );
            }
        } else {
            for (
                let my_offset = 0;
                my_offset < my_nobs;
                my_offset += PAGE_SIZE
            ) {
                const my_count = Math.min(
                    PAGE_SIZE,
                    my_nobs - my_offset
                );
                const the_raw_rows =
                    await this.dta_file.read_rows(
                        my_offset,
                        my_count,
                        col_index,
                        col_index + 1
                    );

                if (my_generation !== this.generation) return;

                for (const my_row of the_raw_rows) {
                    the_values.push(display_for(my_row[0]));
                }
            }
        }

        await vscode.env.clipboard.writeText(
            the_values.join('\n')
        );
    }

    // -------------------------------------------------------
    // Cell formatting
    // -------------------------------------------------------

    private format_rows(
        raw_rows: Row[],
        col_start?: number
    ): CellValue[][] {
        const my_col_offset = col_start ?? 0;

        return raw_rows.map((my_row: Row) =>
            my_row.map((my_raw: RowCell, my_idx: number) => {
                const my_var = this.dta_file!.variables[
                    my_col_offset + my_idx
                ];
                return this.format_cell(my_raw, my_var);
            })
        );
    }

    private format_cell(
        raw: Row[number],
        variable: {
            type: string;
            format: string;
            value_label_name: string;
        }
    ): CellValue {
        return build_cell_value(
            raw,
            variable,
            this.dta_file?.value_label_tables
                .get(variable.value_label_name)
        );
    }
}
