/**
 * Multi-root workspace utilities.
 *
 * Picks the deepest workspace root that contains a given file,
 * falling back to workspace_roots[0] when no root matches.
 */

import * as path from 'path';
import { URI } from 'vscode-uri';

/**
 * Find the deepest workspace root that contains the given filesystem path.
 * Falls back to workspace_roots[0] if no root matches.
 *
 * @param workspace_roots - Array of absolute workspace root paths
 * @param fs_path - Absolute filesystem path to match
 * @returns The deepest matching root, or workspace_roots[0], or undefined if empty
 */
export function get_workspace_root_for_path(
    workspace_roots: string[],
    fs_path: string
): string | undefined {
    if (workspace_roots.length === 0) {
        return undefined;
    }

    const resolved = path.resolve(fs_path);
    let best_match: string | undefined;
    let best_length = -1;

    for (const my_root of workspace_roots) {
        const resolved_root = path.resolve(my_root);
        if (
            resolved.startsWith(resolved_root + path.sep) ||
            resolved === resolved_root
        ) {
            if (resolved_root.length > best_length) {
                best_match = resolved_root;
                best_length = resolved_root.length;
            }
        }
    }

    return best_match ?? path.resolve(workspace_roots[0]);
}

/**
 * Find the deepest workspace root that contains the file at the given URI.
 * Falls back to workspace_roots[0] if no root matches.
 *
 * @param workspace_roots - Array of absolute workspace root paths
 * @param uri - file:// URI of the target file
 * @returns The deepest matching root, or workspace_roots[0], or undefined if empty
 */
export function get_workspace_root_for_uri(
    workspace_roots: string[],
    uri: string
): string | undefined {
    if (workspace_roots.length === 0) {
        return undefined;
    }
    try {
        const fs_path = URI.parse(uri).fsPath;
        return get_workspace_root_for_path(workspace_roots, fs_path);
    } catch {
        return path.resolve(workspace_roots[0]);
    }
}
