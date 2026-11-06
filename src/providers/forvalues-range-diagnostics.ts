import { Diagnostic, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';
import { is_command_position } from './command-position';
import {
    collect_significant_tokens,
    is_adjacent,
    is_diagnostic_range_ignored,
} from './diagnostic-token-stream';

/**
 * Unsigned Stata numeric literal: `3`, `1.5`, `.5`, `1.`, `1e3`.
 * Anything else (missing values, hex floats, macros) is not a literal
 * this analyzer can evaluate, so the range is left alone.
 */
const NUMERIC_LITERAL_PATTERN = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Minimum abbreviation of `forvalues` that Stata accepts. */
const FORVALUES_MIN_ABBREVIATION_LENGTH = 4;

/**
 * A numeric literal in a `forvalues` range, with its source spelling and
 * the first and last tokens it spans (a negative literal is two tokens).
 */
interface NumericLiteral {
    text: string;
    value: number;
    first: Token;
    last: Token;
}

/**
 * The three `forvalues` range forms whose bounds and step are all
 * numeric literals:
 * - `slash`:   `a/b`, which always counts up by 1;
 * - `stepped`: `a(s)b`;
 * - `to`:      `a t to b` or `a t : b`, with implied step `t - a`.
 */
type LiteralForvaluesRange =
    | { form: 'slash'; start: NumericLiteral; end: NumericLiteral }
    | {
          form: 'stepped';
          start: NumericLiteral;
          step: NumericLiteral;
          end: NumericLiteral;
      }
    | {
          form: 'to';
          start: NumericLiteral;
          next: NumericLiteral;
          separator: string;
          end: NumericLiteral;
      };

/**
 * Whether `token` is `forvalues` or one of its accepted abbreviations
 * (`forv` through `forvalues`). Exact case: Stata is case-sensitive.
 */
function is_forvalues_command_word(token: Token): boolean {
    return (
        token.type === 'WORD' &&
        token.value.length >= FORVALUES_MIN_ABBREVIATION_LENGTH &&
        'forvalues'.startsWith(token.value)
    );
}

/**
 * Read a numeric literal starting at `the_tokens[index]`. A negative
 * literal is a `-` directly against its number (`-3`); Stata rejects a
 * detached sign (`- 3`), so that is not a literal.
 */
function read_numeric_literal(
    the_tokens: Token[],
    index: number
): { literal: NumericLiteral; next_index: number } | null {
    const my_token = the_tokens[index];
    if (my_token === undefined) {
        return null;
    }
    if (my_token.type === 'NUMBER') {
        if (!NUMERIC_LITERAL_PATTERN.test(my_token.value)) {
            return null;
        }
        return {
            literal: {
                text: my_token.value,
                value: Number(my_token.value),
                first: my_token,
                last: my_token,
            },
            next_index: index + 1,
        };
    }
    const my_number = the_tokens[index + 1];
    if (
        my_token.type === 'OPERATOR' &&
        my_token.value === '-' &&
        my_number !== undefined &&
        my_number.type === 'NUMBER' &&
        is_adjacent(my_token, my_number) &&
        NUMERIC_LITERAL_PATTERN.test(my_number.value)
    ) {
        return {
            literal: {
                text: `-${my_number.value}`,
                value: -Number(my_number.value),
                first: my_token,
                last: my_number,
            },
            next_index: index + 2,
        };
    }
    return null;
}

/**
 * Parse the tokens after `forvalues name =` (up to, not including, the
 * `{`) as a range whose bounds and step are all numeric literals. The
 * whole token list must match one form; anything else (macros,
 * expressions, extra tokens) returns null.
 */
function parse_literal_range(
    the_spec: Token[]
): LiteralForvaluesRange | null {
    const my_start = read_numeric_literal(the_spec, 0);
    if (!my_start) {
        return null;
    }
    const start = my_start.literal;
    let i = my_start.next_index;
    const my_token = the_spec[i];
    if (my_token === undefined) {
        return null;
    }

    if (my_token.type === 'OPERATOR' && my_token.value === '/') {
        const my_end = read_numeric_literal(the_spec, i + 1);
        if (!my_end || my_end.next_index !== the_spec.length) {
            return null;
        }
        return { form: 'slash', start, end: my_end.literal };
    }

    if (my_token.type === 'LPAREN') {
        const my_step = read_numeric_literal(the_spec, i + 1);
        if (!my_step || the_spec[my_step.next_index]?.type !== 'RPAREN') {
            return null;
        }
        const my_end = read_numeric_literal(
            the_spec,
            my_step.next_index + 1
        );
        if (!my_end || my_end.next_index !== the_spec.length) {
            return null;
        }
        return {
            form: 'stepped',
            start,
            step: my_step.literal,
            end: my_end.literal,
        };
    }

    // `a t to b` / `a t : b`: the second number must be a separate word,
    // not glued to the first (`3-1` is not `3 -1`).
    if (is_adjacent(start.last, my_token)) {
        return null;
    }
    const my_next = read_numeric_literal(the_spec, i);
    if (!my_next) {
        return null;
    }
    i = my_next.next_index;
    const my_separator = the_spec[i];
    const is_separator =
        my_separator !== undefined &&
        ((my_separator.type === 'WORD' && my_separator.value === 'to') ||
            my_separator.type === 'COLON');
    if (!is_separator) {
        return null;
    }
    const my_end = read_numeric_literal(the_spec, i + 1);
    if (!my_end || my_end.next_index !== the_spec.length) {
        return null;
    }
    return {
        form: 'to',
        start,
        next: my_next.literal,
        separator: my_separator.value,
        end: my_end.literal,
    };
}

/**
 * Whether stepping from `start` by `step` can never reach `end`, so the
 * loop body runs no times. A zero step is a different problem (Stata
 * errors with "increment may not be zero"), so it is not reported here.
 */
function steps_away(start: number, step: number, end: number): boolean {
    if (step > 0) {
        return start > end;
    }
    if (step < 0) {
        return start < end;
    }
    return false;
}

/**
 * Message for a range that runs no times, or null when it runs.
 */
function empty_range_message(range: LiteralForvaluesRange): string | null {
    switch (range.form) {
        case 'slash': {
            if (!(range.start.value > range.end.value)) {
                return null;
            }
            const my_text = `${range.start.text}/${range.end.text}`;
            const my_countdown =
                `${range.start.text}(-1)${range.end.text}`;
            return (
                `\`forvalues\` range \`${my_text}\` runs no times ` +
                `(\`a/b\` counts up); did you mean \`${my_countdown}\`?`
            );
        }
        case 'stepped': {
            if (
                !steps_away(
                    range.start.value,
                    range.step.value,
                    range.end.value
                )
            ) {
                return null;
            }
            const my_text =
                `${range.start.text}(${range.step.text})${range.end.text}`;
            return (
                `\`forvalues\` range \`${my_text}\` runs no times ` +
                `(step \`${range.step.text}\` counts away from ` +
                `\`${range.end.text}\`)`
            );
        }
        case 'to': {
            const my_step = range.next.value - range.start.value;
            if (!steps_away(range.start.value, my_step, range.end.value)) {
                return null;
            }
            const my_text =
                `${range.start.text} ${range.next.text} ` +
                `${range.separator} ${range.end.text}`;
            return (
                `\`forvalues\` range \`${my_text}\` runs no times ` +
                `(the step from \`${range.start.text}\` to ` +
                `\`${range.next.text}\` counts away from ` +
                `\`${range.end.text}\`)`
            );
        }
    }
}

/**
 * EmptyForvaluesRangeAnalyzer flags a `forvalues` loop whose literal
 * range runs no times, e.g. `forvalues i = 3/1`. Stata's `a/b` always
 * counts up by 1, so with `a > b` the body never runs, and Stata says
 * nothing. That is almost always a countdown written as `a/b` instead
 * of `a(-1)b`.
 *
 * Only ranges whose bounds and step are all numeric literals are
 * checked; a macro or expression anywhere in the range leaves it alone.
 */
export class EmptyForvaluesRangeAnalyzer {
    /**
     * Analyze a document's token stream for empty `forvalues` ranges.
     *
     * @param document - The document state containing tokens and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of empty-range diagnostics
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        const my_config_severity =
            config.diagnostics?.severity?.emptyForvaluesRange ?? 'warning';
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
        const the_diagnostics: Diagnostic[] = [];

        for (let i = 0; i < the_significant.length; i++) {
            const my_token = the_significant[i];
            if (
                !is_forvalues_command_word(my_token) ||
                !is_command_position(the_significant, i)
            ) {
                continue;
            }
            const my_loop_var = the_significant[i + 1];
            const my_equals = the_significant[i + 2];
            if (
                my_loop_var?.type !== 'WORD' ||
                my_equals?.type !== 'OPERATOR' ||
                my_equals.value !== '='
            ) {
                continue;
            }

            // The range runs from after `=` to the opening `{`. A header
            // with no `{` before the statement ends is a different error.
            let my_end_index = i + 3;
            while (
                my_end_index < the_significant.length &&
                the_significant[my_end_index].type !== 'LBRACE' &&
                the_significant[my_end_index].type !==
                    'STATEMENT_TERMINATOR' &&
                the_significant[my_end_index].type !== 'EOF'
            ) {
                my_end_index++;
            }
            if (the_significant[my_end_index]?.type !== 'LBRACE') {
                continue;
            }
            const the_spec = the_significant.slice(i + 3, my_end_index);
            i = my_end_index;

            const my_range_spec = parse_literal_range(the_spec);
            if (!my_range_spec) {
                continue;
            }
            const my_message = empty_range_message(my_range_spec);
            if (my_message === null) {
                continue;
            }
            const my_first = the_spec[0];
            const my_last = the_spec[the_spec.length - 1];
            if (my_first === undefined || my_last === undefined) {
                continue;
            }
            const my_range = Range.create(
                my_first.range.start,
                my_last.range.end
            );
            if (is_diagnostic_range_ignored(my_range, my_ignored_lines)) {
                continue;
            }
            the_diagnostics.push({
                range: my_range,
                message: my_message,
                severity: my_severity,
                source: 'sight',
                code: StataDiagnosticCode.EMPTY_FORVALUES_RANGE,
                ...diagnostic_code_description_fields(
                    StataDiagnosticCode.EMPTY_FORVALUES_RANGE
                ),
            });
        }

        return the_diagnostics;
    }
}
