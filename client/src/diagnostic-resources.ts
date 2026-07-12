import {
    Uri,
    window,
    type Tab,
} from 'vscode';
import {
    collect_diagnostic_resource_uris,
    type DiagnosticTabResource,
} from './diagnostic-resources-core.js';

function tab_resource(tab: Tab): DiagnosticTabResource | undefined {
    if (!tab.input || typeof tab.input !== 'object') {
        return undefined;
    }

    const input = tab.input as {
        uri?: unknown;
        original?: unknown;
        modified?: unknown;
    };
    // Structural inspection deliberately handles future resource-backed tab
    // inputs without coupling ownership to today's concrete TabInput classes.
    if (input.modified instanceof Uri) {
        return {
            kind: 'diff',
            modified_uri: input.modified.toString(),
            original_uri: input.original instanceof Uri
                ? input.original.toString()
                : undefined,
            is_active: tab.isActive,
        };
    }
    if (input.uri instanceof Uri) {
        return { kind: 'resource', uri: input.uri.toString() };
    }
    return undefined;
}

export function current_diagnostic_resource_uris(): string[] {
    const tabs: DiagnosticTabResource[] = [];
    for (const group of window.tabGroups.all) {
        for (const tab of group.tabs) {
            const resource = tab_resource(tab);
            if (resource) {
                tabs.push(resource);
            }
        }
    }

    return collect_diagnostic_resource_uris(
        tabs,
        window.visibleTextEditors.map(
            editor => editor.document.uri.toString()
        )
    );
}
