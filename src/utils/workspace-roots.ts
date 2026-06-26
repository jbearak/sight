/**
 * Multi-root workspace utilities.
 *
 * Picks the deepest workspace root that contains a given file,
 * falling back to workspace_roots[0] when no root matches.
 */

import * as path from 'path';
import { URI } from 'vscode-uri';
import type { WorkingDirectoryDirective } from '../types';

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

/**
 * Resolve a WorkingDirectoryDirective to an absolute filesystem path.
 *
 * Resolution rules:
 * - `is_workspace_relative === true`: join `workspace_root` with
 *   `directive.resolved_path` and normalise. Returns `undefined` when
 *   `workspace_root` is not provided (no workspace is open).
 * - `is_workspace_relative === false`: return `directive.resolved_path`
 *   directly (the directive parser already resolved it relative to the
 *   script's containing directory).
 *
 * This function intentionally does NOT check whether the resulting path
 * exists on disk. Callers that require an existence check (e.g.
 * DocumentStore) should apply `fs.existsSync` / `fs.statSync` on top of
 * the value returned here. Keeping the existence check out of this helper
 * ensures that the Indexer, ScopeResolver, and DocumentStore all produce
 * the same canonical path string for the same directive, which is
 * required for dependency-graph edge keying to be stable across
 * producers.
 *
 * @param directive - The parsed working-directory directive.
 * @param workspace_root - Pre-resolved workspace root for the file that
 *   contains the directive (used only for workspace-relative paths).
 * @returns Resolved absolute path, or `undefined` if workspace-relative
 *   and no workspace root is available.
 */
export function resolve_working_directory_directive(
    directive: WorkingDirectoryDirective,
    workspace_root: string | undefined,
): string | undefined {
    if (directive.is_workspace_relative) {
        if (!workspace_root) {
            // Cannot resolve a workspace-relative path without a root.
            return undefined;
        }
        // directive.resolved_path already has the leading slash stripped
        // by the directive parser.
        return path.normalize(
            path.join(workspace_root, directive.resolved_path)
        );
    }
    // Non-workspace-relative: the directive parser already resolved the
    // path relative to the script's containing directory.
    return directive.resolved_path;
}
