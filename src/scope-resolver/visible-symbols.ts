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
    ScopeChainEntry,
    SymbolTable,
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

function should_include_entry_for_references(
    entry: ScopeChainEntry,
    symbol_type: ReferenceScopedSymbolType,
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return entry.directive_type === 'included-by';
}

function should_include_call_site_for_references(
    site: ForwardCallSite,
    symbol_type: ReferenceScopedSymbolType,
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return site.effective_type === 'include';
}

/**
 * URIs that should participate in find-references for the given symbol kind.
 * This includes backward-chain files, retained parent forward callees, and
 * current-file visible forward callees, with local macros restricted to
 * include-only edges.
 *
 * Returns a Set containing just `current_uri` when `scope` is undefined.
 */
export function collect_visible_reference_uris(
    scope: ResolvedScope | undefined,
    cursor_line: number,
    current_uri: string,
    symbol_type: ReferenceScopedSymbolType,
): Set<string> {
    const the_result = new Set<string>([current_uri]);
    if (!scope) {
        return the_result;
    }

    for (const my_entry of scope.chain) {
        if (should_include_entry_for_references(my_entry, symbol_type)) {
            the_result.add(my_entry.uri);
        }

        for (const my_site of my_entry.forward_call_sites ?? []) {
            if (should_include_call_site_for_references(my_site, symbol_type)) {
                the_result.add(my_site.callee_uri);
            }
        }
    }

    for (const my_site of get_visible_forward_call_sites(scope, cursor_line)) {
        if (should_include_call_site_for_references(my_site, symbol_type)) {
            the_result.add(my_site.callee_uri);
        }
    }

    return the_result;
}
