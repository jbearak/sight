/**
 * Data Browser Module
 *
 * Entry point for the data browser feature.  Registers the
 * panel manager, signal watcher, and auto-installs the
 * vview.ado helper into the user's personal ado directory.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DataBrowserPanelManager } from './panel-manager';
import {
    BROWSE_DIR,
    prune_stale_browse_files,
    SignalWatcher,
} from './signal-watcher';

export function register_data_browser(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_manager = new DataBrowserPanelManager(
        context.extensionUri
    );
    context.subscriptions.push(my_manager);

    try {
        fs.mkdirSync(BROWSE_DIR, { recursive: true });
    } catch {
        // The watcher/install flow logs its own failures.
    }
    prune_stale_browse_files();

    const my_watcher = new SignalWatcher(
        (sidecar) => my_manager.open_or_refresh(sidecar),
        log
    );
    my_watcher.start();

    context.subscriptions.push({
        dispose: () => my_watcher.stop(),
    });

    install_vview_ado(context, log);
}

// -----------------------------------------------------------
// vview.ado auto-installation
// -----------------------------------------------------------

function install_vview_ado(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_target_dir = get_personal_ado_dir();
    const my_target_path = path.join(
        my_target_dir,
        'vview.ado'
    );

    const my_bundled_uri = vscode.Uri.joinPath(
        context.extensionUri,
        'stata',
        'vview.ado'
    );
    const my_bundled_path = my_bundled_uri.fsPath;

    let my_bundled_content: string;
    try {
        my_bundled_content = fs.readFileSync(
            my_bundled_path,
            'utf-8'
        );
    } catch (my_err) {
        log(
            'vview.ado: failed to read bundled file: '
            + String(my_err)
        );
        return;
    }

    // Check whether the target already exists and matches
    let my_needs_write = true;
    try {
        const my_existing = fs.readFileSync(
            my_target_path,
            'utf-8'
        );
        if (my_existing === my_bundled_content) {
            my_needs_write = false;
        }
    } catch {
        // File does not exist — needs write
    }

    if (!my_needs_write) {
        log('vview.ado: already up to date');
        return;
    }

    try {
        fs.mkdirSync(my_target_dir, { recursive: true });
        fs.writeFileSync(my_target_path, my_bundled_content);
        log('vview.ado: installed to ' + my_target_path);
    } catch (my_err) {
        log(
            'vview.ado: failed to install: '
            + String(my_err)
        );
    }
}

// -----------------------------------------------------------
// Personal ado directory resolution
// -----------------------------------------------------------

function get_personal_ado_dir(): string {
    const my_config = vscode.workspace.getConfiguration(
        'sight'
    );
    const my_custom = my_config.get<string>(
        'personalAdoDir',
        ''
    );
    if (my_custom) {
        return my_custom;
    }

    const my_home = os.homedir();

    switch (process.platform) {
        case 'darwin':
            return path.join(
                my_home,
                'Documents',
                'Stata',
                'ado',
                'personal'
            );
        case 'win32':
            return path.join(
                my_home,
                'ado',
                'personal'
            );
        default:
            // Linux and other Unix-like
            return path.join(
                my_home,
                'ado',
                'personal'
            );
    }
}
