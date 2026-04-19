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

describe('get_visible_symbols_at — current-file shadowing window (call_line, cursor_line]', () => {
    // A scope where the current file sits at chain[0] (matching the
    // ScopeResolver's real-world construction) so the shadowing predicate sees
    // current-file symbols via scope.chain[0].symbols.
    const current_uri = 'file:///current.do';
    const callee_uri = 'file:///callee.do';

    const macro_at_lines = (name: string, uri: string, primary: number, extras: number[] = []): MacroSymbol => ({
        name,
        scope: 'local',
        location: { uri, range: { start: { line: primary, character: 0 }, end: { line: primary, character: name.length } } },
        sourceUri: uri,
        additional_definitions: extras.length
            ? extras.map(line => ({ line, character: 0 }))
            : undefined,
    });

    const build_scope = (
        current_symbol: MacroSymbol | undefined,
        site: ForwardCallSite,
    ): ResolvedScope => {
        const current_symbols = current_symbol
            ? {
                ...create_empty_symbol_table(),
                localMacros: new Map([[current_symbol.name, current_symbol]]),
            }
            : create_empty_symbol_table();
        const current_chain_entry: ScopeChainEntry = {
            uri: current_uri,
            directive_type: 'included-by',
            call_site_line: Number.MAX_SAFE_INTEGER,
            symbols: current_symbols,
            depth: 0,
            directive_order: Number.MAX_SAFE_INTEGER,
            sort_key: `current:${current_uri}`,
        };
        return {
            chain: [current_chain_entry],
            symbols: current_symbols,
            out_of_scope_symbols: [],
            diagnostics: [],
            has_directives: false,
            has_auto_parents: false,
            forward_call_symbols: [site],
        };
    };

    const callee_site = (call_line: number): ForwardCallSite => ({
        callee_uri,
        call_line,
        symbols: {
            ...create_empty_symbol_table(),
            localMacros: new Map([['shared', macro_at_lines('shared', callee_uri, 0)]]),
        },
        effective_type: 'include',
    });

    test('def before call (line 0), call at 5, cursor at 10 → forward wins', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 0),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(callee_uri);
    });

    test('def before call AND redefinition in window (lines 0 + 7), call at 5, cursor at 10 → current wins', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 0, [7]),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(current_uri);
    });

    test('def at line 7 only, call at 5, cursor at 6 → forward wins (future def not yet visible)', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 7),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 6);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(callee_uri);
    });

    test('boundary: def === call_line → forward wins (strict >)', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 5),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(callee_uri);
    });

    test('boundary: def === cursor_line → current wins (non-strict <=)', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 10),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(current_uri);
    });

    test('primary before call, additional_definitions[0] in window → current wins', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 0, [7]),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(current_uri);
    });

    test('primary before call, additional_definitions[0] after cursor → forward wins', () => {
        const my_scope = build_scope(
            macro_at_lines('shared', current_uri, 0, [12]),
            callee_site(5),
        );
        const the_result = get_visible_symbols_at(my_scope, 10);
        expect(the_result.localMacros.get('shared')?.sourceUri).toBe(callee_uri);
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

    test('includes every URI that could reference the active symbol instance, regardless of call-site order', () => {
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
        // `current-hidden.do` is called after the cursor line, but the active
        // instance (contributed by `current-visible.do` at line 1) is still
        // defined when it runs — so references there are references to the
        // same definition and must participate in find-references.
        expect(the_result.has('file:///current-hidden.do')).toBe(true);
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
        // `same-line.do` is an `include` call at the cursor line itself; its
        // inlined body still references the same active local, so it must
        // participate. Call-site order relative to the cursor is irrelevant
        // for find-references once the active instance is selected.
        expect(the_result.has('file:///same-line.do')).toBe(true);
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

    test('includes a post-site callee with scan_through_line when it redeclares same-name locally after inheriting the active symbol', () => {
        const active_local = make_local_macro('fruit', 'file:///first.do');
        // The redeclaring site's symbol table shows a same-name local declared
        // in the callee file itself at line 1 (the `local fruit "orange"` line).
        const shadow_in_second = {
            ...make_local_macro('fruit', 'file:///second.do'),
            location: {
                uri: 'file:///second.do',
                range: { start: { line: 1, character: 6 }, end: { line: 1, character: 11 } },
            },
            sourceUri: 'file:///second.do',
        };
        const my_scope: ResolvedScope = {
            ...empty_scope,
            // scope.symbols carries the merged inherited symbols visible to the
            // current file (first.do defines fruit, so it appears here).
            symbols: {
                ...create_empty_symbol_table(),
                localMacros: new Map([['fruit', active_local]]),
            },
            chain: [
                {
                    uri: 'file:///caller.do',
                    directive_type: 'included-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    all_forward_call_sites: [
                        {
                            callee_uri: 'file:///first.do',
                            call_line: 0,
                            symbols: {
                                ...create_empty_symbol_table(),
                                localMacros: new Map([['fruit', active_local]]),
                            },
                            effective_type: 'include',
                        },
                        {
                            callee_uri: 'file:///second.do',
                            call_line: 1,
                            symbols: {
                                ...create_empty_symbol_table(),
                                localMacros: new Map([['fruit', shadow_in_second]]),
                            },
                            effective_type: 'include',
                        },
                    ],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            100,
            'file:///first.do',
            'local_macro',
            'fruit',
        );
        // second.do INHERITS the active fruit via first.do's include, then
        // redeclares it same-file at line 1. It is included with a line cutoff.
        expect(the_result.has('file:///second.do')).toBe(true);
        expect(the_result.get('file:///second.do')?.scan_through_line).toBe(1);
    });

    test('chain entry all_forward_call_sites adds both pre-site and post-site callees when active is defined in pre-site', () => {
        const active_prog = make_program('shared_prog', 'file:///definer.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', active_prog]]),
            },
            chain: [
                {
                    uri: 'file:///caller.do',
                    directive_type: 'done-by',
                    call_site_line: 1,
                    symbols: create_empty_symbol_table(),
                    all_forward_call_sites: [
                        {
                            callee_uri: 'file:///definer.do',
                            call_line: 0,
                            symbols: {
                                ...create_empty_symbol_table(),
                                programs: new Map([['shared_prog', active_prog]]),
                            },
                            effective_type: 'do',
                        },
                        {
                            callee_uri: 'file:///consumer.do',
                            call_line: 2,
                            symbols: create_empty_symbol_table(),
                            effective_type: 'do',
                        },
                    ],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            100,
            'file:///definer.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///definer.do')).toBe(true);
        expect(the_result.has('file:///consumer.do')).toBe(true);
        expect(the_result.get('file:///consumer.do')?.scan_through_line).toBeUndefined();
    });

    test('chain entry falls back to forward_call_sites when all_forward_call_sites is absent', () => {
        const active_prog = make_program('shared_prog', 'file:///definer.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', active_prog]]),
            },
            chain: [
                {
                    uri: 'file:///caller.do',
                    directive_type: 'done-by',
                    call_site_line: 5,
                    symbols: create_empty_symbol_table(),
                    forward_call_sites: [
                        {
                            callee_uri: 'file:///definer.do',
                            call_line: 1,
                            symbols: {
                                ...create_empty_symbol_table(),
                                programs: new Map([['shared_prog', active_prog]]),
                            },
                            effective_type: 'do',
                        },
                    ],
                    // all_forward_call_sites omitted
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            100,
            'file:///definer.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///definer.do')).toBe(true);
    });

    test('post-site redeclare without inheriting the active symbol is excluded (case 5 via redeclare branch)', () => {
        const other_prog = make_program('shared_prog', 'file:///redeclarer.do');
        const my_scope: ResolvedScope = {
            ...empty_scope,
            chain: [
                {
                    uri: 'file:///caller.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    all_forward_call_sites: [
                        {
                            callee_uri: 'file:///redeclarer.do',
                            call_line: 1,
                            symbols: {
                                ...create_empty_symbol_table(),
                                programs: new Map([['shared_prog', other_prog]]),
                            },
                            effective_type: 'do',
                        },
                    ],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
            ],
            // `scope.symbols` has the active definition from the current file.
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([
                    ['shared_prog', make_program('shared_prog', 'file:///current.do')],
                ]),
            },
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            100,
            'file:///current.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///redeclarer.do')).toBe(false);
    });

    test('transitive redeclaration (redeclaration declared in a different file than the callee) falls back to exclusion', () => {
        const active_prog = make_program('shared_prog', 'file:///first.do');
        // Shadow appears to come through second.do (its symbols carry the entry)
        // but is actually declared in third.do — a transitive surface.
        // Conservative fallback: exclude second.do entirely.
        const shadow_via_second = {
            ...make_program('shared_prog', 'file:///third.do'),
            location: {
                uri: 'file:///third.do',
                range: { start: { line: 5, character: 8 }, end: { line: 5, character: 19 } },
            },
            sourceUri: 'file:///third.do',
        };
        const my_scope: ResolvedScope = {
            ...empty_scope,
            symbols: {
                ...create_empty_symbol_table(),
                programs: new Map([['shared_prog', active_prog]]),
            },
            chain: [
                {
                    uri: 'file:///caller.do',
                    directive_type: 'done-by',
                    call_site_line: 0,
                    symbols: create_empty_symbol_table(),
                    all_forward_call_sites: [
                        {
                            callee_uri: 'file:///first.do',
                            call_line: 0,
                            symbols: {
                                ...create_empty_symbol_table(),
                                programs: new Map([['shared_prog', active_prog]]),
                            },
                            effective_type: 'do',
                        },
                        {
                            callee_uri: 'file:///second.do',
                            call_line: 1,
                            symbols: {
                                ...create_empty_symbol_table(),
                                programs: new Map([['shared_prog', shadow_via_second]]),
                            },
                            effective_type: 'do',
                        },
                    ],
                    depth: 1,
                    directive_order: 0,
                    sort_key: 'a',
                },
            ],
        };
        const the_result = collect_visible_reference_uris(
            my_scope,
            100,
            'file:///first.do',
            'program',
            'shared_prog',
        );
        expect(the_result.has('file:///second.do')).toBe(false);
    });

    test('returns Map, not Set', () => {
        const the_result = collect_visible_reference_uris(
            undefined,
            0,
            'file:///current.do',
            'program',
            'any',
        );
        // Map exposes `.size`, `.has`, and `.get` / `.set`; the type check
        // below catches accidental Set-vs-Map regressions.
        expect(the_result instanceof Map).toBe(true);
    });
});
