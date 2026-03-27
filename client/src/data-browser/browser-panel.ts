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
    apply_display_format,
    type VariableInfo,
} from '../../../src/dta-parser';
import { RowCache } from './row-cache';
import type {
    WebviewMessage,
    RowResponse,
    MetadataMessage,
    CellValue,
    VviewSidecar,
} from './types';

const PAGE_SIZE = 200;

export class DataBrowserPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private dta_file: DtaFile | null = null;
    private row_cache = new RowCache(10, PAGE_SIZE);
    private disposables: vscode.Disposable[] = [];
    private sidecar: VviewSidecar;
    private dta_path: string;
    private disposed = false;

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string
    ) {
        this.panel = panel;
        this.sidecar = sidecar;
        this.dta_path = dta_path;

        panel.webview.html = webview_html;

        this.disposables.push(
            panel.webview.onDidReceiveMessage(
                (msg: WebviewMessage) => this.handle_message(msg)
            )
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
        this.dta_file?.close();
        this.dta_file = null;
        this.row_cache.clear();

        this.sidecar = sidecar;
        this.dta_path = dta_path;

        await this.initialize();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.dta_file?.close();
        this.dta_file = null;

        // On Windows the temp .dta file must be deleted
        // explicitly because unlinking an open file is not
        // supported.  On other platforms the file was already
        // unlinked in initialize().
        if (process.platform === 'win32') {
            try {
                fs.unlinkSync(this.dta_path);
            } catch {
                /* file may already be gone */
            }
        }

        for (const my_d of this.disposables) {
            my_d.dispose();
        }
        this.panel.dispose();
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
            if (process.platform !== 'win32') {
                try {
                    fs.unlinkSync(this.dta_path);
                } catch {
                    /* file may already be gone */
                }
            }

            const my_metadata: MetadataMessage = {
                type: 'metadata',
                nobs: this.dta_file.nobs,
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
                await this.initialize();
                break;
            case 'requestRows':
                await this.handle_row_request(msg);
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
        const the_raw_rows = await this.dta_file.read_rows(
            request.start,
            request.count,
            request.col_start,
            request.col_end
        );

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

    // -------------------------------------------------------
    // Cell formatting
    // -------------------------------------------------------

    private format_rows(
        raw_rows: (number | string | null)[][],
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
        raw: number | string | null,
        variable: {
            type: string;
            format: string;
            value_label_name: string;
        }
    ): CellValue {
        // Null means missing — read_rows returns null for
        // all missing values (system and extended).
        if (raw === null) {
            return {
                raw: null,
                display: '.',
                missing_type: '.',
            };
        }

        // Check for value labels
        if (
            typeof raw === 'number'
            && variable.value_label_name
            && this.dta_file
        ) {
            const my_table =
                this.dta_file.value_label_tables.get(
                    variable.value_label_name
                );
            if (my_table) {
                const my_label = my_table.get(raw);
                if (my_label !== undefined) {
                    return { raw, display: my_label };
                }
            }
        }

        // Apply the variable's display format
        const my_formatted = apply_display_format(
            raw,
            variable.format
        );
        return {
            raw,
            display: my_formatted ?? String(raw),
        };
    }
}
