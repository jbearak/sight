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
import { create_column_width_store } from './column-width-state.js';
import { create_column_visibility_store } from './column-visibility-state.js';
import { create_sort_state_store } from './sort-state.js';
import { create_filter_state_store } from './filter-state.js';
import { register_data_browser_custom_editor } from './custom-editor.js';
import { DataBrowserPanelManager } from './panel-manager.js';
import {
    BROWSE_DIR,
    type ClaimDelayFn,
    prune_stale_browse_files,
    SignalWatcher,
} from './signal-watcher.js';
import {
    ADO_ASSET_DEFS,
    build_install_prompt_message,
    classify_ado_asset,
    aggregate_bundle_state,
    ensure_bundle_installed as ensure_bundle_installed_core,
    install_bundle_manually as install_bundle_manually_core,
    reset_install_permission as reset_install_permission_core,
    uninstall_bundle_and_reset as uninstall_bundle_and_reset_core,
    type AdoAssetStatus,
    type BundleInstallStatus,
    type VviewInstallHooks as CoreVviewInstallHooks,
    type VviewInstallPermission,
    type VviewInstallPromptChoice,
} from './vview-install-core.js';
import { resolve_personal_ado_dir } from './install-path.js';

// Versioned key: the bundle adds a command named after a Stata
// built-in (`browse`), a broader action than the original vview-only
// install, so existing users get one fresh consent decision rather
// than a silently-expanded grant. The old key
// ('sight.vviewInstallPermission') is intentionally not reused.
const STATA_COMMANDS_INSTALL_PERMISSION_KEY =
    'sight.stataCommandsInstallPermission';

const INSTALL_BUTTON = 'Install';
const NOT_NOW_BUTTON = 'Not now';
const VVIEW_INSTALL_PROMPT_DELAY_MS = 1500;
const WORKSPACE_MATCH_DELAY_MS = 300;

export type VviewInstallHooks =
    CoreVviewInstallHooks<vscode.ExtensionContext>;

export function make_claim_delay_fn(
    get_workspace_folders: () =>
        readonly vscode.WorkspaceFolder[] | undefined
): ClaimDelayFn {
    return (sidecar) => {
        if (!sidecar.cwd) {
            return WORKSPACE_MATCH_DELAY_MS;
        }
        const the_folders = get_workspace_folders() ?? [];
        for (const my_folder of the_folders) {
            const my_folder_path = my_folder.uri.fsPath;
            if (
                sidecar.cwd === my_folder_path
                || sidecar.cwd.startsWith(
                    my_folder_path + path.sep
                )
            ) {
                return 0;
            }
        }
        return WORKSPACE_MATCH_DELAY_MS;
    };
}

export function register_data_browser(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_get_max_layouts = () =>
        Math.max(1, vscode.workspace.getConfiguration(
            'sight'
        ).get<number>(
            'dataBrowser.maxStoredLayouts',
            10_000
        ) ?? 10_000);
    const my_column_width_store =
        create_column_width_store(
            context,
            my_get_max_layouts
        );
    const my_column_visibility_store =
        create_column_visibility_store(
            context,
            my_get_max_layouts
        );
    const my_sort_state_store =
        create_sort_state_store(
            context,
            my_get_max_layouts
        );
    const my_filter_state_store =
        create_filter_state_store(
            context,
            my_get_max_layouts
        );
    const my_manager = new DataBrowserPanelManager(
        context.extensionUri,
        my_column_width_store,
        my_column_visibility_store,
        my_sort_state_store,
        my_filter_state_store
    );
    context.subscriptions.push(my_manager);
    register_open_data_browser_command(
        context,
        my_manager
    );
    register_data_browser_custom_editor(
        context,
        my_column_width_store,
        my_column_visibility_store,
        my_sort_state_store,
        my_filter_state_store
    );

    try {
        fs.mkdirSync(BROWSE_DIR, { recursive: true });
    } catch {
        // The watcher/install flow logs its own failures.
    }
    prune_stale_browse_files();

    const my_watcher = new SignalWatcher(
        (sidecar) => my_manager.open_or_refresh(sidecar),
        log,
        undefined,
        make_claim_delay_fn(
            () => vscode.workspace.workspaceFolders
        )
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
                        'Sight\'s Stata commands (vview, browse, and '
                        + 'the browse abbreviations br/bro/brow/brows) '
                        + 'are installed and ready.'
                    );
                    return;
                }

                void vscode.window.showErrorMessage(
                    'Failed to install Sight\'s Stata commands. '
                    + 'See the Sight output channel for details.'
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
                    'Sight Stata commands install permission has been reset.'
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.uninstallStataCommands',
            async () => {
                const my_ok =
                    await uninstall_stata_commands(
                        context,
                        log
                    );
                if (my_ok) {
                    void vscode.window.showInformationMessage(
                        'Sight\'s Stata commands (vview, browse, and '
                        + 'the browse abbreviations br/bro/brow/brows) '
                        + 'were removed (Sight-owned files only).'
                    );
                    return;
                }

                void vscode.window.showErrorMessage(
                    'Some Sight Stata command files could not be '
                    + 'removed. See the Sight output channel for '
                    + 'details.'
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
// Stata commands (vview + browse) installation
// -----------------------------------------------------------

function get_bundled_ado_path(
    context: vscode.ExtensionContext,
    name: string
): string {
    const the_candidate_paths = [
        vscode.Uri.joinPath(
            context.extensionUri,
            'stata',
            name
        ).fsPath,
        path.resolve(
            context.extensionUri.fsPath,
            '..',
            'stata',
            name
        ),
    ];

    for (const my_candidate_path of the_candidate_paths) {
        if (fs.existsSync(my_candidate_path)) {
            return my_candidate_path;
        }
    }

    return the_candidate_paths[0];
}

export function read_bundled_ado_content(
    bundled_path: string,
    name: string,
    log: (msg: string) => void
): string | null {
    try {
        return fs.readFileSync(
            bundled_path,
            'utf-8'
        );
    } catch (my_err) {
        log(
            name
            + ': failed to read bundled file: '
            + String(my_err)
        );
        return null;
    }
}

function inspect_bundle_installation(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): BundleInstallStatus {
    const my_target_dir = get_personal_ado_dir();

    const the_assets: AdoAssetStatus[] = ADO_ASSET_DEFS.map(
        (my_def) => {
            const my_target_path = path.join(
                my_target_dir,
                my_def.name
            );
            const my_bundled_path = get_bundled_ado_path(
                context,
                my_def.name
            );
            const my_bundled_content =
                read_bundled_ado_content(
                    my_bundled_path,
                    my_def.name,
                    log
                ) ?? undefined;

            const my_asset = {
                name: my_def.name,
                target_path: my_target_path,
                bundled_path: my_bundled_path,
                bundled_content: my_bundled_content,
                marker: my_def.marker,
                protect_foreign: my_def.protect_foreign,
            };

            return {
                ...my_asset,
                state: classify_ado_asset(my_asset, log),
            };
        }
    );

    return {
        state: aggregate_bundle_state(
            the_assets.map((my_asset) => my_asset.state)
        ),
        target_dir: my_target_dir,
        assets: the_assets,
    };
}

async function set_stata_commands_install_permission(
    context: vscode.ExtensionContext,
    permission: VviewInstallPermission | undefined
): Promise<void> {
    await context.globalState.update(
        STATA_COMMANDS_INSTALL_PERMISSION_KEY,
        permission
    );
}

export async function prompt_for_stata_commands_install(
    status: BundleInstallStatus
): Promise<VviewInstallPromptChoice> {
    const my_result =
        await vscode.window.showInformationMessage(
            build_install_prompt_message(status),
            INSTALL_BUTTON,
            NOT_NOW_BUTTON
        );

    return my_result === INSTALL_BUTTON
        ? 'install'
        : my_result === NOT_NOW_BUTTON
        ? 'not_now'
        : 'dismissed';
}

export async function ensure_vview_ado_installed(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: VviewInstallHooks = {}
): Promise<boolean> {
    return ensure_bundle_installed_core(
        context,
        log,
        STATA_COMMANDS_INSTALL_PERMISSION_KEY,
        {
            inspect_installation:
                hooks.inspect_installation
                ?? inspect_bundle_installation,
            get_permission: hooks.get_permission,
            set_permission:
                hooks.set_permission
                ?? set_stata_commands_install_permission,
            prompt_for_install:
                hooks.prompt_for_install
                ?? prompt_for_stata_commands_install,
            install_bundle: hooks.install_bundle,
        }
    );
}

export async function install_vview_ado_manually(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: VviewInstallHooks = {}
): Promise<boolean> {
    return install_bundle_manually_core(
        context,
        log,
        STATA_COMMANDS_INSTALL_PERMISSION_KEY,
        {
            inspect_installation:
                hooks.inspect_installation
                ?? inspect_bundle_installation,
            set_permission:
                hooks.set_permission
                ?? set_stata_commands_install_permission,
            install_bundle: hooks.install_bundle,
        }
    );
}

export async function uninstall_stata_commands(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: VviewInstallHooks = {}
): Promise<boolean> {
    return uninstall_bundle_and_reset_core(
        context,
        log,
        STATA_COMMANDS_INSTALL_PERMISSION_KEY,
        {
            inspect_installation:
                hooks.inspect_installation
                ?? inspect_bundle_installation,
            set_permission:
                hooks.set_permission
                ?? set_stata_commands_install_permission,
            uninstall_bundle: hooks.uninstall_bundle,
        }
    );
}

export async function reset_vview_install_permission(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
    hooks: Pick<VviewInstallHooks, 'set_permission'> = {}
): Promise<void> {
    await reset_install_permission_core(
        context,
        log,
        STATA_COMMANDS_INSTALL_PERMISSION_KEY,
        {
            set_permission:
                hooks.set_permission
                ?? set_stata_commands_install_permission,
        }
    );
}

function get_personal_ado_dir(): string {
    const my_config = vscode.workspace.getConfiguration(
        'sight'
    );
    const my_custom = my_config.get<string>(
        'personalAdoDir',
        ''
    );
    return resolve_personal_ado_dir(
        my_custom,
        os.homedir(),
        process.platform
    );
}
