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
import type {
    ForwardCallSite,
    MacroSymbol,
    MatrixSymbol,
    ProgramSymbol,
    ResolvedScope,
    ScalarSymbol,
    SymbolTable,
    VariableSymbol,
} from '../../src/types';

// Small pool of names so same-name collisions actually occur across sites —
// this exercises the lattermost-wins overlay rule under fuzzing.
const NAME_POOL = ['alpha', 'beta', 'gamma'] as const;
const arb_name = fc.constantFrom(...NAME_POOL);
const arb_kind = fc.constantFrom(
    'programs',
    'localMacros',
    'globalMacros',
    'variables',
    'scalars',
    'matrices',
) satisfies fc.Arbitrary<keyof SymbolTable>;

function make_program(name: string, uri: string): ProgramSymbol {
    return {
        name,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
    };
}

function make_macro(name: string, uri: string, scope: 'local' | 'global'): MacroSymbol {
    return {
        name,
        scope,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
    };
}

function make_variable(name: string, uri: string): VariableSymbol {
    return {
        name,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
        source: 'gen',
    };
}

function make_scalar(name: string, uri: string): ScalarSymbol {
    return {
        name,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
    };
}

function make_matrix(name: string, uri: string): MatrixSymbol {
    return {
        name,
        location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } },
        sourceUri: uri,
    };
}

/**
 * Build a fresh SymbolTable with one symbol of the given kind at (name, uri).
 */
function make_symbol_table(kind: keyof SymbolTable, name: string, uri: string): SymbolTable {
    const the_table = create_empty_symbol_table();
    switch (kind) {
        case 'programs': the_table.programs.set(name, make_program(name, uri)); break;
        case 'localMacros': the_table.localMacros.set(name, make_macro(name, uri, 'local')); break;
        case 'globalMacros': the_table.globalMacros.set(name, make_macro(name, uri, 'global')); break;
        case 'variables': the_table.variables.set(name, make_variable(name, uri)); break;
        case 'scalars': the_table.scalars.set(name, make_scalar(name, uri)); break;
        case 'matrices': the_table.matrices.set(name, make_matrix(name, uri)); break;
    }
    return the_table;
}

/**
 * Strong equivalence: same size, same keys, and — for keys that match —
 * the symbols agree on `location.uri`. This is what catches base-wins vs.
 * overlay-wins drift: if a helper returned the earlier-applied symbol
 * instead of the lattermost, the URI would differ even when the key set
 * matches.
 */
function symbol_tables_agree(a: SymbolTable, b: SymbolTable): boolean {
    const the_kinds: Array<keyof SymbolTable> = [
        'programs', 'localMacros', 'globalMacros', 'variables', 'scalars', 'matrices',
    ];
    for (const my_kind of the_kinds) {
        const a_map = a[my_kind] as Map<string, { location: { uri: string } }>;
        const b_map = b[my_kind] as Map<string, { location: { uri: string } }>;
        if (a_map.size !== b_map.size) return false;
        for (const [name, a_sym] of a_map) {
            const b_sym = b_map.get(name);
            if (!b_sym) return false;
            if (a_sym.location.uri !== b_sym.location.uri) return false;
        }
    }
    return true;
}

describe('get_visible_symbols_at equivalence with ForwardScopeResolver.get_symbols_at_line', () => {
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        forward_resolver = new ForwardScopeResolver(new ScopeResolver());
    });

    test('agrees on arbitrary (base, sites, line) inputs across all six symbol kinds', () => {
        // Each site carries one symbol of one kind at a single (name, uri).
        // Drawing names from a small pool forces frequent collisions across
        // sites so lattermost-wins has something to decide.
        const arb_site_shape = fc.record({
            callee_uri: fc.integer({ min: 0, max: 4 }).map(n => `file:///callee${n}.do`),
            call_line: fc.integer({ min: 0, max: 50 }),
            kind: arb_kind,
            symbol_name: arb_name,
        });

        fc.assert(
            fc.property(
                fc.array(arb_site_shape, { maxLength: 10 }),
                fc.integer({ min: 0, max: 60 }),
                (raw_sites, cursor_line) => {
                    const sites: ForwardCallSite[] = raw_sites.map(rs => ({
                        callee_uri: rs.callee_uri,
                        call_line: rs.call_line,
                        symbols: make_symbol_table(rs.kind, rs.symbol_name, rs.callee_uri),
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
                            has_auto_parents: false, is_standalone: false,
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
            { numRuns: 200 },
        );
    });
});
