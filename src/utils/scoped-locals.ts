/**
 * Scope-aware local-macro lookup shared by hover, go-to-definition,
 * find-references, completion, and document/workspace symbols
 * (issue #270).
 *
 * Mirrors the analyzer's `lookup_local_macro` +
 * `macro_resolves_at_reference` (src/analyzer/index.ts) and the
 * diagnostics provider's `find_same_file_out_of_scope_match`
 * (src/providers/diagnostics.ts): a local macro is visible from a
 * position only in its enclosing scope and the do-file scope, in that
 * order — and among visible scopes, the first whose symbol has
 * already been DEFINED at the position wins, so a reference before a
 * program-local's definition resolves to a same-named do-file local
 * exactly like the analyzer does. Position-to-scope resolution goes
 * through `find_enclosing_scope` (src/utils/scope-position.ts) — THE
 * single mechanism for that question; this module does not
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
import {
    compare_positions,
    find_enclosing_scope,
    Position,
} from './scope-position';

/**
 * The ordered visibility list for a reference whose enclosing scope
 * is already resolved: [enclosing, dofile], collapsed to one entry
 * when the enclosing scope IS the do-file scope. THE single encoding
 * of the list-assembly rule — shared with the analyzer's
 * `lookup_local_macro`, which resolves its reference scope through
 * live-analysis state rather than a position.
 */
export function assemble_visible_scopes(
    enclosing_scope: ScopeInfo,
    dofile_scope: ScopeInfo | undefined
): ScopeInfo[] {
    return enclosing_scope.type !== 'dofile' &&
        dofile_scope !== undefined &&
        dofile_scope !== enclosing_scope
        ? [enclosing_scope, dofile_scope]
        : [enclosing_scope];
}

/**
 * Has `symbol` already been defined at `position`? Line/position
 * mirror of the analyzer's `macro_resolves_at_reference` (which also
 * has a preorder-index check unavailable here): a Mata setter's
 * `visibility_start` is authoritative when present; otherwise the
 * primary definition line must be at-or-before the position, with a
 * same-line reference-before-definition check. Only the PRIMARY
 * definition is consulted — the analyzer keeps the primary as the
 * earliest definition, so `additional_definitions` can never turn a
 * forward reference into a resolved one. Permissive when the symbol
 * carries no position markers.
 *
 * LOCKSTEP: any change to these rules must also be applied to the
 * analyzer's `macro_resolves_at_reference`, and vice versa.
 */
export function macro_resolves_at_position(
    symbol: MacroSymbol,
    position: Position
): boolean {
    if (symbol.visibility_start !== undefined) {
        return compare_positions(position, symbol.visibility_start) >= 0;
    }
    if (
        symbol.definition_line !== undefined &&
        symbol.definition_line > position.line
    ) {
        return false;
    }
    // Same-line forward reference: only when the definition's
    // execution-order line matches its source location (mirrors
    // is_reference_before_macro_definition; sentinel lines like the
    // `args` 0-line mean "in scope from the start").
    const definition_line =
        symbol.definition_line ?? symbol.location?.range?.start?.line;
    if (
        definition_line !== undefined &&
        definition_line === symbol.location?.range?.start?.line &&
        position.line === symbol.location.range.start.line &&
        compare_positions(position, symbol.location.range.start) < 0
    ) {
        return false;
    }
    return true;
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
    return assemble_visible_scopes(enclosing_scope, scopes[0]);
}

/**
 * The visible symbol for `name` at `position`, or undefined. Two
 * passes over the visibility list: first the scopes whose symbol has
 * already been defined at `position` (matching the analyzer's
 * resolution — a not-yet-defined program local does not shadow an
 * already-defined do-file local); then, when nothing resolves
 * positionally, the nearest visible scope that defines the name at
 * all (a same-scope FORWARD reference keeps its identity target so
 * navigation still works — the analyzer treats it as plain
 * undefined, not out-of-scope). No out-of-scope bookkeeping — use
 * `lookup_scoped_local_macro` when that distinction matters.
 */
export function resolve_visible_local(
    scopes: ScopeInfo[] | undefined,
    position: Position,
    name: string
): MacroSymbol | undefined {
    const the_visible_scopes = get_visible_local_scopes(scopes, position);
    let forward_fallback: MacroSymbol | undefined;
    for (const my_scope of the_visible_scopes) {
        const my_symbol = my_scope.localMacros.get(name);
        if (!my_symbol) {
            continue;
        }
        if (macro_resolves_at_position(my_symbol, position)) {
            return my_symbol;
        }
        forward_fallback = forward_fallback ?? my_symbol;
    }
    return forward_fallback;
}

/**
 * All local macros visible at `position`. Per name, the first
 * visible scope whose symbol has already been defined at `position`
 * wins; a name defined only later (forward) still appears via its
 * nearest visible scope — the SAME resolved-first-then-forward-
 * fallback policy as `resolve_visible_local`, encoded map-wise here
 * for enumeration. Keep the two in lockstep.
 */
export function collect_visible_local_macros(
    scopes: ScopeInfo[] | undefined,
    position: Position
): Map<string, MacroSymbol> {
    const out = new Map<string, MacroSymbol>();
    const the_fallbacks = new Map<string, MacroSymbol>();
    for (const my_scope of get_visible_local_scopes(scopes, position)) {
        for (const [my_name, my_symbol] of my_scope.localMacros) {
            if (out.has(my_name)) {
                continue;
            }
            if (macro_resolves_at_position(my_symbol, position)) {
                out.set(my_name, my_symbol);
            } else if (!the_fallbacks.has(my_name)) {
                the_fallbacks.set(my_name, my_symbol);
            }
        }
    }
    for (const [my_name, my_symbol] of the_fallbacks) {
        if (!out.has(my_name)) {
            out.set(my_name, my_symbol);
        }
    }
    return out;
}

/**
 * Every local-macro declaration in the file, one entry per owning
 * scope — the flat view holds a single representative per name, which
 * silently drops same-named locals in other scopes (issue #270).
 * Every analyzer write path registers into a scope before publishing
 * to the flat view, so enumerating scopes loses nothing. Falls back
 * to the flat map when `scopes` is empty (degenerate states). Order:
 * do-file scope first, then program scopes in registration order.
 */
export function enumerate_scoped_local_macros(
    scopes: ScopeInfo[] | undefined,
    flat_local_macros: Map<string, MacroSymbol>
): Array<[string, MacroSymbol]> {
    if (scopes === undefined || scopes.length === 0) {
        return [...flat_local_macros];
    }
    const out: Array<[string, MacroSymbol]> = [];
    for (const my_scope of scopes) {
        for (const my_entry of my_scope.localMacros) {
            out.push(my_entry);
        }
    }
    return out;
}

export interface ScopedLocalLookupResult {
    /** THE symbol when a visible scope defines the name (exclusive
     * shadowing among resolved definitions; see
     * `resolve_visible_local` for the forward-reference fallback). */
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
    const visible_symbol = resolve_visible_local(scopes, position, name);
    if (visible_symbol) {
        return { symbol: visible_symbol, out_of_scope: false };
    }
    for (const my_scope of scopes) {
        if (my_scope.localMacros.has(name)) {
            return { symbol: undefined, out_of_scope: true };
        }
    }
    return { symbol: undefined, out_of_scope: false };
}

/**
 * The scoped-or-flat declaration-lookup idiom shared by the
 * cursor-on-declaration classifiers in definition.ts and
 * references.ts: the visible scoped symbol wins; an out-of-scope
 * name yields undefined (the flat slot may be that very out-of-scope
 * symbol); otherwise fall back to the flat compatibility view
 * (degenerate states, names untracked in this file).
 */
export function resolve_scoped_or_flat(
    scopes: ScopeInfo[] | undefined,
    position: Position,
    name: string,
    flat_local_macros: Map<string, MacroSymbol>
): MacroSymbol | undefined {
    const scoped = lookup_scoped_local_macro(scopes, position, name);
    if (scoped.symbol) {
        return scoped.symbol;
    }
    return scoped.out_of_scope
        ? undefined
        : flat_local_macros.get(name);
}
