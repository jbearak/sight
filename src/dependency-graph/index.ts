/**
 * Dependency Graph for Cross-File Auto-Discovery
 *
 * Maintains bidirectional edges between files based on forward calls
 * (do/run/include commands). Used by ScopeResolver to auto-discover
 * parent files when backward_dependencies=auto.
 */

import * as node_path from 'path';
import { ForwardCall, ForwardCallType } from '../types';
import { logger } from '../utils/logger';
import {
    resolve_path_rich,
    type RichResolveFs,
} from '../utils/file-path-utils';

/**
 * An auto-discovered backward edge: a parent file that calls the child.
 */
export interface AutoBackwardEdge {
    caller_uri: string;
    call_type: ForwardCallType;   // 'do' | 'run' | 'include'
    call_site_line: number;       // 0-indexed line in caller file
}

/**
 * Result of updating edges for a caller file.
 */
export interface GraphUpdateResult {
    /** Callee URIs whose parent sets changed (added or removed edges) */
    changed_callees: Set<string>;
}

export class DependencyGraph {
    // callee_uri → AutoBackwardEdge[] (parents that call this file)
    private callee_to_callers: Map<string, AutoBackwardEdge[]> =
        new Map();

    // caller_uri → Set<callee_uri> (for O(M) cleanup on re-index)
    private caller_to_callees: Map<string, Set<string>> = new Map();

    // Monotonic version counter — increments on any mutation
    private version_counter: number = 0;

    // Whether the initial workspace scan has completed
    private scan_complete: boolean = false;

    // Workspace roots for case-only path resolution (set before graph
    // updates so both the indexer and the open-document path share roots).
    private workspace_roots: string[] = [];

    // Injected filesystem for resolve_path_rich (for tests only).
    // When undefined, resolve_path_rich uses the real Node fs.
    private resolve_fs?: RichResolveFs;

    /**
     * Set workspace roots (filesystem paths). Must be called before any
     * `update_caller` so both the indexer and the open-document update
     * path resolve case-only paths against the same roots.
     *
     * When empty (early startup / before roots are known), `update_caller`
     * falls back to today's behavior: edges keyed by the as-typed URI with
     * no case normalization.
     */
    set_workspace_roots(roots: string[]): void {
        this.workspace_roots = roots.map(r => node_path.resolve(r));
    }

    get_workspace_roots(): string[] {
        return [...this.workspace_roots];
    }

    /**
     * Inject a filesystem implementation for `resolve_path_rich`.
     * For testing only — production code leaves this undefined so
     * `resolve_path_rich` uses the real Node `fs`.
     */
    set_resolve_fs(fs: RichResolveFs): void {
        this.resolve_fs = fs;
    }

    /**
     * Update the graph with forward calls from a caller file.
     * Diffs against stored callees: removes stale edges, adds new ones.
     * Only static calls (no macro-interpolated paths) become edges.
     */
    update_caller(
        caller_uri: string,
        forward_calls: ForwardCall[]
    ): GraphUpdateResult {
        const my_caller_uri = this.normalize_uri(caller_uri);
        const my_changed_callees = new Set<string>();

        // Filter to static calls with resolved paths
        const my_new_callees = new Map<string, AutoBackwardEdge>();
        for (const my_call of forward_calls) {
            if (!my_call.is_static || !my_call.path) continue;

            // Compute the joined absolute path the same way
            // resolve_call_path does in forward-scope-resolver: honor
            // working_directory for relative raw paths, else use the
            // analyzer's existing join (my_call.path).
            const my_joined_path = this.compute_joined_path(my_call);

            // Determine the real-cased callee URI.
            // Only attempt case resolution when workspace roots are set.
            let callee_uri: string;
            if (this.workspace_roots.length > 0) {
                const my_outcome = resolve_path_rich(my_joined_path, {
                    workspace_roots: this.workspace_roots,
                    fs: this.resolve_fs,
                });
                if (
                    my_outcome.kind === 'exact' ||
                    my_outcome.kind === 'case_only'
                ) {
                    // Key the edge by the real on-disk-cased path
                    callee_uri = this.path_to_uri(my_outcome.path);
                } else {
                    // ambiguous or missing: keep today's behavior
                    // (key by as-typed path, no real-file edge)
                    callee_uri = this.path_to_uri(my_joined_path);
                }
            } else {
                // Roots unset (early startup): fall back to today's
                // behavior — no case normalization
                callee_uri = this.path_to_uri(my_call.path);
            }

            // If multiple calls from the same caller to the same callee,
            // keep the earliest call site (first encounter wins)
            if (!my_new_callees.has(callee_uri)) {
                my_new_callees.set(callee_uri, {
                    caller_uri: my_caller_uri,
                    call_type: my_call.type,
                    call_site_line: my_call.call_site_line,
                });
            }
        }

        // Get old callee set for this caller
        const my_old_callees = this.caller_to_callees.get(my_caller_uri);

        // Remove stale edges (callees no longer referenced)
        if (my_old_callees) {
            for (const my_old_callee of my_old_callees) {
                if (!my_new_callees.has(my_old_callee)) {
                    this.remove_edge(my_caller_uri, my_old_callee);
                    my_changed_callees.add(my_old_callee);
                }
            }
        }

        // Add or update edges
        for (const [my_callee_uri, my_edge] of my_new_callees) {
            const did_change = this.add_or_update_edge(
                my_callee_uri,
                my_edge
            );
            if (did_change) {
                my_changed_callees.add(my_callee_uri);
            }
        }

        // Update caller → callees index
        if (my_new_callees.size > 0) {
            this.caller_to_callees.set(
                my_caller_uri,
                new Set(my_new_callees.keys())
            );
        } else {
            this.caller_to_callees.delete(my_caller_uri);
        }

        if (my_changed_callees.size > 0) {
            this.version_counter++;
        }

        return { changed_callees: my_changed_callees };
    }

    /**
     * Remove all edges originating from a caller file.
     */
    remove_caller(caller_uri: string): GraphUpdateResult {
        const my_caller_uri = this.normalize_uri(caller_uri);
        const my_changed_callees = new Set<string>();
        const my_old_callees = this.caller_to_callees.get(my_caller_uri);

        if (my_old_callees) {
            for (const my_callee_uri of my_old_callees) {
                this.remove_edge(my_caller_uri, my_callee_uri);
                my_changed_callees.add(my_callee_uri);
            }
            this.caller_to_callees.delete(my_caller_uri);
        }

        if (my_changed_callees.size > 0) {
            this.version_counter++;
        }

        return { changed_callees: my_changed_callees };
    }

    /**
     * Get all auto-discovered parent files that call the given file.
     */
    get_parents(callee_uri: string): AutoBackwardEdge[] {
        const my_uri = this.normalize_uri(callee_uri);
        const the_edges = [...(this.callee_to_callers.get(my_uri) ?? [])];
        the_edges.sort((a, b) => a.caller_uri.localeCompare(b.caller_uri));
        return the_edges;
    }

    /**
     * Get the set of callee URIs for a given caller.
     */
    get_callees(caller_uri: string): Set<string> {
        const my_uri = this.normalize_uri(caller_uri);
        return new Set(this.caller_to_callees.get(my_uri) ?? []);
    }

    /**
     * Get the callees that `caller_uri` reaches through the given
     * `call_type` (e.g., only `include`). Used by find-references to
     * restrict local-macro scans to include chains — `do`/`run` don't
     * propagate local macros in Stata.
     */
    get_callees_by_type(
        caller_uri: string,
        call_type: ForwardCallType
    ): Set<string> {
        const my_caller_uri = this.normalize_uri(caller_uri);
        const the_callees = this.caller_to_callees.get(my_caller_uri);
        const the_filtered = new Set<string>();
        if (!the_callees) return the_filtered;
        for (const my_callee_uri of the_callees) {
            const the_edges = this.callee_to_callers.get(my_callee_uri) ?? [];
            for (const my_edge of the_edges) {
                if (
                    my_edge.caller_uri === my_caller_uri &&
                    my_edge.call_type === call_type
                ) {
                    the_filtered.add(my_callee_uri);
                    break;
                }
            }
        }
        return the_filtered;
    }

    /**
     * Mark the initial workspace scan as complete.
     * After this, diagnostic deferral is no longer needed.
     */
    mark_scan_complete(): void {
        if (!this.scan_complete) {
            this.scan_complete = true;
            this.version_counter++;
            logger.info(
                `DependencyGraph: workspace scan complete ` +
                `(${this.callee_to_callers.size} callees, ` +
                `${this.caller_to_callees.size} callers)`
            );
        }
    }

    /**
     * Whether the initial workspace scan has completed.
     */
    is_scan_complete(): boolean {
        return this.scan_complete;
    }

    /**
     * Monotonic version counter. Increments on any graph mutation.
     * Used by ScopeResolver to invalidate scope cache entries that
     * depend on the graph state.
     */
    get_version(): number {
        return this.version_counter;
    }

    /**
     * Get total number of unique callee files tracked.
     */
    get_callee_count(): number {
        return this.callee_to_callers.size;
    }

    /**
     * Get total number of unique caller files tracked.
     */
    get_caller_count(): number {
        return this.caller_to_callees.size;
    }

    /**
     * Get total number of edges in the graph.
     */
    get_edge_count(): number {
        let count = 0;
        for (const the_edges of this.callee_to_callers.values()) {
            count += the_edges.length;
        }
        return count;
    }

    /**
     * Reset the graph to empty state. Used for testing.
     */
    reset(): void {
        this.callee_to_callers.clear();
        this.caller_to_callees.clear();
        this.scan_complete = false;
        this.version_counter = 0;
    }

    // --- Private helpers ---

    /**
     * Compute the absolute joined path to feed into `resolve_path_rich`.
     *
     * Replicates the join logic of `resolve_call_path` in
     * `forward-scope-resolver/index.ts`: if a `working_directory` is set
     * and `raw_path` is relative, resolve `raw_path` against
     * `working_directory`; otherwise use the analyzer's pre-joined
     * `path` field (which is already script-relative).
     *
     * The `.do` fallback is intentionally left to `resolve_path_rich`.
     */
    private compute_joined_path(call: ForwardCall): string {
        const my_raw = call.raw_path;
        const my_wd = call.working_directory;

        if (my_wd) {
            // Normalize Windows separators before the isAbsolute check
            const my_normalized = my_raw.replace(/\\/g, '/');
            const my_is_abs =
                node_path.isAbsolute(my_normalized) ||
                /^[a-zA-Z]:\//.test(my_normalized);

            if (!my_is_abs) {
                // Relative path + working directory → join against WD
                return node_path.normalize(
                    node_path.join(my_wd, my_normalized),
                );
            }
        }

        // No working directory (or absolute raw_path): use the
        // analyzer's already-resolved path (script-relative join).
        return call.path;
    }

    /**
     * Add or update a single backward edge.
     * Returns true if the edge set changed.
     */
    private add_or_update_edge(
        callee_uri: string,
        edge: AutoBackwardEdge
    ): boolean {
        const the_edges = this.callee_to_callers.get(callee_uri);

        if (!the_edges) {
            this.callee_to_callers.set(callee_uri, [edge]);
            return true;
        }

        // Check if an edge from this caller already exists
        const existing_index = the_edges.findIndex(
            e => e.caller_uri === edge.caller_uri
        );

        if (existing_index === -1) {
            // New edge
            the_edges.push(edge);
            return true;
        }

        // Edge exists — check if it changed
        const existing = the_edges[existing_index];
        if (existing.call_type !== edge.call_type ||
            existing.call_site_line !== edge.call_site_line) {
            the_edges[existing_index] = edge;
            return true;
        }

        return false;
    }

    /**
     * Remove the edge from caller_uri to callee_uri.
     */
    private remove_edge(
        caller_uri: string,
        callee_uri: string
    ): void {
        const the_edges = this.callee_to_callers.get(callee_uri);
        if (!the_edges) return;

        const new_edges = the_edges.filter(
            e => e.caller_uri !== caller_uri
        );

        if (new_edges.length === 0) {
            this.callee_to_callers.delete(callee_uri);
        } else {
            this.callee_to_callers.set(callee_uri, new_edges);
        }
    }

    /**
     * Canonicalize a URI string by round-tripping through vscode-uri.
     * Ensures consistent casing/escaping for map lookups.
     */
    private normalize_uri(uri: string): string {
        const { URI } = require('vscode-uri');
        // If it's already a file:// URI, parse and re-serialize
        if (/^file:\/\//i.test(uri)) {
            return URI.parse(uri).toString();
        }
        // Otherwise treat as a filesystem path
        return URI.file(uri).toString();
    }

    /**
     * Convert a filesystem path to a file URI string.
     */
    private path_to_uri(file_path: string): string {
        // Lazy import to avoid circular dependency at module load time
        const { URI } = require('vscode-uri');
        return URI.file(file_path).toString();
    }
}
