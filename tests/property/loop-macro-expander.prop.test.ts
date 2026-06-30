import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { arbitrary_non_reserved_identifier } from './generators';
import { build_static_value_env } from '../../src/analyzer/loop-expander/static-value-env';
import { resolve_loop_value_set } from '../../src/analyzer/loop-expander/value-set-resolver';
import {
    expand_template,
    NameTemplate,
    BindingFrame,
} from '../../src/analyzer/loop-expander/name-expander';
import { MacroSymbol } from '../../src/types';

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function empty_maps() {
    return { localMacros: new Map<string, MacroSymbol>(), globalMacros: new Map<string, MacroSymbol>() };
}

describe('loop-macro-expander properties', () => {
    it('expands valid iterator values into valid identifier names', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                fc.uniqueArray(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 8 }),
                (iterator, values) => {
                    const frames: BindingFrame[] = [{ var: iterator, values }];
                    const template: NameTemplate = {
                        scope: 'local',
                        parts: [{ kind: 'local_ref', name: iterator }, { kind: 'literal', text: '_x' }],
                    };
                    const names = expand_template(template, frames, empty_maps());
                    // Every produced name is a valid identifier ending in _x.
                    for (const name of names) {
                        expect(VALID_IDENTIFIER.test(name)).toBe(true);
                        expect(name.endsWith('_x')).toBe(true);
                    }
                    // One name per distinct value.
                    expect(names.length).toBe(new Set(values).size);
                }
            )
        );
    });

    it('produces exactly b - a + 1 values for a forvalues a/b range', () => {
        const env = build_static_value_env(empty_maps());
        fc.assert(
            fc.property(
                fc.integer({ min: -50, max: 50 }),
                fc.integer({ min: 0, max: 100 }),
                (a, span) => {
                    const b = a + span;
                    const result = resolve_loop_value_set('forvalues', `= ${a}/${b}`, env);
                    expect(result.kind).toBe('static');
                    if (result.kind === 'static') {
                        expect(result.values.length).toBe(span + 1);
                    }
                }
            )
        );
    });

    it('never throws and returns null on cyclic macro references', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (a, b) => {
                    fc.pre(a !== b);
                    const mk = (name: string, value: string): MacroSymbol => ({
                        name,
                        scope: 'local',
                        location: { uri: 'file:///t.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                        sourceUri: 'file:///t.do',
                        value,
                    });
                    const localMacros = new Map<string, MacroSymbol>([
                        [a, mk(a, `\`${b}'`)],
                        [b, mk(b, `\`${a}'`)],
                    ]);
                    const env = build_static_value_env({ localMacros, globalMacros: new Map() });
                    expect(env.resolve_local(a)).toBeNull();
                    expect(env.resolve_local(b)).toBeNull();
                }
            )
        );
    });
});
