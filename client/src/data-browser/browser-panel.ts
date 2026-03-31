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
    DtaFile,
    type VariableInfo,
    type Row,
} from '../../../src/dta-parser';
import { build_cell_value } from './cell-format';
import {
    build_dataset_key,
    build_dataset_key_aliases,
    type DataBrowserColumnWidthStore,
} from './column-width-state';
import type {
    DataBrowserColumnVisibilityStore,
} from './column-visibility-state';
import { should_unlink_data_browser_path } from './opening';
import { RowCache } from './row-cache';
import type {
    WebviewMessage,
    RowResponse,
    MetadataMessage,
    CellValue,
    VviewSidecar,
    MissingValueStyle,
} from './types';

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
    private disposed = false;
    private generation = 0;

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string,
        column_width_store: DataBrowserColumnWidthStore,
        column_visibility_store: DataBrowserColumnVisibilityStore
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

            const my_metadata: MetadataMessage = {
                type: 'metadata',
                nobs: this.dta_file.nobs,
                missing_value_style: my_missing_style,
                variables: this.dta_file.variables.map(
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
                ),
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
            case 'copyColumn':
                await this.handle_copy_column(
                    msg.col_index,
                    msg.show_labels,
                    msg.show_formats
                );
                break;
        }
    }

    private async handle_row_request(
        request: WebviewMessage & { type: 'requestRows' }
    ): Promise<void> {
        if (!this.dta_file) return;

        // Check cache first
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
        const the_raw_rows = await this.dta_file.read_rows(
            request.start,
            request.count,
            request.col_start,
            request.col_end
        );

        // Drop stale responses after a refresh
        if (my_generation !== this.generation) return;

        // Cache the raw rows for future requests
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
                const my_cell = this.format_cell(
                    my_row[0],
                    my_variable
                );
                let my_display: string;
                if (my_cell.missing_type) {
                    my_display =
                        (show_labels
                            && my_cell.label_display)
                            ? my_cell.label_display
                            : my_cell.missing_type;
                } else if (
                    show_labels
                    && my_cell.label_display
                ) {
                    my_display = my_cell.label_display;
                } else if (show_formats) {
                    my_display =
                        my_cell.formatted_display;
                } else {
                    my_display = my_cell.raw_display;
                }
                the_values.push(my_display);
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
