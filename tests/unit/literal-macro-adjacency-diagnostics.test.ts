/**
 * Unit tests for LiteralMacroAdjacencyAnalyzer (issue #267).
 *
 * Tests detection of suspicious literal-then-macro adjacency in expression
 * contexts, non-detection of intentional macro adjacency (varnames, string
 * interpolation, assignment RHS), severity config, and @lsp-ignore.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { LiteralMacroAdjacencyAnalyzer } from '../../src/providers/literal-macro-adjacency-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('LiteralMacroAdjacencyAnalyzer Unit Tests', () => {
    let analyzer: LiteralMacroAdjacencyAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new LiteralMacroAdjacencyAnalyzer();
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

    const found = (source: string) =>
        analyzer
            .analyze(create_document_state(source), default_config)
            .filter((d) => d.code === StataDiagnosticCode.LITERAL_MACRO_ADJACENCY);

    describe('Diagnostic Code and Default Severity', () => {
        it('uses the symbolic rule id', () => {
            expect(StataDiagnosticCode.LITERAL_MACRO_ADJACENCY).toBe('LITERAL_MACRO_ADJACENCY');
        });
        it('defaults to hint', () => {
            expect(DEFAULT_SETTINGS.diagnostics.severity.literalMacroAdjacency).toBe('hint');
        });
    });

    describe('Detection (positive)', () => {
        it("detects number adjacency after == : a == 1`b'", () => {
            const f = found("if (a == 1`b') {");
            expect(f).toHaveLength(1);
            expect(f[0].severity).toBe(DiagnosticSeverity.Hint);
        });
        it("detects complete-string adjacency after != : a != \"x\"`suffix'", () => {
            expect(found("if a != \"x\"`suffix' {")).toHaveLength(1);
        });
        it("detects number adjacency after < : a < 10`cutoff'", () => {
            expect(found("if a < 10`cutoff' {")).toHaveLength(1);
        });
        it("detects number adjacency after spaced <= : a < = 1`b'", () => {
            expect(found("if a < = 1`b' {")).toHaveLength(1);
        });
        it("detects number adjacency after spaced != : a ! = 1`b'", () => {
            expect(found("if a ! = 1`b' {")).toHaveLength(1);
        });
        it("detects number adjacency after spaced ~= : a ~ = 1`b'", () => {
            expect(found("if a ~ = 1`b' {")).toHaveLength(1);
        });
        it("detects number adjacency after a spaced comparison split by a block comment", () => {
            expect(found("if a < /* note */ = 1`b' {")).toHaveLength(1);
        });
        it("detects number adjacency after a spaced comparison split by a continuation", () => {
            expect(found("if a > ///\n    = 1`b' {")).toHaveLength(1);
        });
        it("detects a leading literal operand before a comparison: while 1`b' == a", () => {
            expect(found("while 1`b' == a {")).toHaveLength(1);
        });
        it("detects a leading operand before a comparison outside if/while: gen z = 1`b' == a", () => {
            expect(found("gen z = 1`b' == a")).toHaveLength(1);
        });
        it("detects adjacency after a logical operator: if a & 1`b'", () => {
            expect(found("if a & 1`b' {")).toHaveLength(1);
        });
        it("detects a global macro too: a == 1$b", () => {
            expect(found("if a == 1$b {")).toHaveLength(1);
        });
        it("detects across a /// continuation: if a == ///<newline>1`b'", () => {
            expect(found("if a == ///\n    1`b' {")).toHaveLength(1);
        });
        it("detects a bare macro-built if condition: if 1`b'", () => {
            expect(found("if 1`b' {")).toHaveLength(1);
        });
        it("detects a bare macro-built while condition: while 1`n'", () => {
            expect(found("while 1`n' {")).toHaveLength(1);
        });
        it("detects across an inline block comment: if a == /* c */ 1`b'", () => {
            expect(found("if a == /* c */ 1`b' {")).toHaveLength(1);
        });
        it("detects a parenthesized bare condition: if (1`b')", () => {
            expect(found("if (1`b') {")).toHaveLength(1);
        });
        it("detects a doubly-parenthesized bare condition: if ((1`b'))", () => {
            expect(found("if ((1`b')) {")).toHaveLength(1);
        });
        it("detects a signed literal operand: a == -1`b'", () => {
            expect(found("if a == -1`b' {")).toHaveLength(1);
        });
        it("detects a parenthesized operand after a comparison: a == (1`b')", () => {
            expect(found("if a == (1`b') {")).toHaveLength(1);
        });
    });

    describe('Non-detection (false-positive guards)', () => {
        it("does not flag varname-macro: generate x`i' = 1", () => {
            expect(found("generate x`i' = 1")).toHaveLength(0);
        });
        it("does not flag macro inside a string: use \"data`year'.dta\", clear", () => {
            expect(found("use \"data`year'.dta\", clear")).toHaveLength(0);
        });
        it("does not flag macro inside a string: display \"prefix`name'\"", () => {
            expect(found("display \"prefix`name'\"")).toHaveLength(0);
        });
        it("does not flag the common quoted-macro idiom: keep if name == \"`prefix'\"", () => {
            expect(found("keep if name == \"`prefix'\"")).toHaveLength(0);
        });
        it("does not flag \"`country'\" == \"US\" in a condition", () => {
            expect(found("if \"`country'\" == \"US\" {")).toHaveLength(0);
        });
        it("does not flag assignment RHS outside a condition: gen y = 1`b'", () => {
            expect(found("gen y = 1`b'")).toHaveLength(0);
        });
        it("does not flag when whitespace separates them: a == 1 `b'", () => {
            expect(found("if a == 1 `b' {")).toHaveLength(0);
        });
        it("does not flag macro-then-literal: a == `b'1", () => {
            expect(found("if a == `b'1 {")).toHaveLength(0);
        });
        it("does not leak condition context into options: regress y x if ok == 1, foo(2`g')", () => {
            expect(found("regress y x if ok == 1, foo(2`g')")).toHaveLength(0);
        });
        it("does not flag a macro-built function argument inside a condition: if inlist(x, 1`a', 2)", () => {
            expect(found("if inlist(x, 1`a', 2) {")).toHaveLength(0);
        });
        it("does not flag a macro-built function argument inside a condition: if max(1`a', y) > 0", () => {
            expect(found("if max(1`a', y) > 0 {")).toHaveLength(0);
        });
        it("does not flag a macro-built first function argument in a condition: if inlist(1`a', 2)", () => {
            expect(found("if inlist(1`a', 2) {")).toHaveLength(0);
        });
        it("does not flag an arithmetic operand: gen z = a - 1`b'", () => {
            expect(found("gen z = a - 1`b'")).toHaveLength(0);
        });
        it("does not flag a final function argument before a comparison: if foo(y, 2`g') > 0", () => {
            expect(found("if foo(y, 2`g') > 0 {")).toHaveLength(0);
        });
        it("does not flag a final inlist argument before ==: if inlist(x, y, 1`a') == 1", () => {
            expect(found("if inlist(x, y, 1`a') == 1 {")).toHaveLength(0);
        });
        it("does not flag a nested function-call argument: if (foo(1`a')) == 2", () => {
            expect(found("if (foo(1`a')) == 2 {")).toHaveLength(0);
        });
        it("does not flag a single-argument function call before a comparison: count if strlen(1`x') > 5", () => {
            expect(found("count if strlen(1`x') > 5")).toHaveLength(0);
        });
        it("does not flag a single-argument function call before ==: if foo(1`b') == a", () => {
            expect(found("if foo(1`b') == a {")).toHaveLength(0);
        });
        it("does not treat spaced = = as a comparison for literal-macro adjacency", () => {
            expect(found("if a = = 1`b' {")).toHaveLength(0);
        });
        it("flags a spaced grouped command expression (not a call): assert (1`b') == 10", () => {
            expect(found("assert (1`b') == 10")).toHaveLength(1);
        });
        it("flags a spaced grouped command expression: display (1`b') == 10", () => {
            expect(found("display (1`b') == 10")).toHaveLength(1);
        });
        it("detects adjacency split by a // comment under #delimit ;", () => {
            expect(found("#delimit ;\nif a == // note\n   1`b';")).toHaveLength(1);
        });
        it("does not bleed condition context into a braceless single-line if body", () => {
            expect(found("if a == 1 gen y = 1`b'")).toHaveLength(0);
        });
        it("does not treat else as a condition starter", () => {
            // Single-line else body with an assignment-context adjacency: no
            // preceding comparison/logical op and not in a condition.
            expect(found("else gen y = 1`b'")).toHaveLength(0);
        });
    });

    describe('Config gating', () => {
        it('returns nothing when set to off', () => {
            default_config.diagnostics.severity.literalMacroAdjacency = 'off';
            expect(found("if a == 1`b' {")).toHaveLength(0);
        });
        it('honors warning severity override', () => {
            default_config.diagnostics.severity.literalMacroAdjacency = 'warning';
            const f = found("if a == 1`b' {");
            expect(f[0].severity).toBe(DiagnosticSeverity.Warning);
        });
    });

    describe('Suppression', () => {
        it('respects @lsp-ignore on the line', () => {
            expect(found("if a == 1`b' { // @lsp-ignore")).toHaveLength(0);
        });
    });
});
