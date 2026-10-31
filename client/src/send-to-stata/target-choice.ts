/**
 * VS Code side of the `ask` send target (see target-choice-core.ts):
 * the menu is a quick pick, and "Always" writes the user setting.
 */

import * as vscode from 'vscode';
import {
    MENU_TITLE,
    TargetChooser,
    type MenuAction,
    type TargetChoice,
} from './target-choice-core.js';

const TARGET_SETTING_SECTION = 'sight.sendToStata';
const TARGET_SETTING_KEY = 'target';
export const CHOOSE_SEND_TARGET_COMMAND = 'sight.chooseSendTarget';
export const SEND_TARGET_DOCS_URL =
    'https://github.com/jbearak/sight/blob/main/docs/send-to-stata.md'
    + '#choosing-where-code-goes';

interface ActionItem extends vscode.QuickPickItem {
    action?: MenuAction;
}

function target_config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(TARGET_SETTING_SECTION);
}

const chooser = new TargetChooser({
    platform: process.platform,
    is_remote: () => Boolean(vscode.env.remoteName),
    effective_setting: () => target_config().get<string>(TARGET_SETTING_KEY),
    pick: async (entries) => {
        const the_items: ActionItem[] = entries.map(my_entry =>
            my_entry.kind === 'separator'
                ? {
                    label: my_entry.label,
                    kind: vscode.QuickPickItemKind.Separator,
                }
                : {
                    label: my_entry.label,
                    detail: my_entry.detail,
                    action: my_entry.action,
                }
        );
        const picked = await vscode.window.showQuickPick(the_items, {
            title: MENU_TITLE,
        });
        return picked?.action;
    },
    open_docs: async () => {
        await vscode.env.openExternal(vscode.Uri.parse(SEND_TARGET_DOCS_URL));
    },
    save_user_setting: async (value) => {
        await target_config().update(
            TARGET_SETTING_KEY, value, vscode.ConfigurationTarget.Global
        );
    },
    inform: (text) => {
        void vscode.window.showInformationMessage(text);
    },
    error: (text) => {
        void vscode.window.showErrorMessage(text);
    },
});

/** Where a send goes under `ask`; null cancels it. */
export function resolve_ask_target(): Promise<TargetChoice | null> {
    return chooser.resolve();
}

/**
 * A menu choice that wins over the setting this session (a workspace
 * setting overrode Always), or null.
 */
export function session_target_override(): TargetChoice | null {
    return chooser.session_override();
}

export function register_target_choice_command(
    context: vscode.ExtensionContext
): void {
    context.subscriptions.push(vscode.commands.registerCommand(
        CHOOSE_SEND_TARGET_COMMAND,
        () => chooser.choose_from_command()
    ));
}

export function reset_target_choice_for_tests(): void {
    chooser.reset_for_tests();
}
