/**
 * Dependency Graph for Cross-File Auto-Discovery
 *
 * Maintains bidirectional edges between files based on forward calls
 * (do/run/include commands). Used by ScopeResolver to auto-discover
 * parent files when backward_dependencies=auto.
 */

import { ForwardCall, ForwardCallType } from '../types';
import { logger } from '../utils/logger';

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

            // Use the callee's file URI as the key
            const callee_uri = this.path_to_uri(my_call.path);
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
        return [...(this.callee_to_callers.get(my_uri) ?? [])];
    }

    /**
     * Get the set of callee URIs for a given caller.
     */
    get_callees(caller_uri: string): Set<string> {
        const my_uri = this.normalize_uri(caller_uri);
        return new Set(this.caller_to_callees.get(my_uri) ?? []);
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
        if (uri.startsWith('file://')) {
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
