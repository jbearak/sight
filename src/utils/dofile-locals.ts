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
    VariableSymbol,
} from '../types';

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
 * The cross-file INHERITED do-file local for `name` visible at a
 * position in the current file, or undefined. Locals cross file
 * boundaries only through `include` semantics: backward via an
 * `included-by` chain entry (already call-site filtered by the
 * resolver), forward via an `include`-effective call site executed
 * before the reference line. Only do-file-scoped symbols qualify
 * (`is_dofile_local`, #271).
 *
 * Used by providers when a name is OUT OF SCOPE same-file (tracked
 * only in non-visible sibling scopes, #270): the same-file flat slot
 * is forbidden there, but an inherited do-file local is genuinely
 * defined at the reference — the analyzer's cross-file suppression
 * treats it as defined, so hover/definition/completion must too.
 */
export function find_inherited_dofile_local(
    resolved_scope: ResolvedScope | undefined,
    name: string,
    reference_line: number,
    current_uri: string
): MacroSymbol | undefined {
    if (!resolved_scope) {
        return undefined;
    }
    for (const my_entry of resolved_scope.chain ?? []) {
        if (my_entry.directive_type !== 'included-by') {
            continue;
        }
        const my_symbol = my_entry.symbols.localMacros.get(name);
        if (
            my_symbol &&
            my_symbol.sourceUri !== current_uri &&
            is_dofile_local(my_symbol)
        ) {
            return my_symbol;
        }
    }
    for (const my_site of resolved_scope.forward_call_symbols ?? []) {
        if (my_site.effective_type !== 'include') {
            continue;
        }
        if (reference_line <= my_site.call_line) {
            continue;
        }
        const my_symbol = my_site.symbols.localMacros.get(name);
        if (
            my_symbol &&
            my_symbol.sourceUri !== current_uri &&
            is_dofile_local(my_symbol)
        ) {
            return my_symbol;
        }
    }
    return undefined;
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
