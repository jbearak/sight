/**
 * Stata execution oracle for forward-call graphs.
 *
 * Ground truth for `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`.
 * Implemented independently from `ForwardScopeResolver` — it uses simpler,
 * structurally different data flow (a linear flattened list of call sites
 * + last-match-wins resolution) so that regressions in the resolver don't
 * silently reproduce in the oracle.
 *
 * Semantics modelled:
 *
 *  - `is_visible_at()` — real Stata semantics: a stack-based simulator
 *    pushes a fresh scope on `do`/`run` and keeps the caller's scope on
 *    `include`. Reports whether the referenced name is bound when the
 *    reference event fires.
 *
 *  - `blame_target_for()` — last-matching-claim wins. Each `do`/`run`
 *    boundary reachable at-or-before the reference becomes a claim whose
 *    payload is the callee's include-chain end-of-execution locals.
 *    Deeper nested claims are filtered against the shallower direct-child
 *    they bubble through, so a name already claimed by a shallower
 *    sibling doesn't get re-claimed by a deeper one (matching the LSP's
 *    `excluded_locals` filtering). Among claims that survive filtering,
 *    the last one in source order wins.
 */
import { ForwardCallGraph } from '../generators/forward-call-graphs';

interface Claim {
    /** Map from local name → file index that defined it in the include walk. */
    end_state: Map<string, number>;
}

export class StataExecutionOracle {
    constructor(private graph: ForwardCallGraph) {}

    is_visible_at(): boolean {
        const the_scope = this.simulate_stack_until_ref();
        return the_scope !== null && the_scope.has(this.graph.reference_name);
    }

    blame_target_for(): number | null {
        const the_claims = this.collect_claims_at_ref();
        let my_winner: number | null = null;
        for (const my_claim of the_claims) {
            const my_owner = my_claim.end_state.get(this.graph.reference_name);
            if (my_owner !== undefined) {
                my_winner = my_owner;
            }
        }
        return my_winner;
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
     * `null` if the reference is never reached (unreachable by the
     * simulation — shouldn't happen with well-formed graphs).
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
     * Walks an individual file through `include` events only, following
     * the last-def-wins rule across its own `local` statements and the
     * recursively-included files. Used to compute the payload a `do`/`run`
     * boundary would carry (i.e., what the caller would see if the
     * boundary were `include`).
     */
    private include_chain_end_state(
        file_index: number,
        visited: Set<number>,
    ): Map<string, number> {
        if (visited.has(file_index)) return new Map();
        const my_visited = new Set(visited);
        my_visited.add(file_index);
        const the_end_state = new Map<string, number>();
        const my_file = this.graph.files[file_index];
        for (const my_event of my_file.events) {
            if (my_event.kind === 'define_local') {
                the_end_state.set(my_event.name, file_index);
            } else if (my_event.kind === 'include_call') {
                const nested = this.include_chain_end_state(my_event.target, my_visited);
                for (const [my_name, my_file_index] of nested) {
                    the_end_state.set(my_name, my_file_index);
                }
            }
            // do/run contribute nothing to the include-chain walk.
        }
        return the_end_state;
    }

    /**
     * Produce the flattened list of claims that would survive at root's
     * reference. Mirrors the LSP's flattening: each `do`/`run` reachable
     * via any call type creates a claim, and claims that bubble up
     * through a shallower direct-child have their names filtered against
     * that direct-child's claim. Also mirrors the resolver's dedup rule:
     * a file visited once as `do` won't be re-processed for another
     * `do`/`run`, and a file visited as `include` won't be re-processed
     * at all.
     */
    private collect_claims_at_ref(): Claim[] {
        const the_claims: Claim[] = [];
        // Shared across the whole walk so sibling branches see each
        // other's visits (matches `ForwardResolveContext.visited`).
        const visited = new Map<number, 'include' | 'do'>();
        this.resolve_file(0, this.graph.reference_event_index, 'include', visited, the_claims);
        return the_claims;
    }

    private resolve_file(
        file_index: number,
        stop_event_index: number | null,
        parent_effective: 'include' | 'do',
        visited: Map<number, 'include' | 'do'>,
        out_claims: Claim[],
    ): void {
        const my_file = this.graph.files[file_index];
        const limit = stop_event_index ?? my_file.events.length;
        for (let i = 0; i < limit; i++) {
            const my_event = my_file.events[i];
            if (
                my_event.kind !== 'include_call' &&
                my_event.kind !== 'do_call' &&
                my_event.kind !== 'run_call'
            ) {
                continue;
            }
            const call_type: 'include' | 'do' =
                my_event.kind === 'include_call' ? 'include' : 'do';
            const my_effective: 'include' | 'do' =
                parent_effective === 'do' || call_type === 'do' ? 'do' : 'include';

            // Dedup: matches `should_process_call` on the resolver side.
            const my_prev = visited.get(my_event.target);
            let action: 'process' | 'skip' | 'add_locals_only';
            if (my_prev === undefined) {
                action = 'process';
            } else if (my_prev === 'include') {
                action = 'skip';
            } else if (call_type === 'include') {
                // Previously visited as `do`; an `include` to the same
                // file only adds its already-known locals. Doesn't create
                // a new blame claim.
                action = 'add_locals_only';
            } else {
                action = 'skip';
            }
            if (action === 'skip') continue;
            visited.set(my_event.target, my_effective);
            if (action === 'add_locals_only') continue;

            // Direct-child claim for this call.
            let direct_claim: Map<string, number> | null = null;
            if (my_effective === 'do') {
                const the_end_state = this.include_chain_end_state(my_event.target, new Set());
                if (the_end_state.size > 0) {
                    direct_claim = the_end_state;
                    out_claims.push({ end_state: the_end_state });
                }
            }
            // Recurse into the callee; collect its claims into a scratch
            // list, filter against `direct_claim`, then append to out_claims.
            const the_nested: Claim[] = [];
            this.resolve_file(my_event.target, null, my_effective, visited, the_nested);
            for (const my_nested of the_nested) {
                let filtered_end_state: Map<string, number>;
                if (direct_claim !== null) {
                    filtered_end_state = new Map();
                    for (const [my_name, my_file_index] of my_nested.end_state) {
                        if (!direct_claim.has(my_name)) {
                            filtered_end_state.set(my_name, my_file_index);
                        }
                    }
                } else {
                    filtered_end_state = my_nested.end_state;
                }
                if (filtered_end_state.size > 0) {
                    out_claims.push({ end_state: filtered_end_state });
                }
            }
        }
    }
}
