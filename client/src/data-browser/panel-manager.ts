/**
 * Data Browser Panel Manager
 *
 * Manages the lifecycle of open data browser panels.
 * Ensures one panel per dataset name, handles
 * replace-or-create logic, and cleans up on dispose.
 */

import * as vscode from 'vscode';
import { DataBrowserPanel } from './browser-panel.js';
import type { DataBrowserColumnWidthStore } from './column-width-state.js';
import type { DataBrowserColumnVisibilityStore } from './column-visibility-state.js';
import type { DataBrowserSortStateStore } from './sort-state.js';
import type { DataBrowserFilterStateStore } from './filter-state.js';
import {
    build_direct_open_sidecar,
    DATA_BROWSER_PANEL_VIEW_TYPE,
    expand_home_path,
} from './opening.js';
import {
    build_data_browser_html,
    generate_nonce,
} from './webview-html.js';
import type { VviewSidecar } from './types.js';
import { applyViewerTabIcon } from '../viewer-tab-icon.js';

export class DataBrowserPanelManager
    implements vscode.Disposable {

    private panels = new Map<string, DataBrowserPanel>();
    constructor(
        private readonly extension_uri: vscode.Uri,
        private readonly column_width_store: DataBrowserColumnWidthStore,
        private readonly column_visibility_store: DataBrowserColumnVisibilityStore,
        private readonly sort_state_store: DataBrowserSortStateStore,
        private readonly filter_state_store: DataBrowserFilterStateStore
    ) {}

    async open_or_refresh(
        sidecar: VviewSidecar
    ): Promise<void> {
        const my_dta_path = expand_home_path(
            sidecar.dtapath
        );
        const my_key = `signal:${sidecar.name}`;
        const my_existing = this.panels.get(my_key);

        if (sidecar.replace && my_existing) {
            await my_existing.refresh(
                sidecar,
                my_dta_path
            );
            my_existing.reveal(vscode.ViewColumn.Active);
            return;
        }

        const my_webview_panel =
            vscode.window.createWebviewPanel(
                DATA_BROWSER_PANEL_VIEW_TYPE,
                sidecar.name,
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(
                            this.extension_uri,
                            'dist',
                            'data-browser-webview'
                        ),
                    ],
                }
            );
        applyViewerTabIcon(my_webview_panel, 'table');

        const my_nonce = generate_nonce();
        const my_html = build_data_browser_html(
            my_webview_panel.webview,
            this.extension_uri,
            my_nonce
        );

        const my_panel = new DataBrowserPanel(
            my_webview_panel,
            sidecar,
            my_dta_path,
            my_html,
            this.column_width_store,
            this.column_visibility_store,
            this.sort_state_store,
            this.filter_state_store
        );

        my_panel.on_did_dispose(() => {
            this.panels.delete(my_key);
        });

        this.panels.set(my_key, my_panel);
    }

    async open_dataset_path(
        dta_path: string,
        column: vscode.ViewColumn = vscode.ViewColumn.Active
    ): Promise<void> {
        const my_sidecar = build_direct_open_sidecar(
            dta_path
        );
        const my_key = `path:${dta_path}`;
        const my_existing = this.panels.get(my_key);

        if (my_existing) {
            await my_existing.refresh(
                my_sidecar,
                dta_path
            );
            my_existing.reveal(column);
            return;
        }

        const my_webview_panel =
            vscode.window.createWebviewPanel(
                DATA_BROWSER_PANEL_VIEW_TYPE,
                my_sidecar.name,
                column,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(
                            this.extension_uri,
                            'dist',
                            'data-browser-webview'
                        ),
                    ],
                }
            );
        applyViewerTabIcon(my_webview_panel, 'table');

        const my_nonce = generate_nonce();
        const my_html = build_data_browser_html(
            my_webview_panel.webview,
            this.extension_uri,
            my_nonce
        );
        const my_panel = new DataBrowserPanel(
            my_webview_panel,
            my_sidecar,
            dta_path,
            my_html,
            this.column_width_store,
            this.column_visibility_store,
            this.sort_state_store,
            this.filter_state_store
        );

        my_panel.on_did_dispose(() => {
            this.panels.delete(my_key);
        });

        this.panels.set(my_key, my_panel);
    }

    dispose(): void {
        for (const my_panel of this.panels.values()) {
            my_panel.dispose();
        }
        this.panels.clear();
    }
}
