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
import {
    OperatorSequenceAnalyzer,
    collect_mixed_effects_separator_starts,
} from '../../src/providers/operator-sequence-diagnostics';
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

    describe('Mixed-effects random-equation separators (issue #320)', () => {
        const operator_sequence_diagnostics = (source: string) =>
            analyzer.analyze(
                create_document_state(source),
                default_config
            );

        const expect_only_operator_diagnostic_at = (
            source: string,
            pair_start_line: number,
            pair_start_character: number,
            pair_length: number
        ) => {
            const the_diagnostics = operator_sequence_diagnostics(source);
            expect(the_diagnostics).toHaveLength(1);
            expect(the_diagnostics[0].range).toEqual({
                start: {
                    line: pair_start_line,
                    character: pair_start_character,
                },
                end: {
                    line: pair_start_line,
                    character: pair_start_character + pair_length,
                },
            });
            return the_diagnostics[0];
        };

        it('accepts the exact issue reproduction', () => {
            const source =
                "mixed log_supply `rhs' if esample || state_num:";
            expect(operator_sequence_diagnostics(source)).toHaveLength(0);
        });

        it('allows mestreg to omit the fixed-effects varlist', () => {
            expect(
                operator_sequence_diagnostics(
                    'mestreg || id:, distribution(weibull)'
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    'mestreg if sample || id:, distribution(weibull)'
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    'mestreg in 1/10 || id:, distribution(weibull)'
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    'mestreg [pw=weight] || id:, distribution(weibull)'
                )
            ).toHaveLength(0);
        });

        it('requires fixed-effects model content for mixed', () => {
            expect(
                operator_sequence_diagnostics('mixed || id:')
            ).toHaveLength(1);
            expect(
                operator_sequence_diagnostics('mixed in 1/10 || id:')
            ).toHaveLength(1);
        });

        it('accepts macro-expanded model and level-variable heads', () => {
            expect(
                operator_sequence_diagnostics("mixed `outcome' x || id:")
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics('mixed $outcome x || id:')
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics("mixed y x || `panel':")
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics('mixed y x || $panel:')
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    "mixed y x || state_`suffix':"
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    'mixed y x || ${prefix}id:'
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    "mixed y x || `prefix'`suffix':"
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    "mixed y x || `panel'1:"
                )
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    'mixed y x || ${panel}2:'
                )
            ).toHaveLength(0);
        });

        it('accepts constructed model heads beginning with if or in', () => {
            const the_valid_sources = [
                "mixed if`suffix' x || id:",
                'mixed in${suffix} x || id:',
            ];
            for (const my_source of the_valid_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }

            const the_invalid_sources = [
                "mixed if `suffix' x || id:",
                'mixed in ${suffix} x || id:',
            ];
            for (const my_source of the_invalid_sources) {
                const my_bar_start = my_source.indexOf('||');
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_source,
                    0,
                    my_bar_start,
                    2
                );
                expect(my_diagnostic.code).toBe(
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
            }
        });

        it('accepts the explicit mixed-effects command family', () => {
            const the_commands = [
                'mixed',
                'mecloglog',
                'meglm',
                'meintreg',
                'melogit',
                'menbreg',
                'meologit',
                'meoprobit',
                'mepoisson',
                'meprobit',
                'meqrlogit',
                'meqrpoisson',
                'mestreg',
                'metobit',
                'xtmixed',
                'xtmelogit',
                'xtmepoisson',
            ];
            for (const my_command of the_commands) {
                expect(
                    operator_sequence_diagnostics(`${my_command} y x || id:`)
                ).toHaveLength(0);
            }
        });

        it('accepts exact-case simple prefixes and their colons', () => {
            const the_prefixes = [
                'cap', 'capt:', 'captu', 'captur:', 'capture',
                'qui', 'quie:', 'quiet', 'quietl:', 'quietly',
                'noi', 'nois:', 'noisi', 'noisil:', 'noisily',
                'capt nois:',
                'capture: quietly: noisily:',
            ];
            for (const my_prefix of the_prefixes) {
                expect(
                    operator_sequence_diagnostics(
                        `${my_prefix} mixed y x || id:`
                    )
                ).toHaveLength(0);
            }
        });

        it('accepts exact-case colon-required xi prefixes', () => {
            const the_valid_sources = [
                'xi: mixed y i.group || id:',
                'xi: xtmixed y i.group || id:',
                'capture xi: xtmixed y i.group || id:',
            ];
            for (const my_source of the_valid_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }

            const the_invalid_sources = [
                'Xi: mixed y i.group || id:',
                'xi mixed y i.group || id:',
            ];
            for (const my_source of the_invalid_sources) {
                const my_bar_start = my_source.indexOf('||');
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_source,
                    0,
                    my_bar_start,
                    2
                );
                expect(my_diagnostic.code).toBe(
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
            }
        });

        it('rejects wrong case and unverified command abbreviations', () => {
            const the_sources = [
                'Mixed y x || id:',
                'capture Mixed y x || id:',
                'Capture mixed y x || id:',
                'mix y x || id:',
                'xtmix y x || id:',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(1);
            }
        });

        it('keeps constructed command-head separators diagnostic', () => {
            const the_sources = [
                "mixed`suffix' y x || id:",
                'mixed${suffix} y x || id:',
                'mixedmore y x || id:',
                'mixed1 y x || id:',
            ];
            for (const my_source of the_sources) {
                const my_bar_start = my_source.indexOf('||');
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_source,
                    0,
                    my_bar_start,
                    2
                );
                expect(my_diagnostic.code).toBe(
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
            }
        });

        it('fails closed for argument-bearing prefixes and exclusions', () => {
            const the_commands = [
                'menl',
                'gsem',
                'twoway',
                'svyset',
                'my_mixed_program',
            ];
            for (const my_command of the_commands) {
                expect(
                    operator_sequence_diagnostics(`${my_command} y x || id:`)
                ).toHaveLength(1);
            }
            expect(
                operator_sequence_diagnostics('by group: mixed y x || id:')
            ).toHaveLength(1);
        });

        it('accepts leading model wildcard patterns', () => {
            const the_sources = [
                'mixed * || id:',
                'mixed *outcome || id:',
                'mixed ?outcome || id:',
                'quietly: mixed *outcome || id:',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }
        });

        it('accepts varlist wildcard tails before separators', () => {
            const the_sources = [
                'mixed y x* || id:',
                'mixed y x? || id:',
                'mixed y * || id:',
                'mixed y ? || id:',
                'mixed y || id: z* || school:',
                'mixed y || id: z? || school:',
                'mixed y if sample || id: z* || school:',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }
        });

        it('accepts wildcard tails after source-adjacent ranges', () => {
            const the_sources = [
                'mixed y x1-x5 z* || id:',
                'mixed y x1-x5 * || id:',
                'mixed y || id: x1-x5 z? || school:',
                'mixed y || id: x1-x5 ? || school:',
                'mixed y if sample || id: x1-x5 z* || school:',
                "mixed y `lo'1-`hi'5 z* || id:",
                'mixed y || id: ${lo}1-${hi}5 ? || school:',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }
        });

        it('accepts constructed if and in wildcard names', () => {
            const the_sources = [
                'mixed y x1if* || id:',
                "mixed y `p'1if* || id:",
                'mixed y in? || id:',
                'mixed y ${prefix}1in? || id:',
                "mixed y || id: `p'1if* || school:",
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(0);
            }
        });

        it('supports multiple equations and random-equation options', () => {
            const source =
                'mixed y x || id: z, covariance(unstructured) ' +
                '|| school: age || classroom:';
            expect(operator_sequence_diagnostics(source)).toHaveLength(0);
        });

        it('distinguishes grouped commas from command options', () => {
            expect(
                operator_sequence_diagnostics(
                    'mixed y x if inlist(group, 1, 2) || id:'
                )
            ).toHaveLength(0);

            const my_top_level = 'mixed y x, mle || id:';
            const my_bar_start = my_top_level.indexOf('||');
            const my_diagnostic = expect_only_operator_diagnostic_at(
                my_top_level,
                0,
                my_bar_start,
                2
            );
            expect(my_diagnostic.code).toBe(
                StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
        });

        it('requires model content and a plausible levelvar colon', () => {
            const the_sources = [
                'mixed || id:',
                'mixed if esample || id:',
                'mixed in 1/10 || id:',
                'mixed 1 || id:',
                'mixed "outcome" || id:',
                'mixed [pw=weight] || id:',
                'mixed y x || id',
                'mixed y x || :',
                'mixed y x || if:',
                'mixed y x || in:',
                'mixed y x || 1:',
                "mixed y x || 1`suffix':",
                'mixed y x || first second:',
                "mixed y x || state_ `suffix':",
                'mixed y x || ${prefix} id:',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(1);
            }
        });

        it('keeps every noncompact double bar diagnostic', () => {
            const the_sources = [
                'mixed y x | | id:',
                'mixed y x |/* comment */| id:',
                'mixed y x | ///\n| id:',
                '#delimit ;\nmixed y x | // comment\n| id: ;',
            ];
            for (const my_source of the_sources) {
                expect(
                    operator_sequence_diagnostics(my_source)
                ).toHaveLength(1);
            }
        });

        it('allows a valid separator after a logical double bar', () => {
            const the_sources = [
                'mixed y x if (a || b) || id:',
                'mixed y x if a[1 || 2] || id:',
                'mixed y x if a || b || id:',
            ];
            for (const my_source of the_sources) {
                const my_invalid_start = my_source.indexOf('||');
                const my_valid_start = my_source.lastIndexOf('||');
                expect(my_invalid_start).not.toBe(my_valid_start);
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_source,
                    0,
                    my_invalid_start,
                    2
                );
                expect(my_diagnostic.code).toBe(
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
                expect(my_diagnostic.range.start.character).not.toBe(
                    my_valid_start
                );
            }
        });

        it('preserves each operator diagnostic beside a separator', () => {
            const the_cases = [
                {
                    source: 'mixed y x if a && b || id:',
                    pair: '&&',
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                },
                {
                    source: 'mixed y x if a < | b || id:',
                    pair: '< |',
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                },
                {
                    source: 'mixed y x if a = = b || id:',
                    pair: '= =',
                    code: StataDiagnosticCode.MALFORMED_OPERATOR,
                },
                {
                    source: 'mixed y x if a < = b || id:',
                    pair: '< =',
                    code: StataDiagnosticCode.SPACED_COMPOUND_OPERATOR,
                },
            ];
            for (const my_case of the_cases) {
                const my_invalid_start = my_case.source.indexOf(
                    my_case.pair
                );
                const my_valid_start = my_case.source.lastIndexOf('||');
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_case.source,
                    0,
                    my_invalid_start,
                    my_case.pair.length
                );
                expect(my_diagnostic.code).toBe(my_case.code);
                expect(my_diagnostic.range.start.character).not.toBe(
                    my_valid_start
                );
            }
        });

        it('keeps dangling = before bars diagnostic at the bars', () => {
            const my_source = 'mixed y x =|| id:';
            const my_bar_start = my_source.indexOf('||');
            const my_diagnostic = expect_only_operator_diagnostic_at(
                my_source,
                0,
                my_bar_start,
                2
            );
            expect(my_diagnostic.code).toBe(
                StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
        });

        it('rejects wildcard-like tails outside mixed varlists', () => {
            const the_sources = [
                'mixed y +* || id:',
                'mixed y =? || id:',
                'mixed y x if a* || id:',
                'mixed y if * || id:',
                'mixed y in ? || id:',
                'mixed y x1 - x5 z* || id:',
                'mixed y x1- z* || id:',
                'mixed y +x1-x5 z* || id:',
                'mixed y if sample x1-x5 z* || id:',
            ];
            for (const my_source of the_sources) {
                const my_bar_start = my_source.indexOf('||');
                const my_diagnostic = expect_only_operator_diagnostic_at(
                    my_source,
                    0,
                    my_bar_start,
                    2
                );
                expect(my_diagnostic.code).toBe(
                    StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
                );
            }
        });

        it('preserves an outer control-flow style diagnostic', () => {
            const source = [
                'if a || b {',
                '    mixed y x || id:',
                '}',
            ].join('\n');
            const my_diagnostic = expect_only_operator_diagnostic_at(
                source,
                0,
                source.split('\n')[0].indexOf('||'),
                2
            );
            expect(my_diagnostic.code).toBe(
                StataDiagnosticCode.CSTYLE_LOGICAL_IN_CONTROL_FLOW
            );
            expect(my_diagnostic.range.start.line).not.toBe(1);
        });

        it('fails closed after malformed grouping', () => {
            const my_unclosed = 'mixed y x if (a || b || id:';
            const the_unclosed_diagnostics =
                operator_sequence_diagnostics(my_unclosed);
            const my_first_bar = my_unclosed.indexOf('||');
            const my_second_bar = my_unclosed.lastIndexOf('||');
            expect(the_unclosed_diagnostics).toHaveLength(2);
            expect(
                the_unclosed_diagnostics.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 0, character: my_first_bar },
                        end: { line: 0, character: my_first_bar + 2 },
                    },
                },
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: { line: 0, character: my_second_bar },
                        end: { line: 0, character: my_second_bar + 2 },
                    },
                },
            ]);

            const my_mismatched =
                'mixed y x || id: (z] || school:';
            const my_valid_start = my_mismatched.indexOf('||');
            const my_invalid_start = my_mismatched.lastIndexOf('||');
            const my_diagnostic = expect_only_operator_diagnostic_at(
                my_mismatched,
                0,
                my_invalid_start,
                2
            );
            expect(my_diagnostic.code).toBe(
                StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(my_diagnostic.range.start.character).not.toBe(
                my_valid_start
            );
        });

        it('supports #delimit ; and /// statement wrapping', () => {
            expect(
                operator_sequence_diagnostics('mixed y x ///\n    || id:')
            ).toHaveLength(0);
            expect(
                operator_sequence_diagnostics(
                    '#delimit ;\nmixed y x\n|| id:\n' +
                    '|| school:\n;'
                )
            ).toHaveLength(0);
        });

        it('does not leak separator state across statements', () => {
            const the_lines = [
                'mixed y x || id:',
                'display a || b',
                'mixed z, mle || school:',
                'mixed q || firm:',
            ];
            const the_diagnostics = operator_sequence_diagnostics(
                the_lines.join('\n')
            );
            expect(
                the_diagnostics.map((my_diagnostic) => ({
                    code: my_diagnostic.code,
                    range: my_diagnostic.range,
                }))
            ).toEqual([
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: {
                            line: 1,
                            character: the_lines[1].indexOf('||'),
                        },
                        end: {
                            line: 1,
                            character: the_lines[1].indexOf('||') + 2,
                        },
                    },
                },
                {
                    code: StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE,
                    range: {
                        start: {
                            line: 2,
                            character: the_lines[2].indexOf('||'),
                        },
                        end: {
                            line: 2,
                            character: the_lines[2].indexOf('||') + 2,
                        },
                    },
                },
            ]);
            expect(
                the_diagnostics.some(
                    (my_diagnostic) =>
                        my_diagnostic.range.start.line === 0 ||
                        my_diagnostic.range.start.line === 3
                )
            ).toBe(false);
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

    describe('Separator-start memoization', () => {
        it('returns the same Set instance for the same token array', () => {
            const doc = create_document_state('mixed y x || id:');
            const first_result =
                collect_mixed_effects_separator_starts(doc.tokens);
            const second_result =
                collect_mixed_effects_separator_starts(doc.tokens);
            expect(second_result).toBe(first_result);
            expect(first_result.size).toBe(1);
        });

        it('computes independently for distinct token arrays of equal source', () => {
            const doc_a = create_document_state('mixed y x || id:');
            const doc_b = create_document_state('mixed y x || id:');
            const result_a =
                collect_mixed_effects_separator_starts(doc_a.tokens);
            const result_b =
                collect_mixed_effects_separator_starts(doc_b.tokens);
            expect(result_a).not.toBe(result_b);
            expect(result_a.size).toBe(1);
            expect(result_b.size).toBe(1);
        });

        it('returns an empty set for files without mixed-effects commands', () => {
            const doc = create_document_state(
                'display x || y\nregress y x || id:'
            );
            const result =
                collect_mixed_effects_separator_starts(doc.tokens);
            expect(result.size).toBe(0);
        });

        it('early exit does not suppress diagnostics for plain double bars', () => {
            const doc = create_document_state('display x || y');
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(1);
        });

        it('still recognizes separators when another statement mentions the command', () => {
            const doc = create_document_state(
                'display "mixed models"\nmixed y x || id:'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const invalid = diagnostics.filter(
                d => d.code === StataDiagnosticCode.INVALID_OPERATOR_SEQUENCE
            );
            expect(invalid).toHaveLength(0);
        });
    });
});
