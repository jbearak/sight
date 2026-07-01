import { Diagnostic, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';
import {
    COMPARISON_OPERATORS,
    LOGICAL_OPERATORS,
    collect_significant_tokens,
    is_adjacent,
} from './diagnostic-token-stream';

/**
 * Token types that, as the previous significant token, mark the end of an
 * operand. A comparison operator is only counted into a run when it follows
 * one of these — i.e. there is an operand between it and the prior comparison.
 * This excludes adjacent operator sequences like `< <` (reported separately by
 * OperatorSequenceAnalyzer), so we never double-report them.
 */
const OPERAND_END_TYPES: Set<string> = new Set([
    'WORD',
    'NUMBER',
    'STRING',
    'MACRO_REF_LOCAL',
    'MACRO_REF_GLOBAL',
    'RPAREN',
    'RBRACKET',
]);

/**
 * Token types that end an expression segment and flush all pending runs. An
 * inline block comment is whitespace-equivalent in Stata and is already
 * dropped by collect_significant_tokens, so it never splits a run. A line
 * comment ends the physical line, so it does break the segment.
 */
const EXPRESSION_BREAKERS: Set<string> = new Set([
    'STATEMENT_TERMINATOR',
    'COMMENT_LINE',
    'LBRACE',
    'RBRACE',
]);

/**
 * Top-level qualifier keywords that end the preceding expression segment.
 */
const QUALIFIER_BREAKERS: Set<string> = new Set(['if', 'in']);

/**
 * A completed comparison chain: the first and last comparison operators of a
 * run of two or more operand-separated comparisons at the same depth.
 */
interface Chain {
    first: Token;
    last: Token;
}

/**
 * ChainedComparisonAnalyzer detects suspicious comparison chains such as
 * `a != b != c`, `a == b == c`, `a < b < c`, or mixed forms like `a < b > c`.
 *
 * Stata has no mathematical chained-comparison semantics: `a < b < c` is
 * evaluated as `(a < b) < c`, comparing the 0/1 result of `a < b` against `c`.
 * A chain is therefore almost always a missing logical operator (`&`/`|`) or
 * missing parentheses.
 *
 * The analyzer walks the significant token stream with a stack of "comparison
 * runs" (one per parenthesis depth). A comparison operator is counted into the
 * current run only when the previous significant token ends an operand, so
 * adjacent operator sequences (`< <`) — already reported by
 * OperatorSequenceAnalyzer — are not double-reported. A run of two or more
 * counted comparisons produces one diagnostic.
 */
export class ChainedComparisonAnalyzer {
    /**
     * Analyze a document's token stream for chained comparisons.
     *
     * @param document - The document state containing tokens and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of chained-comparison diagnostics
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        const my_config_severity =
            config.diagnostics?.severity?.chainedComparison ?? 'warning';
        if (my_config_severity === 'off') {
            return [];
        }

        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        const the_significant = collect_significant_tokens(the_tokens);
        const my_ignored_lines = document.ignored_lines ?? new Set<number>();
        const my_severity = resolve_diagnostic_severity(my_config_severity);

        const the_chains: Chain[] = [];

        // Stack of comparison runs, one entry per open parenthesis/bracket.
        // Index 0 is the top-level (depth-0) run.
        let run_stack: Token[][] = [[]];
        let prev_significant: Token | undefined = undefined;

        const close_run = (my_run: Token[]): void => {
            if (my_run.length >= 2) {
                the_chains.push({
                    first: my_run[0],
                    last: my_run[my_run.length - 1],
                });
            }
            my_run.length = 0;
        };

        const flush_all = (): void => {
            for (const my_run of run_stack) {
                close_run(my_run);
            }
            run_stack = [[]];
            prev_significant = undefined;
        };

        for (const my_token of the_significant) {
            // Top-level `if`/`in` qualifier ends the preceding expression.
            if (
                run_stack.length === 1 &&
                my_token.type === 'WORD' &&
                QUALIFIER_BREAKERS.has(my_token.value)
            ) {
                flush_all();
                continue;
            }

            if (EXPRESSION_BREAKERS.has(my_token.type)) {
                flush_all();
                continue;
            }

            const current_run = run_stack[run_stack.length - 1];

            if (my_token.type === 'COMMA') {
                // A comma breaks any comparison run at the current depth
                // (command/option boundary, or function-argument separator).
                close_run(current_run);
                prev_significant = my_token;
                continue;
            }

            if (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') {
                run_stack.push([]);
                prev_significant = my_token;
                continue;
            }

            if (my_token.type === 'RPAREN' || my_token.type === 'RBRACKET') {
                if (run_stack.length > 1) {
                    const my_closed = run_stack.pop() as Token[];
                    close_run(my_closed);
                }
                prev_significant = my_token;
                continue;
            }

            if (my_token.type === 'OPERATOR') {
                if (LOGICAL_OPERATORS.has(my_token.value)) {
                    // A logical operator separates well-formed comparisons.
                    close_run(current_run);
                    prev_significant = my_token;
                    continue;
                }

                if (COMPARISON_OPERATORS.has(my_token.value)) {
                    // Count the comparison only when it follows an operand,
                    // i.e. there is an operand between it and any prior
                    // comparison. This skips adjacent sequences like `< <`.
                    if (
                        prev_significant &&
                        OPERAND_END_TYPES.has(prev_significant.type)
                    ) {
                        current_run.push(my_token);
                    } else {
                        // Not a chain link (unary/adjacent context): the run
                        // so far is complete.
                        close_run(current_run);
                    }
                    prev_significant = my_token;
                    continue;
                }

                // Other operators (arithmetic, negation) neither count nor
                // break a run; an operand between two comparisons is still
                // present via the operand token itself.
                prev_significant = my_token;
                continue;
            }

            // Any other significant token (operand). Two whitespace-separated
            // operands in a row with no operator between them mark a
            // command/expression boundary — e.g. the body of a braceless
            // single-line `if a < b gen ... c < d`, where `b gen` are separate
            // operands. A comparison run must not span that boundary. Operands
            // that are directly adjacent (no whitespace), such as the
            // concatenation `1`c'`, are a single expanded operand and must NOT
            // break the run.
            if (
                prev_significant &&
                OPERAND_END_TYPES.has(prev_significant.type) &&
                !is_adjacent(prev_significant, my_token)
            ) {
                close_run(current_run);
            }
            prev_significant = my_token;
        }

        // Flush pending runs at end of input.
        for (const my_run of run_stack) {
            close_run(my_run);
        }

        const the_diagnostics: Diagnostic[] = [];
        for (const my_chain of the_chains) {
            // A chain can span multiple lines via `///`; honor an @lsp-ignore
            // on any line the chain covers, not just its first.
            if (
                this.is_range_ignored(
                    my_chain.first.range.start.line,
                    my_chain.last.range.end.line,
                    my_ignored_lines
                )
            ) {
                continue;
            }
            the_diagnostics.push({
                range: Range.create(
                    my_chain.first.range.start,
                    my_chain.last.range.end
                ),
                message:
                    'Chained comparison is suspicious. Stata evaluates ' +
                    'comparisons left-to-right (e.g. `a < b < c` becomes ' +
                    '`(a < b) < c`), not as a mathematical chain. Use an ' +
                    'explicit logical operator (`&`/`|`) or parentheses to ' +
                    'make the intended evaluation clear.',
                severity: my_severity,
                source: 'sight',
                code: StataDiagnosticCode.CHAINED_COMPARISON,
                ...diagnostic_code_description_fields(
                    StataDiagnosticCode.CHAINED_COMPARISON
                ),
            });
        }

        return the_diagnostics;
    }

    /**
     * Whether any line in the inclusive range [start_line, end_line] is
     * suppressed by an @lsp-ignore directive.
     */
    private is_range_ignored(
        start_line: number,
        end_line: number,
        ignored_lines: Set<number>
    ): boolean {
        for (let my_line = start_line; my_line <= end_line; my_line++) {
            if (ignored_lines.has(my_line)) {
                return true;
            }
        }
        return false;
    }
}
