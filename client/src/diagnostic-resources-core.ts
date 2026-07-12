export type DiagnosticTabResource =
    | {
        kind: 'resource';
        uri: string;
    }
    | {
        kind: 'diff';
        modified_uri: string;
        original_uri?: string;
        is_active: boolean;
    };

export interface StringableUri {
    toString(): string;
}

export interface DiagnosticCollectionLike<TUri extends StringableUri> {
    forEach(callback: (uri: TUri) => void): void;
    delete(uri: TUri): void;
}

/** Compare canonical URI snapshots without allocating another set. */
export function same_diagnostic_resource_uris(
    first: readonly string[] | undefined,
    second: readonly string[]
): boolean {
    return first !== undefined && first.length === second.length &&
        first.every((uri, index) => uri === second[index]);
}

/**
 * Collect resources that own editor diagnostics.
 *
 * Every resource-backed tab counts, while a diff owns only its modified side.
 * Visible editors add peek resources. VS Code exposes both sides of an active
 * diff as visible editors, so each active diff consumes exactly one matching
 * original-side occurrence before the remaining visible editors are added.
 */
export function collect_diagnostic_resource_uris(
    tabs: readonly DiagnosticTabResource[],
    visible_editor_uris: readonly string[]
): string[] {
    const resources = new Set<string>();
    const excluded_visible_occurrences = new Map<string, number>();

    for (const tab of tabs) {
        if (tab.kind === 'resource') {
            resources.add(tab.uri);
            continue;
        }

        resources.add(tab.modified_uri);
        if (tab.is_active && tab.original_uri !== undefined) {
            excluded_visible_occurrences.set(
                tab.original_uri,
                (excluded_visible_occurrences.get(tab.original_uri) ?? 0) + 1
            );
        }
    }

    for (const uri of visible_editor_uris) {
        const excluded_count = excluded_visible_occurrences.get(uri) ?? 0;
        if (excluded_count > 0) {
            if (excluded_count === 1) {
                excluded_visible_occurrences.delete(uri);
            } else {
                excluded_visible_occurrences.set(uri, excluded_count - 1);
            }
            continue;
        }
        resources.add(uri);
    }

    return [...resources].sort();
}

/** Remove retained diagnostics for resources no longer owned by the editor. */
export function clear_ineligible_diagnostics<TUri extends StringableUri>(
    collection: DiagnosticCollectionLike<TUri> | undefined,
    eligible_uris: ReadonlySet<string>
): void {
    if (!collection) {
        return;
    }

    const stale_uris: TUri[] = [];
    collection.forEach((uri) => {
        if (!eligible_uris.has(uri.toString())) {
            stale_uris.push(uri);
        }
    });
    for (const uri of stale_uris) {
        collection.delete(uri);
    }
}

/** Client-side final gate for a server publication already in transit. */
export function diagnostics_for_resource<TDiagnostic>(
    uri: string,
    diagnostics: TDiagnostic[],
    eligible_uris: ReadonlySet<string>
): TDiagnostic[] {
    return eligible_uris.has(uri) ? diagnostics : [];
}
