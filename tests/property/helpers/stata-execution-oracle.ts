/**
 * Stata execution oracle for forward-call graphs.
 *
 * Ground truth for `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`.
 * Derived from Stata runtime semantics, not from `ForwardScopeResolver`'s
 * algorithm — so a resolver bug cannot silently propagate into the oracle.
 *
 * Semantics modelled:
 *
 *  - `is_visible_at()` — real Stata: a scope stack pushes a fresh scope on
 *    `do`/`run` and keeps the caller's scope on `include`. Reports whether
 *    the referenced name is bound when the reference event fires.
 *
 *  - `blame_target_for()` — counterfactual "all-include" Stata: promote
 *    every `do`/`run` boundary reachable from the root to `include`,
 *    execute the flattened chain in source order, and return the file
 *    index whose `local X` most recently bound the referenced name before
 *    the reference event fires. The resolver's flattening, dedup, and
 *    excluded-locals filtering are *not* mirrored: the oracle re-runs
 *    each callee as the simulator encounters it (stopping only on the
 *    current recursion path to avoid infinite loops), and the final
 *    binding of the referenced name is the blame file.
 */
import { ForwardCallGraph } from '../generators/forward-call-graphs';

export class StataExecutionOracle {
    constructor(private graph: ForwardCallGraph) {}

    is_visible_at(): boolean {
        const the_scope = this.simulate_stack_until_ref();
        return the_scope !== null && the_scope.has(this.graph.reference_name);
    }

    blame_target_for(): number | null {
        // Counterfactual: promote every do/run to include and re-execute
        // the reachable chain from the root. Every `local X` overwrites
        // prior bindings (last-def-wins). The result is the file that
        // last bound `reference_name` before the reference event fires.
        const the_scope = new Map<string, number>();
        const reached = this.walk_counterfactual(0, the_scope, new Set<number>());
        if (!reached) return null;
        const my_winner = the_scope.get(this.graph.reference_name);
        return my_winner ?? null;
    }

    get_file_name(file_index: number): string {
        return this.graph.files[file_index].filename;
    }

    /**
     * True when the referenced name is defined anywhere in the root file
     * — even after the reference line. The LSP preserves the analyzer's
     * UNDEFINED_MACRO diagnostic for in-root forward references instead
     * of rewriting to OUT_OF_SCOPE_SYMBOL; see `src/providers/diagnostics.ts`
     * around line 358 and issue #145.
     */
    is_defined_in_root(): boolean {
        const my_root = this.graph.files[0];
        for (const my_event of my_root.events) {
            if (
                my_event.kind === 'define_local' &&
                my_event.name === this.graph.reference_name
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Stack-based real-Stata simulation. Returns the current top-of-stack
     * scope when the reference event is reached in the root file, or
     * `null` if the reference is never reached.
     */
    private simulate_stack_until_ref(): Map<string, number> | null {
        const scope_stack: Map<string, number>[] = [new Map()];
        return this.simulate_file(0, scope_stack, new Set([0]));
    }

    private simulate_file(
        file_index: number,
        scope_stack: Map<string, number>[],
        visited: Set<number>,
    ): Map<string, number> | null {
        const my_file = this.graph.files[file_index];
        for (let i = 0; i < my_file.events.length; i++) {
            const my_event = my_file.events[i];
            if (file_index === 0 && i === this.graph.reference_event_index) {
                return scope_stack[scope_stack.length - 1];
            }
            if (my_event.kind === 'define_local') {
                scope_stack[scope_stack.length - 1].set(my_event.name, file_index);
            } else if (my_event.kind === 'include_call') {
                if (visited.has(my_event.target)) continue;
                const my_visited = new Set(visited);
                my_visited.add(my_event.target);
                const result = this.simulate_file(my_event.target, scope_stack, my_visited);
                if (result !== null) return result;
            } else if (
                my_event.kind === 'do_call' ||
                my_event.kind === 'run_call'
            ) {
                if (visited.has(my_event.target)) continue;
                const my_visited = new Set(visited);
                my_visited.add(my_event.target);
                scope_stack.push(new Map());
                const result = this.simulate_file(my_event.target, scope_stack, my_visited);
                scope_stack.pop();
                if (result !== null) return result;
            }
        }
        return null;
    }

    /**
     * Counterfactual walk: every `include`/`do`/`run` expands inline into
     * a single shared scope. Walks the root forward-order until the
     * reference event fires. Returns `true` once the reference is
     * reached; returns `false` if the walk exhausts without finding it.
     *
     * Cycle protection is per-call-path (`current_path`) rather than a
     * global visited set, matching real Stata's re-execution on each
     * call and preserving the last-def-wins ordering that two separate
     * visits to the same file can introduce.
     */
    private walk_counterfactual(
        file_index: number,
        scope: Map<string, number>,
        current_path: Set<number>,
    ): boolean {
        if (current_path.has(file_index)) return false;
        current_path.add(file_index);
        try {
            const my_file = this.graph.files[file_index];
            for (let i = 0; i < my_file.events.length; i++) {
                const my_event = my_file.events[i];
                if (
                    file_index === 0 &&
                    i === this.graph.reference_event_index
                ) {
                    return true;
                }
                if (my_event.kind === 'define_local') {
                    scope.set(my_event.name, file_index);
                } else if (
                    my_event.kind === 'include_call' ||
                    my_event.kind === 'do_call' ||
                    my_event.kind === 'run_call'
                ) {
                    const reached = this.walk_counterfactual(
                        my_event.target,
                        scope,
                        current_path,
                    );
                    if (reached) return true;
                }
            }
            return false;
        } finally {
            current_path.delete(file_index);
        }
    }
}
