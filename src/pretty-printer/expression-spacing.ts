/**
 * Expression Spacing Utility
 *
 * Formats expression strings with proper token spacing while preserving
 * content inside string literals and nested macro references.
 *
 * This module is used by the PrettyPrinter (AST formatter) to produce
 * properly spaced output.
 */

/**
 * Regions of the expression that should not have spacing modified.
 * These include string literals, nested macros, and compound strings.
 */
export interface ProtectedRegion {
    start: number;
    end: number;
    type: 'string' | 'nested_macro' | 'compound_string';
}

/**
 * Token categories for spacing decisions.
 */
export type TokenCategory =
    | 'binary_operator'
    | 'unary_operator'
    | 'open_paren'
    | 'close_paren'
    | 'open_bracket'
    | 'close_bracket'
    | 'open_brace'
    | 'close_brace'
    | 'comma'
    | 'colon'
    | 'keyword'
    | 'identifier'
    | 'number'
    | 'string'
    | 'macro_ref'
    | 'other';

/**
 * A token extracted from the expression.
 */
interface ExpressionToken {
    value: string;
    category: TokenCategory;
    start: number;
    end: number;
}

/**
 * Binary operators that need spaces around them.
 */
const BINARY_OPERATORS = new Set([
    '+', '-', '*', '/', '^',
    '==', '!=', '<', '>', '<=', '>=', '~=',
    '&', '|',
    '=',
]);

/**
 * Unary operators that should not have space after them.
 */
const UNARY_OPERATORS = new Set(['!', '~']);

/**
 * Keywords that need spaces around them in expressions.
 */
const EXPRESSION_KEYWORDS = new Set(['of', 'in']);

/**
 * Find all protected regions in an expression.
 * Content within these regions is preserved exactly as-is.
 *
 * Protected content:
 * - Double-quoted strings: "..."
 * - Compound strings: `"..."'
 * - Nested local macros: `x`y'', `x`y`z'''
 * - Global macros with nested content: ${`x'`y'}
 *
 * Simple macro references like `x' are NOT protected.
 */
export function find_protected_regions(expression: string): ProtectedRegion[] {
    const the_regions: ProtectedRegion[] = [];
    let i = 0;

    while (i < expression.length) {
        // Check for compound string: `"..."'
        if (
            expression[i] === '`' &&
            i + 1 < expression.length &&
            expression[i + 1] === '"'
        ) {
            const my_start = i;
            i += 2; // Skip `"
            let my_depth = 1;

            while (i < expression.length && my_depth > 0) {
                if (
                    expression[i] === '`' &&
                    i + 1 < expression.length &&
                    expression[i + 1] === '"'
                ) {
                    my_depth++;
                    i += 2;
                } else if (
                    expression[i] === '"' &&
                    i + 1 < expression.length &&
                    expression[i + 1] === "'"
                ) {
                    my_depth--;
                    i += 2;
                } else {
                    i++;
                }
            }

            the_regions.push({
                start: my_start,
                end: i,
                type: 'compound_string',
            });
            continue;
        }

        // Check for nested local macro: `x`y'' (backtick followed by content
        // with nested backticks)
        if (
            expression[i] === '`' &&
            (i + 1 >= expression.length || expression[i + 1] !== '"')
        ) {
            const my_start = i;
            i++; // Skip opening backtick

            // Count nested backticks to detect nested macros
            let my_backtick_count = 1;
            let my_has_nested = false;

            while (i < expression.length) {
                if (expression[i] === '`') {
                    my_backtick_count++;
                    my_has_nested = true;
                    i++;
                } else if (expression[i] === "'") {
                    my_backtick_count--;
                    i++;
                    if (my_backtick_count === 0) {
                        break;
                    }
                } else {
                    i++;
                }
            }

            // Only protect if it's a nested macro (has inner backticks)
            if (my_has_nested) {
                the_regions.push({
                    start: my_start,
                    end: i,
                    type: 'nested_macro',
                });
            } else {
                // Simple macro - not protected, reset position to after the macro
                // (we already advanced i past the closing quote)
            }
            continue;
        }

        // Check for global macro with nested content: ${...}
        if (
            expression[i] === '$' &&
            i + 1 < expression.length &&
            expression[i + 1] === '{'
        ) {
            const my_start = i;
            i += 2; // Skip ${
            let my_brace_depth = 1;
            let my_has_nested = false;

            while (i < expression.length && my_brace_depth > 0) {
                if (expression[i] === '{') {
                    my_brace_depth++;
                    i++;
                } else if (expression[i] === '}') {
                    my_brace_depth--;
                    i++;
                } else if (expression[i] === '`') {
                    my_has_nested = true;
                    i++;
                } else {
                    i++;
                }
            }

            // Only protect if it has nested macro content
            if (my_has_nested) {
                the_regions.push({
                    start: my_start,
                    end: i,
                    type: 'nested_macro',
                });
            }
            continue;
        }

        // Check for double-quoted string: "..."
        if (expression[i] === '"') {
            const my_start = i;
            i++; // Skip opening quote

            while (i < expression.length && expression[i] !== '"') {
                // Handle escaped quotes or compound strings inside
                if (expression[i] === '\\' && i + 1 < expression.length) {
                    i += 2;
                } else {
                    i++;
                }
            }

            if (i < expression.length) {
                i++; // Skip closing quote
            }

            the_regions.push({
                start: my_start,
                end: i,
                type: 'string',
            });
            continue;
        }

        i++;
    }

    return the_regions;
}

/**
 * Check if a position is within a protected region.
 */
function is_in_protected_region(pos: number, regions: ProtectedRegion[]): boolean {
    for (const my_region of regions) {
        if (pos >= my_region.start && pos < my_region.end) {
            return true;
        }
    }
    return false;
}

/**
 * Determine if a minus sign is unary based on the previous token.
 */
function is_unary_minus(previous: TokenCategory | null): boolean {
    return (
        previous === null ||
        previous === 'binary_operator' ||
        previous === 'unary_operator' ||
        previous === 'open_paren' ||
        previous === 'open_bracket' ||
        previous === 'comma' ||
        previous === 'colon'
    );
}

/**
 * Classify a token string into a category.
 */
function classify_token(
    value: string,
    previous_category: TokenCategory | null
): TokenCategory {
    // Check for operators
    if (BINARY_OPERATORS.has(value)) {
        // Special case: minus could be unary
        if (value === '-' && is_unary_minus(previous_category)) {
            return 'unary_operator';
        }
        return 'binary_operator';
    }

    if (UNARY_OPERATORS.has(value)) {
        return 'unary_operator';
    }

    // Check for delimiters
    if (value === '(') return 'open_paren';
    if (value === ')') return 'close_paren';
    if (value === '[') return 'open_bracket';
    if (value === ']') return 'close_bracket';
    if (value === '{') return 'open_brace';
    if (value === '}') return 'close_brace';
    if (value === ',') return 'comma';
    if (value === ':') return 'colon';

    // Check for keywords (case-sensitive - Stata is case-sensitive)
    if (EXPRESSION_KEYWORDS.has(value)) {
        return 'keyword';
    }

    // Check for numbers
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
        return 'number';
    }

    // Check for macro references (simple ones - nested are protected)
    if (value.startsWith('`') && value.endsWith("'")) {
        return 'macro_ref';
    }
    if (value.startsWith('$')) {
        return 'macro_ref';
    }

    // Default to identifier
    return 'identifier';
}

/**
 * Tokenize an expression string, skipping protected regions.
 */
function tokenize_expression(
    expression: string,
    protected_regions: ProtectedRegion[]
): ExpressionToken[] {
    const the_tokens: ExpressionToken[] = [];
    let i = 0;

    while (i < expression.length) {
        // Skip whitespace
        while (i < expression.length && /\s/.test(expression[i])) {
            i++;
        }

        if (i >= expression.length) break;

        // Check if we're at a protected region
        let my_in_protected = false;
        for (const my_region of protected_regions) {
            if (i === my_region.start) {
                const my_value = expression.slice(my_region.start, my_region.end);

                the_tokens.push({
                    value: my_value,
                    category: my_region.type === 'string' ? 'string' : 'macro_ref',
                    start: my_region.start,
                    end: my_region.end,
                });
                i = my_region.end;
                my_in_protected = true;
                break;
            }
        }

        if (my_in_protected) continue;

        // Check for multi-character operators
        const my_two_char = expression.slice(i, i + 2);
        if (BINARY_OPERATORS.has(my_two_char)) {
            const my_prev_category = the_tokens.length > 0
                ? the_tokens[the_tokens.length - 1].category
                : null;

            the_tokens.push({
                value: my_two_char,
                category: classify_token(my_two_char, my_prev_category),
                start: i,
                end: i + 2,
            });
            i += 2;
            continue;
        }

        // Check for single-character operators and delimiters
        const my_char = expression[i];
        if (
            BINARY_OPERATORS.has(my_char) ||
            UNARY_OPERATORS.has(my_char) ||
            '()[]{},:'.includes(my_char)
        ) {
            const my_prev_category = the_tokens.length > 0
                ? the_tokens[the_tokens.length - 1].category
                : null;

            the_tokens.push({
                value: my_char,
                category: classify_token(my_char, my_prev_category),
                start: i,
                end: i + 1,
            });
            i++;
            continue;
        }

        // Check for simple local macro: `name'
        if (my_char === '`') {
            const my_start = i;
            i++; // Skip opening backtick

            while (i < expression.length && expression[i] !== "'") {
                i++;
            }

            if (i < expression.length) {
                i++; // Skip closing quote
            }

            const my_value = expression.slice(my_start, i);
            the_tokens.push({
                value: my_value,
                category: 'macro_ref',
                start: my_start,
                end: i,
            });
            continue;
        }

        // Check for global macro: $name or ${name}
        if (my_char === '$') {
            const my_start = i;
            i++; // Skip $

            if (i < expression.length && expression[i] === '{') {
                // ${name} form
                i++; // Skip {
                while (i < expression.length && expression[i] !== '}') {
                    i++;
                }
                if (i < expression.length) {
                    i++; // Skip }
                }
            } else {
                // $name form
                while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
                    i++;
                }
            }

            const my_value = expression.slice(my_start, i);
            the_tokens.push({
                value: my_value,
                category: 'macro_ref',
                start: my_start,
                end: i,
            });
            continue;
        }

        // Read identifier or number
        const my_start = i;
        while (
            i < expression.length &&
            /[a-zA-Z0-9_.]/.test(expression[i]) &&
            !is_in_protected_region(i, protected_regions)
        ) {
            i++;
        }

        if (i > my_start) {
            const my_value = expression.slice(my_start, i);
            const my_prev_category = the_tokens.length > 0
                ? the_tokens[the_tokens.length - 1].category
                : null;

            the_tokens.push({
                value: my_value,
                category: classify_token(my_value, my_prev_category),
                start: my_start,
                end: i,
            });
        } else {
            // Unknown character, skip it
            i++;
        }
    }

    return the_tokens;
}

/**
 * Determine if a space should be added before a token.
 */
function needs_space_before(
    current: ExpressionToken,
    previous: ExpressionToken | null
): boolean {
    if (!previous) return false;

    const my_curr = current.category;
    const my_prev = previous.category;

    // Binary operators need space before
    if (my_curr === 'binary_operator') return true;

    // Unary operators need space before (to separate from previous token, e.g., `x + -y`)
    // but NOT after (they attach to their operand)
    if (my_curr === 'unary_operator') return true;

    // No space before closing delimiters
    if (my_curr === 'close_paren') return false;
    if (my_curr === 'close_bracket') return false;
    if (my_curr === 'close_brace') return false;

    // No space before comma
    if (my_curr === 'comma') return false;

    // Space before opening brace
    if (my_curr === 'open_brace') return true;

    // No space after opening delimiters
    if (my_prev === 'open_paren') return false;
    if (my_prev === 'open_bracket') return false;
    if (my_prev === 'open_brace') return false;

    // Space after binary operators
    if (my_prev === 'binary_operator') return true;

    // No space after unary operators
    if (my_prev === 'unary_operator') return false;

    // Space after comma
    if (my_prev === 'comma') return true;

    // Space around keywords
    if (my_curr === 'keyword') return true;
    if (my_prev === 'keyword') return true;

    // Space around colon (in extended macro functions)
    if (my_curr === 'colon') return true;
    if (my_prev === 'colon') return true;

    // No space between identifier and opening paren (function call)
    if (my_curr === 'open_paren' && my_prev === 'identifier') return false;
    if (my_curr === 'open_paren' && my_prev === 'macro_ref') return false;

    // No space before opening bracket (subscript)
    if (my_curr === 'open_bracket') return false;

    // Space between adjacent identifiers/numbers/macros
    const is_curr_value_like =
        my_curr === 'identifier' ||
        my_curr === 'number' ||
        my_curr === 'macro_ref' ||
        my_curr === 'string';
    const is_prev_value_like =
        my_prev === 'identifier' ||
        my_prev === 'number' ||
        my_prev === 'macro_ref' ||
        my_prev === 'string' ||
        my_prev === 'close_paren' ||
        my_prev === 'close_bracket';
    if (is_curr_value_like && is_prev_value_like) {
        return true;
    }

    return false;
}

/**
 * Format an expression string with proper token spacing.
 *
 * @param expression - The raw expression string (may have missing spaces)
 * @returns The expression with proper spacing applied
 */
export function format_expression_spacing(expression: string): string {
    if (!expression || expression.trim() === '') {
        return expression;
    }

    // Find protected regions first
    const my_protected_regions = find_protected_regions(expression);

    // Tokenize the expression
    const my_tokens = tokenize_expression(expression, my_protected_regions);

    if (my_tokens.length === 0) {
        return expression;
    }

    // Build the output with proper spacing
    const the_parts: string[] = [];
    let my_previous: ExpressionToken | null = null;

    for (const my_token of my_tokens) {
        if (needs_space_before(my_token, my_previous)) {
            the_parts.push(' ');
        }

        the_parts.push(my_token.value);
        my_previous = my_token;
    }

    return the_parts.join('');
}
