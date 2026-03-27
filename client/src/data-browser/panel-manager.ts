/**
 * Data Browser Panel Manager
 *
 * Manages the lifecycle of open data browser panels.
 * Ensures one panel per dataset name, handles
 * replace-or-create logic, and cleans up on dispose.
 */

import * as vscode from 'vscode';
import { DataBrowserPanel } from './browser-panel';
import {
    build_data_browser_html,
    generate_nonce,
} from './webview-html';
import type { VviewSidecar } from './types';

const VIEW_TYPE = 'sightDataBrowser';

export class DataBrowserPanelManager
    implements vscode.Disposable {

    private panels = new Map<string, DataBrowserPanel>();

    async open_or_refresh(
        sidecar: VviewSidecar
    ): Promise<void> {
        const my_key = sidecar.name;
        const my_existing = this.panels.get(my_key);

        if (sidecar.replace && my_existing) {
            await my_existing.refresh(
                sidecar,
                sidecar.dtapath
            );
            my_existing.reveal(vscode.ViewColumn.Active);
            return;
        }

        const my_nonce = generate_nonce();
        const my_html = build_data_browser_html(my_nonce);

        const my_webview_panel =
            vscode.window.createWebviewPanel(
                VIEW_TYPE,
                `Data: ${sidecar.name}`,
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                }
            );

        const my_panel = new DataBrowserPanel(
            my_webview_panel,
            sidecar,
            sidecar.dtapath,
            my_html
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
