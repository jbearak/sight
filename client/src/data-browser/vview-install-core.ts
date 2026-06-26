import * as fs from 'fs';

export type VviewInstallPermission =
    | 'granted'
    | 'declined';

// Per-file install state for a single bundled ado.
export type AdoAssetState =
    | 'missing'      // no file at the target path
    | 'up_to_date'   // target content equals bundled content
    | 'outdated'     // a Sight-owned file differs from bundled content
    | 'foreign'      // a non-Sight file occupies the target path
    | 'error';       // bundled content unavailable / read failure

// Aggregate state across the whole bundle.
export type BundleInstallState =
    | 'missing'
    | 'up_to_date'
    | 'outdated'
    | 'error';

export type VviewInstallPromptChoice =
    | 'install'
    | 'not_now'
    | 'dismissed';

// Description of one bundled ado file.
export interface AdoAsset {
    name: string;
    target_path: string;
    bundled_path: string;
    bundled_content?: string;
    // Stable leading-banner prefix that identifies a Sight-shipped
    // copy of this file. Used to avoid clobbering a user's own file
    // that happens to share the name (e.g. a personal browse.ado).
    marker: string;
}

export interface AdoAssetStatus extends AdoAsset {
    state: AdoAssetState;
}

export interface BundleInstallStatus {
    state: BundleInstallState;
    target_dir: string;
    assets: AdoAssetStatus[];
}

export interface VviewInstallContextLike {
    globalState: {
        get<T>(
            key: string,
            default_value?: T
        ): T | undefined;
        update(
            key: string,
            value: unknown
        ): Promise<void> | Thenable<void>;
    };
}

export interface VviewInstallHooks<
    TContext extends VviewInstallContextLike
> {
    inspect_installation?: (
        context: TContext,
        log: (msg: string) => void
    ) => BundleInstallStatus;
    get_permission?: (
        context: TContext
    ) => VviewInstallPermission | undefined;
    set_permission?: (
        context: TContext,
        permission: VviewInstallPermission | undefined
    ) => Promise<void>;
    prompt_for_install?: (
        target_dir: string
    ) => Promise<VviewInstallPromptChoice>;
    install_bundle?: (
        status: BundleInstallStatus,
        log: (msg: string) => void
    ) => boolean;
    uninstall_bundle?: (
        status: BundleInstallStatus,
        log: (msg: string) => void
    ) => boolean;
}

// True when `content` looks like the Sight-shipped copy of an ado
// (its leading banner begins with the asset's ownership marker).
export function is_sight_owned(
    content: string,
    marker: string
): boolean {
    const my_first_line = content.split('\n', 1)[0].trim();
    return my_first_line.startsWith(marker);
}

export function classify_ado_asset(
    asset: AdoAsset,
    log: (msg: string) => void
): AdoAssetState {
    if (asset.bundled_content === undefined) {
        return 'error';
    }

    let my_existing: string;
    try {
        my_existing = fs.readFileSync(
            asset.target_path,
            'utf-8'
        );
    } catch (my_err) {
        const my_node_error = my_err as NodeJS.ErrnoException;
        if (my_node_error.code === 'ENOENT') {
            return 'missing';
        }
        log(
            asset.name
            + ': failed to inspect existing install: '
            + String(my_err)
        );
        return 'error';
    }

    if (my_existing === asset.bundled_content) {
        return 'up_to_date';
    }
    return is_sight_owned(my_existing, asset.marker)
        ? 'outdated'
        : 'foreign';
}

export function aggregate_bundle_state(
    the_states: AdoAssetState[]
): BundleInstallState {
    if (the_states.includes('error')) {
        return 'error';
    }
    if (the_states.includes('missing')) {
        return 'missing';
    }
    if (the_states.includes('outdated')) {
        return 'outdated';
    }
    // 'up_to_date' and 'foreign' both count as satisfied: a foreign
    // file is intentionally left alone, so it must not re-prompt.
    return 'up_to_date';
}

// Install a single asset, honoring its classified state. A foreign
// file is left untouched (reported as success: blocked, not failed).
export function install_ado_asset(
    asset: AdoAssetStatus,
    target_dir: string,
    log: (msg: string) => void
): boolean {
    if (asset.state === 'foreign') {
        log(
            asset.name
            + ': leaving existing non-Sight file untouched at '
            + asset.target_path
        );
        return true;
    }

    if (asset.state === 'up_to_date') {
        return true;
    }

    if (asset.bundled_content === undefined) {
        log(
            asset.name
            + ': failed to install: bundled content is unavailable'
        );
        return false;
    }

    try {
        fs.mkdirSync(target_dir, { recursive: true });
        fs.writeFileSync(
            asset.target_path,
            asset.bundled_content
        );
        log(
            asset.name
            + ': installed to '
            + asset.target_path
        );
        return true;
    } catch (my_err) {
        log(
            asset.name
            + ': failed to install: '
            + String(my_err)
        );
        return false;
    }
}

// Best-effort install of the whole bundle. A write failure for one
// asset does not abort the others; the aggregate result is false if
// any required write failed.
export function install_bundle(
    status: BundleInstallStatus,
    log: (msg: string) => void
): boolean {
    if (status.state === 'error') {
        log(
            'Stata commands: cannot install; bundled content is unavailable'
        );
        return false;
    }

    let my_all_ok = true;
    for (const my_asset of status.assets) {
        const my_ok = install_ado_asset(
            my_asset,
            status.target_dir,
            log
        );
        if (!my_ok) {
            my_all_ok = false;
        }
    }
    return my_all_ok;
}

// Remove each target only if it is Sight-owned; never delete a
// foreign file that happens to share the name.
export function uninstall_bundle(
    status: BundleInstallStatus,
    log: (msg: string) => void
): boolean {
    let my_all_ok = true;
    for (const my_asset of status.assets) {
        let my_existing: string;
        try {
            my_existing = fs.readFileSync(
                my_asset.target_path,
                'utf-8'
            );
        } catch (my_err) {
            const my_node_error =
                my_err as NodeJS.ErrnoException;
            if (my_node_error.code === 'ENOENT') {
                continue;
            }
            log(
                my_asset.name
                + ': failed to inspect before uninstall: '
                + String(my_err)
            );
            my_all_ok = false;
            continue;
        }

        if (!is_sight_owned(my_existing, my_asset.marker)) {
            log(
                my_asset.name
                + ': not Sight-owned; leaving in place'
            );
            continue;
        }

        try {
            fs.rmSync(my_asset.target_path, { force: true });
            log(
                my_asset.name
                + ': removed '
                + my_asset.target_path
            );
        } catch (my_err) {
            log(
                my_asset.name
                + ': failed to remove: '
                + String(my_err)
            );
            my_all_ok = false;
        }
    }
    return my_all_ok;
}

export function get_install_permission<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    state_key: string
): VviewInstallPermission | undefined {
    return context.globalState.get<
        VviewInstallPermission | undefined
    >(state_key);
}

export async function set_install_permission<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    state_key: string,
    permission: VviewInstallPermission | undefined
): Promise<void> {
    await context.globalState.update(
        state_key,
        permission
    );
}

function resolve_get_permission<
    TContext extends VviewInstallContextLike
>(
    hooks: VviewInstallHooks<TContext>,
    state_key: string
): (context: TContext) => VviewInstallPermission | undefined {
    return hooks.get_permission
        ?? ((my_context) =>
            get_install_permission(my_context, state_key));
}

function resolve_set_permission<
    TContext extends VviewInstallContextLike
>(
    hooks: VviewInstallHooks<TContext>,
    state_key: string
): (
    context: TContext,
    permission: VviewInstallPermission | undefined
) => Promise<void> {
    return hooks.set_permission
        ?? ((my_context, my_permission) =>
            set_install_permission(
                my_context,
                state_key,
                my_permission
            ));
}

export async function ensure_bundle_installed<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    log: (msg: string) => void,
    state_key: string,
    hooks: VviewInstallHooks<TContext> = {}
): Promise<boolean> {
    if (!hooks.inspect_installation) {
        throw new Error(
            'inspect_installation hook is required'
        );
    }
    if (!hooks.prompt_for_install) {
        throw new Error(
            'prompt_for_install hook is required'
        );
    }

    const my_get_permission = resolve_get_permission(
        hooks,
        state_key
    );
    const my_set_permission = resolve_set_permission(
        hooks,
        state_key
    );
    const my_install = hooks.install_bundle ?? install_bundle;

    const my_status = hooks.inspect_installation(
        context,
        log
    );
    log(
        'Stata commands: install check -> '
        + my_status.state
    );

    if (my_status.state === 'error') {
        return false;
    }

    if (my_status.state === 'up_to_date') {
        log('Stata commands: already up to date');
        return true;
    }

    const my_permission = my_get_permission(context);
    if (my_permission === 'granted') {
        log(
            'Stata commands: permission previously granted; installing without prompt'
        );
        return my_install(my_status, log);
    }

    if (my_permission === 'declined') {
        log(
            'Stata commands: permission previously declined; skipping install'
        );
        return false;
    }

    log('Stata commands: prompting for install permission');
    const my_choice = await hooks.prompt_for_install(
        my_status.target_dir
    );
    if (my_choice === 'dismissed') {
        log('Stata commands: prompt dismissed');
        return false;
    }

    if (my_choice === 'not_now') {
        log('Stata commands: install deferred by user');
        return false;
    }

    if (my_choice !== 'install') {
        return false;
    }

    const my_installed = my_install(my_status, log);
    if (!my_installed) {
        return false;
    }

    await my_set_permission(context, 'granted');
    log('Stata commands: permission granted');
    return true;
}

export async function install_bundle_manually<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    log: (msg: string) => void,
    state_key: string,
    hooks: VviewInstallHooks<TContext> = {}
): Promise<boolean> {
    if (!hooks.inspect_installation) {
        throw new Error(
            'inspect_installation hook is required'
        );
    }

    const my_set_permission = resolve_set_permission(
        hooks,
        state_key
    );
    const my_install = hooks.install_bundle ?? install_bundle;

    const my_status = hooks.inspect_installation(
        context,
        log
    );
    log(
        'Stata commands: manual install check -> '
        + my_status.state
    );

    if (my_status.state === 'error') {
        return false;
    }

    if (my_status.state === 'up_to_date') {
        await my_set_permission(context, 'granted');
        log('Stata commands: already up to date');
        return true;
    }

    const my_installed = my_install(my_status, log);
    if (!my_installed) {
        return false;
    }

    await my_set_permission(context, 'granted');
    log('Stata commands: permission granted');
    return true;
}

// Remove Sight-owned ado files and clear the remembered permission.
export async function uninstall_bundle_and_reset<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    log: (msg: string) => void,
    state_key: string,
    hooks: VviewInstallHooks<TContext> = {}
): Promise<boolean> {
    if (!hooks.inspect_installation) {
        throw new Error(
            'inspect_installation hook is required'
        );
    }

    const my_set_permission = resolve_set_permission(
        hooks,
        state_key
    );
    const my_uninstall =
        hooks.uninstall_bundle ?? uninstall_bundle;

    const my_status = hooks.inspect_installation(
        context,
        log
    );
    const my_ok = my_uninstall(my_status, log);
    await my_set_permission(context, undefined);
    log('Stata commands: install permission reset');
    return my_ok;
}

export async function reset_install_permission<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    log: (msg: string) => void,
    state_key: string,
    hooks: Pick<
        VviewInstallHooks<TContext>,
        'set_permission'
    > = {}
): Promise<void> {
    const my_set_permission = resolve_set_permission(
        hooks,
        state_key
    );

    await my_set_permission(context, undefined);
    log('Stata commands: install permission reset');
}
