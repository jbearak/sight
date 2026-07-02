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
