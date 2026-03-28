/**
 * Data Browser Module
 *
 * Entry point for the data browser feature.  Registers the
 * panel manager, signal watcher, and manages installation of
 * the vview.ado helper into the user's personal ado directory.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { create_column_width_store } from './column-width-state';
import { create_column_visibility_store } from './column-visibility-state';
import { register_data_browser_custom_editor } from './custom-editor';
import { DataBrowserPanelManager } from './panel-manager';
import {
    BROWSE_DIR,
    prune_stale_browse_files,
    SignalWatcher,
} from './signal-watcher';
import {
    ensure_vview_ado_installed as ensure_vview_ado_installed_core,
    get_vview_install_state as get_vview_install_state_core,
    install_vview_ado as install_vview_ado_core,
    install_vview_ado_manually as install_vview_ado_manually_core,
    reset_vview_install_permission as reset_vview_install_permission_core,
    type VviewInstallHooks as CoreVviewInstallHooks,
    type VviewInstallPermission,
    type VviewInstallPromptChoice,
    type VviewInstallState,
    type VviewInstallStatus,
} from './vview-install-core';

const VVIEW_INSTALL_PERMISSION_KEY =
    'sight.vviewInstallPermission';
const INSTALL_BUTTON = 'Install';
const NOT_NOW_BUTTON = 'Not now';
const VVIEW_INSTALL_PROMPT_DELAY_MS = 1500;

export type VviewInstallHooks =
    CoreVviewInstallHooks<vscode.ExtensionContext>;

export function register_data_browser(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_column_width_store =
        create_column_width_store(context);
    const my_column_visibility_store =
        create_column_visibility_store(context);
    const my_manager = new DataBrowserPanelManager(
        context.extensionUri,
        my_column_width_store,
        my_column_visibility_store
    );
    context.subscriptions.push(my_manager);
    register_open_data_browser_command(
        context,
        my_manager
    );
    register_data_browser_custom_editor(
        context,
        my_column_width_store,
        my_column_visibility_store
    );

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

    register_vview_install_commands(context, log);
    schedule_vview_install_check(context, log);
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

function register_vview_install_commands(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.installVviewAdo',
            async () => {
                const my_installed =
                    await install_vview_ado_manually(
                        context,
                        log
                    );
                if (my_installed) {
                    void vscode.window.showInformationMessage(
                        'vview.ado is installed and ready for Sight Data Browser.'
                    );
                    return;
                }

                void vscode.window.showErrorMessage(
                    'Failed to install vview.ado. See the Sight output channel for details.'
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.resetVviewInstallPermission',
            async () => {
                await reset_vview_install_permission(
                    context,
                    log
                );
                void vscode.window.showInformationMessage(
                    'Sight vview.ado install permission has been reset.'
                );
            }
        )
    );
}

function schedule_vview_install_check(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_timeout = setTimeout(() => {
        void ensure_vview_ado_installed(context, log);
    }, VVIEW_INSTALL_PROMPT_DELAY_MS);

    context.subscriptions.push({
        dispose: () => clearTimeout(my_timeout),
    });
}

// -----------------------------------------------------------
// vview.ado installation
// -----------------------------------------------------------

function get_bundled_vview_path(
    context: vscode.ExtensionContext
): string {
    const the_candidate_paths = [
        vscode.Uri.joinPath(
            context.extensionUri,
            'stata',
            'vview.ado'
        ).fsPath,
        path.resolve(
            context.extensionUri.fsPath,
            '..',
            'stata',
            'vview.ado'
        ),
    ];

    for (const my_candidate_path of the_candidate_paths) {
        if (fs.existsSync(my_candidate_path)) {
            return my_candidate_path;
        }
    }

    return the_candidate_paths[0];
}

export function read_bundled_vview_content(
    bundled_path: string,
    log: (msg: string) => void
): string | null {
    try {
        return fs.readFileSync(
            bundled_path,
            'utf-8'
        );
    } catch (my_err) {
        log(
            'vview.ado: failed to read bundled file: '
            + String(my_err)
        );
        return null;
    }
}

export function get_vview_install_state(
    target_path: string,
    bundled_content: string,
    log: (msg: string) => void
): VviewInstallState {
    return get_vview_install_state_core(
        target_path,
        bundled_content,
        log
    );
}

function inspect_vview_installation(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): VviewInstallStatus {
    const my_target_dir = get_personal_ado_dir();
    const my_target_path = path.join(
        my_target_dir,
        'vview.ado'
    );
    const my_bundled_path = get_bundled_vview_path(context);
    const my_bundled_content = read_bundled_vview_content(
        my_bundled_path,
        log
    );

    if (my_bundled_content === null) {
        return {
            state: 'error',
            target_dir: my_target_dir,
            target_path: my_target_path,
            bundled_path: my_bundled_path,
            error: 'Failed to read bundled vview.ado',
        };
    }

    return {
        state: get_vview_install_state(
            my_target_path,
            my_bundled_content,
            log
        ),
        target_dir: my_target_dir,
        target_path: my_target_path,
        bundled_path: my_bundled_path,
        bundled_content: my_bundled_content,
    };
}

async function set_vview_install_permission(
    context: vscode.ExtensionContext,
    permission: VviewInstallPermission | undefined
): Promise<void> {
    await context.globalState.update(
        VVIEW_INSTALL_PERMISSION_KEY,
        permission
    );
}

export async function prompt_for_vview_install(
    target_dir: string
): Promise<VviewInstallPromptChoice> {
    const my_result =
        await vscode.window.showInformationMessage(
            'Would you like to add "vview.ado" to Stata?\n\n'
            + 'This works like "browse", but with VS Code.\n\n'
            + `Install location: ${target_dir}`,
            INSTALL_BUTTON,
            NOT_NOW_BUTTON
        );

    return my_result === INSTALL_BUTTON
        ? 'install'
        : my_result === NOT_NOW_BUTTON
        ? 'not_now'
        : 'dismissed';
}

export function install_vview_ado(
    status: VviewInstallStatus,
    log: (msg: string) => void
): boolean {
    return install_vview_ado_core(status, log);
}

export async function ensure_vview_ado_installed(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: VviewInstallHooks = {}
): Promise<boolean> {
    return ensure_vview_ado_installed_core(
        context,
        log,
        VVIEW_INSTALL_PERMISSION_KEY,
        {
            inspect_installation:
                hooks.inspect_installation
                ?? inspect_vview_installation,
            get_permission: hooks.get_permission,
            set_permission:
                hooks.set_permission
                ?? set_vview_install_permission,
            prompt_for_vview_install:
                hooks.prompt_for_vview_install
                ?? prompt_for_vview_install,
            install_vview_ado:
                hooks.install_vview_ado
                ?? install_vview_ado,
        }
    );
}

export async function install_vview_ado_manually(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: VviewInstallHooks = {}
): Promise<boolean> {
    return install_vview_ado_manually_core(
        context,
        log,
        VVIEW_INSTALL_PERMISSION_KEY,
        {
            inspect_installation:
                hooks.inspect_installation
                ?? inspect_vview_installation,
            set_permission:
                hooks.set_permission
                ?? set_vview_install_permission,
            install_vview_ado:
                hooks.install_vview_ado
                ?? install_vview_ado,
        }
    );
}

export async function reset_vview_install_permission(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: Pick<VviewInstallHooks, 'set_permission'> = {}
): Promise<void> {
    await reset_vview_install_permission_core(
        context,
        log,
        VVIEW_INSTALL_PERMISSION_KEY,
        {
            set_permission:
                hooks.set_permission
                ?? set_vview_install_permission,
        }
    );
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
        return my_custom.replace(
            /^~(?=\/|$)/,
            os.homedir()
        );
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
