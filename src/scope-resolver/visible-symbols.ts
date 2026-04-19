/**
 * Pure helpers for asking "what is in scope at a cursor line?" against a
 * ResolvedScope. Providers import these to avoid duplicating the
 * `call_site.call_line < cursor_line` filter across ≈8 sites.
 *
 * All three functions are pure, synchronous, and accept `undefined` for
 * convenience so test-only paths without a ScopeResolver don't need to
 * construct a scope object.
 */

import type {
    ResolvedScope,
    ForwardCallSite,
    SymbolTable,
    ProgramSymbol,
    MacroSymbol,
    ScalarSymbol,
    MatrixSymbol,
} from '../types';
import { create_empty_symbol_table, merge_symbol_tables } from '../analyzer';

/**
 * SymbolTable of every symbol in scope at `cursor_line`. Equivalent to
 *   resolved_scope.symbols
 *   ∪ { call_site.symbols : call_site ∈ resolved_scope.forward_call_symbols,
 *                           call_site.call_line < cursor_line }
 * applied with merge_symbol_tables overlay semantics (lattermost overlay
 * wins on name collisions; matches scope-resolver precedence).
 *
 * Returns an empty SymbolTable when `scope` is undefined.
 */
export function get_visible_symbols_at(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): SymbolTable {
    if (!scope) {
        return create_empty_symbol_table();
    }
    let result: SymbolTable = {
        programs: new Map(scope.symbols.programs),
        localMacros: new Map(scope.symbols.localMacros),
        globalMacros: new Map(scope.symbols.globalMacros),
        variables: new Map(scope.symbols.variables),
        scalars: new Map(scope.symbols.scalars),
        matrices: new Map(scope.symbols.matrices),
    };
    for (const my_site of scope.forward_call_symbols ?? []) {
        if (my_site.call_line < cursor_line) {
            result = merge_symbol_tables(result, my_site.symbols);
        }
    }
    return result;
}

/**
 * Forward-call sites whose symbols are visible at `cursor_line`
 * (site.call_line < cursor_line). Preserves array order so
 * ranking-sensitive callers keep their current behavior.
 *
 * Returns `[]` when `scope` is undefined or has no forward_call_symbols.
 */
export function get_visible_forward_call_sites(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): ForwardCallSite[] {
    if (!scope?.forward_call_symbols) {
        return [];
    }
    return scope.forward_call_symbols.filter(
        my_site => my_site.call_line < cursor_line,
    );
}

type ReferenceScopedSymbolType =
    | 'local_macro'
    | 'global_macro'
    | 'program'
    | 'scalar'
    | 'matrix';

type ReferenceScopedSymbol =
    | ProgramSymbol
    | MacroSymbol
    | ScalarSymbol
    | MatrixSymbol;

function get_reference_symbol_from_table(
    symbols: SymbolTable,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
): ReferenceScopedSymbol | undefined {
    switch (symbol_type) {
        case 'local_macro':
            return symbols.localMacros.get(symbol_name);
        case 'global_macro':
            return symbols.globalMacros.get(symbol_name);
        case 'program':
            return symbols.programs.get(symbol_name);
        case 'scalar':
            return symbols.scalars.get(symbol_name);
        case 'matrix':
            return symbols.matrices.get(symbol_name);
    }
}

function get_reference_symbol_identity(
    symbol: ReferenceScopedSymbol | undefined,
): string | undefined {
    return symbol?.sourceUri ?? symbol?.location.uri;
}

function symbol_table_matches_active_reference(
    symbols: SymbolTable,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
    active_symbol_identity: string,
): boolean {
    return get_reference_symbol_identity(
        get_reference_symbol_from_table(symbols, symbol_type, symbol_name),
    ) === active_symbol_identity;
}

function clone_symbol_table(symbols: SymbolTable): SymbolTable {
    return {
        programs: new Map(symbols.programs),
        localMacros: new Map(symbols.localMacros),
        globalMacros: new Map(symbols.globalMacros),
        variables: new Map(symbols.variables),
        scalars: new Map(symbols.scalars),
        matrices: new Map(symbols.matrices),
    };
}

function can_reference_chain_entry(
    symbol_type: ReferenceScopedSymbolType,
    directive_type: 'done-by' | 'included-by',
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return directive_type === 'included-by';
}

function can_reference_forward_site(
    symbol_type: ReferenceScopedSymbolType,
    site: ForwardCallSite,
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return site.effective_type === 'include';
}

/**
 * URIs that should participate in find-references for the queried `(type,
 * name)`. The helper first resolves the active visible symbol instance at the
 * cursor via get_visible_symbols_at(), then keeps only related files whose
 * visible scope resolves that same name to the winning instance.
 *
 * This is precedence-aware, excludes masked same-name definitions from
 * otherwise-visible files, still includes sibling/parent contexts that can see
 * the winning symbol without defining it locally, and respects stripped-local
 * behavior implicitly by consulting the merged visible symbol table.
 *
 * Returns a Set containing just `current_uri` when `scope` is undefined.
 */
export function collect_visible_reference_uris(
    scope: ResolvedScope | undefined,
    cursor_line: number,
    current_uri: string,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
): Set<string> {
    const the_result = new Set<string>([current_uri]);
    if (!scope) {
        return the_result;
    }

    const visible_symbols = get_visible_symbols_at(scope, cursor_line);
    const active_symbol_identity = get_reference_symbol_identity(
        get_reference_symbol_from_table(visible_symbols, symbol_type, symbol_name),
    );
    if (!active_symbol_identity) {
        return the_result;
    }

    for (const my_entry of scope.chain) {
        let entry_visible_symbols = clone_symbol_table(my_entry.symbols);

        for (const my_site of my_entry.forward_call_sites ?? []) {
            const symbol_visible_before_site = symbol_table_matches_active_reference(
                entry_visible_symbols,
                symbol_type,
                symbol_name,
                active_symbol_identity,
            );
            const site_defines_active_symbol = symbol_table_matches_active_reference(
                my_site.symbols,
                symbol_type,
                symbol_name,
                active_symbol_identity,
            );
            if (
                can_reference_forward_site(symbol_type, my_site) &&
                (symbol_visible_before_site || site_defines_active_symbol)
            ) {
                the_result.add(my_site.callee_uri);
            }
            entry_visible_symbols = merge_symbol_tables(
                entry_visible_symbols,
                my_site.symbols,
            );
        }

        if (
            can_reference_chain_entry(symbol_type, my_entry.directive_type) &&
            symbol_table_matches_active_reference(
                entry_visible_symbols,
                symbol_type,
                symbol_name,
                active_symbol_identity,
            )
        ) {
            the_result.add(my_entry.uri);
        }
    }

    let current_visible_symbols = clone_symbol_table(scope.symbols);
    for (const my_site of get_visible_forward_call_sites(scope, cursor_line)) {
        const symbol_visible_before_site = symbol_table_matches_active_reference(
            current_visible_symbols,
            symbol_type,
            symbol_name,
            active_symbol_identity,
        );
        const site_defines_active_symbol = symbol_table_matches_active_reference(
            my_site.symbols,
            symbol_type,
            symbol_name,
            active_symbol_identity,
        );
        if (
            can_reference_forward_site(symbol_type, my_site) &&
            (symbol_visible_before_site || site_defines_active_symbol)
        ) {
            the_result.add(my_site.callee_uri);
        }
        current_visible_symbols = merge_symbol_tables(
            current_visible_symbols,
            my_site.symbols,
        );
    }

    return the_result;
}
