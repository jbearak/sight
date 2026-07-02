/**
 * Unit tests for MixedLogicalOperatorAnalyzer
 *
 * Tests detection of mixed `&` and `|` operators without parentheses,
 * expression boundary handling, parenthesis grouping, severity config,
 * and @lsp-ignore suppression.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { MixedLogicalOperatorAnalyzer } from '../../src/providers/mixed-logical-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('MixedLogicalOperatorAnalyzer Unit Tests', () => {
    let analyzer: MixedLogicalOperatorAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new MixedLogicalOperatorAnalyzer();
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                },
            },
        };
    });

    describe('Diagnostic Code', () => {
        it('MIXED_LOGICAL_OPERATORS should use its symbolic rule id', () => {
            expect(StataDiagnosticCode.MIXED_LOGICAL_OPERATORS).toBe('MIXED_LOGICAL_OPERATORS');
        });
    });

    describe('Default Severity', () => {
        it('DEFAULT_SETTINGS.diagnostics.severity.mixedLogicalOperators should be "warning"', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.mixedLogicalOperators).toBe('warning');
        });
    });

    describe('Basic Detection', () => {
        it('detects x & y | z', () => {
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
            expect(mixed[0].severity).toBe(DiagnosticSeverity.Warning);
        });

        it('detects x | y & z', () => {
            const doc = create_document_state('display x | y & z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in if qualifier', () => {
            const doc = create_document_state('keep if x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in if control flow condition', () => {
            const doc = create_document_state('if x & y | z {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in while condition', () => {
            const doc = create_document_state('while x & y | z {\n    display "test"\n}');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in a wrapped expression', () => {
            const doc = create_document_state('display (a & b | c)');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in a doubly wrapped expression', () => {
            const doc = create_document_state('display ((a & b | c))');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in parenthesized if condition', () => {
            const doc = create_document_state(
                'if (a & b | c) {\n    display "test"\n}'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators in nested expression contexts', () => {
            const doc = create_document_state('display foo(a & b | c)');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });
    });

    describe('No False Positives', () => {
        it('does not warn for only & operators', () => {
            const doc = create_document_state('display x & y & z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('does not warn for only | operators', () => {
            const doc = create_document_state('display x | y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('does not warn when no logical operators present', () => {
            const doc = create_document_state('display x + y * z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('does not warn for empty document', () => {
            const doc = create_document_state('');
            const diagnostics = analyzer.analyze(doc, default_config);
            expect(diagnostics).toHaveLength(0);
        });

        it('does not merge a main expression with a trailing if qualifier', () => {
            const doc = create_document_state('generate x = a & b if c | d');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('does not add a mixed warning for invalid && sequences', () => {
            const doc = create_document_state('keep if x && y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });
    });

    describe('Explicit Grouping Suppresses Warning', () => {
        it('no warning for (x & y) | z', () => {
            const doc = create_document_state('display (x & y) | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('no warning for x & (y | z)', () => {
            const doc = create_document_state('display x & (y | z)');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('no warning for (x | y) & z', () => {
            const doc = create_document_state('display (x | y) & z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('no warning for fully parenthesized (x & y) | (a & b)', () => {
            const doc = create_document_state('display (x & y) | (a & b)');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });
    });

    describe('Expression Boundaries', () => {
        it('separate statements produce separate diagnostics', () => {
            const doc = create_document_state('display x & y | z\ndisplay a | b & c');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(2);
        });

        it('& on one statement and | on next does not produce diagnostic', () => {
            const doc = create_document_state('display x & y\ndisplay a | b');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('still detects mixed operators inside a trailing if qualifier', () => {
            const doc = create_document_state('generate x = a if b & c | d');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });
    });

    describe('Diagnostic Message', () => {
        it('produces the expected message', () => {
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
            expect(mixed[0].message).toBe(
                "Mixed '&' and '|' without parentheses. "
                + "Use parentheses to clarify precedence "
                + "(e.g., '(x & y) | z' or 'x & (y | z)')"
            );
        });
    });

    describe('Diagnostic Range', () => {
        it('range spans from first to last logical operator', () => {
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);

            // Find the & and | tokens
            const and_token = doc.tokens.find(t => t.type === 'OPERATOR' && t.value === '&');
            const or_token = doc.tokens.find(t => t.type === 'OPERATOR' && t.value === '|');

            expect(and_token).toBeDefined();
            expect(or_token).toBeDefined();

            if (and_token && or_token) {
                expect(mixed[0].range.start.line).toBe(and_token.range.start.line);
                expect(mixed[0].range.start.character).toBe(and_token.range.start.character);
                expect(mixed[0].range.end.line).toBe(or_token.range.end.line);
                expect(mixed[0].range.end.character).toBe(or_token.range.end.character);
            }
        });

        it('range spans correctly for | before &', () => {
            const doc = create_document_state('display x | y & z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);

            const or_token = doc.tokens.find(t => t.type === 'OPERATOR' && t.value === '|');
            const and_token = doc.tokens.find(t => t.type === 'OPERATOR' && t.value === '&');

            expect(or_token).toBeDefined();
            expect(and_token).toBeDefined();

            if (or_token && and_token) {
                // | comes first
                expect(mixed[0].range.start.line).toBe(or_token.range.start.line);
                expect(mixed[0].range.start.character).toBe(or_token.range.start.character);
                expect(mixed[0].range.end.line).toBe(and_token.range.end.line);
                expect(mixed[0].range.end.character).toBe(and_token.range.end.character);
            }
        });

        it('range spans the mixed operators inside a wrapped expression', () => {
            const doc = create_document_state('display (a & b | c)');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);

            const and_token = doc.tokens.find(
                t => t.type === 'OPERATOR' && t.value === '&'
            );
            const or_token = doc.tokens.find(
                t => t.type === 'OPERATOR' && t.value === '|'
            );

            expect(and_token).toBeDefined();
            expect(or_token).toBeDefined();

            if (and_token && or_token) {
                expect(mixed[0].range.start.line).toBe(and_token.range.start.line);
                expect(mixed[0].range.start.character).toBe(and_token.range.start.character);
                expect(mixed[0].range.end.line).toBe(or_token.range.end.line);
                expect(mixed[0].range.end.character).toBe(or_token.range.end.character);
            }
        });
    });

    describe('Source Field', () => {
        it('diagnostics have source "sight"', () => {
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].source).toBe('sight');
        });
    });

    describe('Config Severity Override', () => {
        it('"off" suppresses diagnostic', () => {
            const config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        mixedLogicalOperators: 'off',
                    },
                },
            };
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, config);
            expect(diagnostics).toHaveLength(0);
        });

        it('"error" overrides to Error severity', () => {
            const config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        mixedLogicalOperators: 'error',
                    },
                },
            };
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, config);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
        });

        it('"hint" overrides to Hint severity', () => {
            const config: StataLSPConfig = {
                ...default_config,
                diagnostics: {
                    ...default_config.diagnostics,
                    severity: {
                        ...default_config.diagnostics.severity,
                        mixedLogicalOperators: 'hint',
                    },
                },
            };
            const doc = create_document_state('display x & y | z');
            const diagnostics = analyzer.analyze(doc, config);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Hint);
        });
    });

    describe('@lsp-ignore Suppression', () => {
        it('@lsp-ignore suppresses diagnostic on the following statement', () => {
            const doc = create_document_state('// @lsp-ignore\ndisplay x & y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('@lsp-ignore-next suppresses diagnostic on next line', () => {
            const doc = create_document_state(
                '// @lsp-ignore-next\ndisplay x & y | z'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('inline sight ignore suppresses diagnostic on the same line', () => {
            const doc = create_document_state('display x & y | z // sight: ignore');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('respects @lsp-ignore on the trailing line of a /// mix', () => {
            // The `&` sits on line 1 and the `|` on line 2; the ignore
            // comment is on line 2 only. The diagnostic spans both lines,
            // so it must be suppressed (#268).
            const doc = create_document_state(
                'keep if x & /// \n y | z // @lsp-ignore'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });
    });

    describe('Continuation Lines', () => {
        it('detects mixed operators across /// continuation', () => {
            const doc = create_document_state('keep if x & /// \n y | z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('does not merge statements across a ; after a /// (semicolon mode)', () => {
            // The newline after `///` is WHITESPACE under `#delimit ;`,
            // so the `;` on the next line is a real terminator. The `&`
            // and `|` belong to different statements and must not be
            // reported as a mix. (No `if` qualifier here: that would
            // flush state on its own and mask the terminator handling.)
            const doc = create_document_state(
                '#delimit ;\ngen z = x & y ///\n;\ngen w = a | b ;'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('does not warn for same operator across /// continuation', () => {
            const doc = create_document_state('keep if x & /// \n y & z');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(0);
        });

        it('detects mixed operators across inline block comment', () => {
            const doc = create_document_state(
                'keep if x & /* comment */ y | z'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('detects mixed operators across multiline block comment', () => {
            const doc = create_document_state(
                'keep if x & /* comment\nmore */ y | z'
            );
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });
    });

    describe('Multiple Logical Operators', () => {
        it('detects a & b | c & d (multiple of each)', () => {
            const doc = create_document_state('display a & b | c & d');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);
        });

        it('range spans from first to last logical operator with multiple ops', () => {
            const doc = create_document_state('display a & b | c & d');
            const diagnostics = analyzer.analyze(doc, default_config);
            const mixed = diagnostics.filter(
                d => d.code === StataDiagnosticCode.MIXED_LOGICAL_OPERATORS
            );
            expect(mixed).toHaveLength(1);

            // First & is the start, last & is the end
            const the_ops = doc.tokens.filter(
                t => t.type === 'OPERATOR' && (t.value === '&' || t.value === '|')
            );
            expect(the_ops.length).toBe(3);

            expect(mixed[0].range.start.line).toBe(the_ops[0].range.start.line);
            expect(mixed[0].range.start.character).toBe(the_ops[0].range.start.character);
            expect(mixed[0].range.end.line).toBe(the_ops[2].range.end.line);
            expect(mixed[0].range.end.character).toBe(the_ops[2].range.end.character);
        });
    });
});
