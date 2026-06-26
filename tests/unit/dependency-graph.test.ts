import { describe, it, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from '../../src/dependency-graph';
import { ForwardCall } from '../../src/types';
import { type RichResolveFs } from '../../src/utils/file-path-utils';
import { URI } from 'vscode-uri';

function make_forward_call(
    type: 'do' | 'run' | 'include',
    file_path: string,
    call_site_line: number
): ForwardCall {
    return {
        type,
        path: file_path,
        raw_path: file_path,
        call_site_line,
        range: {
            start: { line: call_site_line, character: 0 },
            end: { line: call_site_line, character: 10 },
        },
        source: 'command',
        is_static: true,
    };
}

/**
 * Build a ForwardCall that carries the resolution context fields
 * (`raw_path`, `caller_uri`, `working_directory`) so the dep-graph can
 * replay the join with `resolve_path_rich`.
 */
function make_forward_call_with_context(opts: {
    type: 'do' | 'run' | 'include';
    path: string;         // analyzer's script-relative join (as typed in path)
    raw_path: string;     // path exactly as written in source
    caller_uri: string;
    call_site_line: number;
    working_directory?: string;
}): ForwardCall {
    return {
        type: opts.type,
        path: opts.path,
        raw_path: opts.raw_path,
        call_site_line: opts.call_site_line,
        range: {
            start: { line: opts.call_site_line, character: 0 },
            end: { line: opts.call_site_line, character: 10 },
        },
        source: 'command',
        is_static: true,
        caller_uri: opts.caller_uri,
        working_directory: opts.working_directory,
    };
}

/**
 * Build a minimal injected `RichResolveFs` from a flat map of
 * directory → entries.  Each entry has a name and a boolean
 * `is_file` flag (false → directory).
 *
 * `existsSync` returns true for any path that appears as a key in
 * `dir_entries` (treating it as an existing directory) or whose
 * parent directory lists it as a file entry.
 */
function make_mock_fs(
    dir_entries: Map<string, Array<{ name: string; is_file: boolean }>>,
): RichResolveFs {
    const known_paths = new Set<string>();
    for (const [dir, entries] of dir_entries) {
        known_paths.add(dir);
        for (const my_entry of entries) {
            known_paths.add(
                dir.endsWith('/') ? `${dir}${my_entry.name}` : `${dir}/${my_entry.name}`,
            );
        }
    }
    return {
        readdirSync(p: string, _opts: { withFileTypes: true }) {
            const norm = p.replace(/\\/g, '/');
            const the_entries = dir_entries.get(norm);
            if (!the_entries) {
                throw new Error(`ENOENT: no such directory: ${norm}`);
            }
            return the_entries.map(e => ({
                name: e.name,
                isFile: () => e.is_file,
                isDirectory: () => !e.is_file,
            }));
        },
        existsSync(p: string): boolean {
            return known_paths.has(p.replace(/\\/g, '/'));
        },
    };
}

function make_dynamic_call(
    type: 'do' | 'run' | 'include',
    raw_path: string,
    call_site_line: number
): ForwardCall {
    return {
        type,
        path: '',
        raw_path,
        call_site_line,
        range: {
            start: { line: call_site_line, character: 0 },
            end: { line: call_site_line, character: 10 },
        },
        source: 'command',
        is_static: false,
    };
}

describe('DependencyGraph', () => {
    let graph: DependencyGraph;
    const parent_path = '/workspace/parent.do';
    const child_path = '/workspace/child.do';
    const other_path = '/workspace/other.do';
    const parent_uri = URI.file(parent_path).toString();
    const child_uri = URI.file(child_path).toString();
    const other_uri = URI.file(other_path).toString();

    beforeEach(() => {
        graph = new DependencyGraph();
    });

    describe('update_caller', () => {
        it('should add forward call edges', () => {
            const the_calls = [
                make_forward_call('do', child_path, 5),
            ];
            graph.update_caller(parent_uri, the_calls);

            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].caller_uri).toBe(parent_uri);
            expect(the_parents[0].call_type).toBe('do');
            expect(the_parents[0].call_site_line).toBe(5);
        });

        it('should handle multiple callees from same caller', () => {
            const the_calls = [
                make_forward_call('do', child_path, 5),
                make_forward_call('include', other_path, 10),
            ];
            graph.update_caller(parent_uri, the_calls);

            expect(graph.get_parents(child_uri)).toHaveLength(1);
            expect(graph.get_parents(other_uri)).toHaveLength(1);
            expect(graph.get_callees(parent_uri).size).toBe(2);
        });

        it('should handle multiple callers for same callee', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            graph.update_caller(other_uri, [
                make_forward_call('include', child_path, 3),
            ]);

            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(2);
            const the_types = new Set(
                the_parents.map(e => e.call_type)
            );
            expect(the_types.has('do')).toBe(true);
            expect(the_types.has('include')).toBe(true);
        });

        it('should skip dynamic (macro-interpolated) calls', () => {
            const the_calls = [
                make_dynamic_call('do', '`path_macro\'', 5),
                make_forward_call('do', child_path, 10),
            ];
            graph.update_caller(parent_uri, the_calls);

            // Only the static call should be in the graph
            expect(graph.get_edge_count()).toBe(1);
            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].call_site_line).toBe(10);
        });

        it('should skip calls with empty path', () => {
            const my_call: ForwardCall = {
                type: 'do',
                path: '',
                raw_path: 'something.do',
                call_site_line: 5,
                range: {
                    start: { line: 5, character: 0 },
                    end: { line: 5, character: 10 },
                },
                source: 'command',
                is_static: true,
            };
            graph.update_caller(parent_uri, [my_call]);
            expect(graph.get_edge_count()).toBe(0);
        });

        it('should remove stale edges on re-index', () => {
            // First: parent calls child and other
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
                make_forward_call('do', other_path, 10),
            ]);
            expect(graph.get_edge_count()).toBe(2);

            // Re-index: parent now only calls child
            const result = graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            expect(graph.get_edge_count()).toBe(1);
            expect(graph.get_parents(other_uri)).toHaveLength(0);
            expect(result.changed_callees.has(other_uri)).toBe(true);
        });

        it('should update edge when call type changes', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            expect(graph.get_parents(child_uri)[0].call_type).toBe('do');

            const result = graph.update_caller(parent_uri, [
                make_forward_call('include', child_path, 5),
            ]);
            expect(graph.get_parents(child_uri)[0].call_type)
                .toBe('include');
            expect(result.changed_callees.has(child_uri)).toBe(true);
        });

        it('should update edge when call site line changes', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);

            const result = graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 20),
            ]);
            expect(graph.get_parents(child_uri)[0].call_site_line)
                .toBe(20);
            expect(result.changed_callees.has(child_uri)).toBe(true);
        });

        it('should not report change when edges are unchanged', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            const result = graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            expect(result.changed_callees.size).toBe(0);
        });

        it('should keep earliest call for duplicate callee', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
                make_forward_call('include', child_path, 10),
            ]);
            // First occurrence wins
            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].call_site_line).toBe(5);
            expect(the_parents[0].call_type).toBe('do');
        });
    });

    describe('remove_caller', () => {
        it('should remove all edges from a caller', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
                make_forward_call('do', other_path, 10),
            ]);
            expect(graph.get_edge_count()).toBe(2);

            const result = graph.remove_caller(parent_uri);
            expect(graph.get_edge_count()).toBe(0);
            expect(result.changed_callees.has(child_uri)).toBe(true);
            expect(result.changed_callees.has(other_uri)).toBe(true);
        });

        it('should not affect edges from other callers', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            graph.update_caller(other_uri, [
                make_forward_call('include', child_path, 3),
            ]);

            graph.remove_caller(parent_uri);
            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].caller_uri).toBe(other_uri);
        });

        it('should handle removing non-existent caller', () => {
            const result = graph.remove_caller(parent_uri);
            expect(result.changed_callees.size).toBe(0);
        });
    });

    describe('get_parents', () => {
        it('should return empty array for unknown callee', () => {
            expect(graph.get_parents(child_uri)).toHaveLength(0);
        });
    });

    describe('workspace scan lifecycle', () => {
        it('should start with scan_complete=false', () => {
            expect(graph.is_scan_complete()).toBe(false);
        });

        it('should set scan_complete after mark_scan_complete', () => {
            graph.mark_scan_complete();
            expect(graph.is_scan_complete()).toBe(true);
        });

        it('should increment version on mark_scan_complete', () => {
            const before = graph.get_version();
            graph.mark_scan_complete();
            expect(graph.get_version()).toBeGreaterThan(before);
        });

        it('should be idempotent on repeated mark_scan_complete', () => {
            graph.mark_scan_complete();
            const version_after_first = graph.get_version();
            graph.mark_scan_complete();
            expect(graph.get_version()).toBe(version_after_first);
        });
    });

    describe('version tracking', () => {
        it('should start at version 0', () => {
            expect(graph.get_version()).toBe(0);
        });

        it('should increment on edge addition', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            expect(graph.get_version()).toBeGreaterThan(0);
        });

        it('should not increment when update has no changes', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            const version = graph.get_version();
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            expect(graph.get_version()).toBe(version);
        });

        it('should increment on edge removal', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            const version = graph.get_version();
            graph.remove_caller(parent_uri);
            expect(graph.get_version()).toBeGreaterThan(version);
        });
    });

    describe('metrics', () => {
        it('should track callee and caller counts', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
                make_forward_call('include', other_path, 10),
            ]);
            expect(graph.get_caller_count()).toBe(1);
            expect(graph.get_callee_count()).toBe(2);
            expect(graph.get_edge_count()).toBe(2);
        });
    });

    describe('reset', () => {
        it('should clear all state', () => {
            graph.update_caller(parent_uri, [
                make_forward_call('do', child_path, 5),
            ]);
            graph.mark_scan_complete();

            graph.reset();
            expect(graph.get_edge_count()).toBe(0);
            expect(graph.get_version()).toBe(0);
            expect(graph.is_scan_complete()).toBe(false);
        });
    });

    describe('case-only path resolution (Task 6)', () => {
        // Virtual workspace layout used by the injected fs:
        //
        //   /ws/
        //     parent.do       (caller)
        //     helpers/
        //       Clean.do      (on-disk casing — caller writes "helpers/clean")
        //     ambig/
        //       Clean.do
        //       clean.do      (two ci matches → ambiguous)
        //     workdir/
        //       Target.do     (resolved via working_directory)
        //
        const ws_root = '/ws';
        const ws_parent_path = '/ws/parent.do';
        const ws_parent_uri = URI.file(ws_parent_path).toString();

        // Real on-disk cased URIs
        const real_clean_uri = URI.file('/ws/helpers/Clean.do').toString();
        const real_target_uri = URI.file('/ws/workdir/Target.do').toString();

        // As-typed (wrong-cased) path the caller uses
        const as_typed_path = '/ws/helpers/clean';     // no .do extension

        let the_fs: RichResolveFs;

        beforeEach(() => {
            // Fresh graph per test
            graph = new DependencyGraph();

            the_fs = make_mock_fs(
                new Map([
                    ['/ws', [
                        { name: 'parent.do', is_file: true },
                        { name: 'helpers',   is_file: false },
                        { name: 'ambig',     is_file: false },
                        { name: 'workdir',   is_file: false },
                    ]],
                    ['/ws/helpers', [
                        { name: 'Clean.do', is_file: true },
                    ]],
                    ['/ws/ambig', [
                        { name: 'Clean.do', is_file: true },
                        { name: 'clean.do', is_file: true },
                    ]],
                    ['/ws/workdir', [
                        { name: 'Target.do', is_file: true },
                    ]],
                ]),
            );

            graph.set_workspace_roots([ws_root]);
            graph.set_resolve_fs(the_fs);
        });

        it('wrong-cased script-relative do builds edge to real-cased URI', () => {
            // The caller writes `do helpers/clean` — the analyzer's
            // script-relative join produces "/ws/helpers/clean" (no ext).
            // resolve_path_rich must find "helpers/Clean.do" via ci + .do
            // fallback.
            const my_call = make_forward_call_with_context({
                type: 'do',
                path: as_typed_path,         // "/ws/helpers/clean"
                raw_path: 'helpers/clean',
                caller_uri: ws_parent_uri,
                call_site_line: 5,
            });

            graph.update_caller(ws_parent_uri, [my_call]);

            // Edge must be keyed by the REAL-cased URI, not the as-typed one
            const the_parents = graph.get_parents(real_clean_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0]!.caller_uri).toBe(ws_parent_uri);

            // The as-typed URI must NOT be in the graph
            const as_typed_uri = URI.file(as_typed_path).toString();
            expect(graph.get_parents(as_typed_uri)).toHaveLength(0);
        });

        it('wrong-cased working-directory join builds edge to real-cased URI', () => {
            // The caller sets @lsp-cd /ws/workdir and writes `do target`.
            // The dep-graph must join raw_path="target" with
            // working_directory="/ws/workdir" to produce
            // "/ws/workdir/target", which resolves to "Target.do" via
            // ci + .do fallback.
            const my_call = make_forward_call_with_context({
                type: 'do',
                path: '/ws/target',          // script-relative (wrong base)
                raw_path: 'target',
                caller_uri: ws_parent_uri,
                call_site_line: 10,
                working_directory: '/ws/workdir',
            });

            graph.update_caller(ws_parent_uri, [my_call]);

            const the_parents = graph.get_parents(real_target_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0]!.caller_uri).toBe(ws_parent_uri);
        });

        it('ambiguous ci matches (2+) keeps today\'s behavior — no real-file edge', () => {
            // /ws/ambig has both CLEAN.do and Clean.do — both are
            // case-insensitive matches for "clean.do", but neither is
            // an exact match → ambiguous.
            const ambig_fs = make_mock_fs(
                new Map([
                    ['/ws', [
                        { name: 'parent.do', is_file: true },
                        { name: 'ambig',     is_file: false },
                    ]],
                    ['/ws/ambig', [
                        { name: 'CLEAN.do', is_file: true },
                        { name: 'Clean.do', is_file: true },
                    ]],
                ]),
            );

            const my_ambig_graph = new DependencyGraph();
            my_ambig_graph.set_workspace_roots([ws_root]);
            my_ambig_graph.set_resolve_fs(ambig_fs);

            const as_typed_ambig = '/ws/ambig/clean.do';
            const my_call = make_forward_call_with_context({
                type: 'do',
                path: as_typed_ambig,
                raw_path: 'ambig/clean.do',
                caller_uri: ws_parent_uri,
                call_site_line: 20,
            });

            my_ambig_graph.update_caller(ws_parent_uri, [my_call]);

            // No real-file edge should have been created for either candidate
            expect(my_ambig_graph.get_edge_count()).toBe(1);

            // The edge is keyed by the as-typed path (today's behavior)
            const as_typed_ambig_uri = URI.file(as_typed_ambig).toString();
            const real_clean_do_uc_uri =
                URI.file('/ws/ambig/CLEAN.do').toString();
            const real_clean_do_mc_uri =
                URI.file('/ws/ambig/Clean.do').toString();

            expect(my_ambig_graph.get_parents(real_clean_do_uc_uri))
                .toHaveLength(0);
            expect(my_ambig_graph.get_parents(real_clean_do_mc_uri))
                .toHaveLength(0);
            expect(my_ambig_graph.get_parents(as_typed_ambig_uri))
                .toHaveLength(1);
        });

        it('unset workspace roots fall back to today\'s behavior — no throw', () => {
            // Create a fresh graph WITHOUT setting workspace roots or fs
            const my_graph = new DependencyGraph();
            // Do NOT call set_workspace_roots or set_resolve_fs

            const my_call = make_forward_call_with_context({
                type: 'do',
                path: '/ws/helpers/clean',
                raw_path: 'helpers/clean',
                caller_uri: ws_parent_uri,
                call_site_line: 5,
            });

            // Must not throw even though there are no workspace roots
            expect(() => my_graph.update_caller(ws_parent_uri, [my_call])).not.toThrow();
            expect(my_graph.get_edge_count()).toBe(1);

            // Edge is keyed by the as-typed path (no case normalization)
            const as_typed_uri = URI.file('/ws/helpers/clean').toString();
            expect(my_graph.get_parents(as_typed_uri)).toHaveLength(1);
        });
    });
});
