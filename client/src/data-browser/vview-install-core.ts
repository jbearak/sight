import * as fs from 'fs';

export type VviewInstallPermission =
    | 'granted'
    | 'declined';

export type VviewInstallState =
    | 'missing'
    | 'up_to_date'
    | 'outdated'
    | 'error';

export type VviewInstallPromptChoice =
    | 'install'
    | 'not_now';

export interface VviewInstallStatus {
    state: VviewInstallState;
    target_dir: string;
    target_path: string;
    bundled_path: string;
    bundled_content?: string;
    error?: string;
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
    ) => VviewInstallStatus;
    get_permission?: (
        context: TContext
    ) => VviewInstallPermission | undefined;
    set_permission?: (
        context: TContext,
        permission: VviewInstallPermission | undefined
    ) => Promise<void>;
    prompt_for_vview_install?: (
        target_dir: string
    ) => Promise<VviewInstallPromptChoice>;
    install_vview_ado?: (
        status: VviewInstallStatus,
        log: (msg: string) => void
    ) => boolean;
}

export function get_vview_install_state(
    target_path: string,
    bundled_content: string,
    log: (msg: string) => void
): VviewInstallState {
    try {
        const my_existing = fs.readFileSync(
            target_path,
            'utf-8'
        );
        return my_existing === bundled_content
            ? 'up_to_date'
            : 'outdated';
    } catch (my_err) {
        const my_node_error = my_err as NodeJS.ErrnoException;
        if (my_node_error.code === 'ENOENT') {
            return 'missing';
        }

        log(
            'vview.ado: failed to inspect existing install: '
            + String(my_err)
        );
        return 'error';
    }
}

export function install_vview_ado(
    status: VviewInstallStatus,
    log: (msg: string) => void
): boolean {
    if (status.bundled_content === undefined) {
        log(
            'vview.ado: failed to install: bundled content is unavailable'
        );
        return false;
    }

    try {
        fs.mkdirSync(status.target_dir, { recursive: true });
        fs.writeFileSync(
            status.target_path,
            status.bundled_content
        );
        log(
            'vview.ado: installed to '
            + status.target_path
        );
        return true;
    } catch (my_err) {
        log(
            'vview.ado: failed to install: '
            + String(my_err)
        );
        return false;
    }
}

export function get_vview_install_permission<
    TContext extends VviewInstallContextLike
>(
    context: TContext,
    state_key: string
): VviewInstallPermission | undefined {
    return context.globalState.get<
        VviewInstallPermission | undefined
    >(state_key);
}

export async function set_vview_install_permission<
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

export async function ensure_vview_ado_installed<
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
    if (!hooks.prompt_for_vview_install) {
        throw new Error(
            'prompt_for_vview_install hook is required'
        );
    }

    const my_get_permission = hooks.get_permission
        ?? ((my_context) =>
            get_vview_install_permission(
                my_context,
                state_key
            ));
    const my_set_permission = hooks.set_permission
        ?? ((my_context, my_permission) =>
            set_vview_install_permission(
                my_context,
                state_key,
                my_permission
            ));
    const my_install = hooks.install_vview_ado
        ?? install_vview_ado;

    const my_status = hooks.inspect_installation(
        context,
        log
    );
    log(
        'vview.ado: install check -> '
        + my_status.state
    );

    if (my_status.state === 'error') {
        return false;
    }

    if (my_status.state === 'up_to_date') {
        log('vview.ado: already up to date');
        return true;
    }

    const my_permission = my_get_permission(context);
    if (my_permission === 'granted') {
        log(
            'vview.ado: permission previously granted; installing without prompt'
        );
        return my_install(my_status, log);
    }

    if (my_permission === 'declined') {
        log(
            'vview.ado: permission previously declined; skipping install'
        );
        return false;
    }

    log('vview.ado: prompting for install permission');
    const my_choice =
        await hooks.prompt_for_vview_install(
            my_status.target_dir
        );
    if (my_choice !== 'install') {
        await my_set_permission(context, 'declined');
        log('vview.ado: permission declined');
        return false;
    }

    const my_installed = my_install(my_status, log);
    if (!my_installed) {
        return false;
    }

    await my_set_permission(context, 'granted');
    log('vview.ado: permission granted');
    return true;
}

export async function install_vview_ado_manually<
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

    const my_set_permission = hooks.set_permission
        ?? ((my_context, my_permission) =>
            set_vview_install_permission(
                my_context,
                state_key,
                my_permission
            ));
    const my_install = hooks.install_vview_ado
        ?? install_vview_ado;
    const my_status = hooks.inspect_installation(
        context,
        log
    );

    log(
        'vview.ado: manual install check -> '
        + my_status.state
    );

    if (my_status.state === 'error') {
        return false;
    }

    if (my_status.state === 'up_to_date') {
        await my_set_permission(context, 'granted');
        log('vview.ado: already up to date');
        return true;
    }

    const my_installed = my_install(my_status, log);
    if (!my_installed) {
        return false;
    }

    await my_set_permission(context, 'granted');
    log('vview.ado: permission granted');
    return true;
}

export async function reset_vview_install_permission<
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
    const my_set_permission = hooks.set_permission
        ?? ((my_context, my_permission) =>
            set_vview_install_permission(
                my_context,
                state_key,
                my_permission
            ));

    await my_set_permission(context, undefined);
    log('vview.ado: install permission reset');
}
