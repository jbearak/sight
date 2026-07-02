/**
 * Unit tests for OperatorSequenceAnalyzer
 * 
 * Tests exact message strings, diagnostic codes, default severity values,
 * and edge cases for malformed operator detection.
 * 
 * Requirements covered:
 * - 4.2: Compound operators without spaces produce single tokens
 * - 5.4-5.8: Exact message strings for spaced compound and malformed pairs
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
                    spacedCompoundOperator: 'information',
                    invalidOperatorSequence: 'error',
                },
            },
        };
    });

    describe('Diagnostic Codes (Requirements 9.1-9.4)', () => {
        it('MALFORMED_OPERATOR should use its symbolic rule id', () => {
            expect(StataDiagnosticCode.MALFORMED_OPERATOR).toBe('MALFORMED_OPERATOR');
        });

        it('INVALID_OPERATOR_SEQUENCE should use its symbolic rule id', () => {
            expect(StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE).toBe('INVALID_OPERATOR_SEQUENCE');
        });

        it('CSTYLE_LOGICAL_IN_CONTROL_FLOW should use its symbolic rule id', () => {
            expect(StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW).toBe('CSTYLE_LOGICAL_IN_CONTROL_FLOW');
        });

        it('SPACED_COMPOUND_OPERATOR should use its symbolic rule id', () => {
            expect(StataDiagnosticCode.SPACED_COMPOUND_OPERATOR).toBe('SPACED_COMPOUND_OPERATOR');
        });
    });

    describe('Default Severity Values (Requirements 8.6, 8.7, 8.9)', () => {
        it('DEFAULT_SETTINGS.diagnostics.severity.malformedOperator should be "warning"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.malformedOperator).toBe('warning');
        });

        it('DEFAULT_SETTINGS.diagnostics.severity.spacedCompoundOperator should be "information"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.spacedCompoundOperator).toBe('information');
        });

        it('DEFAULT_SETTINGS.diagnostics.severity.invalidOperatorSequence should be "error"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.invalidOperatorSequence).toBe('error');
        });

        it('DEFAULT_SETTINGS.diagnostics.severity.cStyleLogicalInControlFlow should be "information"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.cStyleLogicalInControlFlow).toBe('information');
        });
    });

    describe('@lsp-ignore Suppression', () => {
        it('@lsp-ignore-next suppresses a malformed pair on the next line', () => {
            const doc = create_document_state(
                '// @lsp-ignore-next\nscalar x = = y'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const malformed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(malformed).toHaveLength(0);
        });

        it('respects @lsp-ignore on the trailing line of a /// pair', () => {
            // The first `=` sits on line 0 and the second on line 1; the
            // ignore comment is on line 1 only. The diagnostic spans both
            // lines, so it must be suppressed (#268).
            const doc = create_document_state(
                'scalar x = ///\n    = y // @lsp-ignore'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const malformed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(malformed).toHaveLength(0);
        });

        it('still reports a /// pair with no ignore directive', () => {
            const doc = create_document_state('scalar x = ///\n    = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const malformed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(malformed).toHaveLength(1);
        });

        it('does not pair operators across a ; after a /// (semicolon mode)', () => {
            // The newline after `///` is WHITESPACE under `#delimit ;`,
            // so the `;` on the next line is a real terminator that
            // breaks operator adjacency: the trailing `=` of the first
            // statement and the leading `=` of the next are not a pair.
            const doc = create_document_state(
                '#delimit ;\nscalar x = ///\n;\n= y ;'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const malformed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR
            );
            expect(malformed).toHaveLength(0);
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

    describe('Exact Message Strings for Spaced Compound Pairs (Requirements 5.4-5.8)', () => {
        it('< = produces a spaced compound operator message', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            expect(spaced_compound[0].message).toBe(
                "Spaced compound operator '< ='. Stata treats this as '<='; consider writing '<='."
            );
        });

        it('> = produces a spaced compound operator message', () => {
            const doc = create_document_state('display x > = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            expect(spaced_compound[0].message).toBe(
                "Spaced compound operator '> ='. Stata treats this as '>='; consider writing '>='."
            );
        });

        it('! = produces a spaced compound operator message', () => {
            const doc = create_document_state('display x ! = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            expect(spaced_compound[0].message).toBe(
                "Spaced compound operator '! ='. Stata treats this as '!='; consider writing '!='."
            );
        });

        it('~ = produces a spaced compound operator message', () => {
            const doc = create_document_state('display x ~ = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            expect(spaced_compound[0].message).toBe(
                "Spaced compound operator '~ ='. Stata treats this as '~='; consider writing '~='."
            );
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

    describe('Exact Message Strings for C-style Logical Pairs in Qualifier Context (Requirements 5.10-5.11)', () => {
        it('| | in command (not control flow) produces error message with Stata-specific guidance for OR', () => {
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

        it('& & in command (not control flow) produces error message with Stata-specific guidance for AND', () => {
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

    describe('Exact Message Strings for C-style Logical Pairs in Control Flow Context (Requirements 5.13-5.14)', () => {
        it('| | in if control flow produces informational message suggesting single operator', () => {
            const doc = create_document_state('if a | | b {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(1);
            expect(cstyle[0].message).toBe(
                "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style"
            );
        });

        it('& & in if control flow produces informational message suggesting single operator', () => {
            const doc = create_document_state('if a & & b {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(1);
            expect(cstyle[0].message).toBe(
                "C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style"
            );
        });
    });

    describe('Context Detection: Control Flow vs Qualifier (Requirements 2a.1-2a.4)', () => {
        it('| | in if control flow statement emits informational diagnostic, not error', () => {
            const doc = create_document_state('if x | | y {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            
            // Should NOT have INVALID_OPERATOR_SEQUENCE
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(0);
            
            // Should have CSTYLE_LOGICAL_IN_CONTROL_FLOW
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(1);
            expect(cstyle[0].severity).toBe(DiagnosticSeverity.Information);
        });

        it('| | in gen command with if qualifier emits error diagnostic', () => {
            const doc = create_document_state('gen z = 1 if x | | y');
            const diagnostics = analyzer.analyze(doc, default_config);
            
            // Should have INVALID_OPERATOR_SEQUENCE
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
            expect(invalid[0].severity).toBe(DiagnosticSeverity.Error);
            
            // Should NOT have CSTYLE_LOGICAL_IN_CONTROL_FLOW
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(0);
        });

        it('& & in else if control flow statement emits informational diagnostic', () => {
            const doc = create_document_state('if x {\n    display "a"\n}\nelse if y & & z {\n    display "b"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            
            // Should have CSTYLE_LOGICAL_IN_CONTROL_FLOW
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(1);
        });

        it('cStyleLogicalInControlFlow config "off" suppresses informational diagnostic', () => {
            const config_off: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        cStyleLogicalInControlFlow: 'off',
                    },
                },
            };
            const doc = create_document_state('if x | | y {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, config_off);
            
            // Should NOT have any C-style logical diagnostic
            const cstyle = diagnostics.filter(
                d => d.code === StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(cstyle).toHaveLength(0);
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
        const the_general_invalid_pairs = [
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

        for (const my_pair of the_general_invalid_pairs) {
            it(`${my_pair.pair_key} produces generic invalid message`, () => {
                const doc = create_document_state(`display x ${my_pair.first} ${my_pair.second} y`);
                const diagnostics = analyzer.analyze(doc, default_config);
                const invalid = diagnostics.filter(
                    d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
                expect(invalid).toHaveLength(1);
                expect(invalid[0].message).toBe(
                    `Invalid operator sequence '${my_pair.pair_key}'. This operator combination is not valid in Stata`
                );
            });
        }
    });

    describe('Comments Between Operators', () => {
        it('line comment between operators breaks adjacency', () => {
            const doc = create_document_state('display x < // comment\n= y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            // No diagnostic because comment breaks adjacency
            expect(operator_diagnostics).toHaveLength(0);
        });

        it('line comment between operators preserves adjacency under semicolon delimiter', () => {
            const doc = create_document_state(
                '#delimit ;\ndisplay x < // comment\n= y;'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(operator_diagnostics).toHaveLength(1);
        });

        it('block comment between spaced compound operators preserves adjacency', () => {
            for (const my_pair of [
                { first: '<', compact: '<=' },
                { first: '>', compact: '>=' },
                { first: '!', compact: '!=' },
                { first: '~', compact: '~=' },
            ]) {
                const doc = create_document_state(
                    `display x ${my_pair.first} /* comment */ = y`
                );
                const diagnostics = analyzer.analyze(doc, default_config);
                const operator_diagnostics = diagnostics.filter(
                    d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
                );
                expect(operator_diagnostics).toHaveLength(1);
                expect(operator_diagnostics[0].message).toContain(
                    `Stata treats this as '${my_pair.compact}'`
                );
            }
        });

        it('continuation between spaced compound operators preserves adjacency', () => {
            for (const my_pair of [
                { first: '<', compact: '<=' },
                { first: '>', compact: '>=' },
                { first: '!', compact: '!=' },
                { first: '~', compact: '~=' },
            ]) {
                const doc = create_document_state(
                    `display x ${my_pair.first} ///\n    = y`
                );
                const diagnostics = analyzer.analyze(doc, default_config);
                const operator_diagnostics = diagnostics.filter(
                    d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
                );
                expect(operator_diagnostics).toHaveLength(1);
                expect(operator_diagnostics[0].message).toContain(
                    `Stata treats this as '${my_pair.compact}'`
                );
            }
        });

        it('block comment between invalid operators preserves adjacency', () => {
            const doc = create_document_state('display x < /* comment */ < y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
        });

        it('star comment between operators breaks adjacency', () => {
            // Star comment at start of line
            const doc = create_document_state('display x <\n* comment\n= y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const operator_diagnostics = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MALFORMED_OPERATOR ||
                     d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR ||
                     d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            // No diagnostic because comment breaks adjacency
            expect(operator_diagnostics).toHaveLength(0);
        });
    });

    describe('Diagnostic Severity', () => {
        it('spaced compound pairs emit Information severity by default', () => {
            const doc = create_document_state('display x < = y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            expect(spaced_compound[0].severity).toBe(DiagnosticSeverity.Information);
        });

        it('= = emits Warning severity by default', () => {
            const doc = create_document_state('display x = = y');
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
            const spaced_compound = diagnostics.filter(
                d => d.code === StataDiagnosticCode.SPACED_COMPOUND_OPERATOR
            );
            expect(spaced_compound).toHaveLength(1);
            
            // Find the < and = tokens
            const operators = doc.tokens.filter(t => t.type === 'OPERATOR');
            const lt_token = operators.find(t => t.value === '<');
            const eq_token = operators.find(t => t.value === '=');
            
            expect(lt_token).toBeDefined();
            expect(eq_token).toBeDefined();
            
            if (lt_token && eq_token) {
                expect(spaced_compound[0].range.start.line).toBe(lt_token.range.start.line);
                expect(spaced_compound[0].range.start.character).toBe(lt_token.range.start.character);
                expect(spaced_compound[0].range.end.line).toBe(eq_token.range.end.line);
                expect(spaced_compound[0].range.end.character).toBe(eq_token.range.end.character);
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
