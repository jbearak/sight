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
import { scan_macro_refs } from './macro-ref-scanner';

/** A resolved static value, or `null` when the value is dynamic/unknown. */
export type StaticValue = string | null;

export interface StaticValueEnv {
    resolve_local(name: string): StaticValue;
    resolve_global(name: string): StaticValue;
    /**
     * Resolve every macro reference inside an arbitrary string (e.g. a `foreach`
     * list item like `` a`m'b ``), returning the fully-expanded text or null if
     * any referenced macro is dynamic/unknown.
     */
    interpolate(text: string): StaticValue;
}

type MacroMaps = Pick<SymbolTable, 'localMacros' | 'globalMacros'>;

const MAX_FOLD_DEPTH = 8;
// Synthetic values written by the analyzer for command-created macros.
const PLACEHOLDER =
    /^__(tempvar|unab|args|gettoken|file_read|option_local|option_global)_.*__$/;

/**
 * If `text` is a SINGLE pure string literal (`"..."` or compound `` `"..."' ``),
 * return its inner contents; otherwise return `null`.
 *
 * The whole text must be exactly one literal: a value like `"a" + "b"` is an
 * expression (Stata evaluates it to `ab`), not a literal, so it must NOT be
 * folded — returning its mis-stripped inner (`a" + "b`) would fabricate a value
 * and bypass the `= expr` dynamic guard.
 */
function strip_string_literal(text: string): string | null {
    // Compound double-quoted string `"..."', which may nest. Scan from the
    // opening delimiter tracking nesting depth; it is a single pure literal
    // only if depth returns to zero exactly at the end of the text.
    if (text.startsWith('`"')) {
        let depth = 0;
        let i = 0;
        while (i < text.length) {
            if (text[i] === '`' && text[i + 1] === '"') {
                depth++;
                i += 2;
            } else if (text[i] === '"' && text[i + 1] === '\'') {
                depth--;
                i += 2;
                if (depth === 0) {
                    return i === text.length ? text.slice(2, -2) : null;
                }
            } else {
                i++;
            }
        }
        return null; // unbalanced
    }
    // Simple double-quoted string "...". A simple Stata string cannot contain a
    // literal `"`, so an interior quote means this is multiple literals or an
    // expression (e.g. `"a" + "b"`), not a single literal.
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
        const inner = text.slice(1, -1);
        if (inner.includes('"')) return null;
        return inner;
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
    //
    // `max_index` bounds *definition order*: a reference inside this value may
    // only resolve to a macro defined strictly before `max_index` (the defining
    // macro's own definition index). Stata expands a macro's value eagerly at
    // its definition, so a reference captured there cannot see a macro defined
    // later in the file. Honoring this prevents fabricating a name from a
    // forward-defined macro (which would falsely suppress a real warning).
    const interpolate = (
        text: string,
        visited: Set<string>,
        depth: number,
        max_index: number
    ): StaticValue => {
        if (depth > MAX_FOLD_DEPTH) return null;
        const parts: string[] = [];
        const ok = scan_macro_refs(text, {
            literal: (ch) => { parts.push(ch); },
            local_ref: (name) => {
                const resolved = resolve_local_internal(name, visited, depth + 1, max_index);
                if (resolved === null) return false;
                parts.push(resolved);
                return true;
            },
            global_ref: (name) => {
                const resolved = resolve_global_internal(name, visited, depth + 1, max_index);
                if (resolved === null) return false;
                parts.push(resolved);
                return true;
            },
        });
        return ok ? parts.join('') : null;
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
        // References inside this macro's value must have been defined before
        // this macro itself (eager expansion at definition time). A macro with
        // no recorded index does not constrain its references.
        const next_max = symbol.definition_index ?? Number.POSITIVE_INFINITY;
        const literal = strip_string_literal(value);
        if (literal !== null) {
            return interpolate(literal, visited, depth, next_max);
        }
        // A non-literal `= expr` value (e.g. `2+2`) is dynamic.
        if (symbol.hasEquals) return null;
        return interpolate(value, visited, depth, next_max);
    };

    const resolve_local_internal = (
        name: string,
        visited: Set<string>,
        depth: number,
        max_index: number
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
        // Definition-order gate: a macro defined at/after the referencing
        // context did not exist when that reference was captured.
        if (symbol.definition_index !== undefined && symbol.definition_index >= max_index) {
            return null;
        }
        const next_visited = new Set(visited);
        next_visited.add(key);
        return fold_symbol(symbol, next_visited, depth);
    };

    const resolve_global_internal = (
        name: string,
        visited: Set<string>,
        depth: number,
        max_index: number
    ): StaticValue => {
        const key = `global:${name}`;
        if (visited.has(key)) return null; // cycle
        const symbol = symbols.globalMacros.get(name);
        if (!symbol) return null;
        if (symbol.definition_index !== undefined && symbol.definition_index >= max_index) {
            return null;
        }
        const next_visited = new Set(visited);
        next_visited.add(key);
        return fold_symbol(symbol, next_visited, depth);
    };

    // Memoize top-level resolutions of names NOT supplied by the overlay. The
    // overlay rebinds per cartesian tuple, so its names are never cached; every
    // other name folds identically across tuples (the overlay is consulted only
    // at depth 0 for the named macro itself), so a single fold suffices instead
    // of re-folding the same helper up to EXPANSION_CAP times.
    const memo_local = new Map<string, StaticValue>();
    const memo_global = new Map<string, StaticValue>();
    return {
        resolve_local: (name: string) => {
            const overlaid = overlay?.get(name);
            if (overlaid !== undefined) return overlaid;
            if (memo_local.has(name)) return memo_local.get(name)!;
            const resolved = resolve_local_internal(
                name, new Set(), 0, Number.POSITIVE_INFINITY);
            memo_local.set(name, resolved);
            return resolved;
        },
        resolve_global: (name: string) => {
            if (memo_global.has(name)) return memo_global.get(name)!;
            const resolved = resolve_global_internal(
                name, new Set(), 0, Number.POSITIVE_INFINITY);
            memo_global.set(name, resolved);
            return resolved;
        },
        interpolate: (text: string) =>
            interpolate(text, new Set(), 0, Number.POSITIVE_INFINITY),
    };
}
