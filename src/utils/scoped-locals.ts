/**
 * Scope-aware local-macro lookup shared by hover, go-to-definition,
 * find-references, and completion (issue #270).
 *
 * Mirrors the analyzer's `lookup_local_macro` (src/analyzer/index.ts)
 * and the diagnostics provider's `find_same_file_out_of_scope_match`
 * (src/providers/diagnostics.ts): a local macro is visible from a
 * position only in its enclosing scope and the do-file scope, in that
 * order, first-match-wins (shadowing). Position-to-scope resolution
 * goes through `find_enclosing_scope` (src/utils/scope-position.ts) —
 * THE single mechanism for that question; this module does not
 * reimplement it. `body_only` applies throughout: a reference on a
 * program's header or `end` line expands in the enclosing frame
 * (issue #273).
 *
 * IMPORTANT: `document.scopes` describes only THIS file's own text. A
 * do-file-scoped result here does NOT account for cross-file
 * execution-order shadowing (e.g. an `include` that redefined the name
 * after this file's own definition — see the forward-call overlay in
 * src/scope-resolver/visible-symbols.ts). Callers must treat a
 * do-file-scoped `symbol` as informational only for same-file
 * structural questions (declaration-range hits, same-file occurrence
 * identity) and must NOT use it to bypass the resolved-scope / flat
 * value-resolution code. Only a PROGRAM-scoped `symbol` is
 * unconditionally authoritative: issue #271 guarantees program-body
 * locals never cross file boundaries (src/utils/dofile-locals.ts).
 */

import { MacroSymbol, ScopeInfo } from '../types';
import { find_enclosing_scope } from './scope-position';

interface Position {
    line: number;
    character: number;
}

/**
 * Ordered visibility list for `position`: the innermost enclosing
 * program scope (body-only, #273) first, then the do-file scope —
 * collapsed to one entry when the enclosing scope IS the do-file
 * scope. Returns [] when `scopes` is empty (degenerate/partial
 * analyzer states); callers fall back to the flat compatibility view.
 */
export function get_visible_local_scopes(
    scopes: ScopeInfo[] | undefined,
    position: Position
): ScopeInfo[] {
    if (scopes === undefined || scopes.length === 0) {
        return [];
    }
    const enclosing_scope = find_enclosing_scope(scopes, position, {
        body_only: true,
    });
    const dofile_scope = scopes[0];
    return enclosing_scope.type !== 'dofile' &&
        dofile_scope !== undefined &&
        dofile_scope !== enclosing_scope
        ? [enclosing_scope, dofile_scope]
        : [enclosing_scope];
}

/**
 * All local macros visible at `position`, first-match-wins across the
 * visibility list — a name shadowed by the enclosing program scope
 * never surfaces the do-file scope's symbol.
 */
export function collect_visible_local_macros(
    scopes: ScopeInfo[] | undefined,
    position: Position
): Map<string, MacroSymbol> {
    const out = new Map<string, MacroSymbol>();
    for (const my_scope of get_visible_local_scopes(scopes, position)) {
        for (const [my_name, my_symbol] of my_scope.localMacros) {
            if (!out.has(my_name)) {
                out.set(my_name, my_symbol);
            }
        }
    }
    return out;
}

export interface ScopedLocalLookupResult {
    /** THE symbol when a visible scope defines the name (exclusive
     * shadowing: the nearest visible scope's symbol, issue #270). */
    symbol: MacroSymbol | undefined;
    /** True when `name` is registered ONLY in scopes not visible from
     * `position` (e.g. a sibling program's body). Callers must not
     * substitute the flat view's representative — it may be that very
     * out-of-scope symbol. */
    out_of_scope: boolean;
}

/**
 * Resolve local macro `name` at `position` against this file's own
 * scope tree. `{symbol: undefined, out_of_scope: false}` means the
 * scoped model has no opinion (empty `scopes`, or the name is not
 * registered anywhere in this file — e.g. positional args and
 * cross-file inherited locals) and existing fallback code should run
 * unchanged.
 */
export function lookup_scoped_local_macro(
    scopes: ScopeInfo[] | undefined,
    position: Position,
    name: string
): ScopedLocalLookupResult {
    if (scopes === undefined || scopes.length === 0) {
        return { symbol: undefined, out_of_scope: false };
    }
    for (const my_scope of get_visible_local_scopes(scopes, position)) {
        const my_symbol = my_scope.localMacros.get(name);
        if (my_symbol) {
            return { symbol: my_symbol, out_of_scope: false };
        }
    }
    for (const my_scope of scopes) {
        if (my_scope.localMacros.has(name)) {
            return { symbol: undefined, out_of_scope: true };
        }
    }
    return { symbol: undefined, out_of_scope: false };
}
