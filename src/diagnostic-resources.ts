import { URI } from 'vscode-uri';

export const DIAGNOSTIC_RESOURCES_CHANGED_NOTIFICATION =
    'sight/diagnosticResourcesChanged';

function as_record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' &&
        !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

/** Parse an explicit URI array. Undefined means "use normal LSP didOpen". */
export function parse_diagnostic_uri_set(
    value: unknown
): Set<string> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const uris = new Set<string>();
    for (const candidate of value) {
        if (typeof candidate !== 'string') {
            continue;
        }
        try {
            const parsed = URI.parse(candidate, true);
            if (parsed.scheme !== '') {
                uris.add(parsed.toString());
            }
        } catch {
            // Ignore malformed feature metadata without affecting settings.
        }
    }
    return uris;
}

export function diagnostic_uris_from_initialization_options(
    options: unknown
): Set<string> | undefined {
    return parse_diagnostic_uri_set(
        as_record(options)?.['diagnosticUris']
    );
}

export function diagnostic_uris_from_notification(
    params: unknown
): Set<string> | undefined {
    return parse_diagnostic_uri_set(
        as_record(params)?.['diagnosticUris']
    );
}

/** Explicit policy sets compare unequal to the undefined LSP fallback. */
export function same_diagnostic_uri_set(
    current: ReadonlySet<string> | undefined,
    next: ReadonlySet<string>
): boolean {
    if (current === undefined || current.size !== next.size) {
        return false;
    }
    for (const uri of current) {
        if (!next.has(uri)) {
            return false;
        }
    }
    return true;
}

export interface DiagnosticUriSetChanges {
    added: string[];
    removed: string[];
}

/** Return the symmetric difference between two explicit ownership policies. */
export function diagnostic_uri_set_changes(
    current: ReadonlySet<string>,
    next: ReadonlySet<string>
): DiagnosticUriSetChanges {
    const removed = [...current].filter(uri => !next.has(uri));
    const added = [...next].filter(uri => !current.has(uri));
    return { added, removed };
}

/**
 * Remove feature metadata before bare initialization options reach the public
 * settings mapper. A `{ sight: ... }` wrapper is already safely unwrapped by
 * the existing configuration path and is left intact.
 */
export function settings_initialization_options(options: unknown): unknown {
    const record = as_record(options);
    if (!record || !('diagnosticUris' in record) || ('sight' in record)) {
        return options;
    }

    const settings = { ...record };
    delete settings['diagnosticUris'];
    return settings;
}
