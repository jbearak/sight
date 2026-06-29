import { describe, it, expect } from 'bun:test';
import { build_static_value_env } from '../../../src/analyzer/loop-expander/static-value-env';
import { MacroSymbol } from '../../../src/types';

function macro(
    name: string,
    value: string | undefined,
    extras: Partial<MacroSymbol> = {}
): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: { uri: 'file:///t.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
        sourceUri: 'file:///t.do',
        value,
        ...extras,
    };
}

function locals(...syms: MacroSymbol[]): { localMacros: Map<string, MacroSymbol>; globalMacros: Map<string, MacroSymbol> } {
    const localMacros = new Map<string, MacroSymbol>();
    for (const s of syms) localMacros.set(s.name, s);
    return { localMacros, globalMacros: new Map() };
}

describe('build_static_value_env', () => {
    it('resolves globals and braced global refs', () => {
        const env = build_static_value_env({
            localMacros: new Map([
                ['x', macro('x', 'p_${g}')],
            ]),
            globalMacros: new Map([
                ['g', macro('g', 'q', { scope: 'global' })],
            ]),
        });
        expect(env.resolve_global('g')).toBe('q');
        expect(env.resolve_local('x')).toBe('p_q');
    });

    it('resolves a bare literal value', () => {
        const env = build_static_value_env(locals(macro('mylist', 'a b c')));
        expect(env.resolve_local('mylist')).toBe('a b c');
    });

    it('resolves a quoted literal without equals (strips quotes)', () => {
        const env = build_static_value_env(locals(macro('mylist', '"a b c"')));
        expect(env.resolve_local('mylist')).toBe('a b c');
    });

    it('resolves a quoted literal WITH equals as static', () => {
        const env = build_static_value_env(locals(macro('mylist', '"a b c"', { hasEquals: true })));
        expect(env.resolve_local('mylist')).toBe('a b c');
    });

    it('treats a non-literal = expression as dynamic', () => {
        const env = build_static_value_env(locals(macro('n', '2+2', { hasEquals: true })));
        expect(env.resolve_local('n')).toBeNull();
    });

    it('treats a multi-literal = expression as dynamic (not one literal)', () => {
        // `local x = "a" + "b"` evaluates to "ab" in Stata; the value text is an
        // expression, not a single string literal, so it must NOT be folded as
        // the mis-stripped inner `a" + "b`.
        const env = build_static_value_env(locals(macro('x', '"a" + "b"', { hasEquals: true })));
        expect(env.resolve_local('x')).toBeNull();
    });

    it('treats concatenated compound literals as dynamic', () => {
        const env = build_static_value_env(
            locals(macro('x', '`"a"\' + `"b"\'', { hasEquals: true }))
        );
        expect(env.resolve_local('x')).toBeNull();
    });

    it('still folds a single compound `"..."\' literal', () => {
        const env = build_static_value_env(locals(macro('x', '`"a b"\'')));
        expect(env.resolve_local('x')).toBe('a b');
    });

    it('treats command placeholders as dynamic', () => {
        const env = build_static_value_env(locals(macro('t', '__tempvar_t__')));
        expect(env.resolve_local('t')).toBeNull();
    });

    it('treats extended-function macros as dynamic', () => {
        const env = build_static_value_env(locals(macro('x', '', { extendedFunction: { name: 'word', args: '1 of `l\'' } })));
        expect(env.resolve_local('x')).toBeNull();
    });

    it('folds chained references recursively', () => {
        const env = build_static_value_env(locals(macro('a', '`b\''), macro('b', 'x')));
        expect(env.resolve_local('a')).toBe('x');
    });

    it('returns null (no throw) on cyclic references', () => {
        const env = build_static_value_env(locals(macro('a', '`b\''), macro('b', '`a\'')));
        expect(env.resolve_local('a')).toBeNull();
    });

    it('treats a redefined macro (additional_definitions) as dynamic', () => {
        // First-def-wins stores the first value; a redefinition makes the
        // stored value stale, so folding must not use it.
        const redefined = macro('xs', 'a', {
            additional_definitions: [{
                index: 1,
                line: 1,
                location: { uri: 'file:///t.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } } },
            }],
        });
        const env = build_static_value_env(locals(redefined));
        expect(env.resolve_local('xs')).toBeNull();
    });

    it('returns null for unknown macros', () => {
        const env = build_static_value_env(locals());
        expect(env.resolve_local('nope')).toBeNull();
    });

    it('uses the per-tuple overlay first', () => {
        const env = build_static_value_env(locals(), new Map([['i', 'a']]));
        expect(env.resolve_local('i')).toBe('a');
    });

    it('does NOT rebind a stored macro\'s iterator ref to the overlay', () => {
        // A helper defined before the loop with value `i' was already expanded
        // at its (pre-loop) definition time, so the overlay (loop binding) must
        // NOT apply when folding it. With no pre-loop value for `i`, `suffix`
        // is unresolvable (conservative) rather than folding to "a".
        const env = build_static_value_env(locals(macro('suffix', '`i\'')), new Map([['i', 'a']]));
        expect(env.resolve_local('suffix')).toBeNull();
    });

    it('folds a stored macro\'s iterator ref against the iterator\'s PRE-LOOP value', () => {
        // `local i old` then `local suffix `i'` (both before the loop): the
        // overlay binds i=a for the loop, but `suffix' must resolve to i's
        // pre-loop value ("old"), the value Stata froze at suffix's definition.
        const env = build_static_value_env(
            locals(macro('i', 'old'), macro('suffix', '`i\'')),
            new Map([['i', 'a']])
        );
        expect(env.resolve_local('suffix')).toBe('old');
    });

    it('returns null when a referenced macro is dynamic', () => {
        // b is a = expression (dynamic), so a (which references b) is unresolvable.
        const env = build_static_value_env(locals(macro('a', 'p_`b\''), macro('b', '1+1', { hasEquals: true })));
        expect(env.resolve_local('a')).toBeNull();
    });
});
