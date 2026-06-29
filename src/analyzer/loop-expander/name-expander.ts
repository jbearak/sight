/**
 * Extract a constructed macro-name template from a `local`/`global` statement's
 * tokens, and expand it across loop iterator bindings.
 *
 * Name extraction uses **source-range adjacency**, not whitespace tokens,
 * because the lexer emits no WHITESPACE tokens in the default `cr` delimiter
 * mode (src/lexer/index.ts) — a space manifests as a gap between token ranges.
 */
import { SymbolTable, Token } from '../../types';
import { is_valid_identifier } from '../option-argument-parser';
import { build_static_value_env } from './static-value-env';
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

const PREFIX_COMMANDS = new Set([
    'capture', 'cap', 'quietly', 'qui', 'quie', 'noisily', 'noi',
]);
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
export function extract_name_template(statement_tokens: Token[]): NameTemplate | null {
    let i = 0;
    // Skip leading single-line prefix commands (capture/quietly/noisily),
    // including a trailing colon (e.g. `quietly: local ...`, `cap noi: local`).
    while (i < statement_tokens.length && statement_tokens[i].type === 'WORD'
        && PREFIX_COMMANDS.has(statement_tokens[i].value)) {
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
    // A ++/-- prefix is an increment of an existing macro, not a fresh
    // definition, so it does not create any new constructed name.
    if (i < statement_tokens.length && statement_tokens[i].type === 'OPERATOR'
        && (statement_tokens[i].value === '++' || statement_tokens[i].value === '--')) {
        return null;
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
    const has_macro_ref = run.some(
        (t) => t.type === 'MACRO_REF_LOCAL' || t.type === 'MACRO_REF_GLOBAL'
    );
    if (!has_macro_ref) return null; // plain bare name: handled by process_macro_def
    const raw = run.map((my_token) => my_token.value).join('');
    const my_parts = parse_template_string(raw);
    if (!my_parts) return null;
    return { scope, parts: my_parts };
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
    symbols: Pick<SymbolTable, 'localMacros' | 'globalMacros'>
): string[] {
    const the_needed = relevant_frames(template, frames);
    let tuple_count = 1;
    for (const my_frame of the_needed) {
        tuple_count *= my_frame.values.length;
        if (tuple_count > EXPANSION_CAP) return [];
    }
    const the_names = new Set<string>();
    // Build the env once over a single overlay Map that we re-bind per tuple;
    // the env's resolvers read the overlay live, so there is no need to rebuild
    // (and reallocate) it for each of the up-to-EXPANSION_CAP iterations.
    const the_overlay = new Map<string, string>();
    const my_env = build_static_value_env(symbols, the_overlay);
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
