import { Token } from '../types';
import { SINGLE_LINE_PREFIX_COMMANDS } from '../utils/stata-prefix-commands';

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
 */
function is_command_position(
    the_significant: Token[],
    index: number
): boolean {
    let my_i = index - 1;
    while (my_i >= 0) {
        let my_token = the_significant[my_i];
        // A prefix command's optional colon, e.g. `cap:` / `qui noi:`.
        if (my_token.type === 'COLON') {
            my_i--;
            if (my_i < 0) {
                return false;
            }
            my_token = the_significant[my_i];
        }
        if (
            my_token.type === 'WORD' &&
            SINGLE_LINE_PREFIX_COMMANDS.has(my_token.value)
        ) {
            my_i--;
            continue;
        }
        return STATEMENT_BOUNDARY_TYPES.has(my_token.type);
    }
    return true;
}
