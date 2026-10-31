/**
 * The `ask` send target: the first send in a window asks whether code
 * goes to the Stata pane (VS Code's integrated terminal) or the Stata
 * app, for this session or for every session. Where only the pane
 * works (remote sessions and Linux), it doesn't ask.
 *
 * VS Code-free so it can be tested; target-choice.ts adapts it.
 */

export type TargetChoice = 'integrated' | 'external';

export type MenuAction =
    | { kind: 'session'; target: TargetChoice }
    | { kind: 'always'; target: TargetChoice }
    | { kind: 'ask' }
    | { kind: 'read_more' };

export type MenuEntry =
    | { kind: 'separator'; label: string }
    | { kind: 'item'; label: string; detail?: string; action: MenuAction };

export interface TargetChoiceHost {
    platform: NodeJS.Platform;
    is_remote(): boolean;
    /** The target setting's effective value. */
    effective_setting(): string | undefined;
    /** Show the menu; undefined if dismissed. */
    pick(entries: MenuEntry[]): Promise<MenuAction | undefined>;
    open_docs(): Promise<void>;
    /** Write the user (global) setting; undefined removes it. */
    save_user_setting(value: TargetChoice | undefined): Promise<void>;
    inform(text: string): void;
    error(text: string): void;
}

export const MENU_TITLE = 'Where should Sight send Stata code?';
export const PANE_ONLY_NOTE =
    'Code goes to the Stata pane here: the Stata app isn\'t available in '
    + 'remote sessions or on Linux.';

/** `ask`, and `auto` (its older name), and anything unrecognized. */
export function is_ask_setting(setting: string | undefined): boolean {
    return setting !== 'integrated' && setting !== 'external';
}

const TARGET_NAMES: Record<TargetChoice, string> = {
    integrated: 'the Stata pane',
    external: 'the Stata app',
};

export class TargetChooser {
    private session_choice: TargetChoice | null = null;
    private pending: Promise<TargetChoice | null> | null = null;

    constructor(private readonly host: TargetChoiceHost) {}

    /** Both targets work here (local macOS or Windows). */
    can_use_stata_app(): boolean {
        return !this.host.is_remote()
            && (this.host.platform === 'darwin'
                || this.host.platform === 'win32');
    }

    /**
     * Where a send goes under `ask`: the pane where it's the only
     * choice, this session's choice, or the user's answer (null if
     * they dismissed the menu, which cancels the send).
     */
    resolve(): Promise<TargetChoice | null> {
        if (!this.can_use_stata_app()) {
            return Promise.resolve('integrated');
        }
        if (this.session_choice) {
            return Promise.resolve(this.session_choice);
        }
        return this.ask_once();
    }

    /** The "Choose Where to Send Code" command. */
    async choose_from_command(): Promise<void> {
        if (!this.can_use_stata_app()) {
            this.host.inform(PANE_ONLY_NOTE);
            return;
        }
        await this.ask_once();
    }

    /** One menu at a time: sends made while it's open share it. */
    private ask_once(): Promise<TargetChoice | null> {
        if (!this.pending) {
            this.pending = this.ask().finally(() => {
                this.pending = null;
            });
        }
        return this.pending;
    }

    private async ask(): Promise<TargetChoice | null> {
        const asking = is_ask_setting(this.host.effective_setting());
        for (;;) {
            const action = await this.host.pick(
                menu_entries(this.host.platform, asking)
            );
            if (!action) {
                return null;
            }
            switch (action.kind) {
                case 'read_more':
                    await this.host.open_docs();
                    continue;
                case 'session':
                    this.session_choice = action.target;
                    return action.target;
                case 'always':
                    await this.save(action.target);
                    return action.target;
                case 'ask':
                    this.session_choice = null;
                    await this.save(undefined);
                    return null;
            }
        }
    }

    private async save(value: TargetChoice | undefined): Promise<void> {
        try {
            await this.host.save_user_setting(value);
        } catch (my_error) {
            const reason = my_error instanceof Error
                ? my_error.message
                : String(my_error);
            this.host.error(
                `Could not save sight.sendToStata.target: ${reason}`
            );
            if (value) {
                this.session_choice = value;
            }
            return;
        }
        const effective = this.host.effective_setting();
        const in_effect = value
            ? effective === value
            : is_ask_setting(effective);
        if (in_effect) {
            return;
        }
        // A workspace or folder setting overrides the user setting.
        if (value) {
            this.session_choice = value;
            this.host.inform(
                `Saved in your user settings, but this workspace's `
                + 'sight.sendToStata.target overrides it; using '
                + `${TARGET_NAMES[value]} for this session.`
            );
        } else {
            this.host.inform(
                'Saved in your user settings, but this workspace\'s '
                + 'sight.sendToStata.target overrides it.'
            );
        }
    }

    reset_for_tests(): void {
        this.session_choice = null;
        this.pending = null;
    }
}

/**
 * The menu. Under `ask` it offers this session or every session;
 * otherwise (the setting already chose) every session, or going back
 * to asking.
 */
export function menu_entries(
    platform: NodeJS.Platform,
    asking: boolean
): MenuEntry[] {
    const pane_detail = platform === 'win32'
        ? 'sight console in VS Code\'s terminal panel; it drives the '
            + 'Stata app.'
        : 'Console Stata in VS Code\'s terminal panel.';
    const app_detail = 'The Stata application\'s window.';
    const the_entries: MenuEntry[] = [];
    if (asking) {
        the_entries.push(
            { kind: 'separator', label: 'This session' },
            {
                kind: 'item', label: '$(terminal) Stata pane',
                detail: pane_detail,
                action: { kind: 'session', target: 'integrated' },
            },
            {
                kind: 'item', label: '$(window) Stata app',
                detail: app_detail,
                action: { kind: 'session', target: 'external' },
            },
        );
    }
    the_entries.push(
        { kind: 'separator', label: 'Every session (saved in settings)' },
        {
            kind: 'item', label: '$(terminal) Always use the Stata pane',
            detail: asking ? undefined : pane_detail,
            action: { kind: 'always', target: 'integrated' },
        },
        {
            kind: 'item', label: '$(window) Always use the Stata app',
            detail: asking ? undefined : app_detail,
            action: { kind: 'always', target: 'external' },
        },
    );
    if (!asking) {
        the_entries.push({
            kind: 'item', label: '$(question) Ask each session',
            action: { kind: 'ask' },
        });
    }
    the_entries.push(
        { kind: 'separator', label: '' },
        {
            kind: 'item', label: '$(book) Read more…',
            action: { kind: 'read_more' },
        },
    );
    return the_entries;
}
