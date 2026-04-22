/**
 * Unit tests for the counterfactual blame model in `StataExecutionOracle`.
 *
 * The oracle is the ground truth for the forward-call OUT_OF_SCOPE_SYMBOL
 * property tests. It must be an *independent* source of truth — derived
 * from Stata runtime semantics rather than the resolver's algorithm — so
 * that a regression in `ForwardScopeResolver` does not silently propagate
 * into the oracle.
 *
 * The counterfactual model: promote every `do`/`run` boundary reachable
 * from the root to `include`, execute the flattened chain in source
 * order, and ask which file last bound the referenced name before the
 * reference event. Implemented independently of the LSP — no dedup rules,
 * no claim-flattening, no excluded-locals filtering.
 */
import { describe, test, expect } from 'bun:test';
import { StataExecutionOracle } from '../property/helpers/stata-execution-oracle';
import { ForwardCallGraph } from '../property/generators/forward-call-graphs';

function graph(files: { name: string; events: any[] }[], reference_event_index: number, reference_name: string): ForwardCallGraph {
    return {
        files: files.map(f => ({ filename: f.name, events: f.events })),
        reference_event_index,
        reference_name: reference_name as any,
    };
}

describe('StataExecutionOracle.blame_target_for (counterfactual)', () => {
    test('Bug A: redefinition after include wins (blames child)', () => {
        // child: local veggie(carrot); include defs; local veggie(spinach)
        // defs: local veggie(beet)
        // root: do child; ref veggie
        const g = graph([
            { name: 'main.do', events: [
                { kind: 'do_call', target: 1 },
                { kind: 'reference_local', name: 'macro_a' },
            ]},
            { name: 'child.do', events: [
                { kind: 'define_local', name: 'macro_a' }, // carrot
                { kind: 'include_call', target: 2 },
                { kind: 'define_local', name: 'macro_a' }, // spinach
            ]},
            { name: 'defs.do', events: [
                { kind: 'define_local', name: 'macro_a' }, // beet
            ]},
        ], 1, 'macro_a');
        const oracle = new StataExecutionOracle(g);
        expect(oracle.blame_target_for()).toBe(1); // child.do
    });

    test('Bug B: do nested under include names grandchild', () => {
        // root: include child; ref veggie
        // child: do grandchild
        // grandchild: local veggie
        const g = graph([
            { name: 'main.do', events: [
                { kind: 'include_call', target: 1 },
                { kind: 'reference_local', name: 'macro_a' },
            ]},
            { name: 'child.do', events: [
                { kind: 'do_call', target: 2 },
            ]},
            { name: 'grandchild.do', events: [
                { kind: 'define_local', name: 'macro_a' },
            ]},
        ], 1, 'macro_a');
        const oracle = new StataExecutionOracle(g);
        expect(oracle.blame_target_for()).toBe(2); // grandchild.do
    });

    test('a813cca: later include-in-chain wins', () => {
        // root: do child; ref veggie
        // child: local veggie(carrot); include defs
        // defs: local veggie(beet)
        const g = graph([
            { name: 'main.do', events: [
                { kind: 'do_call', target: 1 },
                { kind: 'reference_local', name: 'macro_a' },
            ]},
            { name: 'child.do', events: [
                { kind: 'define_local', name: 'macro_a' },
                { kind: 'include_call', target: 2 },
            ]},
            { name: 'defs.do', events: [
                { kind: 'define_local', name: 'macro_a' },
            ]},
        ], 1, 'macro_a');
        const oracle = new StataExecutionOracle(g);
        expect(oracle.blame_target_for()).toBe(2); // defs.do
    });

    test('Codex audit: nested do under include chain names grandchild', () => {
        // root: do child; ref x
        // child: include defs1; include mid
        // defs1: local x
        // mid: do grandchild
        // grandchild: local x
        const g = graph([
            { name: 'main.do', events: [
                { kind: 'do_call', target: 1 },
                { kind: 'reference_local', name: 'macro_a' },
            ]},
            { name: 'child.do', events: [
                { kind: 'include_call', target: 2 },
                { kind: 'include_call', target: 3 },
            ]},
            { name: 'defs1.do', events: [
                { kind: 'define_local', name: 'macro_a' },
            ]},
            { name: 'mid.do', events: [
                { kind: 'do_call', target: 4 },
            ]},
            { name: 'grandchild.do', events: [
                { kind: 'define_local', name: 'macro_a' },
            ]},
        ], 1, 'macro_a');
        const oracle = new StataExecutionOracle(g);
        expect(oracle.blame_target_for()).toBe(4); // grandchild.do
    });

    test('name not defined anywhere returns null', () => {
        const g = graph([
            { name: 'main.do', events: [
                { kind: 'do_call', target: 1 },
                { kind: 'reference_local', name: 'macro_b' },
            ]},
            { name: 'child.do', events: [
                { kind: 'define_local', name: 'macro_a' },
            ]},
        ], 1, 'macro_b');
        const oracle = new StataExecutionOracle(g);
        expect(oracle.blame_target_for()).toBeNull();
    });
});
