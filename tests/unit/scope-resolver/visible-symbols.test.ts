import { describe, test, expect } from 'bun:test';
import {
    get_visible_symbols_at,
    get_visible_forward_call_sites,
    collect_visible_reference_uris,
} from '../../../src/scope-resolver/visible-symbols';
import { create_empty_symbol_table } from '../../../src/analyzer';
import type {
    ResolvedScope,
    ForwardCallSite,
    ProgramSymbol,
    MacroSymbol,
    ScopeChainEntry,
} from '../../../src/types';

const make_program = (name: string, uri: string): ProgramSymbol => ({
    name,
    location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
    sourceUri: uri,
});

const make_local_macro = (name: string, uri: string): MacroSymbol => ({
    name,
    scope: 'local',
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

describe('collect_visible_reference_uris', () => {
    test('returns a Set containing just current_uri when scope is undefined', () => {
        const the_result = collect_visible_reference_uris(
            undefined,
            0,
            'file:///current.do',
            'program',
            'shared_prog',
        );
        expect(the_result.size).toBe(1);
        expect(the_result.has('file:///current.do')).toBe(true);
    });

    test('includes only URIs contributing the active visible symbol instance', () => {
        const parent1_prog = make_program('shared_prog', 'file:///parent1.do');
        const parent2_prog = make_program('shared_prog', 'file:///parent2.do');
        const parent1_callee_prog = make_program(
            'shared_prog',
            'file:///parent1-callee.do',
        );
        const parent2_callee_prog = make_program(
            'shared_prog',
            'file:///parent2-callee.do',
        );
        const visible_prog = make_program('shared_prog', 'file:///current-visible.do');
        const chain_entries: ScopeChainEntry[] = [
            {
                uri: 'file:///parent1.do',
                directive_type: 'done-by',
                call_site_line: 0,
                symbols: {
                    ...create_empty_symbol_table(),
                    programs: new Map([['shared_prog', parent1_prog]]),
                },
                forward_call_sites: [{
                    callee_uri: 'file:///parent1-callee.do',
                    call_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', parent1_callee_prog]]),
                    },
                    effective_type: 'do',
                }],
                depth: 1,
                directive_order: 0,
                sort_key: 'a',
            },
            {
                uri: 'file:///parent2.do',
                directive_type: 'included-by',
                call_site_line: 0,
                symbols: {
                    ...create_empty_symbol_table(),
                    programs: new Map([['shared_prog', parent2_prog]]),
                },
                forward_call_sites: [{
                    callee_uri: 'file:///parent2-callee.do',
                    call_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', parent2_callee_prog]]),
                    },
                    effective_type: 'include',
                }],
                depth: 2,
                directive_order: 1,
                sort_key: 'b',
            },
        ];
        const my_scope: ResolvedScope = {
            ...empty_scope,
            chain: chain_entries,
            forward_call_symbols: [
                {
                    callee_uri: 'file:///current-visible.do',
                    call_line: 1,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', visible_prog]]),
                    },
                    effective_type: 'do',
                },
                {
                    callee_uri: 'file:///current-hidden.do',
                    call_line: 10,
                    symbols: create_empty_symbol_table(),
                    effective_type: 'include',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            5,
            'file:///current.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///current.do')).toBe(true);
        expect(the_result.has('file:///parent1.do')).toBe(false);
        expect(the_result.has('file:///parent2.do')).toBe(false);
        expect(the_result.has('file:///parent1-callee.do')).toBe(false);
        expect(the_result.has('file:///parent2-callee.do')).toBe(false);
        expect(the_result.has('file:///current-visible.do')).toBe(true);
        expect(the_result.has('file:///current-hidden.do')).toBe(false);
    });

    test('excludes an earlier same-depth backward parent when a later winner masks it', () => {
        const earlier_prog = make_program('shared_prog', 'file:///earlier-parent.do');
        const later_prog = make_program('shared_prog', 'file:///later-parent.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', later_prog]]),
            },
            chain: [
                {
                    uri: 'file:///earlier-parent.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', earlier_prog]]),
                    },
                    forward_call_sites: [],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
                {
                    uri: 'file:///later-parent.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', later_prog]]),
                    },
                    forward_call_sites: [],
                    depth: 1,
                    directive_order: 1,
                    sort_key: 'b',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            5,
            'file:///current.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///current.do')).toBe(true);
        expect(the_result.has('file:///earlier-parent.do')).toBe(false);
        expect(the_result.has('file:///later-parent.do')).toBe(true);
    });

    test('excludes an earlier visible forward callee when a later winner masks it', () => {
        const earlier_prog = make_program('shared_prog', 'file:///earlier.do');
        const later_prog = make_program('shared_prog', 'file:///later.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            forward_call_symbols: [
                {
                    callee_uri: 'file:///earlier.do',
                    call_line: 1,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', earlier_prog]]),
                    },
                    effective_type: 'do',
                },
                {
                    callee_uri: 'file:///later.do',
                    call_line: 2,
                    symbols: {
                        ...create_empty_symbol_table(),
                        programs: new Map([['shared_prog', later_prog]]),
                    },
                    effective_type: 'do',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            5,
            'file:///current.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///current.do')).toBe(true);
        expect(the_result.has('file:///earlier.do')).toBe(false);
        expect(the_result.has('file:///later.do')).toBe(true);
    });

    test('keeps local macros include-only across backward and forward edges', () => {
        const parent_visible_local = make_local_macro('shared', 'file:///parent-include.do');
        const visible_include_site: ForwardCallSite = {
            callee_uri: 'file:///visible-include.do',
            call_line: 1,
            symbols: {
                ...create_empty_symbol_table(),
                localMacros: new Map([['shared', parent_visible_local]]),
            },
            effective_type: 'include',
        };
        const visible_do_site: ForwardCallSite = {
            callee_uri: 'file:///visible-do.do',
            call_line: 1,
            symbols: create_empty_symbol_table(),
            effective_type: 'do',
        };
        const my_scope: ResolvedScope = {
            ...empty_scope,
            chain: [
                {
                    uri: 'file:///done-parent.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    forward_call_sites: [visible_do_site],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
                {
                    uri: 'file:///included-parent.do',
                    directive_type: 'included-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    forward_call_sites: [visible_include_site, visible_do_site],
                    depth: 2,
                    directive_order: 1,
                    sort_key: 'b',
                },
            ],
            forward_call_symbols: [
                visible_include_site,
                visible_do_site,
                {
                    callee_uri: 'file:///same-line.do',
                    call_line: 5,
                    symbols: create_empty_symbol_table(),
                    effective_type: 'include',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            5,
            'file:///current.do',
            'local_macro',
            'shared',
        );
        expect(the_result.has('file:///current.do')).toBe(true);
        expect(the_result.has('file:///done-parent.do')).toBe(false);
        expect(the_result.has('file:///included-parent.do')).toBe(true);
        expect(the_result.has('file:///visible-include.do')).toBe(true);
        expect(the_result.has('file:///visible-do.do')).toBe(false);
        expect(the_result.has('file:///same-line.do')).toBe(false);
    });

    test('excludes a stripped included ancestor local after a downstream done-by boundary', () => {
        const included_local = make_local_macro('shared', 'file:///grand.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            chain: [
                {
                    uri: 'file:///parent.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    forward_call_sites: [],
                    depth: 1,
                    directive_order: 1,
                    sort_key: 'a',
                },
                {
                    uri: 'file:///grand.do',
                    directive_type: 'included-by',
                    call_site_line: 0,
                    symbols: {
                        ...create_empty_symbol_table(),
                        localMacros: new Map([['shared', included_local]]),
                    },
                    forward_call_sites: [],
                    depth: 2,
                    directive_order: 0,
                    sort_key: 'b',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            5,
            'file:///child.do',
            'local_macro',
            'shared',
        );
        expect(the_result.size).toBe(1);
        expect(the_result.has('file:///child.do')).toBe(true);
        expect(the_result.has('file:///grand.do')).toBe(false);
        expect(the_result.has('file:///parent.do')).toBe(false);
    });
});
