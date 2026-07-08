/**
 * Extract a constructed macro-name template from a `local`/`global` statement's
 * tokens, and expand it across loop iterator bindings.
 *
 * Name extraction uses **source-range adjacency**, not whitespace tokens; a
 * space manifests as a gap between token ranges.
 */
import { SymbolTable, Token } from '../../types';
import { is_valid_identifier } from '../option-argument-parser';
import { SINGLE_LINE_PREFIX_COMMANDS } from '../../utils/stata-prefix-commands';
import { build_static_value_env, StaticValueEnvOptions } from './static-value-env';
import { scan_macro_refs } from './macro-ref-scanner';

export type NamePart =
    | { kind: 'literal'; text: string }
    | { kind: 'local_ref'; name: string }
    | { kind: 'global_ref'; name: string };

export interface NameTemplate {
    scope: 'local' | 'global';
    parts: NamePart[];
}

export interface BindingFrame {
    var: string;
    values: string[];
}

/** Cap on concrete names produced per template; overflow ⇒ skip the template. */
export const EXPANSION_CAP = 5000;

// NUMBER is included so a digit adjacent to a macro ref joins the name,
// e.g. `local v`i'1` -> v`i'1 -> v<i>1, not a truncated v<i>. Digits become
// literal parts in parse_template_string. The adjacency check still excludes a
// space-separated trailing value (e.g. `local `i' 1`).
const NAME_TOKEN_TYPES = new Set(['WORD', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL', 'NUMBER']);

function tokens_adjacent(a: Token, b: Token): boolean {
    return (
        a.range.end.line === b.range.start.line &&
        a.range.end.character === b.range.start.character
    );
}

/**
 * Parse a raw constructed-name string (e.g. `` `i'_suffix ``, `` prefix_`i' ``)
 * into ordered parts. Returns null on constructs we do not evaluate (nested or
 * `=expr` macro refs, malformed refs).
 */
function parse_template_string(raw: string): NamePart[] | null {
    const parts: NamePart[] = [];
    let literal = '';
    const flush = () => {
        if (literal.length > 0) {
            parts.push({ kind: 'literal', text: literal });
            literal = '';
        }
    };
    const ok = scan_macro_refs(raw, {
        literal: (ch) => { literal += ch; },
        local_ref: (name) => { flush(); parts.push({ kind: 'local_ref', name }); return true; },
        global_ref: (name) => { flush(); parts.push({ kind: 'global_ref', name }); return true; },
    });
    if (!ok) return null;
    flush();
    return parts;
}

/**
 * Given the tokens of a single statement (in order), return the constructed
 * name template if the statement is a `local`/`global` definition whose name
 * interpolates at least one macro reference; otherwise null.
 */
interface MacroDefHead {
    scope: 'local' | 'global';
    run: Token[];          // the adjacency-collected name token run
    is_increment: boolean; // true for `local ++name` / `local --name`
}

/**
 * Parse the head of a `local`/`global` (re)definition: skip single-line prefix
 * commands and an optional colon, read the keyword, note a `++`/`--` increment,
 * and collect the name token run by source-range adjacency. Returns null when
 * the statement is not a `local`/`global` definition.
 */
function parse_macro_def_head(statement_tokens: Token[]): MacroDefHead | null {
    let i = 0;
    // Skip leading single-line prefix commands (capture/quietly/noisily),
    // including a trailing colon (e.g. `quietly: local ...`, `cap noi: local`).
    while (i < statement_tokens.length && statement_tokens[i].type === 'WORD'
        && SINGLE_LINE_PREFIX_COMMANDS.has(statement_tokens[i].value)) {
        i++;
        if (i < statement_tokens.length && statement_tokens[i].type === 'COLON') {
            i++;
        }
    }
    const keyword = statement_tokens[i];
    if (!keyword || keyword.type !== 'WORD'
        || (keyword.value !== 'local' && keyword.value !== 'global')) {
        return null;
    }
    const scope: 'local' | 'global' = keyword.value === 'local' ? 'local' : 'global';
    i++;
    let is_increment = false;
    if (i < statement_tokens.length && statement_tokens[i].type === 'OPERATOR'
        && (statement_tokens[i].value === '++' || statement_tokens[i].value === '--')) {
        is_increment = true;
        i++;
    }
    // Collect the name run by adjacency. The first name token may follow a gap
    // (the space after the keyword); subsequent tokens must be contiguous.
    const run: Token[] = [];
    while (i < statement_tokens.length) {
        const my_tok = statement_tokens[i];
        if (!NAME_TOKEN_TYPES.has(my_tok.type)) break;
        if (run.length > 0 && !tokens_adjacent(run[run.length - 1], my_tok)) break;
        run.push(my_tok);
        i++;
    }
    if (run.length === 0) return null;
    return { scope, run, is_increment };
}

export function extract_name_template(statement_tokens: Token[]): NameTemplate | null {
    const head = parse_macro_def_head(statement_tokens);
    // A ++/-- prefix is an increment of an existing macro, not a fresh
    // definition, so it does not create any new constructed name.
    if (!head || head.is_increment) return null;
    const has_macro_ref = head.run.some(
        (t) => t.type === 'MACRO_REF_LOCAL' || t.type === 'MACRO_REF_GLOBAL'
    );
    if (!has_macro_ref) return null; // plain bare name: handled by process_macro_def
    const raw = head.run.map((my_token) => my_token.value).join('');
    const my_parts = parse_template_string(raw);
    if (!my_parts) return null;
    return { scope: head.scope, parts: my_parts };
}

/**
 * If the statement (re)defines a plain, statically-known macro name (a single
 * bare identifier — `local i ...`, `local i = ...`, `local ++i`), return its
 * scope and name. Constructed/dynamic names return null: they cannot shadow a
 * statically-known helper or iterator by name. Used to detect when a loop body
 * reassigns a macro that a later constructed name depends on.
 */
export function extract_redefined_macro_name(
    statement_tokens: Token[]
): { scope: 'local' | 'global'; name: string } | null {
    const head = parse_macro_def_head(statement_tokens);
    if (!head || head.run.length !== 1 || head.run[0].type !== 'WORD') return null;
    const name = head.run[0].value;
    return is_valid_identifier(name) ? { scope: head.scope, name } : null;
}

/**
 * True if the template directly references a local macro in `redefined_local`
 * or a global macro in `redefined_global`.
 */
export function template_references_redefined(
    template: NameTemplate,
    redefined_local: Set<string>,
    redefined_global: Set<string>
): boolean {
    for (const my_part of template.parts) {
        if (my_part.kind === 'local_ref' && redefined_local.has(my_part.name)) {
            return true;
        }
        if (my_part.kind === 'global_ref' && redefined_global.has(my_part.name)) {
            return true;
        }
    }
    return false;
}

/**
 * True if the statement is a macro increment/decrement whose target NAME is
 * constructed from a macro reference (e.g. `` local ++x_`i' `` or
 * `` global --g$k ``). Such a statement reassigns a macro whose concrete name
 * cannot be read off as a single bare identifier, so the caller must treat it
 * as a redefinition with an unknown target. A plain `` local ++x_1 `` (bare
 * name) is handled by `extract_redefined_macro_name` instead.
 */
export function is_constructed_increment(statement_tokens: Token[]): boolean {
    const head = parse_macro_def_head(statement_tokens);
    if (!head || !head.is_increment) return false;
    return head.run.some(
        (my_token) =>
            my_token.type === 'MACRO_REF_LOCAL'
            || my_token.type === 'MACRO_REF_GLOBAL'
    );
}

/** Compute the subset of frames whose iterator is referenced directly by the template. */
function relevant_frames(
    template: NameTemplate,
    frames: BindingFrame[]
): BindingFrame[] {
    const innermost_frame_by_var = new Map<string, BindingFrame>();
    for (const my_frame of frames) {
        innermost_frame_by_var.set(my_frame.var, my_frame);
    }

    const relevant = new Set<BindingFrame>();
    for (const my_part of template.parts) {
        if (my_part.kind !== 'local_ref') continue;
        const my_frame = innermost_frame_by_var.get(my_part.name);
        if (my_frame) relevant.add(my_frame);
    }
    // Preserve frame stack order for deterministic cartesian iteration.
    return frames.filter((f) => relevant.has(f));
}

/**
 * Expand a name template across the cartesian product of the relevant iterator
 * frames. Tuples with any unresolvable slot are skipped (partial dynamic).
 * Returns deduplicated concrete names; empty on overflow.
 */
export function expand_template(
    template: NameTemplate,
    frames: BindingFrame[],
    symbols: Pick<SymbolTable, 'localMacros' | 'globalMacros'>,
    // Local names that an enclosing nested loop rebinds (shadows). A reference
    // to one of these is per-iteration and unknown here, so it must NOT resolve
    // to the outer frame OR to a stale pre-loop value — treat it as
    // unresolvable so the constructed name's target stays unknown.
    shadowed_locals?: ReadonlySet<string>,
    env_options?: StaticValueEnvOptions
): string[] {
    const the_needed = relevant_frames(template, frames);
    let tuple_count = 1;
    for (const my_frame of the_needed) {
        tuple_count *= my_frame.values.length;
        // Overflow: bail with no names. This intentionally falls back to
        // pre-feature behavior — references to the (un-enumerated) names will
        // warn — rather than risk fabricating or partially injecting. A loop
        // producing more than EXPANSION_CAP (5000) concrete names is
        // pathological; warning on them is the conservative, never-falsely-
        // suppress choice.
        if (tuple_count > EXPANSION_CAP) return [];
    }
    const the_names = new Set<string>();
    // Build the env once over a single overlay Map that we re-bind per tuple;
    // the env's resolvers read the overlay live, so there is no need to rebuild
    // (and reallocate) it for each of the up-to-EXPANSION_CAP iterations.
    const the_overlay = new Map<string, string>();
    const my_env = build_static_value_env(symbols, the_overlay, env_options);
    for (let i = 0; i < tuple_count; i++) {
        let my_divisor = 1;
        for (const my_frame of the_needed) {
            const my_pick = Math.floor(i / my_divisor) % my_frame.values.length;
            the_overlay.set(my_frame.var, my_frame.values[my_pick]);
            my_divisor *= my_frame.values.length;
        }
        let my_name = '';
        let my_ok = true;
        for (const my_part of template.parts) {
            if (my_part.kind === 'literal') {
                my_name += my_part.text;
            } else if (my_part.kind === 'local_ref') {
                if (shadowed_locals?.has(my_part.name)) { my_ok = false; break; }
                const resolved = my_env.resolve_local(my_part.name);
                if (resolved === null) { my_ok = false; break; }
                my_name += resolved;
            } else {
                const resolved = my_env.resolve_global(my_part.name);
                if (resolved === null) { my_ok = false; break; }
                my_name += resolved;
            }
        }
        // Only inject names Stata could actually define. A digit-leading name
        // (e.g. `forvalues i = 1/3` with `local `i'_suffix` -> "1_suffix") is
        // not a valid macro name and would never be defined at runtime, so
        // injecting it would falsely suppress a reference to it.
        if (my_ok && is_valid_identifier(my_name)) the_names.add(my_name);
    }
    return [...the_names];
}
