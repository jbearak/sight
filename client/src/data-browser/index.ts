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
import { register_data_browser_custom_editor } from './custom-editor';
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
    register_open_data_browser_command(
        context,
        my_manager
    );
    register_data_browser_custom_editor(context);

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

async function resolve_data_browser_uri(
    arg: unknown
): Promise<vscode.Uri | undefined> {
    if (arg instanceof vscode.Uri) {
        return arg;
    }

    const my_active_uri = vscode.window.activeTextEditor
        ?.document.uri;
    if (
        my_active_uri
        && my_active_uri.scheme === 'file'
        && my_active_uri.fsPath.toLowerCase().endsWith('.dta')
    ) {
        return my_active_uri;
    }

    const the_picks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'Stata Datasets': ['dta'],
        },
        openLabel: 'Open in Sight Data Browser',
    });

    return the_picks?.[0];
}

function register_open_data_browser_command(
    context: vscode.ExtensionContext,
    manager: DataBrowserPanelManager
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openDataBrowser',
            async (arg: unknown) => {
                const my_uri = await resolve_data_browser_uri(
                    arg
                );
                if (!my_uri) {
                    return;
                }

                if (
                    my_uri.scheme !== 'file'
                    || !my_uri.fsPath.toLowerCase().endsWith('.dta')
                ) {
                    vscode.window.showErrorMessage(
                        'Sight Data Browser only supports local .dta files.'
                    );
                    return;
                }

                await manager.open_dataset_path(
                    my_uri.fsPath
                );
            }
        )
    );
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
