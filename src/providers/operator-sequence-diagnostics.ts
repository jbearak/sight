import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';

/**
 * Suggestible pairs: spaced compound operators with a known intended form.
 * Maps the pair key (e.g., '< =') to the intended compound operator (e.g., '<=').
 */
const SUGGESTIBLE_PAIRS: Map<string, string> = new Map([
    ['< =', '<='],
    ['> =', '>='],
    ['! =', '!='],
    ['~ =', '~='],
    ['= =', '=='],
]);

/**
 * Invalid pairs: operator combinations with no valid Stata meaning.
 * These are always errors.
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
    // C-style logical (not valid in Stata)
    '| |', '& &',
]);

/**
 * Pairs that get specialized messages.
 */
const SPECIAL_MESSAGES: Map<string, string> = new Map([
    ['| |', "Stata uses '|' for logical OR, not '||'"],
    ['& &', "Stata uses '&' for logical AND, not '&&'"],
    ['| =', "Stata does not support compound assignment operators"],
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
 * WHITESPACE and CONTINUATION tokens between operators do not break adjacency.
 */
const TRIVIA_TYPES: Set<string> = new Set(['WHITESPACE', 'CONTINUATION']);

/**
 * Token types that break adjacency between operators.
 * STATEMENT_TERMINATOR, COMMENT_LINE, and COMMENT_BLOCK break adjacency.
 */
const ADJACENCY_BREAKERS: Set<string> = new Set([
    'STATEMENT_TERMINATOR',
    'COMMENT_LINE',
    'COMMENT_BLOCK',
]);

/**
 * Internal classification result for an operator pair.
 */
interface OperatorPairResult {
    kind: 'suggestible' | 'invalid';
    first_token: Token;
    second_token: Token;
    pair_key: string;
    message: string;
    default_severity: DiagnosticSeverity;
    code: StataDiagnosticCode;
}

/**
 * OperatorSequenceAnalyzer inspects adjacent OPERATOR tokens in Stata source code
 * to detect two categories of malformed sequences:
 * 
 * 1. Suggestible sequences — spaced compound operators like `< =` that likely meant `<=` (Warning severity)
 * 2. Invalid sequences — operator combinations with no valid Stata meaning like `< |` or `& &` (Error severity)
 * 
 * The analyzer follows the established IndentationDiagnosticAnalyzer pattern: a standalone class
 * instantiated by DiagnosticsProvider, receiving DocumentState and StataLSPConfig, and returning Diagnostic[].
 */
export class OperatorSequenceAnalyzer {
    /**
     * Analyze a document's token stream for malformed operator sequences.
     * Returns diagnostics for suggestible and invalid operator pairs.
     * 
     * @param document - The document state containing tokens and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of diagnostics for malformed operator sequences
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        // Early return if both config severities are 'off'
        const malformed_severity = config.diagnostics?.severity?.malformedOperator ?? 'warning';
        const invalid_severity = config.diagnostics?.severity?.invalidOperatorSequence ?? 'error';
        
        if (malformed_severity === 'off' && invalid_severity === 'off') {
            return [];
        }

        // Early return if document.tokens is empty or undefined
        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        // Get ignored lines for suppression (default to empty set if undefined)
        const ignored_lines = document.ignored_lines ?? new Set<number>();

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

            // Classify the pair
            const pair_result = this.classify_pair(first_token, second_token);

            if (!pair_result) {
                // Pair is allowed or unrecognized, skip
                i++;
                continue;
            }

            // Check for suppression via @lsp-ignore directives
            const diagnostic_line = first_token.range.start.line;
            if (ignored_lines.has(diagnostic_line)) {
                // Suppressed by directive, advance past second token
                i = next_index;
                continue;
            }

            // Apply config severity override
            const config_severity = pair_result.kind === 'suggestible'
                ? malformed_severity
                : invalid_severity;

            if (config_severity === 'off') {
                // Category is disabled, advance past second token
                i = next_index;
                continue;
            }

            // Build the diagnostic
            const severity = this.resolve_severity(config_severity, pair_result.default_severity);
            const diagnostic: Diagnostic = {
                range: Range.create(
                    first_token.range.start,
                    second_token.range.end
                ),
                message: pair_result.message,
                severity,
                source: 'sight',
                code: pair_result.code,
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
     * are trivia (WHITESPACE or CONTINUATION). STATEMENT_TERMINATOR, COMMENT_LINE,
     * or COMMENT_BLOCK tokens break adjacency.
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

            // Special case: STATEMENT_TERMINATOR after CONTINUATION is part of the
            // continuation and should NOT break adjacency. The newline after ///
            // is tokenized as STATEMENT_TERMINATOR but is semantically part of the
            // continuation.
            if (my_token.type === 'STATEMENT_TERMINATOR' && in_continuation) {
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
     * Classify an operator pair as suggestible, invalid, allowed, or unrecognized.
     * 
     * @param first_token - The first OPERATOR token
     * @param second_token - The second OPERATOR token
     * @returns OperatorPairResult if the pair is suggestible or invalid, null otherwise
     */
    private classify_pair(
        first_token: Token,
        second_token: Token
    ): OperatorPairResult | null {
        const first_value = first_token.value;
        const second_value = second_token.value;
        const pair_key = `${first_value} ${second_value}`;

        // Check if it's a suggestible pair
        const suggested_compound = SUGGESTIBLE_PAIRS.get(pair_key);
        if (suggested_compound) {
            return {
                kind: 'suggestible',
                first_token,
                second_token,
                pair_key,
                message: `Malformed operator '${pair_key}'. Did you mean '${suggested_compound}'?`,
                default_severity: DiagnosticSeverity.Warning,
                code: StataDiagnosticCode.MALFORMED_OPERATOR,
            };
        }

        // Check if it's an invalid pair
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
        switch (config_severity) {
            case 'error':
                return DiagnosticSeverity.Error;
            case 'warning':
                return DiagnosticSeverity.Warning;
            case 'information':
                return DiagnosticSeverity.Information;
            case 'hint':
                return DiagnosticSeverity.Hint;
            default:
                return default_severity;
        }
    }
}
