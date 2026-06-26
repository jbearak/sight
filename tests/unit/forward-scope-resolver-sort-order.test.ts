/**
 * Unit test for the sort comparator inside
 * `ForwardScopeResolver.compute_effective_end_state_locals`.
 *
 * The helper orders walk events to produce last-def-wins blame. Codex's
 * audit flagged that sorting by `line` alone collapses same-line events
 * — this matters under Stata's `#delimit ;` mode where an include and a
 * `local` redefinition can share one physical line. The analyzer does
 * not currently extract forward calls under `#delimit ;`, so a full
 * end-to-end repro is parser-blocked; this test exercises the sort logic
 * in isolation by stubbing the resolver's callee-scope fetch to return
 * events that share a line but differ in character position.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import type { ForwardCall, MacroSymbol, SymbolTable } from '../../src/types';

function empty_symbol_table(): SymbolTable {
    return {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
}

function make_local(uri: string, name: string, line: number, character: number): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: {
            uri,
            range: {
                start: { line, character },
                end: { line, character: character + 5 + name.length },
            },
        },
        sourceUri: uri,
        definition_line: line,
        containingScope: 'dofile',
    };
}

function make_include_call(line: number, character: number, target_path: string): ForwardCall {
    return {
        type: 'include',
        path: target_path,
        raw_path: target_path,
        call_site_line: line,
        range: {
            start: { line, character },
            end: { line, character: character + 10 },
        },
        source: 'command',
        is_static: true,
    };
}

describe('compute_effective_end_state_locals sort order', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver, { max_forward_depth: 10 });
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    test('same-line include-then-local: local (later character) wins', async () => {
        const callee_uri = 'file:///stub/callee.do';
        const defs_uri = 'file:///stub/defs.do';
        // Callee has: `include defs.do` at col 0, then `local veggie carrot`
        // at col 30 — BOTH on line 5.
        const callee_local_at_col30 = make_local(callee_uri, 'veggie', 5, 30);
        const defs_local_at_col0 = make_local(defs_uri, 'veggie', 0, 0);
        (forward_resolver as any).get_callee_scope = async (_path: string, uri: string) => {
            if (uri === callee_uri) {
                return {
                    symbols: {
                        ...empty_symbol_table(),
                        localMacros: new Map([['veggie', callee_local_at_col30]]),
                    },
                    forward_calls: [make_include_call(5, 0, '/stub/defs.do')],
                };
            }
            if (uri === defs_uri) {
                return {
                    symbols: {
                        ...empty_symbol_table(),
                        localMacros: new Map([['veggie', defs_local_at_col0]]),
                    },
                    forward_calls: [],
                };
            }
            throw new Error('unexpected uri: ' + uri);
        };
        // Also need resolve_call_path to return the defs fs path unchanged.
        (forward_resolver as any).resolve_call_path = (
            _raw: string,
            resolved: string,
        ) => ({ resolved_path: resolved, outcome_kind: 'exact' as const });
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            '/stub/callee.do',
            undefined,
            new Set<string>(),
            1,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.size).toBe(1);
        const winner = result.get('veggie');
        expect(winner).toBeDefined();
        expect(winner!.sourceUri).toBe(callee_uri);
    });

    test('same-line local-then-include: include (later character) wins', async () => {
        const callee_uri = 'file:///stub/callee2.do';
        const defs_uri = 'file:///stub/defs2.do';
        const callee_local_at_col0 = make_local(callee_uri, 'veggie', 5, 0);
        const defs_local = make_local(defs_uri, 'veggie', 0, 0);
        (forward_resolver as any).get_callee_scope = async (_path: string, uri: string) => {
            if (uri === callee_uri) {
                return {
                    symbols: {
                        ...empty_symbol_table(),
                        localMacros: new Map([['veggie', callee_local_at_col0]]),
                    },
                    // Include happens at col 30 — AFTER the local on the same line.
                    forward_calls: [make_include_call(5, 30, '/stub/defs2.do')],
                };
            }
            if (uri === defs_uri) {
                return {
                    symbols: {
                        ...empty_symbol_table(),
                        localMacros: new Map([['veggie', defs_local]]),
                    },
                    forward_calls: [],
                };
            }
            throw new Error('unexpected uri: ' + uri);
        };
        (forward_resolver as any).resolve_call_path = (
            _raw: string,
            resolved: string,
        ) => ({ resolved_path: resolved, outcome_kind: 'exact' as const });
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            '/stub/callee2.do',
            undefined,
            new Set<string>(),
            1,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.size).toBe(1);
        const winner = result.get('veggie');
        expect(winner).toBeDefined();
        expect(winner!.sourceUri).toBe(defs_uri);
    });
});
