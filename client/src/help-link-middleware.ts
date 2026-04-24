/**
 * Help link middleware
 *
 * LSP-provided markdown (from hover and completion) is rendered as
 * untrusted by default, which strips `command:` URIs. Sight emits
 * `command:sight.openHelpTopic?...` links from the server in hover and
 * completion documentation, so we must wrap those payloads as trusted
 * MarkdownString on the client side.
 *
 * We narrowly enable only the `sight.openHelpTopic` command rather than
 * trusting every command URI the server might emit.
 */

import * as vscode from 'vscode';

const TRUSTED_COMMANDS: { enabledCommands: string[] } = {
    enabledCommands: ['sight.openHelpTopic'],
};

function trust_markdown(value: string): vscode.MarkdownString {
    const my_md = new vscode.MarkdownString(value);
    my_md.isTrusted = TRUSTED_COMMANDS;
    return my_md;
}

/**
 * Return a trusted copy of a hover content entry when it carries
 * markdown. Plain strings and MarkedString code blocks (`{language,
 * value}`) have no command URIs to guard, so they pass through
 * unchanged.
 */
function trust_hover_entry(
    entry: vscode.MarkdownString | vscode.MarkedString
): vscode.MarkdownString | vscode.MarkedString {
    if (entry instanceof vscode.MarkdownString) {
        entry.isTrusted = TRUSTED_COMMANDS;
        return entry;
    }
    if (typeof entry === 'string') {
        return trust_markdown(entry);
    }
    // `{ language, value }` plain code block.
    return entry;
}

/**
 * Wrap the `contents` of a VS Code Hover so any markdown entries are
 * trusted for the `sight.openHelpTopic` command link.
 */
export function trust_hover(hover: vscode.Hover): vscode.Hover {
    const the_new_contents = hover.contents.map(trust_hover_entry);
    return new vscode.Hover(the_new_contents, hover.range);
}

/**
 * Wrap a CompletionItem's `documentation` (if any) as a trusted
 * MarkdownString so command links in the server-provided markdown are
 * clickable. Plain-string documentation is left as-is.
 */
export function trust_completion_item(
    item: vscode.CompletionItem
): vscode.CompletionItem {
    const my_doc = item.documentation;
    if (!my_doc || typeof my_doc === 'string') {
        return item;
    }
    if (my_doc instanceof vscode.MarkdownString) {
        my_doc.isTrusted = TRUSTED_COMMANDS;
    }
    return item;
}
