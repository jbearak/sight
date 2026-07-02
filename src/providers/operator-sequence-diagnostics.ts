import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token, StataAST, StataNode } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';
import { is_swallowed_continuation_terminator } from '../utils/continuation';
import { is_diagnostic_range_ignored } from './diagnostic-token-stream';

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
            const pair_result = this.classify_pair(first_token, second_token, ast ?? undefined);

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
