import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { detect_stata_app } from './stata-detector.js';
import {
    escape_for_applescript,
    settle_osascript_result,
} from './applescript.js';
import { StataVariant } from './index.js';

/**
 * Opens an SMCL or help file in Stata's viewer via AppleScript.
 * Always focuses Stata. Launches Stata if not running.
 */
function open_in_stata_app(
    stata_app: StataVariant,
    file_path: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const escaped_path = escape_for_applescript(file_path);
        const applescript_cmd =
            `tell application "${stata_app}" to ` +
            `DoCommandAsync "view \\"${escaped_path}\\""` +
            `\ntell application "${stata_app}" to activate`;

        execFile('osascript', ['-e', applescript_cmd], (error) => {
            settle_osascript_result(error, stata_app, resolve, reject);
        });
    });
}

/**
 * Resolves the file URI from the command argument (explorer context)
 * or the active editor (editor title button).
 */
function resolve_file_uri(arg: unknown): vscode.Uri | undefined {
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    return vscode.window.activeTextEditor?.document.uri;
}

export function register_open_in_stata(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sight.openInStata',
        async (arg: unknown) => {
            const file_uri = resolve_file_uri(arg);
            if (!file_uri) {
                vscode.window.showErrorMessage(
                    'No file selected. Right-click an SMCL file or open one in the editor.'
                );
                return;
            }

            if (process.platform === 'win32') {
                const did_open = await vscode.env.openExternal(file_uri);
                if (!did_open) {
                    vscode.window.showErrorMessage(
                        'Failed to open file in Stata. Ensure .smcl/.sthlp files are associated with Stata.'
                    );
                }
                return;
            }

            if (process.platform !== 'darwin') {
                vscode.window.showErrorMessage(
                    'Open in Stata is only supported on macOS and Windows.'
                );
                return;
            }

            const file_path = file_uri.fsPath;
            if (/[`$"]/.test(file_path)) {
                vscode.window.showErrorMessage(
                    'Cannot open in Stata: the file path contains characters ' +
                    '(", $ or `) that would break or be misinterpreted by Stata. ' +
                    'Rename or move the file to a path without these characters.'
                );
                return;
            }

            const stata_app = await detect_stata_app();
            if (!stata_app) {
                vscode.window.showErrorMessage(
                    'Could not find Stata. Install Stata or set sight.sendToStata.stataApp.'
                );
                return;
            }

            try {
                await open_in_stata_app(stata_app, file_path);
            } catch (error) {
                const message = error instanceof Error
                    ? error.message : String(error);
                vscode.window.showErrorMessage(
                    `Failed to open file in Stata: ${message}`
                );
            }
        }
    );
    context.subscriptions.push(disposable);
}
