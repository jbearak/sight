import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token, StataAST, StataNode } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';
import { is_swallowed_continuation_terminator } from '../utils/continuation';
import { is_logical_statement_boundary } from '../utils/statement-span';
import {
    collect_significant_tokens,
    is_adjacent,
    is_diagnostic_range_ignored,
} from './diagnostic-token-stream';

/**
 * Spaced compound operators that Stata accepts as their compact form.
 */
const SPACED_COMPOUND_PAIRS: Map<string, string> = new Map([
    ['< =', '<='],
    ['> =', '>='],
    ['! =', '!='],
    ['~ =', '~='],
]);

/**
 * Malformed operators with a known intended form. `= =` works as `==` in scalar
 * expressions but not in all expression contexts such as if qualifiers.
 */
const MALFORMED_OPERATOR_PAIRS: Map<string, string> = new Map([
    ['= =', '=='],
]);

/**
 * Invalid pairs: operator combinations with no valid Stata meaning (context-independent).
 * These are always errors regardless of context.
 */
const INVALID_PAIRS: Set<string> = new Set([
    // Comparison + logical
    '< |', '< &', '> |', '> &',
    // Logical + comparison
    '| <', '| >', '& <', '& >',
    // Logical + assignment
    '| =',
    // Double logical
    '| &', '& |',
    // Double comparison
    '< <', '> >', '< >', '> <',
]);

export function is_invalid_operator_sequence_pair(
    first_value: string,
    second_value: string
): boolean {
    return INVALID_PAIRS.has(`${first_value} ${second_value}`);
}

/**
 * C-style logical pairs: context-dependent validity.
 * Valid (but stylistically discouraged) in if/else if control flow statements.
 * Invalid in if qualifier expressions.
 */
const CSTYLE_LOGICAL_PAIRS: Set<string> = new Set([
    '| |',  // || - valid in if/else if control flow, invalid in if qualifier
    '& &',  // && - valid in if/else if control flow, invalid in if qualifier
]);

/**
 * Pairs that get specialized messages (context-independent invalid pairs).
 */
const SPECIAL_MESSAGES: Map<string, string> = new Map([
    ['| =', "Stata does not support compound assignment operators"],
]);

/**
 * Messages for C-style logical in if qualifier context (error).
 */
const CSTYLE_QUALIFIER_MESSAGES: Map<string, string> = new Map([
    ['| |', "Stata uses '|' for logical OR, not '||'"],
    ['& &', "Stata uses '&' for logical AND, not '&&'"],
]);

/**
 * Messages for C-style logical in control flow context (informational).
 */
const CSTYLE_CONTROL_FLOW_MESSAGES: Map<string, string> = new Map([
    ['| |', "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style"],
    ['& &', "C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style"],
]);

/**
 * Arithmetic operators — adjacency with comparison is valid.
 */
const ARITHMETIC_OPS: Set<string> = new Set(['+', '-', '*', '/', '^']);

/**
 * Comparison operators.
 */
const COMPARISON_OPS: Set<string> = new Set(['<', '>']);

/**
 * Negation operators.
 */
const NEGATION_OPS: Set<string> = new Set(['!', '~']);

/**
 * Token types that are considered trivia for adjacency detection.
 * WHITESPACE, CONTINUATION, and comments between operators do not break
 * adjacency. Stata treats comments as whitespace within a continued
 * expression; in `#delimit cr`, the following STATEMENT_TERMINATOR still breaks
 * adjacency for line comments.
 */
const TRIVIA_TYPES: Set<string> = new Set([
    'WHITESPACE',
    'CONTINUATION',
    'COMMENT_BLOCK',
    'COMMENT_LINE',
]);

/**
 * Token types that break adjacency between operators.
 * Real statement terminators break adjacency.
 */
const ADJACENCY_BREAKERS: Set<string> = new Set([
    'STATEMENT_TERMINATOR',
]);

/**
 * Context for C-style logical operators.
 */
type OperatorContext = 'control_flow' | 'qualifier' | 'other';

/**
 * Commands whose documented grammar uses top-level compact
 * `|| levelvar:` random-equation separators. Full names only: command
 * abbreviations are not accepted without verified metadata.
 */
const MIXED_EFFECTS_SEPARATOR_COMMANDS: ReadonlySet<string> = new Set([
    'mixed',
    'mecloglog',
    'meglm',
    'meintreg',
    'melogit',
    'menbreg',
    'meologit',
    'meoprobit',
    'mepoisson',
    'meprobit',
    'meqrlogit',
    'meqrpoisson',
    'mestreg',
    'metobit',
    'xtmixed',
    'xtmelogit',
    'xtmepoisson',
]);

const OMITTED_MODEL_HEAD_COMMANDS: ReadonlySet<string> = new Set([
    'mestreg',
]);

const MIXED_COLON_OPTIONAL_PREFIX_COMMANDS: ReadonlySet<string> = new Set([
    'cap', 'capt', 'captu', 'captur', 'capture',
    'qui', 'quie', 'quiet', 'quietl', 'quietly',
    'noi', 'nois', 'noisi', 'noisil', 'noisily',
]);

const MIXED_COLON_REQUIRED_PREFIX_COMMANDS: ReadonlySet<string> = new Set([
    'xi',
]);

const NAME_FRAGMENT_TOKEN_TYPES: ReadonlySet<string> = new Set([
    'WORD',
    'MACRO_REF_LOCAL',
    'MACRO_REF_GLOBAL',
]);

// Mirrors loop-expander/name-expander.ts: a numeric token may continue a
// source-adjacent constructed name, but it cannot begin one.
const NAME_CONTINUATION_TOKEN_TYPES: ReadonlySet<string> = new Set([
    ...NAME_FRAGMENT_TOKEN_TYPES,
    'NUMBER',
]);

/**
 * Resolve the command used only by mixed-effects separator diagnostics.
 * Capture/quietly/noisily prefixes accept all exact documented spellings and
 * an optional colon; exact-case `xi` requires its colon. Argument-bearing and
 * multiword prefixes remain unsupported. Source-constructed command names fail
 * closed so they cannot inherit a built-in command's separator exception.
 */
function resolve_mixed_effects_command_head(
    the_significant: Token[],
    statement_start: number,
    statement_end: number
): { token: Token; index: number } | undefined {
    let my_i = statement_start;
    while (my_i < statement_end) {
        const my_prefix = the_significant[my_i];
        if (my_prefix.type !== 'WORD') {
            break;
        }

        if (MIXED_COLON_OPTIONAL_PREFIX_COMMANDS.has(my_prefix.value)) {
            my_i++;
            if (
                my_i < statement_end &&
                the_significant[my_i].type === 'COLON'
            ) {
                my_i++;
            }
            continue;
        }

        if (
            MIXED_COLON_REQUIRED_PREFIX_COMMANDS.has(my_prefix.value) &&
            my_i + 1 < statement_end &&
            the_significant[my_i + 1].type === 'COLON'
        ) {
            my_i += 2;
            continue;
        }
        break;
    }

    const my_command = the_significant[my_i];
    if (my_i >= statement_end || my_command?.type !== 'WORD') {
        return undefined;
    }

    const my_continuation = the_significant[my_i + 1];
    if (
        my_i + 1 < statement_end &&
        is_name_continuation_fragment(my_continuation) &&
        is_adjacent(my_command, my_continuation)
    ) {
        return undefined;
    }
    return { token: my_command, index: my_i };
}

type GroupOpener = 'LPAREN' | 'LBRACKET';

function is_matching_group_close(
    my_opener: GroupOpener | undefined,
    close_type: string
): boolean {
    return (
        (my_opener === 'LPAREN' && close_type === 'RPAREN') ||
        (my_opener === 'LBRACKET' && close_type === 'RBRACKET')
    );
}

function is_name_fragment(
    my_token: Token | undefined
): my_token is Token {
    return (
        my_token !== undefined &&
        NAME_FRAGMENT_TOKEN_TYPES.has(my_token.type)
    );
}

function is_name_continuation_fragment(
    my_token: Token | undefined
): my_token is Token {
    return (
        my_token !== undefined &&
        NAME_CONTINUATION_TOKEN_TYPES.has(my_token.type)
    );
}

function is_plausible_model_head(
    the_significant: Token[],
    model_head_index: number,
    statement_end: number
): boolean {
    const my_head = the_significant[model_head_index];
    if (is_mixed_varlist_wildcard(my_head)) {
        return true;
    }
    if (!is_name_fragment(my_head)) {
        return false;
    }
    if (
        my_head.type !== 'WORD' ||
        (my_head.value !== 'if' && my_head.value !== 'in')
    ) {
        return true;
    }

    const my_continuation = the_significant[model_head_index + 1];
    return (
        model_head_index + 1 < statement_end &&
        is_name_continuation_fragment(my_continuation) &&
        is_adjacent(my_head, my_continuation)
    );
}

function is_mixed_varlist_wildcard(
    my_token: Token | undefined
): boolean {
    return (
        (my_token?.type === 'OPERATOR' && my_token.value === '*') ||
        ((my_token?.type === 'OPERATOR' || my_token?.type === 'WORD') &&
            my_token.value === '?')
    );
}

function is_mixed_constructed_name_fragment(
    my_token: Token | undefined
): boolean {
    return (
        is_name_continuation_fragment(my_token) ||
        is_mixed_varlist_wildcard(my_token)
    );
}

function is_standalone_mixed_qualifier(
    the_significant: Token[],
    token_index: number
): boolean {
    const my_token = the_significant[token_index];
    if (
        my_token.type !== 'WORD' ||
        (my_token.value !== 'if' && my_token.value !== 'in')
    ) {
        return false;
    }

    const my_previous = the_significant[token_index - 1];
    const my_next = the_significant[token_index + 1];
    return !(
        (is_mixed_constructed_name_fragment(my_previous) &&
            is_adjacent(my_previous, my_token)) ||
        (is_mixed_constructed_name_fragment(my_next) &&
            is_adjacent(my_token, my_next))
    );
}

function is_plausible_mixed_varlist_range_dash(
    the_significant: Token[],
    dash_index: number
): boolean {
    const my_dash = the_significant[dash_index];
    const my_right_fragment = the_significant[dash_index + 1];
    if (
        my_dash.type !== 'OPERATOR' ||
        my_dash.value !== '-' ||
        !is_name_fragment(my_right_fragment) ||
        !is_adjacent(my_dash, my_right_fragment)
    ) {
        return false;
    }

    let my_right_boundary = my_dash;
    for (let my_i = dash_index - 1; my_i >= 0; my_i--) {
        const my_left_fragment = the_significant[my_i];
        if (
            !is_name_continuation_fragment(my_left_fragment) ||
            !is_adjacent(my_left_fragment, my_right_boundary)
        ) {
            return false;
        }
        if (is_name_fragment(my_left_fragment)) {
            return true;
        }
        my_right_boundary = my_left_fragment;
    }
    return false;
}

function has_dangling_operator_before_mixed_separator(
    the_significant: Token[],
    first_bar_index: number,
    mixed_varlist_is_open: boolean
): boolean {
    const my_previous = the_significant[first_bar_index - 1];
    if (!is_mixed_varlist_wildcard(my_previous)) {
        return my_previous?.type === 'OPERATOR';
    }
    if (!mixed_varlist_is_open) {
        return true;
    }

    let my_i = first_bar_index - 2;
    while (is_mixed_varlist_wildcard(the_significant[my_i])) {
        my_i--;
    }
    return the_significant[my_i]?.type === 'OPERATOR';
}

function plausible_levelvar_colon_index(
    the_significant: Token[],
    first_bar_index: number,
    statement_end: number
): number | undefined {
    const my_first_fragment_index = first_bar_index + 2;
    const my_first_fragment = the_significant[my_first_fragment_index];
    if (!is_name_fragment(my_first_fragment)) {
        return undefined;
    }

    let my_fragment_count = 1;
    let my_last_fragment_index = my_first_fragment_index;
    while (my_last_fragment_index + 1 < statement_end) {
        const my_last_fragment = the_significant[my_last_fragment_index];
        const my_next_fragment =
            the_significant[my_last_fragment_index + 1];
        if (
            !is_name_continuation_fragment(my_next_fragment) ||
            !is_adjacent(my_last_fragment, my_next_fragment)
        ) {
            break;
        }
        my_fragment_count++;
        my_last_fragment_index++;
    }

    const my_colon_index = my_last_fragment_index + 1;
    const my_colon = the_significant[my_colon_index];
    if (my_colon?.type !== 'COLON') {
        return undefined;
    }
    if (
        my_fragment_count === 1 &&
        my_first_fragment.type === 'WORD' &&
        (my_first_fragment.value === 'if' ||
            my_first_fragment.value === 'in')
    ) {
        return undefined;
    }
    return my_colon_index;
}

function mark_mixed_effects_separators_in_statement(
    the_significant: Token[],
    statement_start: number,
    statement_end: number,
    the_separator_starts: Set<Token>
): void {
    const my_command_head = resolve_mixed_effects_command_head(
        the_significant,
        statement_start,
        statement_end
    );
    if (
        my_command_head === undefined ||
        !MIXED_EFFECTS_SEPARATOR_COMMANDS.has(my_command_head.token.value)
    ) {
        return;
    }

    const my_group_stack: GroupOpener[] = [];
    const my_has_required_model_content =
        OMITTED_MODEL_HEAD_COMMANDS.has(my_command_head.token.value) ||
        is_plausible_model_head(
            the_significant,
            my_command_head.index + 1,
            statement_end
        );
    let my_saw_top_level_options_comma = false;
    let my_saw_top_level_double_bar = false;
    let my_has_marked_separator = false;
    let my_separators_are_valid = true;
    let my_mixed_varlist_is_open = true;

    for (
        let my_i = my_command_head.index + 1;
        my_i < statement_end;
        my_i++
    ) {
        const my_token = the_significant[my_i];
        if (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') {
            my_group_stack.push(my_token.type);
            continue;
        }
        if (my_token.type === 'RPAREN' || my_token.type === 'RBRACKET') {
            if (
                !is_matching_group_close(
                    my_group_stack[my_group_stack.length - 1],
                    my_token.type
                )
            ) {
                break;
            }
            my_group_stack.pop();
            continue;
        }

        if (my_group_stack.length !== 0) {
            continue;
        }
        if (my_token.type === 'COMMA') {
            if (!my_has_marked_separator) {
                my_saw_top_level_options_comma = true;
            }
            my_mixed_varlist_is_open = false;
            continue;
        }
        if (is_standalone_mixed_qualifier(the_significant, my_i)) {
            my_mixed_varlist_is_open = false;
        }

        const my_second_bar = the_significant[my_i + 1];
        if (
            my_token.type !== 'OPERATOR' ||
            my_token.value !== '|' ||
            my_second_bar?.type !== 'OPERATOR' ||
            my_second_bar.value !== '|' ||
            !is_adjacent(my_token, my_second_bar)
        ) {
            if (
                my_token.type === 'OPERATOR' &&
                !is_mixed_varlist_wildcard(my_token) &&
                !(
                    my_mixed_varlist_is_open &&
                    is_plausible_mixed_varlist_range_dash(
                        the_significant,
                        my_i
                    )
                )
            ) {
                my_mixed_varlist_is_open = false;
            }
            continue;
        }

        if (!my_saw_top_level_double_bar) {
            my_saw_top_level_double_bar = true;
            if (!my_has_required_model_content) {
                my_separators_are_valid = false;
            }
        }

        const my_levelvar_colon_index = plausible_levelvar_colon_index(
            the_significant,
            my_i,
            statement_end
        );
        if (
            !my_separators_are_valid ||
            (!my_has_marked_separator &&
                my_saw_top_level_options_comma) ||
            has_dangling_operator_before_mixed_separator(
                the_significant,
                my_i,
                my_mixed_varlist_is_open
            ) ||
            my_levelvar_colon_index === undefined
        ) {
            my_mixed_varlist_is_open = false;
            continue;
        }

        the_separator_starts.add(my_token);
        my_has_marked_separator = true;
        my_mixed_varlist_is_open = true;
        my_i = my_levelvar_colon_index;
    }
}

/**
 * Memo shared by the sibling analyzers, keyed by token-array identity.
 * Each lex produces a fresh token array, so identity is a sound cache key
 * and stale entries are collected with their arrays.
 */
const mixed_effects_separator_starts_memo =
    new WeakMap<Token[], Set<Token>>();

function file_mentions_mixed_effects_command(tokens: Token[]): boolean {
    for (const my_token of tokens) {
        if (
            my_token.type === 'WORD' &&
            MIXED_EFFECTS_SEPARATOR_COMMANDS.has(my_token.value)
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Return the first bar token of each recognized mixed-effects separator.
 * Sibling token-stream analyzers use this shared classification so the
 * command-specific grammar remains single-sourced. Results are memoized
 * per token array because both analyzers run on every diagnostics pass.
 */
export function collect_mixed_effects_separator_starts(
    tokens: Token[]
): Set<Token> {
    const my_memoized = mixed_effects_separator_starts_memo.get(tokens);
    if (my_memoized !== undefined) {
        return my_memoized;
    }

    const the_separator_starts =
        compute_mixed_effects_separator_starts(tokens);
    mixed_effects_separator_starts_memo.set(tokens, the_separator_starts);
    return the_separator_starts;
}

function compute_mixed_effects_separator_starts(
    tokens: Token[]
): Set<Token> {
    // Most files contain no mixed-effects command; skip the significant-
    // token rebuild and statement walk entirely for them.
    if (!file_mentions_mixed_effects_command(tokens)) {
        return new Set<Token>();
    }

    const the_significant = collect_significant_tokens(tokens);
    const the_separator_starts = new Set<Token>();
    let statement_start = 0;

    for (let my_i = 0; my_i <= the_significant.length; my_i++) {
        const my_token = the_significant[my_i];
        const at_end = my_token === undefined || my_token.type === 'EOF';
        if (!at_end && !is_logical_statement_boundary(my_token)) {
            continue;
        }

        if (statement_start < my_i) {
            mark_mixed_effects_separators_in_statement(
                the_significant,
                statement_start,
                my_i,
                the_separator_starts
            );
        }
        if (at_end) {
            break;
        }
        statement_start = my_i + 1;
    }

    return the_separator_starts;
}

/**
 * Internal classification result for an operator pair.
 */
interface OperatorPairResult {
    kind: 'spaced_compound' | 'malformed' | 'invalid' | 'cstyle_control_flow';
    first_token: Token;
    second_token: Token;
    pair_key: string;
    message: string;
    default_severity: DiagnosticSeverity;
    code: StataDiagnosticCode;
}

/**
 * OperatorSequenceAnalyzer inspects adjacent OPERATOR tokens in Stata source code
 * to detect operator sequences that are either accepted but stylistically
 * clearer without whitespace, malformed, invalid, or style-specific:
 * 
 * 1. Spaced compound sequences — operators like `< =` that Stata treats as `<=`
 * 2. Malformed sequences — operators like `= =` that are not equivalent to `==` in all contexts
 * 3. Invalid sequences — operator combinations with no valid Stata meaning like `< |` (Error severity)
 * 4. Context-dependent sequences — C-style logical operators (`&&`, `||`) that are valid in
 *    if/else if control flow statements but invalid in if qualifiers
 * 
 * The analyzer follows the established IndentationDiagnosticAnalyzer pattern: a standalone class
 * instantiated by DiagnosticsProvider, receiving DocumentState and StataLSPConfig, and returning Diagnostic[].
 */
export class OperatorSequenceAnalyzer {
    /**
     * Analyze a document's token stream for operator sequence diagnostics.
     * Returns diagnostics for spaced compound, malformed, and invalid operator pairs.
     * 
     * @param document - The document state containing tokens, AST, and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of diagnostics for operator sequences
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        // Early return if all operator-sequence config severities are 'off'
        const malformed_severity = config.diagnostics?.severity?.malformedOperator ?? 'warning';
        const spaced_compound_severity = config.diagnostics?.severity?.spacedCompoundOperator ?? 'information';
        const invalid_severity = config.diagnostics?.severity?.invalidOperatorSequence ?? 'error';
        const cstyle_severity = config.diagnostics?.severity?.cStyleLogicalInControlFlow ?? 'information';
        
        if (
            malformed_severity === 'off' &&
            spaced_compound_severity === 'off' &&
            invalid_severity === 'off' &&
            cstyle_severity === 'off'
        ) {
            return [];
        }

        // Early return if document.tokens is empty or undefined
        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        // Get ignored lines for suppression (default to empty set if undefined)
        const ignored_lines = document.ignored_lines ?? new Set<number>();

        // Get AST for context detection (may be undefined)
        const ast = document.ast;

        const the_mixed_effects_separator_starts =
            collect_mixed_effects_separator_starts(the_tokens);
        const the_diagnostics: Diagnostic[] = [];
        let i = 0;

        while (i < the_tokens.length) {
            const first_token = the_tokens[i];

            // Only consider OPERATOR tokens
            if (first_token.type !== 'OPERATOR') {
                i++;
                continue;
            }

            // Find the next non-trivia token
            const adjacency_result = this.find_adjacent_operator(the_tokens, i);

            if (!adjacency_result) {
                // No adjacent operator found
                i++;
                continue;
            }

            const { second_token, next_index } = adjacency_result;

            if (the_mixed_effects_separator_starts.has(first_token)) {
                i = next_index;
                continue;
            }

            // Classify the pair
            const pair_result = this.classify_pair(
                first_token,
                second_token,
                ast ?? undefined
            );

            if (!pair_result) {
                // Pair is allowed or unrecognized, skip
                i++;
                continue;
            }

            // Check for suppression via @lsp-ignore directives. The pair
            // can span lines via `///`; honor an @lsp-ignore on any line
            // the diagnostic covers.
            const my_pair_range = Range.create(
                first_token.range.start,
                second_token.range.end
            );
            if (is_diagnostic_range_ignored(my_pair_range, ignored_lines)) {
                // Suppressed by directive, advance past second token
                i = next_index;
                continue;
            }

            // Apply config severity override based on result kind
            let config_severity: 'error' | 'warning' | 'information' | 'hint' | 'off' | undefined;
            switch (pair_result.kind) {
                case 'spaced_compound':
                    config_severity = spaced_compound_severity;
                    break;
                case 'malformed':
                    config_severity = malformed_severity;
                    break;
                case 'invalid':
                    config_severity = invalid_severity;
                    break;
                case 'cstyle_control_flow':
                    config_severity = cstyle_severity;
                    break;
            }

            if (config_severity === 'off') {
                // Category is disabled, advance past second token
                i = next_index;
                continue;
            }

            // Build the diagnostic
            const severity = this.resolve_severity(config_severity, pair_result.default_severity);
            const diagnostic: Diagnostic = {
                range: my_pair_range,
                message: pair_result.message,
                severity,
                source: 'sight',
                code: pair_result.code,
                ...diagnostic_code_description_fields(pair_result.code),
            };

            the_diagnostics.push(diagnostic);

            // Advance past second token to avoid overlapping diagnostics
            i = next_index;
        }

        return the_diagnostics;
    }

    /**
     * Find the next adjacent OPERATOR token, if any.
     * Two OPERATOR tokens are considered "adjacent" if all tokens between them
     * are trivia (WHITESPACE, CONTINUATION, COMMENT_BLOCK, or COMMENT_LINE).
     * STATEMENT_TERMINATOR tokens break adjacency.
     * 
     * @param tokens - The token array
     * @param start_index - Index of the first OPERATOR token
     * @returns Object with second_token and next_index, or null if no adjacent operator
     */
    private find_adjacent_operator(
        tokens: Token[],
        start_index: number
    ): { second_token: Token; next_index: number } | null {
        let j = start_index + 1;
        let in_continuation = false;

        // Skip trivia tokens
        while (j < tokens.length) {
            const my_token = tokens[j];

            if (TRIVIA_TYPES.has(my_token.type)) {
                // Track if we're in a continuation sequence
                if (my_token.type === 'CONTINUATION') {
                    in_continuation = true;
                }
                j++;
                continue;
            }

            // The newline terminator swallowed by a `///` continuation
            // does NOT break adjacency; a real terminator (a `;` under
            // `#delimit ;`, or a plain newline) does.
            if (is_swallowed_continuation_terminator(my_token, in_continuation)) {
                // Reset continuation flag and continue scanning
                in_continuation = false;
                j++;
                continue;
            }

            if (ADJACENCY_BREAKERS.has(my_token.type)) {
                // Adjacency broken
                return null;
            }

            // Found a non-trivia, non-breaker token
            if (my_token.type === 'OPERATOR') {
                return { second_token: my_token, next_index: j + 1 };
            }

            // Non-operator token breaks adjacency
            return null;
        }

        // Reached end of tokens
        return null;
    }

    /**
     * Classify an operator pair as spaced_compound, malformed, invalid,
     * cstyle_control_flow, allowed, or unrecognized.
     * 
     * @param first_token - The first OPERATOR token
     * @param second_token - The second OPERATOR token
     * @param ast - The AST for context detection (may be undefined)
     * @returns OperatorPairResult if the pair is diagnostic-worthy; null otherwise
     */
    private classify_pair(
        first_token: Token,
        second_token: Token,
        ast: StataAST | undefined
    ): OperatorPairResult | null {
        const first_value = first_token.value;
        const second_value = second_token.value;
        const pair_key = `${first_value} ${second_value}`;

        // Check if it's a Stata-accepted spaced compound operator.
        const spaced_compound = SPACED_COMPOUND_PAIRS.get(pair_key);
        if (spaced_compound) {
            return {
                kind: 'spaced_compound',
                first_token,
                second_token,
                pair_key,
                message:
                    `Spaced compound operator '${pair_key}'. Stata treats this as ` +
                    `'${spaced_compound}'; consider writing '${spaced_compound}'.`,
                default_severity: DiagnosticSeverity.Information,
                code: StataDiagnosticCode.SPACED_COMPOUND_OPERATOR,
            };
        }

        // Check if it's a malformed pair with a compact spelling suggestion.
        const malformed_suggestion = MALFORMED_OPERATOR_PAIRS.get(pair_key);
        if (malformed_suggestion) {
            return {
                kind: 'malformed',
                first_token,
                second_token,
                pair_key,
                message: `Malformed operator '${pair_key}'. Did you mean '${malformed_suggestion}'?`,
                default_severity: DiagnosticSeverity.Warning,
                code: StataDiagnosticCode.MALFORMED_OPERATOR,
            };
        }

        // Check if it's a C-style logical pair (context-dependent)
        if (CSTYLE_LOGICAL_PAIRS.has(pair_key)) {
            const context = this.get_operator_context(first_token, second_token, ast);
            
            if (context === 'control_flow') {
                // Valid in control flow, emit informational diagnostic
                const message = CSTYLE_CONTROL_FLOW_MESSAGES.get(pair_key) ?? 
                    `C-style logical operator in if condition. Consider using single operator for consistency`;
                return {
                    kind: 'cstyle_control_flow',
                    first_token,
                    second_token,
                    pair_key,
                    message,
                    default_severity: DiagnosticSeverity.Information,
                    code: StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW,
                };
            } else {
                // Invalid in qualifier or other context
                const special_message = CSTYLE_QUALIFIER_MESSAGES.get(pair_key);
                const message = special_message
                    ? `Invalid operator sequence '${pair_key}'. ${special_message}`
                    : `Invalid operator sequence '${pair_key}'. This operator combination is not valid in Stata`;
                return {
                    kind: 'invalid',
                    first_token,
                    second_token,
                    pair_key,
                    message,
                    default_severity: DiagnosticSeverity.Error,
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                };
            }
        }

        // Check if it's an invalid pair (context-independent)
        if (INVALID_PAIRS.has(pair_key)) {
            const special_message = SPECIAL_MESSAGES.get(pair_key);
            const message = special_message
                ? `Invalid operator sequence '${pair_key}'. ${special_message}`
                : `Invalid operator sequence '${pair_key}'. This operator combination is not valid in Stata`;

            return {
                kind: 'invalid',
                first_token,
                second_token,
                pair_key,
                message,
                default_severity: DiagnosticSeverity.Error,
                code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
            };
        }

        // Check if it's an allowed adjacency (comparison + arithmetic in either order)
        if (this.is_allowed_adjacency(first_value, second_value)) {
            return null;
        }

        // Unrecognized pair, skip
        return null;
    }

    /**
     * Determine the context of an operator pair by checking if it falls within
     * an if/else if control flow condition or an if qualifier expression.
     * 
     * @param first_token - The first OPERATOR token
     * @param second_token - The second OPERATOR token
     * @param ast - The AST for context detection
     * @returns 'control_flow' if in if/else if statement, 'qualifier' if in if qualifier, 'other' otherwise
     */
    private get_operator_context(
        first_token: Token,
        second_token: Token,
        ast: StataAST | undefined
    ): OperatorContext {
        if (!ast || !ast.nodes) {
            // No AST available, treat as qualifier context (invalid)
            return 'other';
        }

        // Get the position of the operator pair (use first token's start)
        const op_line = first_token.range.start.line;
        const op_char = first_token.range.start.character;

        // Walk the AST to find nodes containing the operator position
        const context = this.find_context_in_nodes(ast.nodes, op_line, op_char);
        return context;
    }

    /**
     * Recursively search AST nodes to find the context of an operator.
     */
    private find_context_in_nodes(
        nodes: StataNode[],
        op_line: number,
        op_char: number
    ): OperatorContext {
        for (const my_node of nodes) {
            // Check if the operator is within this node's range
            if (!this.is_position_in_range(op_line, op_char, my_node.range)) {
                continue;
            }

            // Check for if/else control flow nodes
            if (my_node.type === 'if' || my_node.type === 'else') {
                const control_flow_node = my_node;
                
                // FIRST: Recursively check body to see if
                // operator is in a nested context
                if (control_flow_node.body) {
                    const body_context = this.find_context_in_nodes(
                        control_flow_node.body,
                        op_line,
                        op_char
                    );
                    if (body_context !== 'other') {
                        return body_context;
                    }
                    
                    // If body returned 'other', check if operator is actually within body range
                    // If so, it's in a plain body context, not in the condition
                    for (const body_node of control_flow_node.body) {
                        if (this.is_position_in_range(op_line, op_char, body_node.range)) {
                            return 'other';
                        }
                    }
                }
                
                // THEN: If not in body and node has a
                // condition, operator must be in the condition
                if (control_flow_node.condition) {
                    return 'control_flow';
                }
            }

            // Check for command nodes with if qualifier
            if (my_node.type === 'command') {
                const command_node = my_node;
                if (command_node.ifExpression) {
                    // This command has an if qualifier
                    // Note: ifExpression is a string without range info, so we can't verify
                    // the operator is actually within the qualifier. This is a best-effort check.
                    return 'qualifier';
                }
                
                // Check body for prefix commands with brace blocks
                if (command_node.body) {
                    const body_context = this.find_context_in_nodes(command_node.body, op_line, op_char);
                    if (body_context !== 'other') {
                        return body_context;
                    }
                }
            }

            // Check for program nodes
            if (my_node.type === 'program') {
                const program_node = my_node;
                if (program_node.body) {
                    const body_context = this.find_context_in_nodes(program_node.body, op_line, op_char);
                    if (body_context !== 'other') {
                        return body_context;
                    }
                }
            }

            // Check for other control flow nodes (foreach, forvalues, while, frame)
            if (my_node.type === 'foreach' || my_node.type === 'forvalues' || 
                my_node.type === 'while' || my_node.type === 'frame') {
                const control_flow_node = my_node;
                
                // FIRST: Recursively check body to see if operator is in a nested context
                if (control_flow_node.body) {
                    const body_context = this.find_context_in_nodes(control_flow_node.body, op_line, op_char);
                    if (body_context !== 'other') {
                        return body_context;
                    }
                    
                    // If body returned 'other', check if operator is actually within body range
                    // If so, it's in a plain body context, not in the condition
                    for (const body_node of control_flow_node.body) {
                        if (this.is_position_in_range(op_line, op_char, body_node.range)) {
                            return 'other';
                        }
                    }
                }
                
                // THEN: If not in body and node has a condition, operator must be in the condition
                if (control_flow_node.condition) {
                    return 'control_flow';
                }
            }
        }

        return 'other';
    }

    /**
     * Check if a position (line, character) is within a range.
     */
    private is_position_in_range(
        line: number,
        character: number,
        range: { start: { line: number; character: number }; end: { line: number; character: number } }
    ): boolean {
        // Check if position is after range start
        if (line < range.start.line) return false;
        if (line === range.start.line && character < range.start.character) return false;
        
        // Check if position is before range end
        if (line > range.end.line) return false;
        if (line === range.end.line && character >= range.end.character) return false;
        
        return true;
    }

    /**
     * Check if an operator pair is in the allowlist of valid adjacencies.
     * 
     * Allowed combinations:
     * - Comparison + arithmetic (either order): `< +`, `+ <`, `> *`, `^ >`, etc.
     * - Negation before comparison: `! <`, `! >`, `~ <`, `~ >`
     * 
     * @param first_value - Value of the first operator
     * @param second_value - Value of the second operator
     * @returns true if the pair is allowed, false otherwise
     */
    private is_allowed_adjacency(first_value: string, second_value: string): boolean {
        // Comparison + arithmetic (either order)
        if (COMPARISON_OPS.has(first_value) && ARITHMETIC_OPS.has(second_value)) {
            return true;
        }
        if (ARITHMETIC_OPS.has(first_value) && COMPARISON_OPS.has(second_value)) {
            return true;
        }

        // Negation before comparison
        if (NEGATION_OPS.has(first_value) && COMPARISON_OPS.has(second_value)) {
            return true;
        }

        return false;
    }

    /**
     * Convert a config severity string to LSP DiagnosticSeverity.
     * Falls back to the default severity if config is undefined.
     * 
     * @param config_severity - The severity from config
     * @param default_severity - The default severity to use
     * @returns The resolved DiagnosticSeverity
     */
    private resolve_severity(
        config_severity: 'error' | 'warning' | 'information' | 'hint' | 'off' | undefined,
        default_severity: DiagnosticSeverity
    ): DiagnosticSeverity {
        if (config_severity === undefined) {
            return default_severity;
        }
        if (config_severity === 'off') {
            throw new Error('resolve_severity called with "off" - caller must filter before calling');
        }
        // Preserve the original contract: an unexpected value maps to the
        // caller's default rather than yielding an undefined severity.
        return resolve_diagnostic_severity(config_severity, default_severity);
    }
}
