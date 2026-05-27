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
import { build_cell_value } from './cell-format';
import {
    build_sort_column,
    classify_sort_kind,
    compute_permutation,
    type SortColumn,
} from './sort';
import {
    group_contiguous_runs,
    permuted_window_indices,
} from './permuted-rows';
import {
    build_dataset_key,
    build_dataset_key_aliases,
    type DataBrowserColumnWidthStore,
} from './column-width-state';
import type {
    DataBrowserColumnVisibilityStore,
} from './column-visibility-state';
import type { DataBrowserSortStateStore } from './sort-state';
import { should_unlink_data_browser_path } from './opening';
import { RowCache } from './row-cache';
import { schema_hash } from './schema-hash';
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
} from './types';
import { EMPTY_SORT } from './types';

const PAGE_SIZE = 200;
const MAX_CACHED_PAGES = 10;

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
    private disposed = false;
    private generation = 0;
    private sort: SortState = EMPTY_SORT;
    private permutation: Uint32Array | null = null;
    private sort_restored = false;

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string,
        column_width_store: DataBrowserColumnWidthStore,
        column_visibility_store: DataBrowserColumnVisibilityStore,
        sort_state_store: DataBrowserSortStateStore
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

    private async send_metadata(): Promise<void> {
        if (!this.dta_file) return;

        try {
            const my_missing_style =
                vscode.workspace
                    .getConfiguration('sight.dataBrowser')
                    .get<MissingValueStyle>(
                        'missingValueStyle',
                        'foreground'
                    );

            const my_variables = this.dta_file.variables.map(
                (my_v: VariableInfo) => ({
                    name: my_v.name,
                    type: my_v.type,
                    format: my_v.format,
                    label: my_v.label,
                    has_value_labels:
                        my_v.value_label_name !== ''
                        && this.dta_file!
                            .value_label_tables.has(
                                my_v.value_label_name
                            ),
                })
            );

            const my_schema_hash = schema_hash(my_variables);
            await this.maybe_restore_sort(my_schema_hash);
            if (!this.dta_file) return;

            const my_metadata: MetadataMessage = {
                type: 'metadata',
                nobs: this.dta_file.nobs,
                missing_value_style: my_missing_style,
                variables: my_variables,
                schema_hash: my_schema_hash,
                stored_sort: this.sort.keys.length > 0
                    ? this.sort
                    : undefined,
                dataset_label: this.dta_file.dataset_label,
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
                source: this.sidecar.source,
                subsetted: this.sidecar.subsetted,
                varlist: this.sidecar.varlist,
                if_condition: this.sidecar.if,
                in_condition: this.sidecar.in,
            };

            this.panel.webview.postMessage(my_metadata);
        } catch (my_err) {
            vscode.window.showErrorMessage(
                `Failed to open .dta file: ${my_err}`
            );
        }
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
     */
    private async maybe_restore_sort(
        schema_hash_value: string
    ): Promise<void> {
        if (this.sort_restored) return;
        this.sort_restored = true;
        if (!this.dta_file || !this.persist_sort_enabled()) return;

        const my_stored = this.sort_state_store.get(
            this.dataset_key,
            schema_hash_value
        );
        if (!my_stored) return;

        const my_generation = this.generation;
        let my_permutation: Uint32Array | null = null;
        try {
            my_permutation =
                await this.compute_sort_permutation(my_stored);
        } catch {
            my_permutation = null;
        }
        if (my_generation !== this.generation) return;
        if (my_permutation) {
            this.sort = my_stored;
            this.permutation = my_permutation;
        }
    }

    /** Read one full column as raw cells (length === nobs). */
    private async read_full_column(
        col_index: number
    ): Promise<RowCell[]> {
        if (!this.dta_file) return [];
        const the_rows = await this.dta_file.read_rows(
            0,
            this.dta_file.nobs,
            col_index,
            col_index + 1
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
        sort: SortState
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
                my_key.col_index
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
            nobs_effective: this.dta_file?.nobs ?? 0,
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

        if (this.permutation) {
            // Map the visible window to original rows (display order)
            // and read them, batching ascending-contiguous runs.
            const the_indices = permuted_window_indices(
                this.permutation,
                request.start,
                request.count,
                this.dta_file.nobs
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

        if (this.permutation) {
            // Copy in display (sorted/filtered) order so the clipboard
            // matches what the user sees.
            const the_column = await this.read_full_column(
                col_index
            );
            if (my_generation !== this.generation) return;
            for (let i = 0; i < this.permutation.length; i++) {
                the_values.push(
                    display_for(the_column[this.permutation[i]])
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

        return raw_rows.map(my_row =>
            my_row.map((my_raw, my_idx) => {
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
