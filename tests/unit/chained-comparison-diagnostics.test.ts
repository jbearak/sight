/**
 * Unit tests for ChainedComparisonAnalyzer (issue #266).
 *
 * Tests detection of suspicious comparison chains (a != b != c, a < b < c,
 * mixed forms), non-detection of well-formed logical-separated comparisons,
 * no double-reporting with adjacent operator sequences, severity config, and
 * @lsp-ignore suppression.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ChainedComparisonAnalyzer } from '../../src/providers/chained-comparison-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('ChainedComparisonAnalyzer Unit Tests', () => {
    let analyzer: ChainedComparisonAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new ChainedComparisonAnalyzer();
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

    const chains = (source: string) =>
        analyzer
            .analyze(create_document_state(source), default_config)
            .filter((d) => d.code === StataDiagnosticCode.CHAINED_COMPARISON);

    describe('Diagnostic Code and Default Severity', () => {
        it('uses the symbolic rule id', () => {
            expect(StataDiagnosticCode.CHAINED_COMPARISON).toBe('CHAINED_COMPARISON');
        });
        it('defaults to warning', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.chainedComparison).toBe('warning');
        });
    });

    describe('Detection (positive)', () => {
        it('detects a != b != c', () => {
            const found = chains('if (a != b != c) {');
            expect(found).toHaveLength(1);
            expect(found[0].severity).toBe(DiagnosticSeverity.Warning);
        });
        it('detects a == b == c', () => {
            expect(chains('display a == b == c')).toHaveLength(1);
        });
        it('detects a < b < c', () => {
            expect(chains('if a < b < c {')).toHaveLength(1);
        });
        it('detects a <= b <= c', () => {
            expect(chains('if a <= b <= c {')).toHaveLength(1);
        });
        it('detects mixed chain a < b > c', () => {
            expect(chains('if a < b > c {')).toHaveLength(1);
        });
        it('detects mixed chain a == b != c', () => {
            expect(chains('if a == b != c {')).toHaveLength(1);
        });
        it('detects spaced != chained comparison syntax', () => {
            expect(chains('if a ! = b ! = c {')).toHaveLength(1);
        });
        it('detects spaced ~= chained comparison syntax', () => {
            expect(chains('if a ~ = b ~ = c {')).toHaveLength(1);
        });
        it('detects spaced <= and >= chained comparison syntax', () => {
            expect(chains('if a < = b > = c {')).toHaveLength(1);
        });
        it('detects spaced comparison operators split by block comments', () => {
            expect(chains('if a ! /* note */ = b ! = c {')).toHaveLength(1);
        });
        it('detects spaced comparison operators split by continuations', () => {
            expect(chains('if a ! ///\n    = b ! = c {')).toHaveLength(1);
        });
        it('detects a chain of four (single diagnostic)', () => {
            expect(chains('if a < b < c < d {')).toHaveLength(1);
        });
        it('detects an incomplete chained comparison tail', () => {
            const found = chains('if a < b <');
            expect(found).toHaveLength(1);
            expect(found[0].message).toContain('Incomplete chained comparison');
        });
        it('detects an incomplete chained comparison tail across a continuation', () => {
            const found = chains('if a < ///\n    b <');
            expect(found).toHaveLength(1);
            expect(found[0].message).toContain('Incomplete chained comparison');
        });
        it('detects a chained comparison with a unary negative RHS', () => {
            expect(chains('if a < b < -1 {')).toHaveLength(1);
        });
        it('detects a chained comparison with a unary negative RHS across a continuation', () => {
            expect(chains('if a < b < ///\n    -1 {')).toHaveLength(1);
        });
        it('detects the missing-& real-world case', () => {
            // `b != 1`c' != 1` : after the & the run has two != separated by
            // operands (1 and `c'), so it is a chain.
            const found = chains("if (`a' == 1 & `b' != 1`c' != 1) {");
            expect(found).toHaveLength(1);
        });
        it('detects a chain inside a subscript x[i < j < k]', () => {
            expect(chains('replace x = y[i < j < k]')).toHaveLength(1);
        });
        it('detects a chain split by an inline block comment', () => {
            expect(chains('if a < /* note */ b < c {')).toHaveLength(1);
        });
        it('detects a chain split by a // comment under #delimit ;', () => {
            expect(chains('#delimit ;\nif a < // note\n   b < c;')).toHaveLength(1);
        });
    });

    describe('Non-detection (negative)', () => {
        it('does not flag a single comparison', () => {
            expect(chains('if a < b {')).toHaveLength(0);
        });
        it('does not flag a single incomplete comparison', () => {
            expect(chains('if (a < )')).toHaveLength(0);
        });
        it('does not flag a single incomplete comparison across a continuation', () => {
            expect(chains('if (a < ///\n    )')).toHaveLength(0);
        });
        it('does not flag a single incomplete macro comparison', () => {
            expect(chains("if (`a' < )")).toHaveLength(0);
        });
        it('does not flag a single incomplete macro comparison across a continuation', () => {
            expect(chains("if (`a' < ///\n    )")).toHaveLength(0);
        });
        it('does not flag comparisons separated by &', () => {
            expect(chains("if `a' == 1 & `b' != 1 & `c' != 1 {")).toHaveLength(0);
        });
        it('does not flag comparisons separated by |', () => {
            expect(chains('if a < b | c > d {')).toHaveLength(0);
        });
        it('does not flag comparisons in separate function arguments', () => {
            expect(chains('gen z = cond(a < b, 1, 0)')).toHaveLength(0);
        });
        it('does not flag inlist arguments', () => {
            expect(chains('keep if inlist(x, 1, 2, 3)')).toHaveLength(0);
        });
        it('does not flag comparisons on separate statements', () => {
            expect(chains('if a < b {\n}\nif c > d {\n}')).toHaveLength(0);
        });
        it('does not flag (a < b) < c as a chain', () => {
            // Parenthesized comparison then a single outer comparison is one
            // comparison per group — not a chain.
            expect(chains('gen z = (a < b) < c')).toHaveLength(0);
        });
        it('does not double-report adjacent < < (handled by OperatorSequence)', () => {
            expect(chains('if a < < b {')).toHaveLength(0);
        });
        it('does not flag an invalid operator sequence after a comparison as a chain', () => {
            expect(chains('if a < b < < c {')).toHaveLength(0);
        });
        it('does not flag an invalid operator sequence after a block comment as a chain', () => {
            expect(chains('if a < b < /* note */ < c {')).toHaveLength(0);
        });
        it('does not flag an invalid operator sequence after a comparison across a continuation as a chain', () => {
            expect(chains('if a < b < ///\n    < c {')).toHaveLength(0);
        });
        it('does not flag an invalid comparison-logical sequence as a chain', () => {
            expect(chains('if a < b < | c {')).toHaveLength(0);
        });
        it('does not flag an invalid comparison-logical sequence across a continuation as a chain', () => {
            expect(chains('if a < b < ///\n    | c {')).toHaveLength(0);
        });
        it('does not normalize spaced = = into a chained comparison', () => {
            expect(chains('if a = = b = = c {')).toHaveLength(0);
        });
        it('does not span a braceless single-line if condition into its body', () => {
            expect(chains('if a < b gen flag = c < d')).toHaveLength(0);
        });
        it('does not span a braceless if into an assert body', () => {
            expect(chains('if a < b assert c < d')).toHaveLength(0);
        });
    });

    describe('Config gating', () => {
        it('returns nothing when set to off', () => {
            default_config.diagnostics.severity.chainedComparison = 'off';
            expect(chains('if a < b < c {')).toHaveLength(0);
        });
        it('honors error severity override', () => {
            default_config.diagnostics.severity.chainedComparison = 'error';
            const found = chains('if a < b < c {');
            expect(found[0].severity).toBe(DiagnosticSeverity.Error);
        });
    });

    describe('Suppression', () => {
        it('respects @lsp-ignore on the chain line', () => {
            const found = chains('if a < b < c { // @lsp-ignore');
            expect(found).toHaveLength(0);
        });
        it('respects @lsp-ignore on the trailing line of a /// chain', () => {
            const found = chains('if a < ///\n    b < c { // @lsp-ignore');
            expect(found).toHaveLength(0);
        });
    });
});
