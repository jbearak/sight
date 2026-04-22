/**
 * Stata execution oracle for forward-call graphs.
 *
 * Ground truth for `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`.
 * Derived from Stata runtime semantics, not from `ForwardScopeResolver`'s
 * algorithm — so a resolver bug cannot silently propagate into the
 * oracle.
 *
 * Semantics modelled:
 *
 *  - `is_visible_at()` — real Stata: a scope stack pushes a fresh scope on
 *    `do`/`run` and keeps the caller's scope on `include`. Reports whether
 *    the referenced name is bound when the reference event fires.
 *
 *  - `blame_target_for()` — single-boundary counterfactual: for each
 *    root-level `do`/`run` call that precedes the reference, promote ONLY
 *    that one boundary to `include` and ask whether the referenced local
 *    would then be bound. Internal `do`/`run` boundaries stay opaque —
 *    `include` is the only edge the walk descends. Returns the file whose
 *    `local X` is the last (in source order, across visible sites) include-
 *    reachable binding, or `null` when no single-boundary promotion would
 *    expose the name.
 */
import { ForwardCallGraph } from '../generators/forward-call-graphs';

export class StataExecutionOracle {
    constructor(private graph: ForwardCallGraph) {}

    is_visible_at(): boolean {
        const the_scope = this.simulate_stack_until_ref();
        return the_scope !== null && the_scope.has(this.graph.reference_name);
    }

    blame_target_for(): number | null {
        // Iterate root-level events in source order until the reference.
        // For each do/run call before the reference, compute the include-
        // only end-state of the callee. The last such call whose end-state
        // binds `reference_name` wins (matches the diagnostic provider's
        // last-visible-site precedence).
        const my_root = this.graph.files[0];
        let blame: number | null = null;
        for (let i = 0; i < my_root.events.length; i++) {
            if (i === this.graph.reference_event_index) break;
            const my_event = my_root.events[i];
            if (my_event.kind !== 'do_call' && my_event.kind !== 'run_call') {
                continue;
            }
            const end_state = this.compute_include_only_end_state(
                my_event.target,
                new Set<number>(),
            );
            const my_winner = end_state.get(this.graph.reference_name);
            if (my_winner !== undefined) {
                blame = my_winner;
            }
        }
        return blame;
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
     * Include-only end-state: walk the callee in source order, overwriting
     * bindings as `local X` statements fire, and merging include-reachable
     * end-states from nested `include` calls. `do`/`run` events are
     * skipped — they would run in a fresh scope and leave nothing behind.
     *
     * Cycle protection is per-path (current_path), not a global visited
     * set, because an include-only walk may legitimately re-enter a file
     * reached through two distinct include chains and rebind on the
     * second visit — last-def-wins depends on seeing both. We block only
     * when recursion would re-enter a file already on the current stack.
     */
    private compute_include_only_end_state(
        file_index: number,
        current_path: Set<number>,
    ): Map<string, number> {
        if (current_path.has(file_index)) return new Map();
        current_path.add(file_index);
        try {
            const the_scope = new Map<string, number>();
            const my_file = this.graph.files[file_index];
            for (const my_event of my_file.events) {
                if (my_event.kind === 'define_local') {
                    the_scope.set(my_event.name, file_index);
                } else if (my_event.kind === 'include_call') {
                    const my_nested = this.compute_include_only_end_state(
                        my_event.target,
                        current_path,
                    );
                    for (const [my_name, my_owner] of my_nested) {
                        the_scope.set(my_name, my_owner);
                    }
                }
                // do_call / run_call: skipped.
            }
            return the_scope;
        } finally {
            current_path.delete(file_index);
        }
    }
}
