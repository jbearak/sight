/**
 * Render a markdown command link that opens the Sight help viewer for
 * the given topic. The link label keeps the familiar `help <topic>`
 * shape so users coming from Stata's `help` command recognize it.
 *
 * VS Code requires command arguments to be a JSON array encoded with
 * `encodeURIComponent`. The client middleware trusts this specific
 * command URI so the link is clickable from LSP-provided markdown.
 */
export function format_help_link(topic: string): string {
    const my_encoded_args = encodeURIComponent(JSON.stringify([topic]));
    return `[help ${topic}](command:sight.openHelpTopic?${my_encoded_args})`;
}
