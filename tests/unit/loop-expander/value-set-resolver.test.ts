import { describe, it, expect } from 'bun:test';
import { resolve_loop_value_set } from '../../../src/analyzer/loop-expander/value-set-resolver';
import { StaticValueEnv } from '../../../src/analyzer/loop-expander/static-value-env';

function env_from(map: Record<string, string>, globals: Record<string, string> = {}): StaticValueEnv {
    return {
        resolve_local: (name) => (name in map ? map[name] : null),
        resolve_global: (name) => (name in globals ? globals[name] : null),
    };
}

const EMPTY = env_from({});

describe('resolve_loop_value_set: foreach in', () => {
    it('splits a literal list', () => {
        expect(resolve_loop_value_set('foreach', 'in a b c', EMPTY)).toEqual({ kind: 'static', values: ['a', 'b', 'c'] });
    });

    it('expands a local macro ref in the list', () => {
        const env = env_from({ looped: 'x y z' });
        expect(resolve_loop_value_set('foreach', "in `looped'", env)).toEqual({ kind: 'static', values: ['x', 'y', 'z'] });
    });

    it('handles a mixed literal + macro list', () => {
        const env = env_from({ looped: 'x y z', also: 'l m' });
        expect(resolve_loop_value_set('foreach', "in a b `looped' c `also'", env))
            .toEqual({ kind: 'static', values: ['a', 'b', 'x', 'y', 'z', 'c', 'l', 'm'] });
    });

    it('drops an unresolvable macro item (partial dynamic)', () => {
        expect(resolve_loop_value_set('foreach', "in a `unknown' c", EMPTY))
            .toEqual({ kind: 'static', values: ['a', 'c'] });
    });

    it('treats a double-quoted span as a single element', () => {
        expect(resolve_loop_value_set('foreach', 'in "a b" c', EMPTY))
            .toEqual({ kind: 'static', values: ['a b', 'c'] });
    });
});

describe('resolve_loop_value_set: foreach of', () => {
    it('expands of local', () => {
        const env = env_from({ mylist: 'a b c' });
        expect(resolve_loop_value_set('foreach', 'of local mylist', env)).toEqual({ kind: 'static', values: ['a', 'b', 'c'] });
    });

    it('expands of global', () => {
        const env = env_from({}, { glist: 'p q' });
        expect(resolve_loop_value_set('foreach', 'of global glist', env)).toEqual({ kind: 'static', values: ['p', 'q'] });
    });

    it('splits a folded list quote-aware (compound-quoted elements)', () => {
        const env = env_from({ xs: '`"a"\' `"b"\'' });
        expect(resolve_loop_value_set('foreach', 'of local xs', env)).toEqual({ kind: 'static', values: ['a', 'b'] });
    });

    it('is dynamic when of local is unknown', () => {
        expect(resolve_loop_value_set('foreach', 'of local unknown', EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('is dynamic for of varlist', () => {
        expect(resolve_loop_value_set('foreach', 'of varlist price mpg', EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('is dynamic for of numlist', () => {
        expect(resolve_loop_value_set('foreach', 'of numlist 1/3', EMPTY)).toEqual({ kind: 'dynamic' });
    });
});

describe('resolve_loop_value_set: forvalues', () => {
    it('expands a/b range', () => {
        expect(resolve_loop_value_set('forvalues', '= 1/3', EMPTY)).toEqual({ kind: 'static', values: ['1', '2', '3'] });
    });

    it('expands a(step)b range', () => {
        expect(resolve_loop_value_set('forvalues', '= 1(2)9', EMPTY)).toEqual({ kind: 'static', values: ['1', '3', '5', '7', '9'] });
    });

    it('resolves macro range bounds that fold to integers', () => {
        const env = env_from({ n: '3' });
        expect(resolve_loop_value_set('forvalues', "= 1/`n'", env)).toEqual({ kind: 'static', values: ['1', '2', '3'] });
    });

    it('is dynamic for non-integer bounds', () => {
        expect(resolve_loop_value_set('forvalues', '= 1/x', EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('is dynamic for a zero step', () => {
        expect(resolve_loop_value_set('forvalues', '= 1(0)9', EMPTY)).toEqual({ kind: 'dynamic' });
    });
});
