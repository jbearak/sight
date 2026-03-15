import { describe, it, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from '../../src/dependency-graph';
import { ForwardCall } from '../../src/types';
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
});
