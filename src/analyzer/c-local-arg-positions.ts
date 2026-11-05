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

const C_LOCAL_MACRO_NAME_RE = /^`([A-Za-z_][A-Za-z0-9_]*)'$/;
const C_LOCAL_DIGIT_NAME_RE = /^`([1-9][0-9]*)'$/;
const DIGITS_RE = /^[0-9]+$/;
const PARSE_OPTION_RE = /^p(a(r(s(e)?)?)?)?$/;
const MACRO_SHIFT_RE = /^sh(i(f(t)?)?)?$/;
const NAME_CHAR_RE = /[A-Za-z0-9_`$]/;

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
    if (node.fullName === 'tokenize') return true;
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
        if (my_node.type === 'command' && my_node.fullName === 'c_local') {
            const the_items = (my_node.varlist ?? []).filter(
                (my_item) => my_item.recovery_only !== true
            );
            // The parser splits `` `where'_x `` into two items; a name
            // joined to more text is not the argument alone.
            const first = whole_word_item(group_name_words(the_items)[0]);
            const match = first
                ? C_LOCAL_MACRO_NAME_RE.exec(first.name)
                    ?? C_LOCAL_DIGIT_NAME_RE.exec(first.name)
                : null;
            if (match) names.add(match[1]);
        }
        const the_body = nested_statements(my_node);
        if (the_body) collect_c_local_name_macros(the_body, names);
    }
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
 * - `` c_local `1' `` when nothing in the body changes the numbered
 *   locals (`tokenize`, `macro shift`, `local 1 …`);
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
    const has_digit_name = [...the_names].some((my_name) => DIGITS_RE.test(my_name));
    if (
        has_digit_name
        && !body.some((my_node) => some_statement(my_node, changes_numbered_local))
    ) {
        for (const my_name of the_names) {
            if (DIGITS_RE.test(my_name)) the_positions.add(Number(my_name));
        }
    }

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

/** Index of the first token starting at or after `position`. */
function first_token_at_or_after(tokens: readonly Token[], position: Position): number {
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

/** A caller local created at a call, with where the call sits. */
export interface CLocalArgCall {
    name: string;
    /** Line of the call statement. */
    line: number;
    /** Start line of the program body holding the call, if any. */
    program_start_line?: number;
}

/**
 * The caller locals that calls in `nodes` create through positional
 * `c_local` names of `programs`, grouped by local name. Also returns
 * the line spans of the program definitions in `nodes`, so a caller
 * can tell which program frame a reference sits in.
 */
export function collect_c_local_arg_calls(
    nodes: readonly StataNode[],
    tokens: readonly Token[],
    programs: ReadonlyMap<string, { c_local_arg_positions?: number[] }>
): {
    calls: Map<string, CLocalArgCall[]>;
    program_lines: Array<{ start: number; end: number }>;
} {
    const calls = new Map<string, CLocalArgCall[]>();
    const program_lines: Array<{ start: number; end: number }> = [];
    const visit = (the_nodes: readonly StataNode[], program_start_line?: number): void => {
        for (const my_node of the_nodes) {
            if (my_node.type === 'program') {
                program_lines.push({
                    start: my_node.range.start.line,
                    end: my_node.range.end.line,
                });
                visit(my_node.body, my_node.range.start.line);
                continue;
            }
            if (my_node.type === 'command') {
                const the_positions = programs.get(my_node.fullName)?.c_local_arg_positions;
                if (the_positions) {
                    for (const my_created of resolve_c_local_arg_names(my_node, tokens, the_positions)) {
                        const the_list = calls.get(my_created.name) ?? [];
                        the_list.push({
                            name: my_created.name,
                            line: my_node.range.start.line,
                            program_start_line,
                        });
                        calls.set(my_created.name, the_list);
                    }
                }
            }
            const the_body = nested_statements(my_node);
            if (the_body) visit(the_body, program_start_line);
        }
    };
    visit(nodes);
    return { calls, program_lines };
}
