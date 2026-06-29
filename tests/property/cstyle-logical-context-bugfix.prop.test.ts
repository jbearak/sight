/**
 * Property-based tests for C-style logical context detection
 * bugfix.
 *
 * Verifies that C-style logical operators (`& &`, `| |`) in if
 * qualifiers inside control flow bodies are correctly classified
 * as 'qualifier' context and emit INVALID_OPERATOR_SEQUENCE errors.
 */

import { describe, test, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { OperatorSequenceAnalyzer } from '../../src/providers/operator-sequence-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import {
    arbitrary_identifier,
    arbitrary_non_reserved_identifier,
} from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

describe('C-Style Logical Context Detection Bugfix Property Tests', () => {
    // C-style logical pairs
    const CSTYLE_PAIRS: Array<{
        first: string;
        second: string;
        display: string;
    }> = [
        { first: '&', second: '&', display: '&&' },
        { first: '|', second: '|', display: '||' },
    ];

    // Default config with error severity for invalid
    // operator sequences
    const my_config: StataLSPConfig = {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'warning',
                styleWarnings: 'warning',
                malformedOperator: 'warning',
                invalidOperatorSequence: 'error',
                cStyleLogicalInControlFlow: 'information',
            },
            indentation: false,
        },
        completion: { cacheSize: 100, prefixMaxItems: 50 },
        formatting: {
            indentSize: 4,
            indentStyle: 'spaces',
            lineWidth: 80,
            preferredCommentStyle: '//',
            normalizeCommentStyle: false,
            commentLineWidth: 72,
        },
        indexing: { maxFileSizeBytes: 1000000 },
        adoPaths: [],
        indexWorkspace: false,
        cross_file: {
            index_workspace: false,
            max_indexed_files: 100,
            assume_call_site: 'end',
            max_backward_depth: 10,
            max_forward_depth: 10,
            max_chain_depth: 20,
            diagnostics: {
                missing_file: 'warning',
                max_depth: 'warning',
            },
        },
    };

    /**
     * Generates a control flow wrapper at a given nesting
     * depth. Each level wraps the inner content in a
     * different control flow structure.
     */
    function wrap_in_control_flow(
        inner: string,
        depth: number,
        wrappers: string[]
    ): string {
        let result = inner;
        for (let i = depth - 1; i >= 0; i--) {
            const indent = '    '.repeat(i);
            const inner_indent = '    '.repeat(i + 1);
            const wrapper = wrappers[i];
            // Indent each line of the inner content
            const indented_inner = result
                .split('\n')
                .map((my_line) => inner_indent + my_line)
                .join('\n');
            result =
                `${indent}${wrapper} {\n` +
                `${indented_inner}\n` +
                `${indent}}`;
        }
        return result;
    }

    // Generator for C-style logical pairs
    const arbitrary_cstyle_pair = fc.constantFrom(
        ...CSTYLE_PAIRS
    );

    // Generator for trivia between operators
    const arbitrary_trivia = fc.oneof(
        fc.constant(' '),
        fc.constant('  '),
        fc.constant('\t')
    );

    // Generator for control flow wrapper types
    const arbitrary_wrapper = fc.constantFrom(
        'if (1)',
        'foreach x of local vars',
        'forvalues i = 1/5',
        'while (1)'
    );

    // Generator for nesting depth (1 to 3 levels)
    const arbitrary_depth = fc.integer({ min: 1, max: 3 });

    /**
     * Feature: cstyle-logical-context-detection-bugfix,
     * Property 1: If qualifier context detection emits Error
     * diagnostic
     *
     * For any C-style logical operator (`&&`, `||`) appearing
     * in an if qualifier on a command, regardless of nesting
     * depth within control flow structures, the analyzer should
     * emit exactly one diagnostic with:
     * (a) severity Error
     * (b) code INVALID_OPERATOR_SEQUENCE
     * (c) a message noting that Stata uses single `|` or `&`
     *     for logical operations
     *
     * Validates: Requirements 1.1, 2.1, 3.1
     */
    test('if qualifier context detection emits Error diagnostic', () => {
        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_cstyle_pair,
                arbitrary_trivia,
                arbitrary_depth,
                fc.array(arbitrary_wrapper, {
                    minLength: 3,
                    maxLength: 3,
                }),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (
                    my_pair,
                    my_trivia,
                    my_depth,
                    my_wrappers,
                    my_lhs,
                    my_rhs
                ) => {
                    // Build the inner command with an if
                    // qualifier containing the C-style
                    // logical operator
                    const my_command =
                        `gen ${my_lhs} = 1 if ` +
                        `${my_rhs} == 1 ` +
                        `${my_pair.first}` +
                        `${my_trivia}` +
                        `${my_pair.second} ` +
                        `${my_lhs} == 2`;

                    // Wrap in control flow at the
                    // generated depth
                    const my_source = wrap_in_control_flow(
                        my_command,
                        my_depth,
                        my_wrappers.slice(0, my_depth)
                    );

                    const my_doc_state =
                        create_document_state(my_source);
                    const my_diagnostics =
                        my_analyzer.analyze(
                            my_doc_state,
                            my_config
                        );

                    // Filter to INVALID_OPERATOR_SEQUENCE
                    // diagnostics.
                    const my_error_diags =
                        my_diagnostics.filter(
                            (my_d) =>
                                my_d.code ===
                                StataDiagnosticCode
                                    .INVALID_OPERATOR_SEQUENCE
                        );

                    // (a) Should emit exactly one Error
                    // diagnostic
                    expect(
                        my_error_diags
                    ).toHaveLength(1);

                    const my_diag = my_error_diags[0];

                    // (b) Severity should be Error
                    expect(my_diag.severity).toBe(
                        DiagnosticSeverity.Error
                    );

                    // (c) Code should be INVALID_OPERATOR_SEQUENCE.
                    expect(my_diag.code).toBe(
                        StataDiagnosticCode
                            .INVALID_OPERATOR_SEQUENCE
                    );

                    // (d) Message should note Stata uses
                    // single operators
                    expect(my_diag.message).toContain(
                        `'${my_pair.first} ${my_pair.second}'`
                    );

                    // Should NOT emit a control flow
                    // diagnostic for the qualifier
                    const my_cf_diags =
                        my_diagnostics.filter(
                            (my_d) =>
                                my_d.code ===
                                StataDiagnosticCode
                                    .CSTYLE_LOGICAL_IN_CONTROL_FLOW
                        );
                    // Control flow wrappers with
                    // conditions (if, while) may emit
                    // their own 6003 diagnostics, but
                    // the qualifier operator must NOT
                    // be among them. Verify the 6002
                    // diagnostic line differs from any
                    // 6003 diagnostic lines.
                    for (const my_cf of my_cf_diags) {
                        expect(
                            my_diag.range.start.line
                        ).not.toBe(
                            my_cf.range.start.line
                        );
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: cstyle-logical-context-detection-bugfix,
     * Property 2: Control flow context detection emits
     * Information diagnostic
     *
     * For any C-style logical operator (`&&`, `||`)
     * appearing in the condition of an if/else if control
     * flow statement, regardless of nesting depth, the
     * analyzer should emit exactly one diagnostic with:
     * (a) severity Information (when config is not 'off')
     * (b) code CSTYLE_LOGICAL_IN_CONTROL_FLOW
     * (c) a message suggesting the use of single operators
     *     for consistency
     *
     * Validates: Requirements 1.2, 2.2, 3.2
     */
    test('control flow context detection emits Information diagnostic', () => {
        const my_analyzer = new OperatorSequenceAnalyzer();

        // Generator for control flow type
        const arbitrary_control_flow_type = fc.constantFrom(
            'if',
            'else if'
        ) as fc.Arbitrary<'if' | 'else if'>;

        fc.assert(
            fc.property(
                arbitrary_cstyle_pair,
                arbitrary_trivia,
                arbitrary_control_flow_type,
                arbitrary_depth,
                fc.array(arbitrary_wrapper, {
                    minLength: 3,
                    maxLength: 3,
                }),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (
                    my_pair,
                    my_trivia,
                    my_cf_type,
                    my_depth,
                    my_wrappers,
                    my_lhs,
                    my_rhs
                ) => {
                    // Build the if/else if statement
                    // with C-style logical operator in
                    // condition
                    let my_inner: string;
                    if (my_cf_type === 'if') {
                        my_inner =
                            `if ${my_lhs} == 1 ` +
                            `${my_pair.first}` +
                            `${my_trivia}` +
                            `${my_pair.second} ` +
                            `${my_rhs} == 2 {\n` +
                            `    display "ok"\n` +
                            `}`;
                    } else {
                        // else if needs a preceding if
                        my_inner =
                            `if 1 {\n}\n` +
                            `else if ` +
                            `${my_lhs} == 1 ` +
                            `${my_pair.first}` +
                            `${my_trivia}` +
                            `${my_pair.second} ` +
                            `${my_rhs} == 2 {\n` +
                            `    display "ok"\n` +
                            `}`;
                    }

                    // Wrap in control flow at the
                    // generated depth
                    const my_source =
                        wrap_in_control_flow(
                            my_inner,
                            my_depth,
                            my_wrappers.slice(
                                0,
                                my_depth
                            )
                        );

                    const my_doc_state =
                        create_document_state(
                            my_source
                        );
                    const my_diagnostics =
                        my_analyzer.analyze(
                            my_doc_state,
                            my_config
                        );

                    // Filter to
                    // CSTYLE_LOGICAL_IN_CONTROL_FLOW
                    // diagnostics.
                    const my_cf_diags =
                        my_diagnostics.filter(
                            (my_d) =>
                                my_d.code ===
                                StataDiagnosticCode
                                    .CSTYLE_LOGICAL_IN_CONTROL_FLOW
                        );

                    // There may be additional 6003
                    // diagnostics from outer wrappers
                    // that use `if (1)` or `while (1)`.
                    // We need at least one from our
                    // generated condition.
                    expect(
                        my_cf_diags.length
                    ).toBeGreaterThanOrEqual(1);

                    // Find the diagnostic on the line
                    // containing our generated operator
                    const my_op_str =
                        `${my_pair.first}` +
                        `${my_trivia}` +
                        `${my_pair.second}`;
                    const my_condition_pattern =
                        `${my_lhs} == 1 ` +
                        `${my_op_str} ` +
                        `${my_rhs} == 2`;
                    const my_lines =
                        my_source.split('\n');
                    let my_target_line = -1;
                    for (
                        let i = 0;
                        i < my_lines.length;
                        i++
                    ) {
                        if (
                            my_lines[i].includes(
                                my_condition_pattern
                            )
                        ) {
                            my_target_line = i;
                            break;
                        }
                    }
                    expect(
                        my_target_line
                    ).not.toBe(-1);

                    // Find the diagnostic on that line
                    const my_target_diag =
                        my_cf_diags.find(
                            (my_d) =>
                                my_d.range.start
                                    .line ===
                                my_target_line
                        );
                    expect(
                        my_target_diag
                    ).toBeDefined();

                    // (a) Severity should be
                    // Information
                    expect(
                        my_target_diag!.severity
                    ).toBe(
                        DiagnosticSeverity.Information
                    );

                    // (b) Code should be
                    // CSTYLE_LOGICAL_IN_CONTROL_FLOW
                    expect(
                        my_target_diag!.code
                    ).toBe(
                        StataDiagnosticCode
                            .CSTYLE_LOGICAL_IN_CONTROL_FLOW
                    );

                    // (c) Message should suggest using
                    // single operators
                    expect(
                        my_target_diag!.message
                    ).toContain(
                        `'${my_pair.first}` +
                        `${my_pair.second}'`
                    );

                    // Should NOT emit an Error
                    // for the condition operator
                    const my_error_diags =
                        my_diagnostics.filter(
                            (my_d) =>
                                my_d.code ===
                                StataDiagnosticCode
                                    .INVALID_OPERATOR_SEQUENCE &&
                                my_d.range.start
                                    .line ===
                                    my_target_line
                        );
                    expect(
                        my_error_diags
                    ).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
