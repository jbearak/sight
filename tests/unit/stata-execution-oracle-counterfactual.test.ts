/**
 * Unit tests for the single-boundary blame model in `StataExecutionOracle`.
 *
 * The oracle is the ground truth for the forward-call OUT_OF_SCOPE_SYMBOL
 * property tests. It must be an *independent* source of truth — derived
 * from Stata runtime semantics rather than the resolver's algorithm — so
 * that a regression in `ForwardScopeResolver` does not silently propagate
 * into the oracle.
 *
 * The single-boundary model: for each root-level `do`/`run` call that
 * precedes the reference, promote ONLY that one boundary to `include` and
 * walk the callee under an include-only end-state rule (own `local`
 * statements + recursion through `include` only). Return the file whose
 * binding wins under that single-boundary promotion, or null if no such
 * promotion would expose the name. Nested `do`/`run` stay opaque —
 * exposing them would require a separate fix.
 */
import { describe, test, expect } from 'bun:test';
import { StataExecutionOracle } from '../property/helpers/stata-execution-oracle';
import {
    ForwardCallGraph,
    FileEvent,
    MacroName,
} from '../property/generators/forward-call-graphs';

function graph(
    files: { name: string; events: FileEvent[] }[],
    reference_event_index: number,
    reference_name: MacroName,
): ForwardCallGraph {
    return {
        files: files.map(f => ({ filename: f.name, events: f.events })),
        reference_event_index,
        reference_name,
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

    test('Bug B: root include blocker is not a do/run - returns null', () => {
        // root: include child; ref macro_a
        // child: do grandchild
        // grandchild: local macro_a
        //
        // Single-boundary semantics: no root-level do/run precedes the
        // reference, so no one-line fix on a root `do`/`run` exposes the
        // binding. The diagnostic falls back to generic UNDEFINED_MACRO and
        // the oracle must return null.
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
        expect(oracle.blame_target_for()).toBeNull();
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

    test('Codex audit: nested do under include chain names defs1 (single-boundary)', () => {
        // root: do child; ref macro_a
        // child: include defs1; include mid
        // defs1: local macro_a
        // mid: do grandchild
        // grandchild: local macro_a
        //
        // Promoting only root's `do child` to `include child` makes child run
        // in main's scope. child's include-only end-state: include defs1
        // binds macro_a to defs1; include mid contributes nothing (mid's only
        // event is a do, which is opaque). grandchild's binding is NOT
        // exposed by this one-line fix.
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
        expect(oracle.blame_target_for()).toBe(2); // defs1.do
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
