import { describe, test, expect } from 'bun:test';
import {
    get_visible_symbols_at,
    get_visible_forward_call_sites,
    collect_visible_uris,
} from '../../../src/scope-resolver/visible-symbols';
import { create_empty_symbol_table } from '../../../src/analyzer';
import type {
    ResolvedScope,
    ForwardCallSite,
    ProgramSymbol,
    ScopeChainEntry,
} from '../../../src/types';

const make_program = (name: string, uri: string): ProgramSymbol => ({
    name,
    location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
    sourceUri: uri,
});

const empty_scope: ResolvedScope = {
    chain: [],
    symbols: create_empty_symbol_table(),
    out_of_scope_symbols: [],
    diagnostics: [],
    has_directives: false,
    has_auto_parents: false,
};

describe('get_visible_symbols_at', () => {
    test('returns an empty SymbolTable when scope is undefined', () => {
        const the_result = get_visible_symbols_at(undefined, 0);
        expect(the_result.programs.size).toBe(0);
        expect(the_result.localMacros.size).toBe(0);
        expect(the_result.globalMacros.size).toBe(0);
        expect(the_result.variables.size).toBe(0);
        expect(the_result.scalars.size).toBe(0);
        expect(the_result.matrices.size).toBe(0);
    });

    test('returns scope.symbols verbatim when forward_call_symbols is empty', () => {
        const my_base: ResolvedScope = {
            ...empty_scope,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['base_prog', make_program('base_prog', 'file:///a.do')]]),
            },
        };
        const the_result = get_visible_symbols_at(my_base, 100);
        expect(the_result.programs.has('base_prog')).toBe(true);
    });

    test('includes a forward-call site symbol when call_line < cursor_line', () => {
        const my_site: ForwardCallSite = {
            callee_uri: 'file:///callee.do',
            call_line: 5,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['fwd_prog', make_program('fwd_prog', 'file:///callee.do')]]),
            },
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = { ...empty_scope, forward_call_symbols: [my_site] };
        const at_six = get_visible_symbols_at(my_scope, 6);
        expect(at_six.programs.has('fwd_prog')).toBe(true);
    });

    test('excludes a forward-call site symbol when call_line >= cursor_line (strict <)', () => {
        const my_site: ForwardCallSite = {
            callee_uri: 'file:///callee.do',
            call_line: 5,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['fwd_prog', make_program('fwd_prog', 'file:///callee.do')]]),
            },
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = { ...empty_scope, forward_call_symbols: [my_site] };
        const at_five = get_visible_symbols_at(my_scope, 5);
        expect(at_five.programs.has('fwd_prog')).toBe(false);
        const at_four = get_visible_symbols_at(my_scope, 4);
        expect(at_four.programs.has('fwd_prog')).toBe(false);
    });

    test('lattermost overlay wins on name collision', () => {
        const site_a_prog = make_program('shared_prog', 'file:///a.do');
        const site_b_prog = make_program('shared_prog', 'file:///b.do');
        const site_a: ForwardCallSite = {
            callee_uri: 'file:///a.do',
            call_line: 1,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', site_a_prog]]),
            },
            effective_type: 'do',
        };
        const site_b: ForwardCallSite = {
            callee_uri: 'file:///b.do',
            call_line: 2,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', site_b_prog]]),
            },
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = { ...empty_scope, forward_call_symbols: [site_a, site_b] };
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.programs.get('shared_prog')?.location.uri).toBe('file:///b.do');
    });
});

describe('get_visible_forward_call_sites', () => {
    test('returns [] when scope is undefined', () => {
        expect(get_visible_forward_call_sites(undefined, 0)).toEqual([]);
    });

    test('returns [] when forward_call_symbols is undefined', () => {
        expect(get_visible_forward_call_sites(empty_scope, 0)).toEqual([]);
    });

    test('preserves input array order for visible sites', () => {
        const site_early: ForwardCallSite = {
            callee_uri: 'file:///early.do',
            call_line: 1,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const site_later: ForwardCallSite = {
            callee_uri: 'file:///later.do',
            call_line: 3,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = {
            ...empty_scope,
            forward_call_symbols: [site_early, site_later],
        };
        const the_result = get_visible_forward_call_sites(my_scope, 10);
        expect(the_result.map(s => s.callee_uri)).toEqual(['file:///early.do', 'file:///later.do']);
    });

    test('strict < boundary: call_line === cursor_line is excluded', () => {
        const my_site: ForwardCallSite = {
            callee_uri: 'file:///boundary.do',
            call_line: 5,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = { ...empty_scope, forward_call_symbols: [my_site] };
        expect(get_visible_forward_call_sites(my_scope, 5)).toEqual([]);
        expect(get_visible_forward_call_sites(my_scope, 6)).toHaveLength(1);
    });
});

describe('collect_visible_uris', () => {
    test('returns a Set containing just current_uri when scope is undefined', () => {
        const the_result = collect_visible_uris(undefined, 0, 'file:///current.do');
        expect(the_result.size).toBe(1);
        expect(the_result.has('file:///current.do')).toBe(true);
    });

    test('includes every chain[*].uri regardless of cursor_line', () => {
        const chain_entries: ScopeChainEntry[] = [
            {
                uri: 'file:///parent1.do',
                directive_type: 'done-by',
                call_site_line: 0,
                symbols: create_empty_symbol_table(),
                depth: 1,
                directive_order: 0,
                sort_key: 'a',
            },
            {
                uri: 'file:///parent2.do',
                directive_type: 'included-by',
                call_site_line: 0,
                symbols: create_empty_symbol_table(),
                depth: 2,
                directive_order: 1,
                sort_key: 'b',
            },
        ];
        const my_scope: ResolvedScope = { ...empty_scope, chain: chain_entries };
        const the_result = collect_visible_uris(my_scope, 0, 'file:///current.do');
        expect(the_result.has('file:///current.do')).toBe(true);
        expect(the_result.has('file:///parent1.do')).toBe(true);
        expect(the_result.has('file:///parent2.do')).toBe(true);
    });

    test('includes callee_uri only for sites with call_line < cursor_line', () => {
        const site_visible: ForwardCallSite = {
            callee_uri: 'file:///visible.do',
            call_line: 1,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const site_hidden: ForwardCallSite = {
            callee_uri: 'file:///hidden.do',
            call_line: 10,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = {
            ...empty_scope,
            forward_call_symbols: [site_visible, site_hidden],
        };
        const the_result = collect_visible_uris(my_scope, 5, 'file:///current.do');
        expect(the_result.has('file:///visible.do')).toBe(true);
        expect(the_result.has('file:///hidden.do')).toBe(false);
    });
});
