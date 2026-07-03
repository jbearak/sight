/**
 * Scope gate for local macros crossing file boundaries (issue #271).
 *
 * A local macro is inheritable across an `include` boundary only when it
 * is genuine do-file-level state. Locals defined inside `program ... end`
 * bodies (`containingScope: 'program'`) die with their program's scope
 * frame — merely defining the program does not execute it — so they never
 * exist at the do-file level that `include` splices into.
 *
 * The flat `SymbolTable.localMacros` view can carry a program-body local
 * when a name has no do-file-level definition (see the analyzer's
 * `publish_flat_local`), so every cross-file consumer of that map must
 * apply this gate.
 */

import {
    MacroSymbol,
    MatrixSymbol,
    ProgramSymbol,
    ResolvedScope,
    ScalarSymbol,
    ScopeInfo,
    VariableSymbol,
} from '../types';
import { Position } from './scope-position';
import { lookup_scoped_local_macro } from './scoped-locals';

export function is_dofile_local(
    symbol: Pick<MacroSymbol, 'containingScope'>
): boolean {
    return symbol.containingScope === 'dofile';
}

export function filter_dofile_locals(
    locals: Map<string, MacroSymbol>
): Map<string, MacroSymbol> {
    const filtered = new Map<string, MacroSymbol>();
    for (const [my_name, my_symbol] of locals) {
        if (is_dofile_local(my_symbol)) {
            filtered.set(my_name, my_symbol);
        }
    }
    return filtered;
}

/**
 * Every cross-file INHERITED do-file local visible at a position in
 * the current file, keyed by name, with effective-scope precedence.
 * Locals cross file boundaries only through `include` semantics:
 * backward via `included-by` chain entries (already call-site
 * filtered and inheritance-filtered by the resolver), forward via
 * `include`-effective call sites executed before the reference line.
 * Only do-file-scoped symbols from OTHER files qualify
 * (`is_dofile_local`, #271).
 *
 * Precedence mirrors the resolver's merge exactly: chain entries are
 * applied far-to-near (depth descending, same-depth lattermost
 * directive last) so nearer parents overwrite; executed forward
 * include sites are then applied in array (source) order so later
 * includes overwrite — and override the chain, matching
 * get_visible_symbols_at's last-wins overlay and Stata's execution
 * order.
 *
 * Used by providers when a name is OUT OF SCOPE same-file (tracked
 * only in non-visible sibling scopes, #270): the same-file flat slot
 * is forbidden there, but an inherited do-file local is genuinely
 * defined at the reference — the analyzer's cross-file suppression
 * treats it as defined, so hover/definition/completion must too.
 */
export function collect_inherited_dofile_locals(
    resolved_scope: ResolvedScope | undefined,
    reference_line: number,
    current_uri: string
): Map<string, MacroSymbol> {
    const out = new Map<string, MacroSymbol>();
    if (!resolved_scope) {
        return out;
    }
    const put_qualifying = (
        locals: Map<string, MacroSymbol>
    ): void => {
        for (const [my_name, my_symbol] of locals) {
            if (
                my_symbol.sourceUri !== current_uri &&
                is_dofile_local(my_symbol)
            ) {
                out.set(my_name, my_symbol);
            }
        }
    };
    // No directive_type filter: inheritance is applied by EFFECTIVE
    // call type (apply_inheritance_rules in the resolver), which can
    // differ from the written directive type stored on the entry —
    // e.g. `@lsp-done-by` where the parent actually uses `include`.
    // The entry's localMacros are already inheritance-filtered, so a
    // done-by-effective entry carries no locals and contributes
    // nothing here; only the current file's own raw entry (chain[0])
    // must be excluded by uri.
    const the_parents = (resolved_scope.chain ?? [])
        .filter(my_entry => my_entry.uri !== current_uri)
        .sort(
            (a, b) => b.depth - a.depth ||
                a.directive_order - b.directive_order ||
                a.sort_key.localeCompare(b.sort_key)
        );
    for (const my_entry of the_parents) {
        put_qualifying(my_entry.symbols.localMacros);
    }
    for (const my_site of resolved_scope.forward_call_symbols ?? []) {
        if (my_site.effective_type !== 'include') {
            continue;
        }
        if (reference_line <= my_site.call_line) {
            continue;
        }
        put_qualifying(my_site.symbols.localMacros);
    }
    return out;
}

/**
 * Single-name convenience over `collect_inherited_dofile_locals` —
 * same precedence by construction.
 */
export function find_inherited_dofile_local(
    resolved_scope: ResolvedScope | undefined,
    name: string,
    reference_line: number,
    current_uri: string
): MacroSymbol | undefined {
    return collect_inherited_dofile_locals(
        resolved_scope, reference_line, current_uri
    ).get(name);
}

/**
 * THE effective local-macro resolution order at a position, for names
 * TRACKED in the current file's scope tree — the one rule every
 * provider consumes (issue #270, round-9 gate):
 *   1. the positionally RESOLVED winner in [enclosing, dofile]
 *      (same-file scoped identity);
 *   2. else the cross-file INHERITED do-file local (the analyzer's
 *      cross-file suppression treats the reference as defined via it,
 *      so it outranks a not-yet-defined same-scope local);
 *   3. else the nearest visible scope's FORWARD identity target (a
 *      same-scope forward reference keeps navigation working; the
 *      analyzer treats it as plain undefined);
 *   4. else nothing: tracked-but-invisible names are out-of-scope,
 *      while UNTRACKED names (positional args, purely cross-file
 *      names) belong to the pre-existing resolved-scope/flat
 *      machinery — an inherited-only name is ONE frame-local whose
 *      include-chain definitions pool like same-file redefinitions,
 *      so the winner-only rules deliberately do not apply there.
 */
export function resolve_effective_local(
    scopes: ScopeInfo[] | undefined,
    position: Position,
    name: string,
    resolved_scope: ResolvedScope | undefined,
    current_uri: string
): MacroSymbol | undefined {
    return classify_effective_local(
        scopes, position, name, resolved_scope, current_uri
    ).symbol;
}

export interface EffectiveLocalClassification {
    /** Which tier of the effective order won (see
     * resolve_effective_local): 'out_of_scope' = tracked same-file
     * but invisible with no inherited winner; 'none' = untracked
     * (positional args, names foreign to this file). */
    kind: 'resolved' | 'inherited' | 'forward' | 'out_of_scope' | 'none';
    symbol?: MacroSymbol;
}

/**
 * The effective order with its winning tier exposed, for providers
 * whose handling differs per tier (references' target modes,
 * definition's fast path / fallbacks). THE single arm mapping —
 * bespoke per-provider re-derivations of this order are how the
 * round-9/10 gate bugs happened.
 */
export function classify_effective_local(
    scopes: ScopeInfo[] | undefined,
    position: Position,
    name: string,
    resolved_scope: ResolvedScope | undefined,
    current_uri: string
): EffectiveLocalClassification {
    const scoped = lookup_scoped_local_macro(scopes, position, name);
    if (scoped.symbol && !scoped.forward_only) {
        return { kind: 'resolved', symbol: scoped.symbol };
    }
    if (scoped.out_of_scope || scoped.forward_only) {
        const inherited = find_inherited_dofile_local(
            resolved_scope, name, position.line, current_uri
        );
        if (inherited) {
            return { kind: 'inherited', symbol: inherited };
        }
        if (scoped.forward_only) {
            return { kind: 'forward', symbol: scoped.symbol };
        }
        return { kind: 'out_of_scope' };
    }
    return { kind: 'none' };
}

/**
 * True when a workspace-indexed symbol hit from ANOTHER file must be
 * hidden because it is a program-body local. Providers that fall back
 * to the raw indexer tables (definition/hover/references) share this
 * gate; non-local symbol kinds are never hidden by it. Callers exempt
 * same-file hits themselves where same-file redefinitions are wanted.
 */
export function is_cross_file_hidden_local(
    symbol_kind: string,
    symbol:
        | ProgramSymbol
        | MacroSymbol
        | VariableSymbol
        | ScalarSymbol
        | MatrixSymbol
): boolean {
    // The indexer's find_symbol_definitions only yields MacroSymbols
    // for the 'local' kind, so the narrowing cast is safe.
    return symbol_kind === 'local' &&
        !is_dofile_local(symbol as MacroSymbol);
}
