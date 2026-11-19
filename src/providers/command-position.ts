import { Token } from '../types';
import {
    COLON_PREFIX_COMMANDS,
    PREFIX_COMMANDS,
} from '../utils/stata-prefix-commands';

/**
 * Keywords that syntactically introduce a boolean condition wherever
 * they appear. Exact case; Stata is case-sensitive.
 */
export const CONTROL_FLOW_EXPRESSION_KEYWORDS: ReadonlySet<string> =
    new Set(['if', 'while']);

/**
 * Commands whose whole (non-prefix) argument is a bare boolean
 * expression but which are ordinary WORD tokens, not parser keywords —
 * recognizing them safely requires knowing they are in COMMAND
 * POSITION. `assert` is the only case Sight special-cases (#268 item 3):
 * folding it into CONTROL_FLOW_EXPRESSION_KEYWORDS was rejected on
 * review because that set is also consulted by call-opener detection,
 * and `assert` is a valid callee/subscript-target WORD in non-command
 * positions (`display assert(1`b')`, `gen y = assert[1`b']`).
 *
 * SEAM FOR THE DEFERRED FIX: issue #268 defers a general
 * position-to-context resolver (AST expression regions with ranges +
 * command-database expression-vs-text argument metadata) that would let
 * any command declare "this argument is an evaluated expression"
 * without a hardcoded set. When that lands, replace this set and
 * `is_bare_expression_command_at` with a query against that resolver —
 * this module is the only file that should need to change.
 *
 * Module-private on purpose: external callers must go through
 * `is_bare_expression_command_at`, which adds the command-position
 * check that makes the classification safe.
 */
const BARE_EXPRESSION_COMMANDS: ReadonlySet<string> =
    new Set(['assert']);

/**
 * Token types after which the next significant token is in command
 * position. A `#delimit` line ends any statement, so the token after a
 * DELIMIT_DIRECTIVE starts a new one.
 */
const STATEMENT_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
    'STATEMENT_TERMINATOR',
    'LBRACE',
    'RBRACE',
    'DELIMIT_DIRECTIVE',
]);

/**
 * Whether `the_significant[index]` is a BARE_EXPRESSION_COMMANDS word
 * used as a command: the first significant token of a statement,
 * optionally preceded by single-line prefix commands, each optionally
 * followed by a colon (`capture assert ...`, `cap: assert ...`,
 * `qui noi assert ...`). False for every non-command use.
 *
 * Precondition: `the_significant` has already been filtered by
 * `collect_significant_tokens` (src/providers/diagnostic-token-stream.ts),
 * so trivia and `///` continuations are gone and statement boundaries
 * are real STATEMENT_TERMINATOR tokens.
 */
export function is_bare_expression_command_at(
    the_significant: Token[],
    index: number
): boolean {
    const my_token = the_significant[index];
    if (my_token === undefined || my_token.type !== 'WORD') {
        return false;
    }
    if (!BARE_EXPRESSION_COMMANDS.has(my_token.value)) {
        return false;
    }
    return is_command_position(the_significant, index);
}

/**
 * Whether the token at `index` starts a command: scanning backward,
 * only prefix commands (each optionally followed by their colon) may
 * sit between it and the start of input or a statement boundary. This
 * is the backward version of the forward prefix-skipping grammar in
 * src/analyzer/loop-expander/name-expander.ts (parse_macro_def_head).
 * A `version #:` prefix (`version 16:`, `vers 16.1:`) counts too; it
 * is a prefix only with its colon.
 *
 * Same precondition as `is_bare_expression_command_at`: the tokens come
 * from `collect_significant_tokens`.
 */
export function is_command_position(
    the_significant: Token[],
    index: number
): boolean {
    return is_command_position_by(the_significant, index, (i) => i - 1);
}

/**
 * `is_command_position` over any token array: `previous(i)` gives the
 * index of the significant token before `i`, or -1 at the start. Lets
 * a raw lexer stream skip its own trivia (comments, `///` line ends).
 */
export function is_command_position_by(
    the_tokens: Token[],
    index: number,
    previous: (index: number) => number
): boolean {
    let my_i = previous(index);
    while (my_i >= 0) {
        let my_token = the_tokens[my_i];
        // A prefix command's optional colon, e.g. `cap:` / `qui noi:`.
        if (my_token.type === 'COLON') {
            my_i = previous(my_i);
            if (my_i < 0) {
                return false;
            }
            my_token = the_tokens[my_i];
            const my_version_index = version_prefix_start(
                the_tokens, my_i, previous
            );
            if (my_version_index !== undefined) {
                my_i = previous(my_version_index);
                continue;
            }
        }
        if (my_token.type === 'WORD' && is_single_line_prefix(my_token.value)) {
            my_i = previous(my_i);
            continue;
        }
        return STATEMENT_BOUNDARY_TYPES.has(my_token.type);
    }
    return true;
}

/**
 * Whether `word` is a prefix command that takes no arguments, in any
 * abbreviation Stata accepts (`capt`, `quie`, `n`, `noisi`), exact
 * case. `by` and `bysort` take a varlist, so they are not.
 */
export function is_single_line_prefix(word: string): boolean {
    const canonical = PREFIX_COMMANDS.get(word);
    return canonical !== undefined &&
        canonical !== 'by' && canonical !== 'bysort';
}

/**
 * When `the_tokens[index]`, the token before a colon, ends a
 * `version #:` prefix, the index of its `version` word; otherwise
 * undefined. The number may carry options: `16` in `version 16:`,
 * `user` in `version 16, user:`.
 */
function version_prefix_start(
    the_tokens: Token[],
    index: number,
    previous: (index: number) => number
): number | undefined {
    let my_i = index;
    if (the_tokens[my_i]?.type === 'WORD') {
        while (the_tokens[my_i]?.type === 'WORD') {
            my_i = previous(my_i);
        }
        if (the_tokens[my_i]?.type !== 'COMMA') {
            return undefined;
        }
        my_i = previous(my_i);
    }
    if (the_tokens[my_i]?.type !== 'NUMBER') {
        return undefined;
    }
    const my_word_index = previous(my_i);
    const my_word = the_tokens[my_word_index];
    if (
        my_word?.type === 'WORD' &&
        COLON_PREFIX_COMMANDS.get(my_word.value) === 'version'
    ) {
        return my_word_index;
    }
    return undefined;
}
