/**
 * Static constant-folder for Stata macros.
 *
 * Answers "what is the statically-known string value of macro `name`?" so the
 * loop expander can resolve iteration lists and constructed macro names. A value
 * is static only when it bottoms out in literals; anything dynamic (= expr,
 * extended functions, command-created placeholders, unknown macros, cycles)
 * yields `null`.
 *
 * The optional `overlay` binds the loop iterator name(s) to their value for the
 * current cartesian tuple. Stata expands macro references EAGERLY, so where a
 * `` `i' `` sits determines whether it sees the loop value:
 *
 *   - A `` `i' `` written DIRECTLY in the constructed name (loop body) is
 *     re-evaluated every iteration and takes the loop value. The overlay
 *     supplies it — but only at the top level (`resolve_local`/`resolve_global`
 *     at recursion depth 0).
 *         local i = 1
 *         forvalues i = 2/10 { local x_`i' }     // x_2 .. x_10 (NOT x_1)
 *
 *   - A `` `i' `` that was captured into a SEPARATE macro's value assigned
 *     before the loop is expanded once, at that assignment, and the iterator
 *     token is gone thereafter. Folding such a stored value (depth > 0) must
 *     therefore NOT consult the overlay; it resolves the captured reference
 *     against the value `i` held when the helper was defined.
 *         local i old
 *         local suffix `i'                        // suffix is the literal "old"
 *         foreach i in a b { local x_`suffix' }   // x_old every iteration
 *
 * Consulting the overlay while folding a stored value would rebind the captured
 * `` `i' `` to the loop iterator and fabricate names that never exist at runtime
 * (`x_a`/`x_b`), falsely suppressing undefined-macro warnings. When the captured
 * value is not statically known (e.g. `local i = 1` uses `=`), the helper is
 * unresolvable and the constructed name is skipped (a conservative miss). This
 * is an INTENTIONAL, by-design limitation — declining to expand such a name is
 * always preferred over fabricating one, because a fabricated name is exactly
 * the false suppression this feature must never produce. (See the design spec's
 * "Out of scope" section.)
 */
import { MacroSymbol, SymbolTable } from '../../types';

/** A resolved static value, or `null` when the value is dynamic/unknown. */
export type StaticValue = string | null;

export interface StaticValueEnv {
    resolve_local(name: string): StaticValue;
    resolve_global(name: string): StaticValue;
}

type MacroMaps = Pick<SymbolTable, 'localMacros' | 'globalMacros'>;

const MAX_FOLD_DEPTH = 8;
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Synthetic values written by the analyzer for command-created macros.
const PLACEHOLDER =
    /^__(tempvar|unab|args|gettoken|file_read|option_local|option_global)_.*__$/;
const MACRO_NAME_PART = /[A-Za-z0-9_]/;

/**
 * If `text` is a single pure string literal (`"..."` or compound `` `"..."' ``),
 * return its inner contents; otherwise return `null`.
 */
function strip_string_literal(text: string): string | null {
    if (text.startsWith('`"') && text.endsWith('"\'') && text.length >= 4) {
        return text.slice(2, -2);
    }
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
        return text.slice(1, -1);
    }
    return null;
}

export function build_static_value_env(
    symbols: MacroMaps,
    overlay?: Map<string, string>
): StaticValueEnv {
    // Interpolate macro references inside a value string. Returns null if any
    // referenced macro is dynamic/unknown, or if the value uses constructs we
    // do not statically evaluate (nested macro refs, `=expr', unbalanced refs).
    const interpolate = (
        text: string,
        visited: Set<string>,
        depth: number
    ): StaticValue => {
        if (depth > MAX_FOLD_DEPTH) return null;
        const parts: string[] = [];
        let i = 0;
        while (i < text.length) {
            const c = text[i];
            if (c === '`') {
                // `=expr' (expression evaluation) and nested `...` are dynamic.
                if (text[i + 1] === '=') return null;
                let j = i + 1;
                let name = '';
                while (j < text.length && text[j] !== '\'' && text[j] !== '`') {
                    name += text[j];
                    j++;
                }
                if (j >= text.length || text[j] === '`') return null; // unbalanced/nested
                if (!VALID_NAME.test(name)) return null;
                const resolved = resolve_local_internal(name, visited, depth + 1);
                if (resolved === null) return null;
                parts.push(resolved);
                i = j + 1;
            } else if (c === '$') {
                let name = '';
                let j = i + 1;
                let braced = false;
                if (text[j] === '{') {
                    braced = true;
                    j++;
                }
                while (j < text.length && MACRO_NAME_PART.test(text[j])) {
                    name += text[j];
                    j++;
                }
                if (braced) {
                    if (text[j] !== '}') return null;
                    j++;
                }
                if (!VALID_NAME.test(name)) return null;
                const resolved = resolve_global_internal(name, visited, depth + 1);
                if (resolved === null) return null;
                parts.push(resolved);
                i = j;
            } else {
                parts.push(c);
                i++;
            }
        }
        return parts.join('');
    };

    const fold_symbol = (
        symbol: MacroSymbol,
        visited: Set<string>,
        depth: number
    ): StaticValue => {
        if (symbol.value === undefined) return null;
        // First-def-wins keeps only the FIRST value; later redefinitions live in
        // `additional_definitions` without their values. When the env is built
        // from the pre-loop snapshot, any `additional_definitions` means the
        // macro was redefined before the loop, so the stored value is stale and
        // its real value is unknown — treat it as dynamic rather than fold a
        // stale value (which could falsely suppress a warning).
        if (symbol.additional_definitions && symbol.additional_definitions.length > 0) {
            return null;
        }
        if (symbol.extendedFunction) return null;
        const value = symbol.value.trim();
        if (PLACEHOLDER.test(value)) return null;
        const literal = strip_string_literal(value);
        if (literal !== null) {
            return interpolate(literal, visited, depth);
        }
        // A non-literal `= expr` value (e.g. `2+2`) is dynamic.
        if (symbol.hasEquals) return null;
        return interpolate(value, visited, depth);
    };

    const resolve_local_internal = (
        name: string,
        visited: Set<string>,
        depth: number
    ): StaticValue => {
        // The overlay (loop iterator value) supplies a `` `i' `` written
        // directly in the constructed name (depth 0), which Stata re-evaluates
        // each iteration. A `` `i' `` reached by folding a stored macro's value
        // (depth > 0) was captured/expanded once at that macro's own assignment,
        // so it must resolve from the stored symbols, not the loop binding.
        // See the file header for worked examples.
        if (depth === 0) {
            const overlaid = overlay?.get(name);
            if (overlaid !== undefined) return overlaid;
        }
        const key = `local:${name}`;
        if (visited.has(key)) return null; // cycle
        const symbol = symbols.localMacros.get(name);
        if (!symbol) return null;
        const next_visited = new Set(visited);
        next_visited.add(key);
        return fold_symbol(symbol, next_visited, depth);
    };

    const resolve_global_internal = (
        name: string,
        visited: Set<string>,
        depth: number
    ): StaticValue => {
        const key = `global:${name}`;
        if (visited.has(key)) return null; // cycle
        const symbol = symbols.globalMacros.get(name);
        if (!symbol) return null;
        const next_visited = new Set(visited);
        next_visited.add(key);
        return fold_symbol(symbol, next_visited, depth);
    };

    return {
        resolve_local: (name: string) => resolve_local_internal(name, new Set(), 0),
        resolve_global: (name: string) => resolve_global_internal(name, new Set(), 0),
    };
}
