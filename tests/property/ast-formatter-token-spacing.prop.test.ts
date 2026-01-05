/**
 * Property Tests: AST Formatter Token Spacing
 *
 * Feature: ast-formatter-token-spacing
 *
 * Tests the expression spacing utility that formats expression strings
 * with proper token spacing while preserving content inside string literals
 * and nested macro references.
 */

import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import {
    format_expression_spacing,
    find_protected_regions,
    ProtectedRegion,
} from '../../src/pretty-printer/expression-spacing';

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate valid Stata identifiers.
 */
const identifier_arb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'),
    { minLength: 1, maxLength: 10 }
).filter(s => /^[a-zA-Z_]/.test(s));

/**
 * Generate simple numbers.
 */
const number_arb = fc.oneof(
    fc.integer({ min: 0, max: 1000 }).map(n => n.toString()),
    fc.float({ min: 0, max: 100, noNaN: true }).map(n => n.toFixed(2))
);

/**
 * Generate binary operators.
 */
const binary_operator_arb = fc.constantFrom(
    '+', '-', '*', '/', '^',
    '==', '!=', '<', '>', '<=', '>=',
    '&', '|', '='
);

/**
 * Generate unary operators.
 */
const unary_operator_arb = fc.constantFrom('!', '~');

/**
 * Generate simple local macro references.
 */
const simple_macro_arb = identifier_arb.map(name => `\`${name}'`);

/**
 * Generate simple global macro references.
 */
const global_macro_arb = identifier_arb.map(name => `$${name}`);

/**
 * Generate string literals (protected content).
 */
const string_literal_arb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 +-*/=<>'),
    { minLength: 0, maxLength: 20 }
).map(s => `"${s}"`);

/**
 * Generate compound strings (protected content).
 */
const compound_string_arb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 +-*/=<>'),
    { minLength: 0, maxLength: 20 }
).map(s => `\`"${s}"'`);

/**
 * Generate nested macro references (protected content).
 */
const nested_macro_arb = fc.tuple(identifier_arb, identifier_arb).map(
    ([outer, inner]) => `\`${outer}\`${inner}''`
);

/**
 * Generate simple binary expressions.
 */
const simple_binary_expr_arb = fc.tuple(
    fc.oneof(identifier_arb, number_arb, simple_macro_arb),
    binary_operator_arb,
    fc.oneof(identifier_arb, number_arb, simple_macro_arb)
).map(([left, op, right]) => `${left}${op}${right}`);

/**
 * Generate expressions with unary operators.
 */
const unary_expr_arb = fc.tuple(
    unary_operator_arb,
    fc.oneof(identifier_arb, number_arb)
).map(([op, operand]) => `${op}${operand}`);

/**
 * Generate function call expressions.
 */
const function_call_arb = fc.tuple(
    identifier_arb,
    fc.array(fc.oneof(identifier_arb, number_arb), { minLength: 1, maxLength: 3 })
).map(([name, args]) => `${name}(${args.join(',')})`);

/**
 * Generate subscript expressions.
 */
const subscript_arb = fc.tuple(
    identifier_arb,
    fc.oneof(identifier_arb, number_arb)
).map(([name, index]) => `${name}[${index}]`);

/**
 * Generate expressions with parentheses.
 */
const paren_expr_arb = fc.tuple(
    fc.oneof(identifier_arb, number_arb),
    binary_operator_arb,
    fc.oneof(identifier_arb, number_arb)
).map(([left, op, right]) => `(${left}${op}${right})`);

// ============================================================================
// Property 0: Protected Content Preservation
// ============================================================================

describe('Property 0: Protected Content Preservation', () => {
    it('should preserve string literal content unchanged', () => {
        fc.assert(
            fc.property(string_literal_arb, (str) => {
                const my_result = format_expression_spacing(str);
                // The string content should be preserved exactly
                expect(my_result).toBe(str);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should preserve compound string content unchanged', () => {
        fc.assert(
            fc.property(compound_string_arb, (str) => {
                const my_result = format_expression_spacing(str);
                // The compound string content should be preserved exactly
                expect(my_result).toBe(str);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should preserve nested macro reference content unchanged', () => {
        fc.assert(
            fc.property(nested_macro_arb, (macro) => {
                const my_result = format_expression_spacing(macro);
                // The nested macro content should be preserved exactly
                expect(my_result).toBe(macro);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should preserve string literals in expressions', () => {
        fc.assert(
            fc.property(
                fc.tuple(identifier_arb, string_literal_arb),
                ([id, str]) => {
                    const my_input = `${id}+${str}`;
                    const my_result = format_expression_spacing(my_input);
                    // The string should appear unchanged in the result
                    expect(my_result).toContain(str);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should preserve compound strings in expressions', () => {
        fc.assert(
            fc.property(
                fc.tuple(identifier_arb, compound_string_arb),
                ([id, str]) => {
                    const my_input = `${id}+${str}`;
                    const my_result = format_expression_spacing(my_input);
                    // The compound string should appear unchanged in the result
                    expect(my_result).toContain(str);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Property 1: Binary Operator Spacing
// ============================================================================

describe('Property 1: Binary Operator Spacing', () => {
    it('should add spaces around arithmetic operators', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.oneof(identifier_arb, number_arb),
                    fc.constantFrom('+', '-', '*', '/', '^'),
                    fc.oneof(identifier_arb, number_arb)
                ),
                ([left, op, right]) => {
                    const my_input = `${left}${op}${right}`;
                    const my_result = format_expression_spacing(my_input);
                    // Should have space before and after operator
                    expect(my_result).toContain(` ${op} `);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should add spaces around comparison operators', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.oneof(identifier_arb, number_arb),
                    fc.constantFrom('==', '!=', '<', '>', '<=', '>='),
                    fc.oneof(identifier_arb, number_arb)
                ),
                ([left, op, right]) => {
                    const my_input = `${left}${op}${right}`;
                    const my_result = format_expression_spacing(my_input);
                    // Should have space before and after operator
                    expect(my_result).toContain(` ${op} `);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should add spaces around logical operators', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.oneof(identifier_arb, number_arb),
                    fc.constantFrom('&', '|'),
                    fc.oneof(identifier_arb, number_arb)
                ),
                ([left, op, right]) => {
                    const my_input = `${left}${op}${right}`;
                    const my_result = format_expression_spacing(my_input);
                    // Should have space before and after operator
                    expect(my_result).toContain(` ${op} `);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should add spaces around assignment operator', () => {
        fc.assert(
            fc.property(
                fc.tuple(identifier_arb, fc.oneof(identifier_arb, number_arb)),
                ([left, right]) => {
                    const my_input = `${left}=${right}`;
                    const my_result = format_expression_spacing(my_input);
                    // Should have space before and after =
                    expect(my_result).toContain(' = ');
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Property 2: Parenthesis Internal Spacing
// ============================================================================

describe('Property 2: Parenthesis Internal Spacing', () => {
    it('should not add space after opening parenthesis', () => {
        fc.assert(
            fc.property(paren_expr_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space after (
                expect(my_result).not.toMatch(/\(\s+/);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space before closing parenthesis', () => {
        fc.assert(
            fc.property(paren_expr_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space before )
                expect(my_result).not.toMatch(/\s+\)/);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space between function name and opening parenthesis', () => {
        fc.assert(
            fc.property(function_call_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space before (
                expect(my_result).not.toMatch(/[a-zA-Z_]\s+\(/);
                return true;
            }),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Property 3: Comma Spacing
// ============================================================================

describe('Property 3: Comma Spacing', () => {
    it('should add space after comma', () => {
        fc.assert(
            fc.property(function_call_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Every comma should be followed by a space (unless at end)
                const my_commas = my_result.match(/,/g) || [];
                for (let i = 0; i < my_result.length; i++) {
                    if (my_result[i] === ',' && i + 1 < my_result.length && my_result[i + 1] !== ')') {
                        expect(my_result[i + 1]).toBe(' ');
                    }
                }
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space before comma', () => {
        fc.assert(
            fc.property(function_call_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space before comma
                expect(my_result).not.toMatch(/\s+,/);
                return true;
            }),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Property 4: Keyword Spacing
// ============================================================================

describe('Property 4: Keyword Spacing', () => {
    it('should add spaces around "of" keyword', () => {
        const my_input = 'list posof "x" of mylist';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toContain(' of ');
    });

    it('should add spaces around "in" keyword in list context', () => {
        const my_input = 'x in mylist';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toContain(' in ');
    });
});

// ============================================================================
// Property 5: Bracket Spacing
// ============================================================================

describe('Property 5: Bracket Spacing', () => {
    it('should not add space before opening bracket', () => {
        fc.assert(
            fc.property(subscript_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space before [
                expect(my_result).not.toMatch(/\s+\[/);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space after opening bracket', () => {
        fc.assert(
            fc.property(subscript_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space after [
                expect(my_result).not.toMatch(/\[\s+/);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space before closing bracket', () => {
        fc.assert(
            fc.property(subscript_arb, (expr) => {
                const my_result = format_expression_spacing(expr);
                // Should not have space before ]
                expect(my_result).not.toMatch(/\s+\]/);
                return true;
            }),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Property 6: Colon Spacing
// ============================================================================

describe('Property 6: Colon Spacing', () => {
    it('should add spaces around colon in extended macro functions', () => {
        const my_input = 'x:list';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toContain(' : ');
    });
});

// ============================================================================
// Property 7: Curly Brace Spacing
// ============================================================================

describe('Property 7: Curly Brace Spacing', () => {
    it('should add space before opening brace', () => {
        const my_input = 'if(x){';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toContain(' {');
    });

    it('should not add space after opening brace', () => {
        const my_input = '{ x }';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).not.toMatch(/\{\s+/);
    });

    it('should not add space before closing brace', () => {
        const my_input = '{ x }';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).not.toMatch(/\s+\}/);
    });
});

// ============================================================================
// Property 8: Unary Operator Spacing
// ============================================================================

describe('Property 8: Unary Operator Spacing', () => {
    it('should not add space between unary minus and operand at expression start', () => {
        fc.assert(
            fc.property(fc.oneof(identifier_arb, number_arb), (operand) => {
                const my_input = `-${operand}`;
                const my_result = format_expression_spacing(my_input);
                // Should not have space after -
                expect(my_result).toBe(`-${operand}`);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space between logical not and operand', () => {
        fc.assert(
            fc.property(identifier_arb, (operand) => {
                const my_input = `!${operand}`;
                const my_result = format_expression_spacing(my_input);
                // Should not have space after !
                expect(my_result).toBe(`!${operand}`);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should not add space between tilde negation and operand', () => {
        fc.assert(
            fc.property(identifier_arb, (operand) => {
                const my_input = `~${operand}`;
                const my_result = format_expression_spacing(my_input);
                // Should not have space after ~
                expect(my_result).toBe(`~${operand}`);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should handle unary minus after binary operator', () => {
        fc.assert(
            fc.property(
                fc.tuple(identifier_arb, fc.oneof(identifier_arb, number_arb)),
                ([left, right]) => {
                    const my_input = `${left}+-${right}`;
                    const my_result = format_expression_spacing(my_input);
                    // Should have space around + but not after unary -
                    expect(my_result).toBe(`${left} + -${right}`);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Idempotency Property
// ============================================================================

describe('Idempotency Property', () => {
    it('format(format(x)) == format(x) for simple expressions', () => {
        fc.assert(
            fc.property(simple_binary_expr_arb, (expr) => {
                const my_once = format_expression_spacing(expr);
                const my_twice = format_expression_spacing(my_once);
                expect(my_twice).toBe(my_once);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('format(format(x)) == format(x) for function calls', () => {
        fc.assert(
            fc.property(function_call_arb, (expr) => {
                const my_once = format_expression_spacing(expr);
                const my_twice = format_expression_spacing(my_once);
                expect(my_twice).toBe(my_once);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('format(format(x)) == format(x) for subscripts', () => {
        fc.assert(
            fc.property(subscript_arb, (expr) => {
                const my_once = format_expression_spacing(expr);
                const my_twice = format_expression_spacing(my_once);
                expect(my_twice).toBe(my_once);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('format(format(x)) == format(x) for unary expressions', () => {
        fc.assert(
            fc.property(unary_expr_arb, (expr) => {
                const my_once = format_expression_spacing(expr);
                const my_twice = format_expression_spacing(my_once);
                expect(my_twice).toBe(my_once);
                return true;
            }),
            { numRuns: 100 }
        );
    });
});

// ============================================================================
// Protected Region Detection Tests
// ============================================================================

describe('Protected Region Detection', () => {
    it('should detect double-quoted strings', () => {
        const my_regions = find_protected_regions('"hello world"');
        expect(my_regions.length).toBe(1);
        expect(my_regions[0].type).toBe('string');
    });

    it('should detect compound strings', () => {
        const my_regions = find_protected_regions('`"hello world"\'');
        expect(my_regions.length).toBe(1);
        expect(my_regions[0].type).toBe('compound_string');
    });

    it('should detect nested macros', () => {
        const my_regions = find_protected_regions('`x`y\'\'');
        expect(my_regions.length).toBe(1);
        expect(my_regions[0].type).toBe('nested_macro');
    });

    it('should not protect simple macros', () => {
        const my_regions = find_protected_regions('`x\'');
        expect(my_regions.length).toBe(0);
    });

    it('should detect multiple protected regions', () => {
        const my_regions = find_protected_regions('"a" + `"b"\' + `x`y\'\'');
        expect(my_regions.length).toBe(3);
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
    it('should handle empty string', () => {
        expect(format_expression_spacing('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
        expect(format_expression_spacing('   ')).toBe('   ');
    });

    it('should handle single identifier', () => {
        expect(format_expression_spacing('x')).toBe('x');
    });

    it('should handle single number', () => {
        expect(format_expression_spacing('42')).toBe('42');
    });

    it('should handle already properly spaced expression', () => {
        const my_input = 'x + y';
        expect(format_expression_spacing(my_input)).toBe('x + y');
    });

    it('should handle complex nested expression', () => {
        const my_input = '(a+b)*(c-d)';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toBe('(a + b) * (c - d)');
    });

    it('should handle macro references with operators', () => {
        const my_input = '`x\'+`y\'';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toBe('`x\' + `y\'');
    });

    it('should handle global macros with operators', () => {
        const my_input = '$x+$y';
        const my_result = format_expression_spacing(my_input);
        expect(my_result).toBe('$x + $y');
    });
});
