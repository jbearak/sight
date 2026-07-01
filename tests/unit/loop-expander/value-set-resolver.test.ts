import { describe, it, expect } from 'bun:test';
import { resolve_loop_value_set } from '../../../src/analyzer/loop-expander/value-set-resolver';
import { StaticValueEnv, StaticValue } from '../../../src/analyzer/loop-expander/static-value-env';
import { scan_macro_refs } from '../../../src/analyzer/loop-expander/macro-ref-scanner';

function env_from(map: Record<string, string>, globals: Record<string, string> = {}): StaticValueEnv {
    const resolve_local = (name: string): StaticValue => (name in map ? map[name] : null);
    const resolve_global = (name: string): StaticValue => (name in globals ? globals[name] : null);
    return {
        resolve_local,
        resolve_global,
        interpolate: (text: string): StaticValue => {
            const parts: string[] = [];
            const ok = scan_macro_refs(text, {
                literal: (ch) => { parts.push(ch); },
                local_ref: (name) => {
                    const value = resolve_local(name);
                    if (value === null) return false;
                    parts.push(value);
                    return true;
                },
                global_ref: (name) => {
                    const value = resolve_global(name);
                    if (value === null) return false;
                    parts.push(value);
                    return true;
                },
            });
            return ok ? parts.join('') : null;
        },
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

    it('expands valid braced and unbraced global refs in the list', () => {
        const env = env_from({}, { looped: 'x y', also: 'z' });
        expect(resolve_loop_value_set('foreach', 'in $looped ${also}', env))
            .toEqual({ kind: 'static', values: ['x', 'y', 'z'] });
    });

    it('does not resolve half-braced global refs as pure globals', () => {
        const env = env_from({}, { looped: 'x y' });
        expect(resolve_loop_value_set('foreach', 'in ${looped $looped}', env))
            .toEqual({ kind: 'static', values: ['${looped', '$looped}'] });
    });

    it('drops an unresolvable macro item (partial dynamic)', () => {
        expect(resolve_loop_value_set('foreach', "in a `unknown' c", EMPTY))
            .toEqual({ kind: 'static', values: ['a', 'c'] });
    });

    it('is dynamic when every list item is unresolvable', () => {
        expect(resolve_loop_value_set('foreach', "in `r(levels)'", EMPTY))
            .toEqual({ kind: 'dynamic' });
    });

    it('interpolates a macro ref adjacent to literal text in an unquoted item', () => {
        const env = env_from({ m: 'b' }, { g: '1' });
        expect(resolve_loop_value_set('foreach', "in a`m' x$g", env))
            .toEqual({ kind: 'static', values: ['ab', 'x1'] });
    });

    it('expands then whitespace-splits an adjacent macro that holds a list', () => {
        const env = env_from({ m: 'b c' });
        expect(resolve_loop_value_set('foreach', "in a`m'", env))
            .toEqual({ kind: 'static', values: ['ab', 'c'] });
    });

    it('drops an unquoted item whose adjacent macro ref is dynamic', () => {
        expect(resolve_loop_value_set('foreach', "in p a`unknown' q", EMPTY))
            .toEqual({ kind: 'static', values: ['p', 'q'] });
    });

    it('treats a double-quoted span as a single element', () => {
        expect(resolve_loop_value_set('foreach', 'in "a b" c', EMPTY))
            .toEqual({ kind: 'static', values: ['a b', 'c'] });
    });

    it('interpolates macro refs embedded in a quoted element', () => {
        const env = env_from({ m: 'mid' });
        expect(resolve_loop_value_set('foreach', "in \"a`m'b\" c", env))
            .toEqual({ kind: 'static', values: ['amidb', 'c'] });
    });

    it('drops a quoted element whose embedded ref is dynamic', () => {
        expect(resolve_loop_value_set('foreach', "in \"a`unknown'b\" c", EMPTY))
            .toEqual({ kind: 'static', values: ['c'] });
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

    it('resolves braced and unbraced global range bounds that fold to integers', () => {
        const env = env_from({}, { start: '1', end: '3' });
        expect(resolve_loop_value_set('forvalues', '= $start/${end}', env)).toEqual({ kind: 'static', values: ['1', '2', '3'] });
    });

    it('is dynamic for half-braced global range bounds', () => {
        const env = env_from({}, { start: '1', end: '3' });
        expect(resolve_loop_value_set('forvalues', '= ${start/$end}', env)).toEqual({ kind: 'dynamic' });
    });

    it('is dynamic for non-integer bounds', () => {
        expect(resolve_loop_value_set('forvalues', '= 1/x', EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('is dynamic for a zero step', () => {
        expect(resolve_loop_value_set('forvalues', '= 1(0)9', EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('handles adversarial stepped-range punctuation as dynamic', () => {
        const input = `= ${'!('.repeat(200)}${'!)!'.repeat(200)}`;
        expect(resolve_loop_value_set('forvalues', input, EMPTY)).toEqual({ kind: 'dynamic' });
    });

    it('handles adversarial slash-range punctuation as dynamic', () => {
        const input = `= ${'!/!'.repeat(500)}`;
        expect(resolve_loop_value_set('forvalues', input, EMPTY)).toEqual({ kind: 'dynamic' });
    });
});
