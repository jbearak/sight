import { describe, test, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { StataLexer } from '../../src/lexer';
import { OperatorSequenceAnalyzer } from '../../src/providers/operator-sequence-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { arbitrary_identifier } from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

describe('Operator Sequence Diagnostics Property Tests', () => {
    let lexer: StataLexer;

    beforeEach(() => {
        lexer = new StataLexer();
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 1: ~= compound
     * token produces single OPERATOR
     *
     * For any valid Stata expression containing `~=` (no space), the
     * lexer produces a single OPERATOR token with value `~=`.
     *
     * Validates: Requirements Prerequisites, 4.2
     */
    test('~= without space produces a single OPERATOR token with value ~=', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_lhs, my_rhs) => {
                    const my_source = `display ${my_lhs} ~= ${my_rhs}`;
                    const my_result = lexer.tokenize(my_source);

                    const my_non_trivia = my_result.tokens.filter(
                        (my_t) =>
                            my_t.type !== 'WHITESPACE' &&
                            my_t.type !== 'EOF' &&
                            my_t.type !== 'STATEMENT_TERMINATOR'
                    );

                    // Find all OPERATOR tokens with value '~='
                    const my_tilde_eq_tokens = my_non_trivia.filter(
                        (my_t) =>
                            my_t.type === 'OPERATOR' &&
                            my_t.value === '~='
                    );

                    // Should have exactly one ~= token
                    expect(my_tilde_eq_tokens).toHaveLength(1);

                    // The ~= token should be a single token, not two
                    // separate ~ and = tokens
                    const my_all_operators = my_non_trivia.filter(
                        (my_t) => my_t.type === 'OPERATOR'
                    );
                    const my_tilde_only = my_all_operators.filter(
                        (my_t) => my_t.value === '~'
                    );
                    const my_eq_only = my_all_operators.filter(
                        (my_t) => my_t.value === '='
                    );

                    // No standalone ~ or = should exist from the ~=
                    // sequence
                    expect(my_tilde_only).toHaveLength(0);
                    expect(my_eq_only).toHaveLength(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 2: ~ = with
     * space produces two separate OPERATOR tokens
     *
     * For any valid Stata expression containing `~ =` (with space),
     * the lexer produces two separate OPERATOR tokens: `~` and `=`.
     *
     * Validates: Requirements Prerequisites, 4.2
     */
    test('~ = with space produces two separate OPERATOR tokens', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_lhs, my_rhs) => {
                    const my_source = `display ${my_lhs} ~ = ${my_rhs}`;
                    const my_result = lexer.tokenize(my_source);

                    const my_non_trivia = my_result.tokens.filter(
                        (my_t) =>
                            my_t.type !== 'WHITESPACE' &&
                            my_t.type !== 'EOF' &&
                            my_t.type !== 'STATEMENT_TERMINATOR'
                    );

                    // Should NOT have any ~= compound token
                    const my_tilde_eq_tokens = my_non_trivia.filter(
                        (my_t) =>
                            my_t.type === 'OPERATOR' &&
                            my_t.value === '~='
                    );
                    expect(my_tilde_eq_tokens).toHaveLength(0);

                    // Should have separate ~ and = tokens
                    const my_tilde_tokens = my_non_trivia.filter(
                        (my_t) =>
                            my_t.type === 'OPERATOR' &&
                            my_t.value === '~'
                    );
                    const my_eq_tokens = my_non_trivia.filter(
                        (my_t) =>
                            my_t.type === 'OPERATOR' &&
                            my_t.value === '='
                    );

                    expect(my_tilde_tokens).toHaveLength(1);
                    expect(my_eq_tokens).toHaveLength(1);

                    // The ~ token should come before the = token
                    const my_tilde_idx = my_non_trivia.indexOf(
                        my_tilde_tokens[0]
                    );
                    const my_eq_idx = my_non_trivia.indexOf(
                        my_eq_tokens[0]
                    );
                    expect(my_tilde_idx).toBeLessThan(my_eq_idx);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 1: Suggestible pair detection and diagnostics
     *
     * For any suggestible operator pair (`< =`, `> =`, `! =`, `~ =`, `= =`) embedded
     * in valid Stata code as adjacent OPERATOR tokens, the analyzer should emit exactly
     * one diagnostic with:
     * (a) severity Warning
     * (b) code MALFORMED_OPERATOR (6001)
     * (c) a message matching "Malformed operator '<op1> <op2>'. Did you mean '<compound>'?"
     * (d) a range spanning from the start of the first token to the end of the second token
     *
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3, 9.2
     */
    test('suggestible pair detection emits correct diagnostic', () => {
        // Define the suggestible pairs and their expected compound operators
        const SUGGESTIBLE_PAIRS: Array<{ first: string; second: string; compound: string }> = [
            { first: '<', second: '=', compound: '<=' },
            { first: '>', second: '=', compound: '>=' },
            { first: '!', second: '=', compound: '!=' },
            { first: '~', second: '=', compound: '~=' },
            { first: '=', second: '=', compound: '==' },
        ];

        // Generator for suggestible pairs
        const arbitrary_suggestible_pair = fc.constantFrom(...SUGGESTIBLE_PAIRS);

        // Generator for whitespace between operators (at least one space)
        // Note: Continuation-spanning cases (e.g., '< /// comment\n =') are tested
        // separately in Property 5 (task 5.2) since they require special handling
        // of STATEMENT_TERMINATOR tokens after CONTINUATION tokens.
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('   '),
            fc.constant('\t'),
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_suggestible_pair,
                arbitrary_trivia_between,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_trivia, my_lhs, my_rhs) => {
                    // Build source with the suggestible pair
                    // Use a simple expression context: display lhs <op1> <trivia> <op2> rhs
                    const my_source = `display ${my_lhs} ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only MALFORMED_OPERATOR diagnostics (code 6001)
                    const my_suggestible_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR
                    );

                    // (a) Should emit exactly one diagnostic
                    expect(my_suggestible_diagnostics).toHaveLength(1);

                    const my_diag = my_suggestible_diagnostics[0];

                    // (b) Severity should be Warning
                    expect(my_diag.severity).toBe(DiagnosticSeverity.Warning);

                    // (c) Code should be MALFORMED_OPERATOR (6001)
                    expect(my_diag.code).toBe(StataDiagnosticCode.MALFORMED_OPERATOR);
                    expect(my_diag.code).toBe(6001);

                    // (d) Message should match the expected template
                    const my_expected_message = `Malformed operator '${my_pair.first} ${my_pair.second}'. Did you mean '${my_pair.compound}'?`;
                    expect(my_diag.message).toBe(my_expected_message);

                    // (e) Range should span from start of first operator to end of second operator
                    // Find the operator tokens in the document that form the adjacent pair
                    const my_operator_tokens = my_doc_state.tokens.filter(
                        (my_t) => my_t.type === 'OPERATOR'
                    );

                    // Find adjacent operator pairs matching our expected pair
                    // We need to find the actual adjacent pair, not just any operators with matching values
                    let my_first_op_token: typeof my_operator_tokens[0] | undefined;
                    let my_second_op_token: typeof my_operator_tokens[0] | undefined;

                    for (let idx = 0; idx < my_operator_tokens.length - 1; idx++) {
                        const candidate_first = my_operator_tokens[idx];
                        const candidate_second = my_operator_tokens[idx + 1];

                        if (candidate_first.value === my_pair.first &&
                            candidate_second.value === my_pair.second) {
                            // Check that these are actually adjacent in the token stream
                            // (only trivia between them)
                            const first_idx = my_doc_state.tokens.indexOf(candidate_first);
                            const second_idx = my_doc_state.tokens.indexOf(candidate_second);

                            let is_adjacent = true;
                            for (let j = first_idx + 1; j < second_idx; j++) {
                                const between_token = my_doc_state.tokens[j];
                                if (between_token.type !== 'WHITESPACE' &&
                                    between_token.type !== 'CONTINUATION') {
                                    is_adjacent = false;
                                    break;
                                }
                            }

                            if (is_adjacent) {
                                my_first_op_token = candidate_first;
                                my_second_op_token = candidate_second;
                                break;
                            }
                        }
                    }

                    expect(my_first_op_token).toBeDefined();
                    expect(my_second_op_token).toBeDefined();

                    if (my_first_op_token && my_second_op_token) {
                        // Diagnostic range should start at first operator's start
                        expect(my_diag.range.start.line).toBe(my_first_op_token.range.start.line);
                        expect(my_diag.range.start.character).toBe(my_first_op_token.range.start.character);

                        // Diagnostic range should end at second operator's end
                        expect(my_diag.range.end.line).toBe(my_second_op_token.range.end.line);
                        expect(my_diag.range.end.character).toBe(my_second_op_token.range.end.character);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 2: Invalid pair detection and diagnostics
     *
     * For any invalid operator pair (excluding C-style logical `| |` and `& &`) embedded
     * in valid Stata code as adjacent OPERATOR tokens, the analyzer should emit exactly
     * one diagnostic with:
     * (a) severity Error
     * (b) code INVALID_OPERATOR_SEQUENCE (6002)
     * (c) a message containing the specific pair string
     * (d) for `| =`, the message should note that Stata does not support compound assignment operators
     *
     * Note: C-style logical pairs (`| |`, `& &`) are context-dependent and tested
     * separately in Properties 2a and 2b.
     *
     * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 5.2, 5.3, 5.9, 5.12, 9.3
     */
    test('invalid pair detection emits correct diagnostic', () => {
        // Define invalid pairs (excluding C-style logical which are context-dependent)
        // C-style logical pairs (`| |`, `& &`) are tested in Properties 2a and 2b
        const INVALID_PAIRS: Array<{
            first: string;
            second: string;
            special_message?: string;
        }> = [
            // Comparison + logical
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            // Logical + comparison
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            // Logical + assignment (special message)
            { first: '|', second: '=', special_message: "Stata does not support compound assignment operators" },
            // Double logical
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            // Double comparison
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
        ];

        // Generator for invalid pairs
        const arbitrary_invalid_pair = fc.constantFrom(...INVALID_PAIRS);

        // Generator for whitespace between operators (at least one space)
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('   '),
            fc.constant('\t'),
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_invalid_pair,
                arbitrary_trivia_between,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_trivia, my_lhs, my_rhs) => {
                    // Build source with the invalid pair
                    // Use a simple expression context: display lhs <op1> <trivia> <op2> rhs
                    const my_source = `display ${my_lhs} ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only INVALID_OPERATOR_SEQUENCE diagnostics (code 6002)
                    const my_invalid_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // (a) Should emit exactly one diagnostic
                    expect(my_invalid_diagnostics).toHaveLength(1);

                    const my_diag = my_invalid_diagnostics[0];

                    // (b) Severity should be Error
                    expect(my_diag.severity).toBe(DiagnosticSeverity.Error);

                    // (c) Code should be INVALID_OPERATOR_SEQUENCE (6002)
                    expect(my_diag.code).toBe(StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE);
                    expect(my_diag.code).toBe(6002);

                    // (d) Message should contain the specific pair string
                    const my_pair_key = `${my_pair.first} ${my_pair.second}`;
                    expect(my_diag.message).toContain(`'${my_pair_key}'`);

                    // (e) Check for special messages
                    if (my_pair.special_message) {
                        // For |=, check the special message is included
                        expect(my_diag.message).toContain(my_pair.special_message);
                    } else {
                        // For general invalid pairs, check the generic message
                        expect(my_diag.message).toContain('This operator combination is not valid in Stata');
                    }

                    // (f) Range should span from start of first operator to end of second operator
                    const my_operator_tokens = my_doc_state.tokens.filter(
                        (my_t) => my_t.type === 'OPERATOR'
                    );

                    // Find adjacent operator pairs matching our expected pair
                    let my_first_op_token: typeof my_operator_tokens[0] | undefined;
                    let my_second_op_token: typeof my_operator_tokens[0] | undefined;

                    for (let idx = 0; idx < my_operator_tokens.length - 1; idx++) {
                        const candidate_first = my_operator_tokens[idx];
                        const candidate_second = my_operator_tokens[idx + 1];

                        if (candidate_first.value === my_pair.first &&
                            candidate_second.value === my_pair.second) {
                            // Check that these are actually adjacent in the token stream
                            const first_idx = my_doc_state.tokens.indexOf(candidate_first);
                            const second_idx = my_doc_state.tokens.indexOf(candidate_second);

                            let is_adjacent = true;
                            for (let j = first_idx + 1; j < second_idx; j++) {
                                const between_token = my_doc_state.tokens[j];
                                if (between_token.type !== 'WHITESPACE' &&
                                    between_token.type !== 'CONTINUATION') {
                                    is_adjacent = false;
                                    break;
                                }
                            }

                            if (is_adjacent) {
                                my_first_op_token = candidate_first;
                                my_second_op_token = candidate_second;
                                break;
                            }
                        }
                    }

                    expect(my_first_op_token).toBeDefined();
                    expect(my_second_op_token).toBeDefined();

                    if (my_first_op_token && my_second_op_token) {
                        // Diagnostic range should start at first operator's start
                        expect(my_diag.range.start.line).toBe(my_first_op_token.range.start.line);
                        expect(my_diag.range.start.character).toBe(my_first_op_token.range.start.character);

                        // Diagnostic range should end at second operator's end
                        expect(my_diag.range.end.line).toBe(my_second_op_token.range.end.line);
                        expect(my_diag.range.end.character).toBe(my_second_op_token.range.end.character);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 4: No false positives for allowed adjacencies
     *
     * For any pair of adjacent OPERATOR tokens where the combination is in the allowlist
     * (comparison + arithmetic in either order, or negation before comparison), the
     * analyzer should emit zero diagnostics.
     *
     * Validates: Requirements 4.3, 4.4
     */
    test('no false positives for allowed adjacencies', () => {
        // Define allowed adjacency pairs
        const ALLOWED_PAIRS: Array<{ first: string; second: string; description: string }> = [
            // Comparison + arithmetic (comparison first)
            { first: '<', second: '+', description: 'less-than + plus' },
            { first: '<', second: '-', description: 'less-than + minus' },
            { first: '<', second: '*', description: 'less-than + multiply' },
            { first: '<', second: '/', description: 'less-than + divide' },
            { first: '<', second: '^', description: 'less-than + power' },
            { first: '>', second: '+', description: 'greater-than + plus' },
            { first: '>', second: '-', description: 'greater-than + minus' },
            { first: '>', second: '*', description: 'greater-than + multiply' },
            { first: '>', second: '/', description: 'greater-than + divide' },
            { first: '>', second: '^', description: 'greater-than + power' },
            // Arithmetic + comparison (arithmetic first)
            { first: '+', second: '<', description: 'plus + less-than' },
            { first: '+', second: '>', description: 'plus + greater-than' },
            { first: '-', second: '<', description: 'minus + less-than' },
            { first: '-', second: '>', description: 'minus + greater-than' },
            { first: '*', second: '<', description: 'multiply + less-than' },
            { first: '*', second: '>', description: 'multiply + greater-than' },
            { first: '/', second: '<', description: 'divide + less-than' },
            { first: '/', second: '>', description: 'divide + greater-than' },
            { first: '^', second: '<', description: 'power + less-than' },
            { first: '^', second: '>', description: 'power + greater-than' },
            // Negation before comparison
            { first: '!', second: '<', description: 'not + less-than' },
            { first: '!', second: '>', description: 'not + greater-than' },
            { first: '~', second: '<', description: 'tilde-not + less-than' },
            { first: '~', second: '>', description: 'tilde-not + greater-than' },
        ];

        // Generator for allowed pairs
        const arbitrary_allowed_pair = fc.constantFrom(...ALLOWED_PAIRS);

        // Generator for whitespace between operators (at least one space)
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('   '),
            fc.constant('\t'),
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_allowed_pair,
                arbitrary_trivia_between,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_trivia, my_lhs, my_rhs) => {
                    // Build source with the allowed pair
                    // Use a simple expression context: display lhs <op1> <trivia> <op2> rhs
                    const my_source = `display ${my_lhs} ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics for allowed adjacencies
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 8: Config severity override (suggestible)
     *
     * For any suggestible operator pair and any `malformedOperator` config severity value
     * (`'error'`, `'warning'`, `'information'`, `'hint'`), the emitted diagnostic should
     * use the configured severity. When `malformedOperator` is `'off'`, zero suggestible
     * diagnostics should be emitted.
     *
     * Validates: Requirements 8.1, 8.3, 8.5, 8.6
     */
    test('config severity override for suggestible pairs', () => {
        // Define the suggestible pairs
        const SUGGESTIBLE_PAIRS: Array<{ first: string; second: string; compound: string }> = [
            { first: '<', second: '=', compound: '<=' },
            { first: '>', second: '=', compound: '>=' },
            { first: '!', second: '=', compound: '!=' },
            { first: '~', second: '=', compound: '~=' },
            { first: '=', second: '=', compound: '==' },
        ];

        // All possible severity values
        const SEVERITY_VALUES = ['error', 'warning', 'information', 'hint', 'off'] as const;

        // Map config severity to DiagnosticSeverity
        const severity_map: Record<string, DiagnosticSeverity> = {
            'error': DiagnosticSeverity.Error,
            'warning': DiagnosticSeverity.Warning,
            'information': DiagnosticSeverity.Information,
            'hint': DiagnosticSeverity.Hint,
        };

        // Generator for suggestible pairs
        const arbitrary_suggestible_pair = fc.constantFrom(...SUGGESTIBLE_PAIRS);

        // Generator for severity values
        const arbitrary_severity = fc.constantFrom(...SEVERITY_VALUES);

        // Generator for whitespace between operators
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('\t'),
        );

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_suggestible_pair,
                arbitrary_severity,
                arbitrary_trivia_between,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_severity, my_trivia, my_lhs, my_rhs) => {
                    // Build config with the specified severity
                    const my_config: StataLSPConfig = {
                        diagnostics: {
                            enabled: true,
                            severity: {
                                undefinedMacro: 'warning',
                                undefinedVariable: 'warning',
                                styleWarnings: 'warning',
                                malformedOperator: my_severity,
                                invalidOperatorSequence: 'error',
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

                    // Build source with the suggestible pair
                    const my_source = `display ${my_lhs} ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs}`;

                    // Create document state
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only MALFORMED_OPERATOR diagnostics (code 6001)
                    const my_suggestible_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR
                    );

                    if (my_severity === 'off') {
                        // When 'off', zero suggestible diagnostics should be emitted
                        expect(my_suggestible_diagnostics).toHaveLength(0);
                    } else {
                        // Should emit exactly one diagnostic with the configured severity
                        expect(my_suggestible_diagnostics).toHaveLength(1);

                        const my_diag = my_suggestible_diagnostics[0];
                        const expected_severity = severity_map[my_severity];
                        expect(my_diag.severity).toBe(expected_severity);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 2a: C-style logical in if qualifier context
     *
     * For any C-style logical operator pair (`| |`, `& &`) appearing in an if qualifier context
     * (e.g., `gen x = 1 if a == 1 && b == 1`), the analyzer should emit exactly one diagnostic with:
     * (a) severity Error
     * (b) code INVALID_OPERATOR_SEQUENCE (6002)
     * (c) a message noting that Stata uses single `|` or `&` for logical operations
     *
     * Validates: Requirements 2.6, 5.10, 5.11, 9.3
     */
    test('C-style logical in if qualifier context emits error diagnostic', () => {
        // Define C-style logical pairs and their expected messages
        const CSTYLE_LOGICAL_PAIRS: Array<{
            first: string;
            second: string;
            expected_message_part: string;
        }> = [
            { first: '|', second: '|', expected_message_part: "Stata uses '|' for logical OR, not '||'" },
            { first: '&', second: '&', expected_message_part: "Stata uses '&' for logical AND, not '&&'" },
        ];

        // Generator for C-style logical pairs
        const arbitrary_cstyle_pair = fc.constantFrom(...CSTYLE_LOGICAL_PAIRS);

        // Generator for whitespace between operators (at least one space)
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('   '),
            fc.constant('\t'),
        );

        // Generator for Stata commands that support if qualifiers
        const arbitrary_command = fc.constantFrom(
            'gen',
            'generate',
            'replace',
            'list',
            'summarize',
            'sum',
            'count',
            'drop',
            'keep',
            'tabulate',
            'tab',
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_cstyle_pair,
                arbitrary_trivia_between,
                arbitrary_command,
                arbitrary_identifier(),
                arbitrary_identifier(),
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_trivia, my_command, my_var, my_lhs, my_rhs, my_cond_var) => {
                    // Build source with C-style logical pair in if qualifier context
                    // Format: <command> <var> = <lhs> if <cond_var> == 1 <op1> <trivia> <op2> <rhs> == 1
                    // Example: gen x = 1 if a == 1 & & b == 1
                    const my_source = `${my_command} ${my_var} = ${my_lhs} if ${my_cond_var} == 1 ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs} == 1`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only INVALID_OPERATOR_SEQUENCE diagnostics (code 6002)
                    const my_invalid_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // (a) Should emit exactly one diagnostic
                    expect(my_invalid_diagnostics).toHaveLength(1);

                    const my_diag = my_invalid_diagnostics[0];

                    // (b) Severity should be Error
                    expect(my_diag.severity).toBe(DiagnosticSeverity.Error);

                    // (c) Code should be INVALID_OPERATOR_SEQUENCE (6002)
                    expect(my_diag.code).toBe(StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE);
                    expect(my_diag.code).toBe(6002);

                    // (d) Message should contain the pair key and the expected message part
                    const my_pair_key = `${my_pair.first} ${my_pair.second}`;
                    expect(my_diag.message).toContain(`'${my_pair_key}'`);
                    expect(my_diag.message).toContain(my_pair.expected_message_part);

                    // (e) Range should span from start of first operator to end of second operator
                    const my_operator_tokens = my_doc_state.tokens.filter(
                        (my_t) => my_t.type === 'OPERATOR'
                    );

                    // Find adjacent operator pairs matching our expected pair
                    let my_first_op_token: typeof my_operator_tokens[0] | undefined;
                    let my_second_op_token: typeof my_operator_tokens[0] | undefined;

                    for (let idx = 0; idx < my_operator_tokens.length - 1; idx++) {
                        const candidate_first = my_operator_tokens[idx];
                        const candidate_second = my_operator_tokens[idx + 1];

                        if (candidate_first.value === my_pair.first &&
                            candidate_second.value === my_pair.second) {
                            // Check that these are actually adjacent in the token stream
                            const first_idx = my_doc_state.tokens.indexOf(candidate_first);
                            const second_idx = my_doc_state.tokens.indexOf(candidate_second);

                            let is_adjacent = true;
                            for (let j = first_idx + 1; j < second_idx; j++) {
                                const between_token = my_doc_state.tokens[j];
                                if (between_token.type !== 'WHITESPACE' &&
                                    between_token.type !== 'CONTINUATION') {
                                    is_adjacent = false;
                                    break;
                                }
                            }

                            if (is_adjacent) {
                                my_first_op_token = candidate_first;
                                my_second_op_token = candidate_second;
                                break;
                            }
                        }
                    }

                    expect(my_first_op_token).toBeDefined();
                    expect(my_second_op_token).toBeDefined();

                    if (my_first_op_token && my_second_op_token) {
                        // Diagnostic range should start at first operator's start
                        expect(my_diag.range.start.line).toBe(my_first_op_token.range.start.line);
                        expect(my_diag.range.start.character).toBe(my_first_op_token.range.start.character);

                        // Diagnostic range should end at second operator's end
                        expect(my_diag.range.end.line).toBe(my_second_op_token.range.end.line);
                        expect(my_diag.range.end.character).toBe(my_second_op_token.range.end.character);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 9: Config severity override (invalid)
     *
     * For any invalid operator pair (excluding C-style logical) and any `invalidOperatorSequence`
     * config severity value (`'error'`, `'warning'`, `'information'`, `'hint'`), the emitted
     * diagnostic should use the configured severity. When `invalidOperatorSequence` is `'off'`,
     * zero invalid diagnostics should be emitted.
     *
     * Note: C-style logical pairs (`| |`, `& &`) are context-dependent and tested
     * separately in Property 10.
     *
     * Validates: Requirements 8.2, 8.4, 8.5, 8.7
     */
    test('config severity override for invalid pairs', () => {
        // Define invalid pairs (excluding C-style logical which are context-dependent)
        const INVALID_PAIRS: Array<{ first: string; second: string }> = [
            // Comparison + logical
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            // Logical + comparison
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            // Logical + assignment
            { first: '|', second: '=' },
            // Double logical
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            // Double comparison
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
        ];

        // All possible severity values
        const SEVERITY_VALUES = ['error', 'warning', 'information', 'hint', 'off'] as const;

        // Map config severity to DiagnosticSeverity
        const severity_map: Record<string, DiagnosticSeverity> = {
            'error': DiagnosticSeverity.Error,
            'warning': DiagnosticSeverity.Warning,
            'information': DiagnosticSeverity.Information,
            'hint': DiagnosticSeverity.Hint,
        };

        // Generator for invalid pairs
        const arbitrary_invalid_pair = fc.constantFrom(...INVALID_PAIRS);

        // Generator for severity values
        const arbitrary_severity = fc.constantFrom(...SEVERITY_VALUES);

        // Generator for whitespace between operators
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('\t'),
        );

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_invalid_pair,
                arbitrary_severity,
                arbitrary_trivia_between,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_severity, my_trivia, my_lhs, my_rhs) => {
                    // Build config with the specified severity
                    const my_config: StataLSPConfig = {
                        diagnostics: {
                            enabled: true,
                            severity: {
                                undefinedMacro: 'warning',
                                undefinedVariable: 'warning',
                                styleWarnings: 'warning',
                                malformedOperator: 'warning',
                                invalidOperatorSequence: my_severity,
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

                    // Build source with the invalid pair
                    const my_source = `display ${my_lhs} ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs}`;

                    // Create document state
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only INVALID_OPERATOR_SEQUENCE diagnostics (code 6002)
                    const my_invalid_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    if (my_severity === 'off') {
                        // When 'off', zero invalid diagnostics should be emitted
                        expect(my_invalid_diagnostics).toHaveLength(0);
                    } else {
                        // Should emit exactly one diagnostic with the configured severity
                        expect(my_invalid_diagnostics).toHaveLength(1);

                        const my_diag = my_invalid_diagnostics[0];
                        const expected_severity = severity_map[my_severity];
                        expect(my_diag.severity).toBe(expected_severity);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 5: Continuation-spanning detection
     *
     * For any malformed operator pair (excluding C-style logical) where the first operator
     * is on one line and the second is on the next line connected by a `///` continuation,
     * the analyzer should still detect and emit a diagnostic for the pair.
     *
     * Note: C-style logical pairs (`| |`, `& &`) are context-dependent and excluded
     * from this test since their behavior depends on AST context.
     *
     * Validates: Requirements 6.1
     */
    test('continuation-spanning detection emits diagnostic', () => {
        // Define malformed pairs (excluding C-style logical which are context-dependent)
        const MALFORMED_PAIRS: Array<{
            first: string;
            second: string;
            kind: 'suggestible' | 'invalid';
            expected_code: number;
        }> = [
            // Suggestible pairs
            { first: '<', second: '=', kind: 'suggestible', expected_code: 6001 },
            { first: '>', second: '=', kind: 'suggestible', expected_code: 6001 },
            { first: '!', second: '=', kind: 'suggestible', expected_code: 6001 },
            { first: '~', second: '=', kind: 'suggestible', expected_code: 6001 },
            { first: '=', second: '=', kind: 'suggestible', expected_code: 6001 },
            // Invalid pairs (excluding C-style logical)
            { first: '<', second: '|', kind: 'invalid', expected_code: 6002 },
            { first: '<', second: '&', kind: 'invalid', expected_code: 6002 },
            { first: '>', second: '|', kind: 'invalid', expected_code: 6002 },
            { first: '>', second: '&', kind: 'invalid', expected_code: 6002 },
            { first: '|', second: '<', kind: 'invalid', expected_code: 6002 },
            { first: '|', second: '>', kind: 'invalid', expected_code: 6002 },
            { first: '&', second: '<', kind: 'invalid', expected_code: 6002 },
            { first: '&', second: '>', kind: 'invalid', expected_code: 6002 },
            { first: '|', second: '=', kind: 'invalid', expected_code: 6002 },
            { first: '|', second: '&', kind: 'invalid', expected_code: 6002 },
            { first: '&', second: '|', kind: 'invalid', expected_code: 6002 },
            { first: '<', second: '<', kind: 'invalid', expected_code: 6002 },
            { first: '>', second: '>', kind: 'invalid', expected_code: 6002 },
            { first: '<', second: '>', kind: 'invalid', expected_code: 6002 },
            { first: '>', second: '<', kind: 'invalid', expected_code: 6002 },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Generator for optional continuation comment text
        const arbitrary_continuation_comment = fc.oneof(
            fc.constant(''),
            fc.constant(' comment'),
            fc.constant(' some text here'),
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_continuation_comment,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_comment, my_lhs, my_rhs) => {
                    // Build source with the malformed pair spanning a continuation
                    // Format: display lhs <op1> ///<comment>\n<op2> rhs
                    const my_source = `display ${my_lhs} ${my_pair.first} ///${my_comment}\n${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit exactly one diagnostic
                    expect(my_operator_diagnostics).toHaveLength(1);

                    const my_diag = my_operator_diagnostics[0];

                    // Code should match the expected code for this pair type
                    expect(my_diag.code).toBe(my_pair.expected_code);

                    // Message should contain the pair key
                    const my_pair_key = `${my_pair.first} ${my_pair.second}`;
                    expect(my_diag.message).toContain(`'${my_pair_key}'`);

                    // Range should span from first operator (line 0) to second operator (line 1)
                    expect(my_diag.range.start.line).toBe(0);
                    expect(my_diag.range.end.line).toBe(1);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: malformed-operator-diagnostics, Property 6: Statement terminator boundary
     *
     * For any two operators separated by a statement terminator (newline in CR mode
     * or `;` in semicolon mode), the analyzer should emit zero diagnostics, even if
     * the pair would otherwise be malformed.
     *
     * Note: C-style logical pairs (`| |`, `& &`) are context-dependent but are still
     * included here since the statement terminator boundary should prevent detection
     * regardless of context.
     *
     * Validates: Requirements 6.2
     */
    test('statement terminator boundary prevents detection', () => {
        // Define malformed pairs (excluding C-style logical which are context-dependent)
        // Note: We exclude C-style logical pairs here because their behavior depends on
        // AST context, and when separated by statement terminators, the context detection
        // may behave differently.
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            // Suggestible pairs
            { first: '<', second: '=' },
            { first: '>', second: '=' },
            { first: '!', second: '=' },
            { first: '~', second: '=' },
            { first: '=', second: '=' },
            // Invalid pairs (excluding C-style logical)
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            { first: '|', second: '=' },
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Generator for delimiter mode: CR (newline) or semicolon
        const arbitrary_delimiter_mode = fc.constantFrom('cr', 'semicolon') as fc.Arbitrary<'cr' | 'semicolon'>;

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_delimiter_mode,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_delimiter_mode, my_lhs, my_rhs) => {
                    let my_source: string;

                    if (my_delimiter_mode === 'cr') {
                        // CR mode: newline is statement terminator
                        // Format: display lhs <op1>\n<op2> rhs
                        my_source = `display ${my_lhs} ${my_pair.first}\n${my_pair.second} ${my_rhs}`;
                    } else {
                        // Semicolon mode: semicolon is statement terminator
                        // Format: #delimit ;\ndisplay lhs <op1>; <op2> rhs;
                        my_source = `#delimit ;\ndisplay ${my_lhs} ${my_pair.first}; ${my_pair.second} ${my_rhs};`;
                    }

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because the operators are in different statements
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});


/**
 * Feature: malformed-operator-diagnostics, Property 3: Embedded context suppression
 *
 * For any malformed operator pair (suggestible or invalid) placed inside a Mata or
 * Python embedded block, the analyzer (via DiagnosticsProvider filtering) should emit
 * zero diagnostics for that pair.
 *
 * Validates: Requirements 3.1, 3.2
 */
describe('Embedded Context Suppression Property Tests', () => {
    /**
     * Property 3: Embedded context suppression for Mata blocks
     *
     * For any malformed operator pair placed inside a Mata embedded block,
     * the DiagnosticsProvider should emit zero operator sequence diagnostics.
     */
    test('malformed operators in Mata blocks emit zero diagnostics', async () => {
        // Import DiagnosticsProvider for full pipeline testing
        const { DiagnosticsProvider } = await import('../../src/providers/diagnostics');

        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            // Suggestible pairs
            { first: '<', second: '=' },
            { first: '>', second: '=' },
            { first: '!', second: '=' },
            { first: '~', second: '=' },
            { first: '=', second: '=' },
            // Invalid pairs
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            { first: '|', second: '=' },
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        // Create mock connection for DiagnosticsProvider
        const my_mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        const my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

        await fc.assert(
            fc.asyncProperty(
                arbitrary_malformed_pair,
                arbitrary_identifier(),
                async (my_pair, my_var) => {
                    // Build source with the malformed pair inside a Mata block
                    // Format: mata\nreal x = var <op1> <op2> var\nend
                    const my_source = `mata\nreal ${my_var} = ${my_var} ${my_pair.first} ${my_pair.second} ${my_var}\nend`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Get diagnostics through the full DiagnosticsProvider pipeline
                    const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_doc_state,
                        my_config
                    );

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because the operators are in Mata context
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Embedded context suppression for Python blocks
     *
     * For any malformed operator pair placed inside a Python embedded block,
     * the DiagnosticsProvider should emit zero operator sequence diagnostics.
     */
    test('malformed operators in Python blocks emit zero diagnostics', async () => {
        // Import DiagnosticsProvider for full pipeline testing
        const { DiagnosticsProvider } = await import('../../src/providers/diagnostics');

        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            // Suggestible pairs
            { first: '<', second: '=' },
            { first: '>', second: '=' },
            { first: '!', second: '=' },
            { first: '~', second: '=' },
            { first: '=', second: '=' },
            // Invalid pairs
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            { first: '|', second: '=' },
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        // Create mock connection for DiagnosticsProvider
        const my_mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        const my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

        await fc.assert(
            fc.asyncProperty(
                arbitrary_malformed_pair,
                arbitrary_identifier(),
                async (my_pair, my_var) => {
                    // Build source with the malformed pair inside a Python block
                    // Format: python\nx = var <op1> <op2> var\nend
                    const my_source = `python\n${my_var} = ${my_var} ${my_pair.first} ${my_pair.second} ${my_var}\nend`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Get diagnostics through the full DiagnosticsProvider pipeline
                    const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_doc_state,
                        my_config
                    );

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because the operators are in Python context
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Malformed operators outside embedded blocks still emit diagnostics
     *
     * For any malformed operator pair placed outside embedded blocks (in Stata context),
     * the DiagnosticsProvider should still emit diagnostics.
     */
    test('malformed operators outside embedded blocks still emit diagnostics', async () => {
        // Import DiagnosticsProvider for full pipeline testing
        const { DiagnosticsProvider } = await import('../../src/providers/diagnostics');

        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{
            first: string;
            second: string;
            expected_code: number;
        }> = [
            // Suggestible pairs
            { first: '<', second: '=', expected_code: 6001 },
            { first: '>', second: '=', expected_code: 6001 },
            { first: '!', second: '=', expected_code: 6001 },
            { first: '~', second: '=', expected_code: 6001 },
            { first: '=', second: '=', expected_code: 6001 },
            // Invalid pairs
            { first: '<', second: '|', expected_code: 6002 },
            { first: '|', second: '|', expected_code: 6002 },
            { first: '&', second: '&', expected_code: 6002 },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        // Create mock connection for DiagnosticsProvider
        const my_mock_connection = {
            sendDiagnostics: () => {},
        } as any;

        const my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

        await fc.assert(
            fc.asyncProperty(
                arbitrary_malformed_pair,
                arbitrary_identifier(),
                arbitrary_identifier(),
                async (my_pair, my_lhs, my_rhs) => {
                    // Build source with the malformed pair in Stata context (outside embedded blocks)
                    const my_source = `display ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Get diagnostics through the full DiagnosticsProvider pipeline
                    const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
                        my_doc_state,
                        my_config
                    );

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit exactly one diagnostic because the operators are in Stata context
                    expect(my_operator_diagnostics).toHaveLength(1);
                    expect(my_operator_diagnostics[0].code).toBe(my_pair.expected_code);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});


/**
 * Feature: malformed-operator-diagnostics, Property 7: Directive suppression
 *
 * For any malformed operator pair on a line annotated with `@lsp-ignore` (same line)
 * or targeted by `@lsp-ignore-next` (preceding comment line), the analyzer should
 * emit zero diagnostics for that pair.
 *
 * Validates: Requirements 7.1, 7.2
 */
describe('Directive Suppression Property Tests', () => {
    /**
     * Property 7: @lsp-ignore suppresses malformed operator diagnostics on same line
     *
     * For any malformed operator pair on a line with `@lsp-ignore` comment
     * (in any comment style: //, *, or block comments), the analyzer should emit zero
     * operator sequence diagnostics.
     */
    test('@lsp-ignore suppresses malformed operator diagnostics on same line', () => {
        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            // Suggestible pairs
            { first: '<', second: '=' },
            { first: '>', second: '=' },
            { first: '!', second: '=' },
            { first: '~', second: '=' },
            { first: '=', second: '=' },
            // Invalid pairs
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            { first: '|', second: '=' },
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Generator for comment styles for @lsp-ignore (inline comments)
        // Note: * comment style cannot be used inline (must be at start of line)
        // so we test // and /* */ for inline @lsp-ignore
        const arbitrary_inline_comment_style = fc.constantFrom(
            '//',     // Slash-slash comment
            '/* */',  // Block comment
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_inline_comment_style,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_comment_style, my_lhs, my_rhs) => {
                    // Build source with the malformed pair and @lsp-ignore on same line
                    let my_source: string;
                    if (my_comment_style === '/* */') {
                        // Block comment style
                        my_source = `display ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs} /* @lsp-ignore */`;
                    } else {
                        // Slash-slash comment style
                        my_source = `display ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs} // @lsp-ignore`;
                    }

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because the line has @lsp-ignore
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: @lsp-ignore-next suppresses malformed operator diagnostics on next line
     *
     * For any malformed operator pair on a line targeted by `@lsp-ignore-next`
     * in a preceding comment (in any comment style: //, *, or block comments), the analyzer
     * should emit zero operator sequence diagnostics.
     */
    test('@lsp-ignore-next suppresses malformed operator diagnostics on next line', () => {
        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            // Suggestible pairs
            { first: '<', second: '=' },
            { first: '>', second: '=' },
            { first: '!', second: '=' },
            { first: '~', second: '=' },
            { first: '=', second: '=' },
            // Invalid pairs
            { first: '<', second: '|' },
            { first: '<', second: '&' },
            { first: '>', second: '|' },
            { first: '>', second: '&' },
            { first: '|', second: '<' },
            { first: '|', second: '>' },
            { first: '&', second: '<' },
            { first: '&', second: '>' },
            { first: '|', second: '=' },
            { first: '|', second: '&' },
            { first: '&', second: '|' },
            { first: '<', second: '<' },
            { first: '>', second: '>' },
            { first: '<', second: '>' },
            { first: '>', second: '<' },
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Generator for comment styles for @lsp-ignore-next (all three styles)
        const arbitrary_comment_style = fc.constantFrom(
            '//',     // Slash-slash comment
            '*',      // Star comment (at start of line)
            '/* */',  // Block comment
        );

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_comment_style,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_comment_style, my_lhs, my_rhs) => {
                    // Build source with @lsp-ignore-next on previous line
                    let my_source: string;
                    if (my_comment_style === '*') {
                        // Star comment must be at start of line
                        my_source = `* @lsp-ignore-next\ndisplay ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;
                    } else if (my_comment_style === '/* */') {
                        // Block comment style
                        my_source = `/* @lsp-ignore-next */\ndisplay ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;
                    } else {
                        // Slash-slash comment
                        my_source = `// @lsp-ignore-next\ndisplay ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;
                    }

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because the previous line has @lsp-ignore-next
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: @lsp-ignore-next with blank lines still suppresses
     *
     * For any malformed operator pair on a line targeted by `@lsp-ignore-next`
     * with blank lines between the directive and the operator pair, the analyzer
     * should still emit zero operator sequence diagnostics.
     */
    test('@lsp-ignore-next with blank lines still suppresses', () => {
        // Define a subset of malformed pairs for this test
        const MALFORMED_PAIRS: Array<{ first: string; second: string }> = [
            { first: '<', second: '=' },
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Generator for number of blank lines (0-3)
        const arbitrary_blank_lines = fc.integer({ min: 0, max: 3 });

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_blank_lines,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_blank_count, my_lhs, my_rhs) => {
                    // Build source with @lsp-ignore-next followed by blank lines
                    const my_blanks = '\n'.repeat(my_blank_count);
                    const my_source = `// @lsp-ignore-next${my_blanks}\ndisplay ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit zero diagnostics because @lsp-ignore-next targets the next non-trivia token's line
                    expect(my_operator_diagnostics).toHaveLength(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Without suppression directives, diagnostics are emitted
     *
     * For any malformed operator pair without suppression directives,
     * the analyzer should emit diagnostics.
     */
    test('without suppression directives, diagnostics are emitted', () => {
        // Define all malformed pairs (both suggestible and invalid)
        const MALFORMED_PAIRS: Array<{
            first: string;
            second: string;
            expected_code: number;
        }> = [
            // Suggestible pairs
            { first: '<', second: '=', expected_code: 6001 },
            { first: '>', second: '=', expected_code: 6001 },
            { first: '!', second: '=', expected_code: 6001 },
            { first: '~', second: '=', expected_code: 6001 },
            { first: '=', second: '=', expected_code: 6001 },
            // Invalid pairs
            { first: '<', second: '|', expected_code: 6002 },
            { first: '|', second: '|', expected_code: 6002 },
            { first: '&', second: '&', expected_code: 6002 },
        ];

        // Generator for malformed pairs
        const arbitrary_malformed_pair = fc.constantFrom(...MALFORMED_PAIRS);

        // Default config with default severities
        const my_config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_malformed_pair,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_lhs, my_rhs) => {
                    // Build source without any suppression directives
                    const my_source = `display ${my_lhs} ${my_pair.first} ${my_pair.second} ${my_rhs}`;

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only operator sequence diagnostics (codes 6001 and 6002)
                    const my_operator_diagnostics = my_diagnostics.filter(
                        (my_d) =>
                            my_d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                            my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );

                    // Should emit exactly one diagnostic
                    expect(my_operator_diagnostics).toHaveLength(1);
                    expect(my_operator_diagnostics[0].code).toBe(my_pair.expected_code);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('C-Style Logical Control Flow Property Tests', () => {
    /**
     * Feature: malformed-operator-diagnostics, Property 2b: C-style logical in if control flow context
     *
     * For any C-style logical operator pair (`| |`, `& &`) appearing in an if or else if
     * control flow statement condition (e.g., `if a == 1 && b == 1 { ... }`), the analyzer should:
     * (a) NOT emit an error diagnostic
     * (b) when `cStyleLogicalInControlFlow` config is not `'off'`, emit an informational diagnostic
     *     with code CSTYLE_LOGICAL_IN_CONTROL_FLOW (6003) and a message suggesting the use of
     *     single operators for consistency
     *
     * Validates: Requirements 2a.1, 2a.2, 5.13, 5.14, 9.4
     */
    test('C-style logical in if control flow context emits informational diagnostic', () => {
        // Define C-style logical pairs and their expected messages
        const CSTYLE_LOGICAL_PAIRS: Array<{
            first: string;
            second: string;
            expected_message: string;
        }> = [
            {
                first: '|',
                second: '|',
                expected_message: "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style",
            },
            {
                first: '&',
                second: '&',
                expected_message: "C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style",
            },
        ];

        // Generator for C-style logical pairs
        const arbitrary_cstyle_pair = fc.constantFrom(...CSTYLE_LOGICAL_PAIRS);

        // Generator for whitespace between operators (at least one space)
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('   '),
            fc.constant('\t'),
        );

        // Generator for control flow type: 'if' or 'else if'
        const arbitrary_control_flow_type = fc.constantFrom('if', 'else if') as fc.Arbitrary<'if' | 'else if'>;

        // Default config with default severities (cStyleLogicalInControlFlow: 'information')
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

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_cstyle_pair,
                arbitrary_trivia_between,
                arbitrary_control_flow_type,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_trivia, my_control_flow_type, my_lhs, my_rhs) => {
                    // Build source with C-style logical pair in if/else if control flow context
                    // Format: if <lhs> == 1 <op1> <trivia> <op2> <rhs> == 1 { display "test" }
                    // or: if 1 { } else if <lhs> == 1 <op1> <trivia> <op2> <rhs> == 1 { display "test" }
                    let my_source: string;
                    if (my_control_flow_type === 'if') {
                        my_source = `if ${my_lhs} == 1 ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs} == 1 {\n    display "test"\n}`;
                    } else {
                        // else if requires a preceding if block
                        my_source = `if 1 {\n}\nelse if ${my_lhs} == 1 ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs} == 1 {\n    display "test"\n}`;
                    }

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // (a) Should NOT emit an error diagnostic (INVALID_OPERATOR_SEQUENCE)
                    const my_error_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                    );
                    expect(my_error_diagnostics).toHaveLength(0);

                    // (b) Should emit exactly one informational diagnostic (CSTYLE_LOGICAL_IN_CONTROL_FLOW)
                    const my_cstyle_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
                    );
                    expect(my_cstyle_diagnostics).toHaveLength(1);

                    const my_diag = my_cstyle_diagnostics[0];

                    // Severity should be Information (default)
                    expect(my_diag.severity).toBe(DiagnosticSeverity.Information);

                    // Code should be CSTYLE_LOGICAL_IN_CONTROL_FLOW (6003)
                    expect(my_diag.code).toBe(StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW);
                    expect(my_diag.code).toBe(6003);

                    // Message should match the expected message
                    expect(my_diag.message).toBe(my_pair.expected_message);

                    // Range should span from start of first operator to end of second operator
                    const my_operator_tokens = my_doc_state.tokens.filter(
                        (my_t) => my_t.type === 'OPERATOR'
                    );

                    // Find adjacent operator pairs matching our expected pair
                    let my_first_op_token: typeof my_operator_tokens[0] | undefined;
                    let my_second_op_token: typeof my_operator_tokens[0] | undefined;

                    for (let idx = 0; idx < my_operator_tokens.length - 1; idx++) {
                        const candidate_first = my_operator_tokens[idx];
                        const candidate_second = my_operator_tokens[idx + 1];

                        if (candidate_first.value === my_pair.first &&
                            candidate_second.value === my_pair.second) {
                            // Check that these are actually adjacent in the token stream
                            const first_idx = my_doc_state.tokens.indexOf(candidate_first);
                            const second_idx = my_doc_state.tokens.indexOf(candidate_second);

                            let is_adjacent = true;
                            for (let j = first_idx + 1; j < second_idx; j++) {
                                const between_token = my_doc_state.tokens[j];
                                if (between_token.type !== 'WHITESPACE' &&
                                    between_token.type !== 'CONTINUATION') {
                                    is_adjacent = false;
                                    break;
                                }
                            }

                            if (is_adjacent) {
                                my_first_op_token = candidate_first;
                                my_second_op_token = candidate_second;
                                break;
                            }
                        }
                    }

                    expect(my_first_op_token).toBeDefined();
                    expect(my_second_op_token).toBeDefined();

                    if (my_first_op_token && my_second_op_token) {
                        // Diagnostic range should start at first operator's start
                        expect(my_diag.range.start.line).toBe(my_first_op_token.range.start.line);
                        expect(my_diag.range.start.character).toBe(my_first_op_token.range.start.character);

                        // Diagnostic range should end at second operator's end
                        expect(my_diag.range.end.line).toBe(my_second_op_token.range.end.line);
                        expect(my_diag.range.end.character).toBe(my_second_op_token.range.end.character);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });


    /**
     * Feature: malformed-operator-diagnostics, Property 10: Config severity override (C-style in control flow)
     *
     * For any C-style logical operator pair (`| |`, `& &`) in an if/else if control flow context
     * and any `cStyleLogicalInControlFlow` config severity value (`'error'`, `'warning'`,
     * `'information'`, `'hint'`), the emitted diagnostic should use the configured severity.
     * When `cStyleLogicalInControlFlow` is `'off'`, zero diagnostics should be emitted for
     * C-style logical operators in control flow contexts.
     *
     * Validates: Requirements 2a.3, 2a.4, 8.8, 8.9, 8.10
     */
    test('config severity override for C-style logical in control flow', () => {
        // Define C-style logical pairs
        const CSTYLE_LOGICAL_PAIRS: Array<{ first: string; second: string }> = [
            { first: '|', second: '|' },
            { first: '&', second: '&' },
        ];

        // All possible severity values
        const SEVERITY_VALUES = ['error', 'warning', 'information', 'hint', 'off'] as const;

        // Map config severity to DiagnosticSeverity
        const severity_map: Record<string, DiagnosticSeverity> = {
            'error': DiagnosticSeverity.Error,
            'warning': DiagnosticSeverity.Warning,
            'information': DiagnosticSeverity.Information,
            'hint': DiagnosticSeverity.Hint,
        };

        // Generator for C-style logical pairs
        const arbitrary_cstyle_pair = fc.constantFrom(...CSTYLE_LOGICAL_PAIRS);

        // Generator for severity values
        const arbitrary_severity = fc.constantFrom(...SEVERITY_VALUES);

        // Generator for whitespace between operators
        const arbitrary_trivia_between = fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('\t'),
        );

        // Generator for control flow type: 'if' or 'else if'
        const arbitrary_control_flow_type = fc.constantFrom('if', 'else if') as fc.Arbitrary<'if' | 'else if'>;

        const my_analyzer = new OperatorSequenceAnalyzer();

        fc.assert(
            fc.property(
                arbitrary_cstyle_pair,
                arbitrary_severity,
                arbitrary_trivia_between,
                arbitrary_control_flow_type,
                arbitrary_identifier(),
                arbitrary_identifier(),
                (my_pair, my_severity, my_trivia, my_control_flow_type, my_lhs, my_rhs) => {
                    // Build config with the specified cStyleLogicalInControlFlow severity
                    const my_config: StataLSPConfig = {
                        diagnostics: {
                            enabled: true,
                            severity: {
                                undefinedMacro: 'warning',
                                undefinedVariable: 'warning',
                                styleWarnings: 'warning',
                                malformedOperator: 'warning',
                                invalidOperatorSequence: 'error',
                                cStyleLogicalInControlFlow: my_severity,
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

                    // Build source with C-style logical pair in if/else if control flow context
                    // Format: if <lhs> == 1 <op1> <trivia> <op2> <rhs> == 1 { display "test" }
                    // or: if 1 { } else if <lhs> == 1 <op1> <trivia> <op2> <rhs> == 1 { display "test" }
                    let my_source: string;
                    if (my_control_flow_type === 'if') {
                        my_source = `if ${my_lhs} == 1 ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs} == 1 {\n    display "test"\n}`;
                    } else {
                        // else if requires a preceding if block
                        my_source = `if 1 {\n}\nelse if ${my_lhs} == 1 ${my_pair.first}${my_trivia}${my_pair.second} ${my_rhs} == 1 {\n    display "test"\n}`;
                    }

                    // Create document state (tokenizes, parses, analyzes)
                    const my_doc_state = create_document_state(my_source);

                    // Run the operator sequence analyzer
                    const my_diagnostics = my_analyzer.analyze(my_doc_state, my_config);

                    // Filter to only CSTYLE_LOGICAL_IN_CONTROL_FLOW diagnostics (code 6003)
                    const my_cstyle_diagnostics = my_diagnostics.filter(
                        (my_d) => my_d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
                    );

                    if (my_severity === 'off') {
                        // When 'off', zero C-style logical diagnostics should be emitted in control flow
                        expect(my_cstyle_diagnostics).toHaveLength(0);

                        // Also verify no INVALID_OPERATOR_SEQUENCE diagnostic is emitted
                        // (C-style logical in control flow should NOT be treated as invalid)
                        const my_invalid_diagnostics = my_diagnostics.filter(
                            (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                        );
                        expect(my_invalid_diagnostics).toHaveLength(0);
                    } else {
                        // Should emit exactly one diagnostic with the configured severity
                        expect(my_cstyle_diagnostics).toHaveLength(1);

                        const my_diag = my_cstyle_diagnostics[0];

                        // Verify the diagnostic uses the configured severity
                        const expected_severity = severity_map[my_severity];
                        expect(my_diag.severity).toBe(expected_severity);

                        // Verify the diagnostic code is CSTYLE_LOGICAL_IN_CONTROL_FLOW (6003)
                        expect(my_diag.code).toBe(StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW);
                        expect(my_diag.code).toBe(6003);

                        // Also verify no INVALID_OPERATOR_SEQUENCE diagnostic is emitted
                        // (C-style logical in control flow should NOT be treated as invalid)
                        const my_invalid_diagnostics = my_diagnostics.filter(
                            (my_d) => my_d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                        );
                        expect(my_invalid_diagnostics).toHaveLength(0);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
