import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../../src/lexer';
import {
    extract_name_template,
    expand_template,
    NameTemplate,
    BindingFrame,
} from '../../../src/analyzer/loop-expander/name-expander';
import { MacroSymbol, SymbolTable, Token } from '../../../src/types';

function stmt_tokens(source: string): Token[] {
    const result = new StataLexer().tokenize(source);
    return result.tokens.filter((t) => t.type !== 'EOF');
}

function macro(name: string, value: string): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: { uri: 'file:///t.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
        sourceUri: 'file:///t.do',
        value,
    };
}

function maps(...syms: MacroSymbol[]): Pick<SymbolTable, 'localMacros' | 'globalMacros'> {
    const localMacros = new Map<string, MacroSymbol>();
    for (const s of syms) localMacros.set(s.name, s);
    return { localMacros, globalMacros: new Map() };
}

describe('extract_name_template', () => {
    it('extracts a pure iterator name', () => {
        expect(extract_name_template(stmt_tokens("local `i'"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }],
        });
    });

    it('extracts iterator + literal suffix', () => {
        expect(extract_name_template(stmt_tokens("local `i'_suffix"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_suffix' }],
        });
    });

    it('extracts literal prefix + iterator', () => {
        expect(extract_name_template(stmt_tokens("local prefix_`i'"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'literal', text: 'prefix_' }, { kind: 'local_ref', name: 'i' }],
        });
    });

    it('extracts prefix + iterator + literal + ref', () => {
        expect(extract_name_template(stmt_tokens("local prefix_`i'_`suffix'"))).toEqual({
            scope: 'local',
            parts: [
                { kind: 'literal', text: 'prefix_' },
                { kind: 'local_ref', name: 'i' },
                { kind: 'literal', text: '_' },
                { kind: 'local_ref', name: 'suffix' },
            ],
        });
    });

    it('includes a digit adjacent to the macro ref', () => {
        expect(extract_name_template(stmt_tokens("local v`i'1"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'literal', text: 'v' }, { kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '1' }],
        });
    });

    it('returns null for a plain bare name', () => {
        expect(extract_name_template(stmt_tokens('local x'))).toBeNull();
    });

    it('stops the name at a whitespace gap (value is separate)', () => {
        expect(extract_name_template(stmt_tokens("local `i' somevalue"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }],
        });
    });

    it('captures global scope', () => {
        expect(extract_name_template(stmt_tokens("global `i'_g"))).toEqual({
            scope: 'global',
            parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_g' }],
        });
    });

    it('skips a leading capture prefix', () => {
        expect(extract_name_template(stmt_tokens("capture local `i'"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }],
        });
    });

    it('skips a leading prefix command with a colon', () => {
        expect(extract_name_template(stmt_tokens("quietly: local `i'_x"))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_x' }],
        });
    });

    it('returns null for a ++ increment (not a definition)', () => {
        expect(extract_name_template(stmt_tokens("local ++`i'"))).toBeNull();
    });

    it('stops the name at a colon (extended macro)', () => {
        expect(extract_name_template(stmt_tokens("local `i'_x : subinstr local foo \"a\" \"b\""))).toEqual({
            scope: 'local',
            parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_x' }],
        });
    });
});

describe('expand_template', () => {
    const frames_i: BindingFrame[] = [{ var: 'i', values: ['a', 'b', 'c'] }];

    it('expands across the iterator', () => {
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_suffix' }] };
        expect(expand_template(t, frames_i, maps()).sort()).toEqual(['a_suffix', 'b_suffix', 'c_suffix']);
    });

    it('produces the cartesian product for nested frames', () => {
        const frames: BindingFrame[] = [{ var: 'i', values: ['a', 'b'] }, { var: 'j', values: ['x', 'y'] }];
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_' }, { kind: 'local_ref', name: 'j' }] };
        expect(expand_template(t, frames, maps()).sort()).toEqual(['a_x', 'a_y', 'b_x', 'b_y']);
    });

    it('folds a non-iterator static local in the name', () => {
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_' }, { kind: 'local_ref', name: 'suffix' }] };
        expect(expand_template(t, frames_i, maps(macro('suffix', 'foo'))).sort()).toEqual(['a_foo', 'b_foo', 'c_foo']);
    });

    it('does not rebind a pre-loop helper\'s iterator ref to the loop binding', () => {
        // `suffix' is a (pre-loop) helper whose value is `i'. Stata froze that
        // `i' at suffix's earlier definition, so it must NOT be rebound to the
        // loop iterator: x_a/x_b/x_c are never defined at runtime. With no
        // pre-loop value for `i', suffix is unresolvable -> no names (the
        // conservative miss; never a false suppression).
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'literal', text: 'x_' }, { kind: 'local_ref', name: 'suffix' }] };
        expect(expand_template(t, frames_i, maps(macro('suffix', "`i'")))).toEqual([]);
    });

    it('folds a pre-loop helper\'s iterator ref against the iterator\'s pre-loop value', () => {
        // `i' = "old" before the loop, then `suffix' = `i' = "old". The single
        // constructed name is x_old (frozen), independent of the loop binding.
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'literal', text: 'x_' }, { kind: 'local_ref', name: 'suffix' }] };
        expect(expand_template(t, frames_i, maps(macro('i', 'old'), macro('suffix', "`i'")))).toEqual(['x_old']);
    });

    it('drops names that are not valid Stata identifiers (digit-leading)', () => {
        // forvalues-style integer iterator at the start of the name.
        const frames: BindingFrame[] = [{ var: 'i', values: ['1', '2', '3'] }];
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_suffix' }] };
        expect(expand_template(t, frames, maps())).toEqual([]);
    });

    it('skips tuples with an unresolvable slot (partial dynamic)', () => {
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'local_ref', name: 'i' }, { kind: 'literal', text: '_' }, { kind: 'local_ref', name: 'missing' }] };
        expect(expand_template(t, frames_i, maps())).toEqual([]);
    });

    it('dedupes names that do not depend on every frame', () => {
        const frames: BindingFrame[] = [{ var: 'i', values: ['a', 'b'] }, { var: 'j', values: ['x', 'y'] }];
        const t: NameTemplate = { scope: 'local', parts: [{ kind: 'literal', text: 'p_' }, { kind: 'local_ref', name: 'i' }] };
        expect(expand_template(t, frames, maps()).sort()).toEqual(['p_a', 'p_b']);
    });
});
