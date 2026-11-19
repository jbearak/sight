/**
 * `c_local` names taken from a program's positional arguments.
 *
 * A program can set a local in its caller whose name the caller passes
 * as an argument:
 *
 *     program _getrhs
 *         args where
 *         c_local `where' ...
 *     end
 *     _getrhs rhs          // the caller now has `rhs'
 *
 * The callee side records which argument positions name a caller
 * local. The call side maps those positions to the call's arguments
 * and keeps only plain names. Both sides refuse anything they cannot
 * read for certain: an argument that is a macro, a quoted string or
 * missing, or a binding that the program may change before `c_local`.
 */
import { Position, Range } from 'vscode-languageserver-textdocument';
import {
    CommandNode,
    MacroDefNode,
    MacroSymbol,
    StataNode,
    Token,
} from '../types';
import { nested_statements } from '../utils/node-body';
import { is_valid_identifier } from './option-argument-parser';
import { group_name_words, whole_word_item } from '../utils/name-words';
import { PROGRAM_COMMAND_NAMES } from '../utils/program-definition';

const C_LOCAL_MACRO_NAME_RE = /^`([A-Za-z_][A-Za-z0-9_]*)'$/;
const C_LOCAL_DIGIT_NAME_RE = /^`([1-9][0-9]*)'$/;
const DIGITS_RE = /^[0-9]+$/;
const PARSE_OPTION_RE = /^p(a(r(s(e)?)?)?)?$/;
const MACRO_SHIFT_RE = /^sh(i(f(t)?)?)?$/;
const NAME_CHAR_RE = /[A-Za-z0-9_`$]/;

/**
 * Shortest spelling of `tokenize` that Stata accepts (`token`), as in
 * the command database's `min_abbreviation`. Exact case.
 */
export const TOKENIZE_MIN_ABBREVIATION = 5;

/** True for `tokenize` or an abbreviation of it down to `token`. */
function is_tokenize(node: CommandNode): boolean {
    const name = node.fullName;
    return name.length >= TOKENIZE_MIN_ABBREVIATION
        && 'tokenize'.startsWith(name);
}

/**
 * True for `gettoken`'s source part `: 0`, which the parser keeps as
 * `[":", "0"]` or `[":0"]` in `extra_args`.
 */
function reads_from_zero(node: CommandNode): boolean {
    const the_extra = node.extra_args ?? [];
    return the_extra.map((my_item) => my_item.name).join('') === ':0';
}

function is_gettoken(node: CommandNode): boolean {
    return node.fullName === 'gettoken' || node.fullName === 'gettok';
}

function is_local_command(node: CommandNode): boolean {
    return node.fullName === 'local' || node.fullName === 'loc';
}

function is_macro_shift(node: CommandNode): boolean {
    if (node.fullName !== 'macro' && node.fullName !== 'mac') return false;
    const first = node.varlist?.[0]?.name;
    return first !== undefined && MACRO_SHIFT_RE.test(first);
}

/**
 * The name a `local` definition is read by here: its first word or
 * number, so `` local 1`x' `` counts as `1` and `` local foo`x' ``
 * as `foo`, as before names were joined across macros.
 */
function macro_def_head(node: MacroDefNode): string {
    const head = node.name_parts?.[0];
    return head?.kind === 'text' ? head.value : node.name;
}

/**
 * True if `node` itself (not its body) may change the program's `0`,
 * including `` local `name' `` and `` gettoken `name' ``, whose target
 * is not known.
 */
function changes_zero(node: StataNode): boolean {
    if (node.type === 'macro_def') {
        const head = macro_def_head(node);
        return node.scope === 'local'
            && (head === '0' || head.includes('`'));
    }
    if (node.type !== 'command') return false;
    if (is_local_command(node)) {
        const first = node.varlist?.[0]?.name;
        return first === '0' || (first?.includes('`') ?? false);
    }
    if (is_gettoken(node)) {
        return (node.varlist ?? []).some(
            (my_item) => my_item.name === '0' || my_item.name.includes('`')
        );
    }
    return is_macro_shift(node);
}

/**
 * True if `node` itself (not its body) may change a numbered local
 * such as `1`: `tokenize`, `macro shift`, `local 1 …`, a `gettoken`
 * into `1`, or `` local `name' ``, whose target is not known.
 */
function changes_numbered_local(node: StataNode): boolean {
    if (node.type === 'macro_def') {
        const head = macro_def_head(node);
        return node.scope === 'local'
            && (DIGITS_RE.test(head) || head.includes('`'));
    }
    if (node.type !== 'command') return false;
    if (is_tokenize(node)) return true;
    if (is_gettoken(node)) {
        return (node.varlist ?? []).some(
            (my_item) => DIGITS_RE.test(my_item.name) || my_item.name.includes('`')
        );
    }
    if (is_local_command(node)) {
        // `` local `n' `` may name a numbered local too.
        const first = node.varlist?.[0]?.name;
        return first !== undefined
            && (DIGITS_RE.test(first) || first.includes('`'));
    }
    return is_macro_shift(node);
}

/**
 * True if `node` or any statement nested in it satisfies `test`.
 * Nested program definitions are not part of the body.
 */
function some_statement(
    node: StataNode,
    test: (node: StataNode) => boolean
): boolean {
    if (test(node)) return true;
    if (node.type === 'program') return false;
    for (const my_child of nested_statements(node) ?? []) {
        if (some_statement(my_child, test)) return true;
    }
    return false;
}

/**
 * True if `gettoken` splits its source on spaces and on no character
 * that can appear in a name. Then a plain-name argument, and every
 * plain name before it, is one token, as it is for `args`. Allowed:
 * no options, or only `parse()` with a space in it, e.g. `parse(" ,")`.
 */
function gettoken_splits_on_spaces(node: CommandNode): boolean {
    for (const my_option of node.options ?? []) {
        if (!PARSE_OPTION_RE.test(my_option.name)) return false;
        const the_chars = unquote(my_option.argument ?? '');
        if (the_chars === undefined) return false;
        if (!the_chars.includes(' ') || NAME_CHAR_RE.test(the_chars)) {
            return false;
        }
    }
    return true;
}

/** The text inside `"…"` or `` `"…"' ``, or undefined. */
function unquote(text: string): string | undefined {
    const trimmed = text.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }
    if (
        trimmed.length >= 4
        && trimmed.startsWith('`"')
        && trimmed.endsWith('"\'')
    ) {
        return trimmed.slice(2, -2);
    }
    return undefined;
}

function same_start(a: Range, b: Range): boolean {
    return a.start.line === b.start.line
        && a.start.character === b.start.character;
}

/**
 * Names in a program body that `` c_local `name' `` uses as the
 * caller's local name, including numbered names such as `1`. Nested
 * program definitions are skipped.
 */
function collect_c_local_name_macros(
    nodes: StataNode[],
    names: Set<string>
): void {
    for (const my_node of nodes) {
        if (my_node.type === 'program') continue;
        const name = c_local_name_macro(my_node);
        if (name !== undefined) names.add(name);
        const the_body = nested_statements(my_node);
        if (the_body) collect_c_local_name_macros(the_body, names);
    }
}

/**
 * The macro that `node` uses as its whole `c_local` name: `where` for
 * `` c_local `where' … ``, `1` for `` c_local `1' … ``. Undefined for
 * any other statement.
 */
function c_local_name_macro(node: StataNode): string | undefined {
    if (node.type !== 'command' || node.fullName !== 'c_local') {
        return undefined;
    }
    const the_items = (node.varlist ?? []).filter(
        (my_item) => my_item.recovery_only !== true
    );
    // The parser splits `` `where'_x `` into two items; a name
    // joined to more text is not the argument alone.
    const first = whole_word_item(group_name_words(the_items)[0]);
    const match = first
        ? C_LOCAL_MACRO_NAME_RE.exec(first.name)
            ?? C_LOCAL_DIGIT_NAME_RE.exec(first.name)
        : null;
    return match?.[1];
}

/**
 * Adds to `positions` each numbered `` c_local `N' `` in `nodes` that
 * runs, on its first pass, before anything may have changed the
 * numbered locals (`changes_numbered_local`). A reset after the
 * `c_local` ran cannot undo the caller's local, so
 * `` c_local `1' 1 `` then `tokenize "x y"` still names argument 1.
 *
 * `changed` says whether the numbered locals may already have changed
 * on entry; the result says whether they may have after `nodes`. The
 * branches of an `if` and its `else` chain each start from the state
 * before the `if`; after the chain, a change in any branch counts.
 * A loop body is read once, in order: its first pass is what the
 * caller's local depends on. Nested program definitions are skipped.
 */
function collect_numbered_c_local_positions(
    nodes: readonly StataNode[],
    changed: boolean,
    positions: Set<number>
): boolean {
    // State before the current `if`/`else` chain, and the union of
    // its branches' outcomes so far.
    let chain_entry = changed;
    let chain_changed = changed;
    for (const my_node of nodes) {
        if (my_node.type === 'program') continue;
        if (my_node.type === 'else') {
            const after = collect_numbered_c_local_positions(
                my_node.body, chain_entry, positions);
            chain_changed = chain_changed || after;
            changed = chain_changed;
            continue;
        }
        chain_entry = changed;
        if (!changed) {
            const name = c_local_name_macro(my_node);
            if (name !== undefined && DIGITS_RE.test(name)) {
                positions.add(Number(name));
            }
        }
        if (changes_numbered_local(my_node)) changed = true;
        const the_body = nested_statements(my_node);
        if (the_body) {
            changed = collect_numbered_c_local_positions(
                the_body, changed, positions);
        }
        chain_changed = changed;
    }
    return changed;
}

/**
 * Positions bound by `args` statements in the body, keyed by name, with
 * the range of the name in the `args` statement. `args` reads `1`, `2`,
 * …, so an `args` counts only when no earlier top-level statement, and
 * nothing in its own top-level statement, may change those
 * (`tokenize`, `macro shift`, `local 1 …`).
 */
function collect_args_bindings(
    body: StataNode[],
    bindings: Map<string, Array<{ position: number; range: Range }>>
): void {
    for (const my_node of body) {
        if (some_statement(my_node, changes_numbered_local)) return;
        collect_args_in(my_node, bindings);
    }
}

function collect_args_in(
    node: StataNode,
    bindings: Map<string, Array<{ position: number; range: Range }>>
): void {
    if (node.type === 'program') return;
    if (node.type === 'command' && node.fullName === 'args') {
        const the_items = node.varlist ?? [];
        // A recovered item may not be one word in Stata's split.
        if (!the_items.some((my_item) => my_item.recovery_only === true)) {
            // Positions count words: `` args a`i' b `` binds `b` to 2,
            // and the joined first name is known only at run time.
            group_name_words(the_items).forEach((my_word, i) => {
                const my_item = whole_word_item(my_word);
                if (!my_item || !is_valid_identifier(my_item.name)) return;
                const the_list = bindings.get(my_item.name) ?? [];
                the_list.push({ position: i + 1, range: my_item.range });
                bindings.set(my_item.name, the_list);
            });
        }
    }
    for (const my_child of nested_statements(node) ?? []) {
        collect_args_in(my_child, bindings);
    }
}

/**
 * Names bound to position 1 by the first top-level reads from `0`:
 * `gettoken name : 0` (which reads without consuming) and the first
 * `gettoken name 0 : 0`. Later reads are not counted: a word such as
 * `x,` is one argument but two tokens under `parse(" ,")`. The search
 * also ends at a statement anywhere that may change `0` some other
 * way, such as a `gettoken` from `0` inside an `if`, or `local 0 …`.
 */
function collect_gettoken_bindings(
    body: StataNode[],
    bindings: Map<string, Array<{ position: number; range: Range }>>
): void {
    for (const my_node of body) {
        const is_top_level_read = my_node.type === 'command'
            && is_gettoken(my_node)
            && reads_from_zero(my_node);
        if (!is_top_level_read) {
            if (some_statement(my_node, changes_zero)) return;
            continue;
        }
        // Words, so a joined name (`` gettoken a`i' : 0 ``) binds nothing.
        const the_outputs = group_name_words(my_node.varlist ?? []);
        const first = whole_word_item(the_outputs[0]);
        if (
            !first
            || first.recovery_only === true
            || !is_valid_identifier(first.name)
            || the_outputs.length > 2
            || !gettoken_splits_on_spaces(my_node)
        ) {
            return;
        }
        const the_list = bindings.get(first.name) ?? [];
        the_list.push({ position: 1, range: first.range });
        bindings.set(first.name, the_list);
        if (whole_word_item(the_outputs[1])?.name === '0') return;
    }
}

/**
 * Argument positions whose plain-name value a program uses as a
 * `c_local` name, sorted and unique. Covers:
 *
 * - `args a b` then `` c_local `b' `` (position 2);
 * - `` c_local `1' `` when nothing before it in the body may have
 *   changed the numbered locals (`tokenize`, `macro shift`,
 *   `local 1 …`; see `collect_numbered_c_local_positions`);
 * - a leading `gettoken a 0 : 0` then `` c_local `a' `` (position 1).
 *
 * An `args`/`gettoken` name counts only when that statement is the
 * name's one definition in the program. `local_macros` is the
 * program scope's local-macro map after its body was analyzed; a second
 * definition shows up there as `additional_definitions` or as a primary
 * whose range is not the binding's.
 */
export function extract_c_local_arg_positions(
    body: StataNode[],
    local_macros: ReadonlyMap<string, MacroSymbol>
): number[] {
    const the_names = new Set<string>();
    collect_c_local_name_macros(body, the_names);
    if (the_names.size === 0) return [];

    const the_positions = new Set<number>();
    collect_numbered_c_local_positions(body, false, the_positions);

    const the_bindings = new Map<string, Array<{ position: number; range: Range }>>();
    collect_args_bindings(body, the_bindings);
    collect_gettoken_bindings(body, the_bindings);
    for (const my_name of the_names) {
        if (DIGITS_RE.test(my_name)) continue;
        const the_list = the_bindings.get(my_name);
        if (!the_list || the_list.length !== 1) continue;
        const symbol = local_macros.get(my_name);
        if (
            !symbol
            || (symbol.additional_definitions?.length ?? 0) > 0
            || !same_start(symbol.location.range, the_list[0].range)
        ) {
            continue;
        }
        the_positions.add(the_list[0].position);
    }
    return [...the_positions].sort((a, b) => a - b);
}

/** A caller local that a call creates through a positional argument. */
export interface CLocalArgName {
    name: string;
    /** Range of the argument word at the call. */
    range: Range;
}

function compare_positions(a: Position, b: Position): number {
    return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

/**
 * Index of the first token starting at or after `position`, by binary
 * search: `tokens` are in source order.
 */
export function first_token_at_or_after(tokens: readonly Token[], position: Position): number {
    let low = 0;
    let high = tokens.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (compare_positions(tokens[middle].range.start, position) < 0) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function touches(a: Token, b: Token): boolean {
    return compare_positions(a.range.end, b.range.start) === 0;
}

/**
 * The call's argument words as Stata splits them into `1`, `2`, …:
 * on white space, with a quoted string as one word. Each entry is the
 * plain name at that position, or null for any other word. The list
 * stops before the first word whose position, or that of the words
 * after it, is not certain: one that holds a macro (it may expand to
 * any number of words), a string joined to other text, or a word
 * touching a comment.
 */
function split_call_words(
    node: CommandNode,
    tokens: readonly Token[]
): Array<{ name: string; range: Range } | null> {
    const the_prefixes = node.prefix ?? [];
    const last_prefix = the_prefixes[the_prefixes.length - 1];
    const search_from = last_prefix ? last_prefix.range.end : node.range.start;
    let i = first_token_at_or_after(tokens, search_from);
    while (
        i < tokens.length
        && compare_positions(tokens[i].range.start, node.range.end) < 0
        && !(tokens[i].type === 'WORD' && tokens[i].value === node.name)
    ) {
        i++;
    }
    const the_words: Array<{ name: string; range: Range } | null> = [];
    let current: Token[] = [];
    let previous: Token | undefined;
    // A comment, or a word that touches one, makes the split unclear.
    let tainted = false;

    const finish_word = (): boolean => {
        if (current.length === 0) return true;
        const has_macro = current.some((my_token) =>
            my_token.type === 'MACRO_REF_LOCAL'
            || my_token.type === 'MACRO_REF_GLOBAL'
            || my_token.value.includes('`')
            || my_token.value.includes('$')
        );
        const joined_string = current.length > 1
            && current.some((my_token) => my_token.type === 'STRING');
        if (has_macro || joined_string || tainted) return false;
        const only = current.length === 1 ? current[0] : undefined;
        the_words.push(
            only && only.type === 'WORD' && is_valid_identifier(only.value)
                ? { name: only.value, range: only.range }
                : null
        );
        current = [];
        return true;
    };

    for (i += 1; i < tokens.length; i++) {
        const my_token = tokens[i];
        if (compare_positions(my_token.range.start, node.range.end) >= 0) break;
        if (
            my_token.type === 'CONTINUATION'
            || my_token.type === 'STATEMENT_TERMINATOR'
            || my_token.type === 'WHITESPACE'
        ) {
            if (!finish_word()) return the_words;
            previous = undefined;
            continue;
        }
        if (my_token.type === 'COMMENT_BLOCK' || my_token.type === 'COMMENT_LINE') {
            if (previous && touches(previous, my_token)) tainted = true;
            if (!finish_word()) return the_words;
            previous = my_token;
            continue;
        }
        if (previous && touches(previous, my_token)) {
            if (previous.type === 'COMMENT_BLOCK' || previous.type === 'COMMENT_LINE') {
                tainted = true;
            }
        } else if (!finish_word()) {
            return the_words;
        }
        current.push(my_token);
        previous = my_token;
    }
    finish_word();
    return the_words;
}

/**
 * Caller locals that a call to a program with `positions` (from
 * `extract_c_local_arg_positions`) creates: the plain name at each
 * position. `tokens` is the file's token stream.
 */
export function resolve_c_local_arg_names(
    node: CommandNode,
    tokens: readonly Token[],
    positions: readonly number[]
): CLocalArgName[] {
    if (positions.length === 0 || node.body) return [];
    const the_words = split_call_words(node, tokens);
    const the_names: CLocalArgName[] = [];
    for (const my_position of positions) {
        const my_word = the_words[my_position - 1];
        if (my_word) the_names.push({ name: my_word.name, range: my_word.range });
    }
    return the_names;
}

/**
 * The names a literal `program drop` removes, or `all` for
 * `program drop _all`. Undefined for any other statement.
 */
export function program_drop_targets(
    node: StataNode
): { names: string[]; all: boolean } | undefined {
    if (node.type !== 'command' || !PROGRAM_COMMAND_NAMES.has(node.fullName)) {
        return undefined;
    }
    const the_items = (node.varlist ?? []).filter(
        (my_item) => my_item.recovery_only !== true
    );
    if (the_items[0]?.name !== 'drop') return undefined;
    const the_names: string[] = [];
    let all = false;
    for (const my_item of the_items.slice(1)) {
        if (my_item.name === '_all') {
            all = true;
        } else if (my_item.name === '_allado') {
            // Drops only programs loaded from ados, which this file's
            // own definitions are not; such a program reloads anyway.
            continue;
        } else if (is_valid_identifier(my_item.name)) {
            the_names.push(my_item.name);
        }
    }
    return { names: the_names, all };
}
