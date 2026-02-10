/**
 * Unit tests for OperatorSequenceAnalyzer
 * 
 * Tests exact message strings, diagnostic codes, default severity values,
 * and edge cases for malformed operator detection.
 * 
 * Requirements covered:
 * - 4.2: Compound operators without spaces produce single tokens
 * - 5.4-5.8: Exact message strings for suggestible pairs
 * - 5.9: Exact message strings for general invalid pairs
 * - 5.10-5.11: Exact message strings for C-style logical pairs
 * - 5.12: Exact message string for | =
 * - 8.6-8.7: Default severity values in DEFAULT_SETTINGS
 * - 9.1-9.3: Diagnostic codes
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { StataLexer } from '../../src/lexer';
import { OperatorSequenceAnalyzer } from '../../src/providers/operator-sequence-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('OperatorSequenceAnalyzer Unit Tests', () => {
    let lexer: StataLexer;
    let analyzer: OperatorSequenceAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        lexer = new StataLexer();
        analyzer = new OperatorSequenceAnalyzer();
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                    malformedOperator: 'warning',
                    invalidOperatorSequence: 'error',
                },
            },
        };
    });

    describe('Diagnostic Codes (Requirements 9.1-9.3)', () => {
        it('MALFORMED_OPERATOR should equal 6001', () => {
            expect(StataDiagnosticCode.MALFORMED_OPERATOR).toBe(6001);
        });

        it('INVALID_OPERATOR_SEQUENCE should equal 6002', () => {
            expect(StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE).toBe(6002);
        });
    });

    describe('Default Severity Values (Requirements 8.6, 8.7)', () => {
        it('DEFAULT_SETTINGS.diagnostics.severity.malformedOperator should be "warning"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.malformedOperator).toBe('warning');
        });

        it('DEFAULT_SETTINGS.diagnostics.severity.invalidOperatorSequence should be "error"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.invalidOperatorSequence).toBe('error');
        });
    });

    describe('Compound Operators Without Spaces (Requirement 4.2)', () => {
        it('<= produces a single OPERATOR token', () => {
            const result = lexer.tokenize('display x <= y');
            const operators = result.tokens.filter(t => t.type === 'OPERATOR');
            const le_tokens = operators.filter(t => t.value === '<=');
            expect(le_tokens).toHaveLength(1);
            // No separate < or = tokens from the <= sequence
            const lt_tokens = operators.filter(t => t.value === '<');
            const eq_tokens = operators.filter(t => t.value === '=');
            expect(lt_tokens).toHaveLength(0);
            expect(eq_tokens).toHaveLength(0);
        });

        it('>= produces a single OPERATOR token', () => {
            const result = lexer.tokenize('display x >= y');
            const operators = result.tokens.filter(t => t.type === 'OPERATOR');
            const ge_tokens = operators.filter(t => t.value === '>=');
            expect(ge_tokens).toHaveLength(1);
            const gt_tokens = operators.filter(t => t.value === '>');
            const eq_tokens = operators.filter(t => t.value === '=');
            expect(gt_tokens).toHaveLength(0);
            expect(eq_tokens).toHaveLength(0);
        });

        it('== produces a single OPERATOR token', () => {
            const result = lexer.tokenize('display x == y');
            const operators = result.tokens.filter(t => t.type === 'OPERATOR');
            const eq_eq_tokens = operators.filter(t => t.value === '==');
            expect(eq_eq_tokens).toHaveLength(1);
            const eq_tokens = operators.filter(t => t.value === '=');
            expect(eq_tokens).toHaveLength(0);
        });

        it('!= produces a single OPERATOR token', () => {
            const result = lexer.tokenize('display x != y');
            const operators = result.tokens.filter(t => t.type === 'OPERATOR');
            const ne_tokens = operators.filter(t => t.value === '!=');
            expect(ne_tokens).toHaveLength(1);
            const not_tokens = operators.filter(t => t.value === '!');
            const eq_tokens = operators.filter(t => t.value === '=');
            expect(not_tokens).toHaveLength(0);
            expect(eq_tokens).toHaveLength(0);
        });

        it('~= produces a single OPERATOR token', () => {
            const result = lexer.tokenize('display x ~= y');
            const operators = result.tokens.filter(t => t.type === 'OPERATOR');
            const tilde_eq_tokens = operators.filter(t => t.value === '~=');
            expect(tilde_eq_tokens).toHaveLength(1);
            const tilde_tokens = operators.filter(t => t.value === '~');
            const eq_tokens = operators.filter(t => t.value === '=');
            expect(tilde_tokens).toHaveLength(0);
            expect(eq_tokens).toHaveLength(0);
        });
    });

    describe('Exact Message Strings for Suggestible Pairs (Requirements 5.4-5.8)', () => {
        it('< = produces message: Malformed operator \'< =\'. Did you mean \'<=\'?', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].message).toBe("Malformed operator '< ='. Did you mean '<='?");
        });

        it('> = produces message: Malformed operator \'> =\'. Did you mean \'>=\'?', () => {
            const doc = create_document_state('display x > = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].message).toBe("Malformed operator '> ='. Did you mean '>='?");
        });

        it('! = produces message: Malformed operator \'! =\'. Did you mean \'!=\'?', () => {
            const doc = create_document_state('display x ! = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].message).toBe("Malformed operator '! ='. Did you mean '!='?");
        });

        it('~ = produces message: Malformed operator \'~ =\'. Did you mean \'~=\'?', () => {
            const doc = create_document_state('display x ~ = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].message).toBe("Malformed operator '~ ='. Did you mean '~='?");
        });

        it('= = produces message: Malformed operator \'= =\'. Did you mean \'==\'?', () => {
            const doc = create_document_state('display x = = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].message).toBe("Malformed operator '= ='. Did you mean '=='?");
        });
    });

    describe('Exact Message Strings for C-style Logical Pairs (Requirements 5.10-5.11)', () => {
        it('| | produces message with Stata-specific guidance for OR', () => {
            const doc = create_document_state('display x | | y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
            expect(invalid[0].message).toBe(
                "Invalid operator sequence '| |'. Stata uses '|' for logical OR, not '||'"
            );
        });

        it('& & produces message with Stata-specific guidance for AND', () => {
            const doc = create_document_state('display x & & y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
            expect(invalid[0].message).toBe(
                "Invalid operator sequence '& &'. Stata uses '&' for logical AND, not '&&'"
            );
        });
    });

    describe('Exact Message String for | = (Requirement 5.12)', () => {
        it('| = produces message about compound assignment operators', () => {
            const doc = create_document_state('display x | = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
            expect(invalid[0].message).toBe(
                "Invalid operator sequence '| ='. Stata does not support compound assignment operators"
            );
        });
    });

    describe('Exact Message Strings for General Invalid Pairs (Requirement 5.9)', () => {
        const general_invalid_pairs = [
            { first: '<', second: '|', pair_key: '< |' },
            { first: '<', second: '&', pair_key: '< &' },
            { first: '>', second: '|', pair_key: '> |' },
            { first: '>', second: '&', pair_key: '> &' },
            { first: '|', second: '<', pair_key: '| <' },
            { first: '|', second: '>', pair_key: '| >' },
            { first: '&', second: '<', pair_key: '& <' },
            { first: '&', second: '>', pair_key: '& >' },
            { first: '|', second: '&', pair_key: '| &' },
            { first: '&', second: '|', pair_key: '& |' },
            { first: '<', second: '<', pair_key: '< <' },
            { first: '>', second: '>', pair_key: '> >' },
            { first: '<', second: '>', pair_key: '< >' },
            { first: '>', second: '<', pair_key: '> <' },
        ];

        for (const pair of general_invalid_pairs) {
            it(`${pair.pair_key} produces generic invalid message`, () => {
                const doc = create_document_state(`display x ${pair.first} ${pair.second} y`);
                const diagnostics = analyzer.analyze(doc, default_config);
                const invalid = diagnostics.filter(
                    d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
                expect(invalid).toHaveLength(1);
                expect(invalid[0].message).toBe(
                    `Invalid operator sequence '${pair.pair_key}'. This operator combination is not valid in Stata`
                );
            });
        }
    });

    describe('Comments Between Operators Break Adjacency', () => {
        it('line comment between operators breaks adjacency', () => {
            const doc = create_document_state('display x < // comment\n= y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            // No diagnostic because comment breaks adjacency
            expect(operator_diagnostics).toHaveLength(0);
        });

        it('block comment between operators breaks adjacency', () => {
            const doc = create_document_state('display x < /* comment */ = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            // No diagnostic because comment breaks adjacency
            expect(operator_diagnostics).toHaveLength(0);
        });

        it('star comment between operators breaks adjacency', () => {
            // Star comment at start of line
            const doc = create_document_state('display x <\n* comment\n= y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            // No diagnostic because comment breaks adjacency
            expect(operator_diagnostics).toHaveLength(0);
        });
    });

    describe('Diagnostic Severity', () => {
        it('suggestible pairs emit Warning severity by default', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            expect(suggestible[0].severity).toBe(DiagnosticSeverity.Warning);
        });

        it('invalid pairs emit Error severity by default', () => {
            const doc = create_document_state('display x < | y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
            expect(invalid[0].severity).toBe(DiagnosticSeverity.Error);
        });
    });

    describe('Diagnostic Range', () => {
        it('diagnostic range spans from first operator start to second operator end', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const suggestible = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(suggestible).toHaveLength(1);
            
            // Find the < and = tokens
            const operators = doc.tokens.filter(t => t.type === 'OPERATOR');
            const lt_token = operators.find(t => t.value === '<');
            const eq_token = operators.find(t => t.value === '=');
            
            expect(lt_token).toBeDefined();
            expect(eq_token).toBeDefined();
            
            if (lt_token && eq_token) {
                expect(suggestible[0].range.start.line).toBe(lt_token.range.start.line);
                expect(suggestible[0].range.start.character).toBe(lt_token.range.start.character);
                expect(suggestible[0].range.end.line).toBe(eq_token.range.end.line);
                expect(suggestible[0].range.end.character).toBe(eq_token.range.end.character);
            }
        });
    });

    describe('Source Field', () => {
        it('diagnostics have source "sight"', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].source).toBe('sight');
        });
    });
});
