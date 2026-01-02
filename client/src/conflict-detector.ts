import * as vscode from 'vscode';
import { findConflictingExtensions, formatConflictMessage, formatConflictTooltip, isStataFile, getDisplayName, shouldPersistDismissal, ConflictingExtension } from './conflict-detector-core';

export { ConflictingExtension } from './conflict-detector-core';

const DOCS_URL = 'https://github.com/jbearak/sight?tab=readme-ov-file#extension-conflict-detection';
const STATE_KEY_WARNING_DISMISSED = 'sight.conflictWarningDismissed';

export class ConflictDetector {
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];
    private cachedConflicts: ConflictingExtension[] | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.disposables.push(this.statusBarItem);
        
        // Register command for status bar click (Req 3.3)
        this.disposables.push(
            vscode.commands.registerCommand('sight.showConflictHelp', () => this.showConflictHelp())
        );
        
        // Temporary command to reset dismissal for testing
        this.disposables.push(
            vscode.commands.registerCommand('sight.resetConflictDismissal', async () => {
                await this.context.globalState.update(STATE_KEY_WARNING_DISMISSED, undefined);
                vscode.window.showInformationMessage('Conflict dismissal reset. Reload window to see dialog again.');
            })
        );
        
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.updateStatusBar()),
            vscode.extensions.onDidChange(() => {
                this.cachedConflicts = null; // Invalidate cache when extensions change
                this.checkAndNotify();
            })
        );
    }

    detectConflicts(): ConflictingExtension[] {
        const conflicts = findConflictingExtensions(vscode.extensions.all, this.context.extension.id);
        return conflicts.map(ext => ({
            id: ext.id,
            displayName: getDisplayName(ext)
        }));
    }

    private getConflicts(): ConflictingExtension[] {
        if (this.cachedConflicts === null) {
            this.cachedConflicts = this.detectConflicts();
        }
        return this.cachedConflicts;
    }

    checkAndNotify(): void {
        this.cachedConflicts = null; // Refresh cache at start of update cycle
        const conflicts = this.getConflicts();
        const warningDismissed = this.context.globalState.get<boolean>(STATE_KEY_WARNING_DISMISSED, false);
        
        // Show warning only if conflicts exist and user hasn't dismissed (Req 2.1, 2.7, 2.8)
        if (conflicts.length > 0 && !warningDismissed) {
            this.showConflictWarning(conflicts);
        }
        
        this.updateStatusBar();
    }

    showConflictWarning(conflicts: ConflictingExtension[]): void {
        const message = formatConflictMessage(conflicts);
        const isPlural = conflicts.length > 1;
        const buttonText = isPlural ? 'Open Extensions Pane' : 'Open Extension Pane';
        
        // Use modal dialog for more persistent notification
        vscode.window.showWarningMessage(
            message,
            { modal: true },
            buttonText,
            'More info',
            'Dismiss'
        ).then(async selection => {
            if (selection === buttonText) {
                // Open Extensions view filtered to conflicting extensions
                try {
                    const extensionIds = conflicts.map(c => c.id);
                    await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', extensionIds);
                } catch (err) {
                    this.outputChannel.appendLine(`Failed to open extensions view with filter: ${err}`);
                    // Fallback to regular extensions view
                    try {
                        await vscode.commands.executeCommand('workbench.view.extensions');
                    } catch (fallbackErr) {
                        this.outputChannel.appendLine(`Failed to open extensions view: ${fallbackErr}`);
                    }
                }
            } else if (selection === 'More info') {
                // Req 2.6: Open docs URL
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));
                } catch (err) {
                    this.outputChannel.appendLine(`Failed to open documentation URL: ${err}`);
                }
            } else if (shouldPersistDismissal(selection)) {
                // Req 2.7: Record dismissal ONLY on Dismiss or close (undefined)
                try {
                    await this.context.globalState.update(STATE_KEY_WARNING_DISMISSED, true);
                } catch (err) {
                    this.outputChannel.appendLine(`Failed to persist dismissal state: ${err}`);
                }
            }
        });
    }

    updateStatusBar(): void {
        const activeEditor = vscode.window.activeTextEditor;
        // Req 3.5, 3.8: Hide when no Stata file active
        if (!isStataFile(activeEditor?.document.fileName)) {
            this.statusBarItem.hide();
            return;
        }

        const conflicts = this.getConflicts();
        // Req 3.4: Hide when no conflicts
        if (conflicts.length === 0) {
            this.statusBarItem.hide();
            return;
        }

        // Req 3.1: Display with warning icon and "Stata: Conflict" text
        this.statusBarItem.text = '$(warning) Stata: Conflict';
        // Req 3.2: Tooltip with conflicting extension names
        this.statusBarItem.tooltip = formatConflictTooltip(conflicts);
        // Req 3.3: Click shows conflict help
        this.statusBarItem.command = 'sight.showConflictHelp';
        // Req 3.6, 3.7: Show on right side when Stata file active
        this.statusBarItem.show();
    }

    showConflictHelp(): void {
        const conflicts = this.getConflicts();
        if (conflicts.length === 0) return;

        const panel = vscode.window.createWebviewPanel(
            'sightConflictHelp',
            'Sight: Extension Conflicts',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        // Handle webview messages for command execution
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'openExtensions') {
                await vscode.commands.executeCommand('workbench.view.extensions');
            }
        });

        panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:var(--vscode-font-family);padding:20px;line-height:1.6;color:var(--vscode-foreground);}
h1{color:var(--vscode-foreground);border-bottom:1px solid var(--vscode-panel-border);padding-bottom:10px;}
h2{color:var(--vscode-foreground);margin-top:30px;margin-bottom:15px;}
ul{margin:10px 0;}
li{margin:5px 0;}
code{background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px;}
strong{color:var(--vscode-foreground);}
a{color:var(--vscode-textLink-foreground);cursor:pointer;}
</style></head><body>
<h1>Conflicting Stata Extensions</h1>
<p>The following extensions interfere with Sight's language features:</p>
<ul>
${conflicts.map(c => `<li><strong>${c.displayName}</strong> (${c.id})</li>`).join('\n')}
</ul>
<h2>Recommended Actions</h2>
<ol>
<li><strong>Disable conflicting extensions</strong> for Stata files</li>
<li><strong>Uninstall unused extensions</strong> to avoid conflicts</li>
<li><a href="https://github.com/jbearak/sight/issues" style="color:var(--vscode-textLink-foreground);">Report issues</a> if problems persist after disabling conflicts</li>
</ol>
<h2>Why This Matters</h2>
<p>Multiple extensions providing Stata language support can cause VS Code to use the other extension's syntax highlighting instead of Sight's.</p>
<h2>How to Disable or Uninstall Extensions</h2>
<ol>
<li>Go to the <a onclick="openExtensions()" style="color:var(--vscode-textLink-foreground);">Extensions view</a> (Cmd+Shift+X / Ctrl+Shift+X)</li>
<li>Find the conflicting extension</li>
<li>Click the gear icon next to it</li>
<li>Select "Disable" or "Uninstall"</li>
<li>Reload VS Code</li>
</ol>
<script>
const vscode = acquireVsCodeApi();
function openExtensions() {
    vscode.postMessage({ command: 'openExtensions' });
}
</script>
</body></html>`;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
