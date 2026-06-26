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

// Identity of one bundled ado file.
export interface AdoAssetDef {
    name: string;
    // The full, stable leading-banner line that identifies a
    // Sight-shipped copy of this file. It MUST equal the first line of
    // the corresponding stata/<name> source (a test enforces this) so
    // ownership detection is precise and never misclassifies a user's
    // own same-named file (e.g. a personal browse.ado).
    marker: string;
    // When true, a differing same-named file that is NOT Sight-owned
    // is left untouched (classified 'foreign'). When false, Sight owns
    // the command name and installs/updates its own copy regardless.
    // `vview` is Sight's own command, so it is always installed: a
    // user's unrelated vview.ado would otherwise leave `browse`
    // aliasing a non-Sight vview. `browse` is a generic Stata built-in
    // name, so a user's own browse.ado must be protected.
    protect_foreign: boolean;
}

// Single source of truth for the bundled ado files and their ownership
// markers. Imported by the extension wiring and by tests, so the marker
// strings never drift between production and test code.
export const ADO_ASSET_DEFS: AdoAssetDef[] = [
    {
        name: 'vview.ado',
        marker:
            '*! vview.ado — Open dataset in Sight Data Browser',
        protect_foreign: false,
    },
    {
        name: 'browse.ado',
        marker:
            '*! browse.ado — CLI alias for vview (Sight Data Browser)',
        protect_foreign: true,
    },
    // Standard Stata abbreviations of `browse`. Like `browse`, each
    // is a generic built-in name (in the GUI, the built-in command
    // and its abbreviations shadow these ados), so a user's own
    // same-named file must be protected.
    {
        name: 'brows.ado',
        marker:
            '*! brows.ado — CLI alias for vview (Sight Data Browser)',
        protect_foreign: true,
    },
    {
        name: 'brow.ado',
        marker:
            '*! brow.ado — CLI alias for vview (Sight Data Browser)',
        protect_foreign: true,
    },
    {
        name: 'bro.ado',
        marker:
            '*! bro.ado — CLI alias for vview (Sight Data Browser)',
        protect_foreign: true,
    },
    {
        name: 'br.ado',
        marker:
            '*! br.ado — CLI alias for vview (Sight Data Browser)',
        protect_foreign: true,
    },
];

// Description of one bundled ado file.
export interface AdoAsset extends AdoAssetDef {
    target_path: string;
    bundled_path: string;
    bundled_content?: string;
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
        status: BundleInstallStatus
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

// True when `content` is a Sight-shipped copy of an ado: its leading
// banner line is exactly the asset's ownership marker. The match is
// exact (not a prefix, and surrounding whitespace is NOT normalized),
// so a foreign file that merely begins with, or pads, our banner text
// is never misclassified as Sight-owned and clobbered. Only a trailing
// CR is stripped, so a CRLF-saved copy of our own file still matches.
export function is_sight_owned(
    content: string,
    marker: string
): boolean {
    let my_first_line = content.split('\n', 1)[0];
    if (my_first_line.endsWith('\r')) {
        my_first_line = my_first_line.slice(0, -1);
    }
    return my_first_line === marker;
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
    if (is_sight_owned(my_existing, asset.marker)) {
        return 'outdated';
    }
    // A differing, non-Sight file. Protect it only when the name is not
    // Sight-owned; otherwise treat it as outdated and overwrite it.
    return asset.protect_foreign ? 'foreign' : 'outdated';
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

    // For a protected (generic-named) asset, do a final ownership
    // re-check: the classification was captured during inspection,
    // possibly before a permission prompt. Guard against a foreign file
    // appearing at the target in that window (TOCTOU) so we never
    // overwrite a user's own same-named file. Sight-owned names
    // (protect_foreign === false) are always installed, so they skip
    // this and overwrite unconditionally.
    if (asset.protect_foreign) {
        try {
            const my_current = fs.readFileSync(
                asset.target_path,
                'utf-8'
            );
            if (!is_sight_owned(my_current, asset.marker)) {
                log(
                    asset.name
                    + ': a non-Sight file now occupies '
                    + asset.target_path
                    + '; leaving it untouched'
                );
                return true;
            }
        } catch (my_err) {
            const my_node_error =
                my_err as NodeJS.ErrnoException;
            if (my_node_error.code !== 'ENOENT') {
                log(
                    asset.name
                    + ': failed to re-check before install: '
                    + String(my_err)
                );
                return false;
            }
            // ENOENT: nothing at the target, safe to create.
        }
    }

    try {
        fs.mkdirSync(target_dir, { recursive: true });
        // For a protected, missing target, create exclusively ('wx') so
        // that a foreign file racing in between the re-check above and
        // this write is not clobbered (EEXIST → leave it). Otherwise
        // overwrite ('w'): updating our own file, or installing a
        // Sight-owned name we always own.
        const my_flag =
            asset.protect_foreign && asset.state === 'missing'
                ? 'wx'
                : 'w';
        fs.writeFileSync(
            asset.target_path,
            asset.bundled_content,
            { flag: my_flag }
        );
        log(
            asset.name
            + ': installed to '
            + asset.target_path
        );
        return true;
    } catch (my_err) {
        const my_node_error = my_err as NodeJS.ErrnoException;
        if (my_node_error.code === 'EEXIST') {
            log(
                asset.name
                + ': a file appeared at '
                + asset.target_path
                + ' during install; leaving it untouched'
            );
            return true;
        }
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

// Build the install-permission prompt text, tailored to what is
// already on disk. When vview.ado is already installed (up to date),
// re-offering "vview" confuses a user who installed it before the
// browse bundle existed, so the prompt instead frames the fresh
// consent as *adding the console `browse` alias* (and its
// abbreviations). When vview is not yet present, the full bundle is
// offered. Either way the install location is named.
export function build_install_prompt_message(
    status: BundleInstallStatus
): string {
    const my_vview = status.assets.find(
        (my_asset) => my_asset.name === 'vview.ado'
    );
    const vview_already_installed =
        my_vview?.state === 'up_to_date';

    if (vview_already_installed) {
        return (
            'vview is already installed. Would you like Sight to '
            + 'also add the console "browse" command (and its '
            + 'abbreviations "brows", "brow", "bro", "br") as an '
            + 'alias for vview? In console Stata they open datasets '
            + 'in VS Code; the GUI built-in "browse" is unaffected.'
            + '\n\n'
            + `Install location: ${status.target_dir}`
        );
    }

    return (
        'Would you like to add Sight\'s Stata commands '
        + '("vview" and "browse") to Stata?\n\n'
        + '"vview" opens datasets in VS Code; in console '
        + 'Stata, "browse" (and its abbreviations "brows", '
        + '"brow", "bro", "br") becomes an alias for it (the '
        + 'GUI built-in "browse" is unaffected).\n\n'
        + `Install location: ${status.target_dir}`
    );
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
            'Stata commands: permission previously granted; '
            + 'installing without prompt'
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
        my_status
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
