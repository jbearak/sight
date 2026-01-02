/**
 * Forvalues Parsing Fix Property Tests
 *
 * Tests that verify the parser correctly handles `forvalues` loop syntax,
 * including loop specification parsing and brace placement validation.
 *
 * Feature: forvalues-parsing-fix
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode, ControlFlowNode } from '../../src/types';

/**
 * Helper to parse a document and get parse result
 */
function parse_document(source: string): {
    errors: Array<{ code: ParseErrorCode; message: string }>;
    nodes: Array<ControlFlowNode | { type: string }>;
} {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);
    return {
        errors: parse_result.errors,
        nodes: parse_result.ast.nodes as any,
    };
}

/**
 * Helper to check if a specific error code is present
 */
function has_error_code(errors: Array<{ code: ParseErrorCode }>, code: ParseErrorCode): boolean {
    return errors.some(e => e.code === code);
}

/**
 * Generator for valid Stata variable names.
 * Rules: Must start with letter or underscore, followed by alphanumeric/underscore.
 * Max length 32 characters (Stata limit).
 */
const arbitrary_stata_variable = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.split('')),
    { minLength: 1, maxLength: 31 }
).filter(s => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(s));

/**
 * Generator for valid range specifications (start/end integers).
 * Generates ranges like 1/10, 0/100, -5/5, etc.
 */
const arbitrary_range_spec = fc.tuple(
    fc.integer({ min: -100, max: 100 }),
    fc.integer({ min: -100, max: 100 })
).map(([my_start, my_end]) => `${my_start}/${my_end}`);

/**
 * Generator for simple command names that don't require arguments.
 */
const arbitrary_simple_command = fc.constantFrom(
    'display',
    'sum',
    'list',
    'describe',
    'clear'
);

describe('Forvalues Parsing Fix Property Tests', () => {
    /**
     * Property 1: forvalues Loop Spec Parsing
     * For any valid `forvalues` statement with syntax `forvalues var = start/end {`,
     * the parser SHALL produce a ControlFlowNode with:
     * - `type` equal to `'forvalues'`
     * - `loopVar` containing the variable name
     * - `loopSpec` containing `= start/end`
     * - `body` array (possibly empty)
     *
     * Feature: forvalues-parsing-fix, Property 1: forvalues Loop Spec Parsing
     * **Validates: Requirements 1.1, 1.2**
     */
    describe('Property 1: forvalues Loop Spec Parsing', () => {
        it('should parse forvalues with correct type, loopVar, and loopSpec', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    arbitrary_simple_command,
                    (my_var, my_range, my_cmd) => {
                        // Create a valid forvalues statement
                        const my_document = `forvalues ${my_var} = ${my_range} {\n    ${my_cmd}\n}`;
                        const { nodes } = parse_document(my_document);

                        // Find the forvalues node
                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // Should have a forvalues node
                        if (!my_forvalues_node) {
                            return false;
                        }

                        // Type should be 'forvalues'
                        if (my_forvalues_node.type !== 'forvalues') {
                            return false;
                        }

                        // loopVar should contain the variable name
                        if (my_forvalues_node.loopVar !== my_var) {
                            return false;
                        }

                        // loopSpec should contain the range specification
                        // The parser may include the `=` and may add spaces around `/`
                        if (!my_forvalues_node.loopSpec) {
                            return false;
                        }
                        const my_spec = my_forvalues_node.loopSpec;
                        // Normalize both strings by removing spaces for comparison
                        const my_normalized_spec = my_spec.replace(/\s+/g, '');
                        const my_normalized_range = `=${my_range}`.replace(/\s+/g, '');
                        if (!my_normalized_spec.includes(my_normalized_range.replace('=', ''))) {
                            return false;
                        }

                        // body should be an array
                        if (!Array.isArray(my_forvalues_node.body)) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse forvalues with empty body', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    (my_var, my_range) => {
                        // Create a forvalues statement with empty body
                        const my_document = `forvalues ${my_var} = ${my_range} {\n}`;
                        const { nodes } = parse_document(my_document);

                        // Find the forvalues node
                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // Should have a forvalues node with empty body array
                        return my_forvalues_node !== undefined &&
                               my_forvalues_node.type === 'forvalues' &&
                               my_forvalues_node.loopVar === my_var &&
                               Array.isArray(my_forvalues_node.body);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly capture the loop variable name', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.integer({ min: 1, max: 10 }),
                    fc.integer({ min: 11, max: 20 }),
                    (my_var, my_start, my_end) => {
                        const my_document = `forvalues ${my_var} = ${my_start}/${my_end} {\n    display \`${my_var}'\n}`;
                        const { nodes } = parse_document(my_document);

                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // The loopVar should exactly match the variable name
                        return my_forvalues_node !== undefined &&
                               my_forvalues_node.loopVar === my_var;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: No False Positive Brace Diagnostic
     * For any `forvalues` statement where the opening brace `{` is on the same line
     * as the `forvalues` keyword, the parser SHALL NOT emit a diagnostic with code
     * `OPEN_BRACE_ALONE`.
     *
     * Feature: forvalues-parsing-fix, Property 2: No False Positive Brace Diagnostic
     * **Validates: Requirements 1.3**
     */
    describe('Property 2: No False Positive Brace Diagnostic', () => {
        it('should NOT emit OPEN_BRACE_ALONE for forvalues with brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    arbitrary_simple_command,
                    (my_var, my_range, my_cmd) => {
                        // Create a valid forvalues statement with brace on same line
                        const my_document = `forvalues ${my_var} = ${my_range} {\n    ${my_cmd}\n}`;
                        const { errors } = parse_document(my_document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit OPEN_BRACE_ALONE for forvalues with various range formats', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.integer({ min: 0, max: 50 }),
                    fc.integer({ min: 51, max: 100 }),
                    (my_var, my_start, my_end) => {
                        // Test with explicit integer ranges
                        const my_document = `forvalues ${my_var} = ${my_start}/${my_end} {\n    display \`${my_var}'\n}`;
                        const { errors } = parse_document(my_document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit any brace-related errors for valid forvalues syntax', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    arbitrary_simple_command,
                    (my_var, my_range, my_cmd) => {
                        const my_document = `forvalues ${my_var} = ${my_range} {\n    ${my_cmd}\n}`;
                        const { errors } = parse_document(my_document);

                        // Should NOT have any brace-related errors
                        const has_brace_not_alone = has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                        const has_open_brace_alone = has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                        const has_code_after_brace = has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);

                        return !has_brace_not_alone && !has_open_brace_alone && !has_code_after_brace;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Single-Line Loop Parsing
     * For any single-line `forvalues` loop of the form `forvalues var = range { body }`,
     * the parser SHALL correctly parse both the loop header and the body, producing
     * a ControlFlowNode with non-empty `body` array.
     *
     * Feature: forvalues-parsing-fix, Property 3: Single-Line Loop Parsing
     * **Validates: Requirements 1.4, 3.1**
     */
    describe('Property 3: Single-Line Loop Parsing', () => {
        it('should parse single-line forvalues loop with body', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.integer({ min: 1, max: 10 }),
                    fc.integer({ min: 11, max: 20 }),
                    (my_var, my_start, my_end) => {
                        // Create a single-line forvalues loop
                        const my_document = `forvalues ${my_var} = ${my_start}/${my_end} { display \`${my_var}' }`;
                        const { nodes, errors } = parse_document(my_document);

                        // Find the forvalues node
                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // Should have a forvalues node
                        if (!my_forvalues_node) {
                            return false;
                        }

                        // Should have correct type and loopVar
                        if (my_forvalues_node.type !== 'forvalues') {
                            return false;
                        }
                        if (my_forvalues_node.loopVar !== my_var) {
                            return false;
                        }

                        // Body should be non-empty for single-line loop with command
                        if (!Array.isArray(my_forvalues_node.body) || my_forvalues_node.body.length === 0) {
                            return false;
                        }

                        // Should NOT have OPEN_BRACE_ALONE error
                        if (has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE)) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse single-line forvalues with simple commands', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    (my_var, my_range) => {
                        // Single-line loop with sum command
                        const my_document = `forvalues ${my_var} = ${my_range} { sum }`;
                        const { nodes } = parse_document(my_document);

                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // Should parse as forvalues with body
                        return my_forvalues_node !== undefined &&
                               my_forvalues_node.type === 'forvalues' &&
                               Array.isArray(my_forvalues_node.body) &&
                               my_forvalues_node.body.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly identify loop header vs body in single-line format', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.integer({ min: 1, max: 5 }),
                    fc.integer({ min: 6, max: 10 }),
                    (my_var, my_start, my_end) => {
                        const my_document = `forvalues ${my_var} = ${my_start}/${my_end} { display "test" }`;
                        const { nodes, errors } = parse_document(my_document);

                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        if (!my_forvalues_node) {
                            return false;
                        }

                        // loopVar should be the variable, not part of the body
                        if (my_forvalues_node.loopVar !== my_var) {
                            return false;
                        }

                        // loopSpec should contain the range (parser may add spaces around /)
                        if (!my_forvalues_node.loopSpec) {
                            return false;
                        }
                        const my_normalized_spec = my_forvalues_node.loopSpec.replace(/\s+/g, '');
                        const my_expected_range = `${my_start}/${my_end}`;
                        if (!my_normalized_spec.includes(my_expected_range)) {
                            return false;
                        }

                        // Body should contain the display command
                        if (!Array.isArray(my_forvalues_node.body) || my_forvalues_node.body.length === 0) {
                            return false;
                        }

                        // No false positive OPEN_BRACE_ALONE error
                        // Note: Single-line loops may have CODE_AFTER_OPEN_BRACE and BRACE_NOT_ALONE
                        // warnings, which are expected Stata style warnings
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional Property: Multi-line forvalues with multiple body commands
     * Ensures the parser handles multi-line bodies correctly.
     */
    describe('Additional: Multi-line forvalues body parsing', () => {
        it('should parse forvalues with multiple body commands', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_range_spec,
                    fc.array(arbitrary_simple_command, { minLength: 1, maxLength: 3 }),
                    (my_var, my_range, my_commands) => {
                        // Create multi-line forvalues with multiple commands
                        const my_body = my_commands.map(cmd => `    ${cmd}`).join('\n');
                        const my_document = `forvalues ${my_var} = ${my_range} {\n${my_body}\n}`;
                        const { nodes, errors } = parse_document(my_document);

                        const my_forvalues_node = nodes.find(
                            n => n.type === 'forvalues'
                        ) as ControlFlowNode | undefined;

                        // Should have forvalues node with body
                        if (!my_forvalues_node) {
                            return false;
                        }

                        // Should have correct structure
                        if (my_forvalues_node.type !== 'forvalues') {
                            return false;
                        }
                        if (my_forvalues_node.loopVar !== my_var) {
                            return false;
                        }
                        if (!Array.isArray(my_forvalues_node.body)) {
                            return false;
                        }

                        // No false positive brace errors
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: foreach Regression
     *
     * For any valid `foreach` statement with syntax `foreach var in list {` or
     * `foreach var of varlist {`, the parser SHALL produce a ControlFlowNode with:
     * - `type` equal to `'foreach'`
     * - `loopVar` containing the variable name
     * - `loopSpec` containing the specification starting with `in` or
     *   `of`
     * Feature: forvalues-parsing-fix, Property 4: foreach Regression
     * **Validates: Requirements 2.1, 2.2, 2.3**
     */
    describe('Property 4: foreach Regression', () => {
        /**
         * Generator for list items (simple words for `in` syntax).
         * Generates 1-5 simple alphanumeric words.
         */
        const arbitrary_list_items = fc
            .array(
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,9}$/),
                { minLength: 1, maxLength: 5 }
            )
            .map((my_items) => my_items.join(' '));

        /**
         * Generator for varlist types for `of` syntax.
         * Generates valid varlist specifications like:
         * - `local macroname`
         * - `global macroname`
         * - `varlist varnames`
         * - `newlist varnames`
         */
        const arbitrary_varlist_type = fc.oneof(
            // of local macroname
            arbitrary_stata_variable.map((my_name) => `local ${my_name}`),
            // of global macroname
            arbitrary_stata_variable.map((my_name) => `global ${my_name}`),
            // of varlist varnames
            fc
                .array(arbitrary_stata_variable, { minLength: 1, maxLength: 3 })
                .map((my_vars) => `varlist ${my_vars.join(' ')}`),
            // of newlist varnames
            fc
                .array(arbitrary_stata_variable, { minLength: 1, maxLength: 3 })
                .map((my_vars) => `newlist ${my_vars.join(' ')}`)
        );

        /**
         * Property 4a: foreach with `in` syntax
         *
         * For any valid `foreach var in list {` statement, the parser should
         * produce a ControlFlowNode with type 'foreach', correct loopVar, and
         * loopSpec starting with 'in'.
         */
        it('should correctly parse foreach with in syntax', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_list_items,
                    (my_loop_var, my_list_items) => {
                        const my_document = `foreach ${my_loop_var} in ${my_list_items} {\n    display "\`${my_loop_var}'"\n}`;

                        const { nodes } = parse_document(my_document);
                        const my_node = nodes.find(n => n.type === 'foreach') as ControlFlowNode | undefined;

                        // Should produce a ControlFlowNode
                        if (!my_node) return false;

                        // Type should be 'foreach'
                        if (my_node.type !== 'foreach') return false;

                        // loopVar should contain the variable name
                        if (my_node.loopVar !== my_loop_var) return false;

                        // loopSpec should start with 'in'
                        if (!my_node.loopSpec || !my_node.loopSpec.startsWith('in')) return false;

                        // loopSpec should contain the list items
                        if (!my_node.loopSpec.includes(my_list_items)) return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4b: foreach with `of` syntax
         *
         * For any valid `foreach var of varlist {` statement, the parser should
         * produce a ControlFlowNode with type 'foreach', correct loopVar, and
         * loopSpec starting with 'of'.
         */
        it('should correctly parse foreach with of syntax', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_varlist_type,
                    (my_loop_var, my_varlist_spec) => {
                        const my_document = `foreach ${my_loop_var} of ${my_varlist_spec} {\n    display "\`${my_loop_var}'"\n}`;

                        const { nodes } = parse_document(my_document);
                        const my_node = nodes.find(n => n.type === 'foreach') as ControlFlowNode | undefined;

                        // Should produce a ControlFlowNode
                        if (!my_node) return false;

                        // Type should be 'foreach'
                        if (my_node.type !== 'foreach') return false;

                        // loopVar should contain the variable name
                        if (my_node.loopVar !== my_loop_var) return false;

                        // loopSpec should start with 'of'
                        if (!my_node.loopSpec || !my_node.loopSpec.startsWith('of')) return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4c: foreach body is correctly parsed
         *
         * For any valid foreach statement, the body should be correctly parsed
         * and contain the expected commands.
         */
        it('should correctly parse foreach body', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    arbitrary_list_items,
                    fc.array(arbitrary_simple_command, { minLength: 1, maxLength: 3 }),
                    (my_loop_var, my_list_items, my_commands) => {
                        const my_body = my_commands.map((my_cmd) => `    ${my_cmd} x`).join('\n');
                        const my_document = `foreach ${my_loop_var} in ${my_list_items} {\n${my_body}\n}`;

                        const { nodes } = parse_document(my_document);
                        const my_node = nodes.find(n => n.type === 'foreach') as ControlFlowNode | undefined;

                        // Should produce a ControlFlowNode
                        if (!my_node) return false;

                        // Type should be 'foreach'
                        if (my_node.type !== 'foreach') return false;

                        // Body should exist and have nodes
                        if (!my_node.body || my_node.body.length === 0) return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4d: foreach with numeric list items
         *
         * For any valid foreach statement with numeric list items,
         * the parser should correctly parse the statement.
         */
        it('should correctly parse foreach with numeric list items', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 5 }),
                    (my_loop_var, my_numbers) => {
                        const my_list = my_numbers.join(' ');
                        const my_document = `foreach ${my_loop_var} in ${my_list} {\n    display \`${my_loop_var}'\n}`;

                        const { nodes } = parse_document(my_document);
                        const my_node = nodes.find(n => n.type === 'foreach') as ControlFlowNode | undefined;

                        // Should produce a ControlFlowNode
                        if (!my_node) return false;

                        // Type should be 'foreach'
                        if (my_node.type !== 'foreach') return false;

                        // loopVar should contain the variable name
                        if (my_node.loopVar !== my_loop_var) return false;

                        // loopSpec should start with 'in'
                        if (!my_node.loopSpec || !my_node.loopSpec.startsWith('in')) return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4e: foreach with mixed alphanumeric list items
         *
         * For any valid foreach statement with mixed alphanumeric list items,
         * the parser should correctly parse the statement.
         */
        it('should correctly parse foreach with mixed alphanumeric list items', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.array(
                        fc.oneof(
                            fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,9}$/),
                            fc.integer({ min: 0, max: 100 }).map((n) => n.toString())
                        ),
                        { minLength: 1, maxLength: 5 }
                    ),
                    (my_loop_var, my_items) => {
                        const my_list = my_items.join(' ');
                        const my_document = `foreach ${my_loop_var} in ${my_list} {\n    display \`${my_loop_var}'\n}`;

                        const { nodes } = parse_document(my_document);
                        const my_node = nodes.find(n => n.type === 'foreach') as ControlFlowNode | undefined;

                        // Should produce a ControlFlowNode
                        if (!my_node) return false;

                        // Type should be 'foreach'
                        if (my_node.type !== 'foreach') return false;

                        // loopVar should contain the variable name
                        if (my_node.loopVar !== my_loop_var) return false;

                        // loopSpec should start with 'in'
                        if (!my_node.loopSpec || !my_node.loopSpec.startsWith('in')) return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4f: foreach does not produce forvalues node
         *
         * For any valid foreach statement, the parser should never produce
         * a forvalues node - this ensures no confusion between the two loop types.
         */
        it('should never produce forvalues node for foreach syntax', () => {
            fc.assert(
                fc.property(
                    arbitrary_stata_variable,
                    fc.oneof(
                        arbitrary_list_items.map((my_items) => `in ${my_items}`),
                        arbitrary_varlist_type.map((my_spec) => `of ${my_spec}`)
                    ),
                    (my_loop_var, my_spec) => {
                        const my_document = `foreach ${my_loop_var} ${my_spec} {\n    display x\n}`;

                        const { nodes } = parse_document(my_document);

                        // Find all control flow nodes
                        const my_control_flow_nodes = nodes.filter(
                            (my_node) =>
                                my_node.type === 'foreach' || my_node.type === 'forvalues'
                        ) as ControlFlowNode[];

                        // Should have exactly one control flow node
                        if (my_control_flow_nodes.length !== 1) return false;

                        // It should be a foreach, not forvalues
                        if (my_control_flow_nodes[0].type !== 'foreach') return false;

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
