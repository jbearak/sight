/**
 * Unit tests for issue #271: program-body locals must not cross file
 * boundaries via `include` inheritance.
 *
 * Covers the resolver-level filters directly:
 * - ScopeResolver.apply_inheritance_rules (included-by / done-by)
 * - ForwardScopeResolver.apply_forward_inheritance (include / do)
 * - ScopeResolver.compute_dual_interface_hash (include hash must reflect
 *   the filtered do-file-local interface, not the raw flat map)
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../../src/scope-resolver';
import { ForwardScopeResolver } from '../../../src/forward-scope-resolver';
import { MacroSymbol, ScopeType, SymbolTable } from '../../../src/types';

const PARENT_URI = 'file:///parent.do';

function make_local(
    name: string,
    containing_scope: ScopeType,
    line: number = 0
): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: {
            uri: PARENT_URI,
            range: {
                start: { line, character: 0 },
                end: { line, character: name.length },
            },
        },
        sourceUri: PARENT_URI,
        containingScope: containing_scope,
        ...(containing_scope === 'program'
            ? { containing_program_name: 'p' }
            : {}),
    };
}

function make_table(the_locals: MacroSymbol[]): SymbolTable {
    const table: SymbolTable = {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
    for (const my_local of the_locals) {
        table.localMacros.set(my_local.name, my_local);
    }
    return table;
}

describe('ScopeResolver.apply_inheritance_rules - program-body locals', () => {
    let resolver: ScopeResolver;

    beforeEach(() => {
        resolver = new ScopeResolver();
    });

    it('included-by keeps dofile locals and drops program-body locals', () => {
        const symbols = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const result = resolver.apply_inheritance_rules(
            symbols,
            'included-by',
            PARENT_URI
        );

        expect(result.filtered.localMacros.has('visible')).toBe(true);
        expect(result.filtered.localMacros.has('hidden')).toBe(false);
    });

    it('included-by silently drops program-body locals (no excluded_locals entry)', () => {
        const symbols = make_table([make_local('hidden', 'program', 2)]);

        const result = resolver.apply_inheritance_rules(
            symbols,
            'included-by',
            PARENT_URI
        );

        // Per the issue-#271 decision, references to a program-body local
        // get the plain undefined warning: no out-of-scope rewrite entry.
        expect(result.excluded_locals).toHaveLength(0);
    });

    it('included-by does not mutate or alias the (cached) input table', () => {
        const symbols = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const result = resolver.apply_inheritance_rules(
            symbols,
            'included-by',
            PARENT_URI
        );

        // The input table is the shared file-cache entry; filtering must
        // not remove entries from it, and the filtered map must not be
        // the same object (a later consumer of the cache would otherwise
        // see the filtered view).
        expect(symbols.localMacros.has('hidden')).toBe(true);
        expect(result.filtered.localMacros).not.toBe(symbols.localMacros);
    });

    it('included-by preserves non-local symbol kinds', () => {
        const symbols = make_table([make_local('hidden', 'program', 2)]);
        symbols.globalMacros.set('G', {
            name: 'G',
            scope: 'global',
            location: {
                uri: PARENT_URI,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 },
                },
            },
            sourceUri: PARENT_URI,
        });

        const result = resolver.apply_inheritance_rules(
            symbols,
            'included-by',
            PARENT_URI
        );

        expect(result.filtered.globalMacros.has('G')).toBe(true);
    });

    it('done-by excluded_locals omits program-body locals but keeps dofile locals', () => {
        const symbols = make_table([
            make_local('veggie', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const result = resolver.apply_inheritance_rules(
            symbols,
            'done-by',
            PARENT_URI
        );

        // All locals stay excluded from the inherited table.
        expect(result.filtered.localMacros.size).toBe(0);

        // Only the dofile local earns the "use include instead" rewrite:
        // promoting the call to `include` would NOT surface a program-body
        // local, so advertising it would be false advice.
        const the_excluded_names = result.excluded_locals.map(s => s.name);
        expect(the_excluded_names).toContain('veggie');
        expect(the_excluded_names).not.toContain('hidden');
    });
});

describe('ForwardScopeResolver.apply_forward_inheritance - program-body locals', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
    });

    it('include keeps dofile locals and drops program-body locals', () => {
        const callee_symbols = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const inherited = forward_resolver.apply_forward_inheritance(
            callee_symbols,
            'include'
        );

        expect(inherited.localMacros.has('visible')).toBe(true);
        expect(inherited.localMacros.has('hidden')).toBe(false);
    });

    it('include does not mutate or alias the (cached) callee table', () => {
        const callee_symbols = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const inherited = forward_resolver.apply_forward_inheritance(
            callee_symbols,
            'include'
        );

        expect(callee_symbols.localMacros.has('hidden')).toBe(true);
        expect(inherited.localMacros).not.toBe(callee_symbols.localMacros);
    });

    it('do still drops all locals regardless of containing scope', () => {
        const callee_symbols = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);

        const inherited = forward_resolver.apply_forward_inheritance(
            callee_symbols,
            'do'
        );

        expect(inherited.localMacros.size).toBe(0);
    });
});

describe('ScopeResolver.compute_dual_interface_hash - include hash scope sensitivity', () => {
    let resolver: ScopeResolver;

    beforeEach(() => {
        resolver = new ScopeResolver();
    });

    it('include hash changes when a local moves between program and dofile scope', () => {
        // Same name set, different containing scope: the include-visible
        // interface differs (a dofile local is inherited via include, a
        // program-body local is not), so the hash must differ or callee
        // revalidation gets skipped after such an edit.
        const program_scoped = make_table([make_local('hidden', 'program', 1)]);
        const dofile_scoped = make_table([make_local('hidden', 'dofile', 1)]);

        const hash_program = resolver.compute_dual_interface_hash(program_scoped);
        const hash_dofile = resolver.compute_dual_interface_hash(dofile_scoped);

        expect(hash_program.include_hash).not.toBe(hash_dofile.include_hash);
    });

    it('include hash ignores program-body locals entirely', () => {
        // A program-body local is invisible across every boundary type, so
        // adding/removing one must not change the include interface.
        const with_program_local = make_table([
            make_local('visible', 'dofile', 0),
            make_local('hidden', 'program', 2),
        ]);
        const without_program_local = make_table([
            make_local('visible', 'dofile', 0),
        ]);

        const hash_with = resolver.compute_dual_interface_hash(with_program_local);
        const hash_without = resolver.compute_dual_interface_hash(without_program_local);

        expect(hash_with.include_hash).toBe(hash_without.include_hash);
    });
});
