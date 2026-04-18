/**
 * Property test: get_visible_symbols_at must agree with
 * ForwardScopeResolver.get_symbols_at_line on arbitrary inputs.
 *
 * Keeping two independent implementations of the same rule and testing
 * them against each other means the pair cannot silently drift.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { get_visible_symbols_at } from '../../src/scope-resolver/visible-symbols';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_empty_symbol_table } from '../../src/analyzer';
import type { ForwardCallSite, ResolvedScope, SymbolTable, ProgramSymbol } from '../../src/types';

function make_program(name: string, uri: string): ProgramSymbol {
    return {
        name,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
    };
}

function symbol_tables_agree(a: SymbolTable, b: SymbolTable): boolean {
    const keys: Array<keyof SymbolTable> = [
        'programs', 'localMacros', 'globalMacros', 'variables', 'scalars', 'matrices',
    ];
    for (const k of keys) {
        if (a[k].size !== b[k].size) return false;
        for (const [name, _] of a[k]) {
            if (!b[k].has(name)) return false;
        }
    }
    return true;
}

describe('get_visible_symbols_at equivalence with ForwardScopeResolver.get_symbols_at_line', () => {
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        forward_resolver = new ForwardScopeResolver(new ScopeResolver());
    });

    test('agrees on arbitrary (base, sites, line) inputs', () => {
        const arb_program_site = fc.record({
            callee_uri: fc.string({ minLength: 1 }).map(s => `file:///${s}.do`),
            call_line: fc.integer({ min: 0, max: 50 }),
            program_names: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 5 }),
        });

        fc.assert(
            fc.property(
                fc.array(arb_program_site, { maxLength: 8 }),
                fc.integer({ min: 0, max: 60 }),
                (raw_sites, cursor_line) => {
                    const sites: ForwardCallSite[] = raw_sites.map(rs => ({
                        callee_uri: rs.callee_uri,
                        call_line: rs.call_line,
                        symbols: {
                            ...create_empty_symbol_table(),
                            programs: new Map(
                                rs.program_names.map(n => [n, make_program(n, rs.callee_uri)]),
                            ),
                        },
                        effective_type: 'do' as const,
                    }));
                    const base_symbols = create_empty_symbol_table();

                    const via_helper = get_visible_symbols_at(
                        {
                            chain: [],
                            symbols: base_symbols,
                            out_of_scope_symbols: [],
                            diagnostics: [],
                            has_directives: false,
                            has_auto_parents: false,
                            forward_call_symbols: sites,
                        } as ResolvedScope,
                        cursor_line,
                    );
                    const via_method = forward_resolver.get_symbols_at_line(
                        base_symbols,
                        sites,
                        cursor_line,
                    );

                    expect(symbol_tables_agree(via_helper, via_method)).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });
});
