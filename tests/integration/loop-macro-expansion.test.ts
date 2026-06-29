import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

describe('Loop macro expansion (integration)', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;

    beforeEach(() => {
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    function analyze(source: string) {
        const lex = lexer.tokenize(source);
        const parse = parser.parse(lex.tokens);
        return analyzer.analyze(parse.ast, 'file:///test.do', undefined, undefined, lex.tokens);
    }

    function undefined_macros(source: string): string[] {
        return analyze(source)
            .diagnostics.filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
            .map((d) => d.symbol_name ?? '');
    }

    it('defines the four constructed-name forms after the loop', () => {
        const source = [
            'local suffix foo',
            'foreach i in a b c {',
            "    local `i'",
            "    local `i'_suffix",
            "    local prefix_`i'",
            "    local prefix_`i'_`suffix'",
            '}',
            "display `a'",
            "display `b_suffix'",
            "display `prefix_c'",
            "display `prefix_a_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        for (const name of ['a', 'b', 'c', 'a_suffix', 'b_suffix', 'c_suffix',
            'prefix_a', 'prefix_b', 'prefix_c', 'prefix_a_foo', 'prefix_b_foo', 'prefix_c_foo']) {
            expect(symbols.localMacros.has(name)).toBe(true);
        }
        // No false "undefined" for the post-loop references.
        const undef = undefined_macros(source);
        for (const name of ['a', 'b_suffix', 'prefix_c', 'prefix_a_foo']) {
            expect(undef).not.toContain(name);
        }
    });

    it('makes constructed names visible only after the closing brace', () => {
        const source = [
            'foreach i in a b {',
            "    local `i'_x = 1",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        const ax = symbols.localMacros.get('a_x');
        expect(ax).toBeDefined();
        // closing brace is line 2 (0-indexed); visible on line 3.
        expect(ax!.definition_line).toBe(3);
    });

    it('still warns for an in-body reference to a sibling constructed name', () => {
        const source = [
            'foreach i in a b {',
            "    local `i'_x = 1",
            "    display `a_x'",
            '}',
        ].join('\n');
        expect(undefined_macros(source)).toContain('a_x');
    });

    it('expands nested loops as a cartesian product', () => {
        const source = [
            'foreach i in a b {',
            '    foreach j in x y {',
            "        local `i'_`j'",
            '    }',
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        for (const name of ['a_x', 'a_y', 'b_x', 'b_y']) {
            expect(symbols.localMacros.has(name)).toBe(true);
        }
    });

    it('expands forvalues integer ranges', () => {
        const source = [
            'forvalues i = 1/3 {',
            "    local v`i'",
            '}',
            "display `v2'",
        ].join('\n');
        const { symbols } = analyze(source);
        for (const name of ['v1', 'v2', 'v3']) {
            expect(symbols.localMacros.has(name)).toBe(true);
        }
        expect(undefined_macros(source)).not.toContain('v2');
    });

    it('expands a local-macro iteration list', () => {
        const source = [
            'local looped a b c',
            "foreach i in `looped' {",
            "    local out_`i'",
            '}',
            "display `out_b'",
        ].join('\n');
        const { symbols } = analyze(source);
        for (const name of ['out_a', 'out_b', 'out_c']) {
            expect(symbols.localMacros.has(name)).toBe(true);
        }
        expect(undefined_macros(source)).not.toContain('out_b');
    });

    it('records collisions as additional definitions, not drops', () => {
        const source = [
            'foreach i in a b {',
            "    local v`i'",
            '}',
            'foreach i in a b {',
            "    local v`i'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        const va = symbols.localMacros.get('va');
        expect(va).toBeDefined();
        expect(va!.additional_definitions?.length ?? 0).toBeGreaterThanOrEqual(1);
    });

    it('does not falsely suppress when a name helper is defined later in the body', () => {
        // `suffix' is referenced in a constructed name before it is defined, so
        // at runtime the name is not `a_x'. We must NOT inject a_x / b_x.
        const source = [
            'foreach i in a b {',
            "    local `suffix'_x 1",
            "    local suffix `i'",
            '}',
            "display `a_x'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('a_x')).toBe(false);
        expect(undefined_macros(source)).toContain('a_x');
    });

    it('resolves a name helper defined before the loop', () => {
        const source = [
            'local suffix foo',
            'foreach i in a b {',
            "    local x_`i'_`suffix'",
            '}',
            "display `x_a_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a_foo')).toBe(true);
        expect(symbols.localMacros.has('x_b_foo')).toBe(true);
        expect(undefined_macros(source)).not.toContain('x_a_foo');
    });

    it('does not rebind a pre-loop helper that references the iterator', () => {
        // `suffix' is defined BEFORE the loop with value `i'. Stata expands `i'
        // at that (pre-loop) point, where `i' is undefined, so suffix = "" and
        // the loop body defines `x_' — NOT x_a / x_b. We must not inject x_a/x_b
        // (that would falsely suppress the genuine undefined-macro warnings).
        const source = [
            "local suffix `i'",
            'foreach i in a b {',
            "    local x_`suffix'",
            '}',
            "display `x_a'",
            "display `x_b'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
        const undef = undefined_macros(source);
        expect(undef).toContain('x_a');
        expect(undef).toContain('x_b');
    });

    it('folds a pre-loop helper against the iterator\'s prior (pre-loop) value', () => {
        // `i' exists before the loop (= "old"), so `local suffix `i'` freezes
        // suffix = "old" and the loop defines x_old on every iteration — never
        // x_a / x_b. The expander resolves suffix against i's pre-loop value.
        const source = [
            'local i old',
            "local suffix `i'",
            'foreach i in a b {',
            "    local x_`suffix'",
            '}',
            "display `x_old'",
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(true);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
        const undef = undefined_macros(source);
        expect(undef).not.toContain('x_old');
        expect(undef).toContain('x_a');
    });

    it('does not inject digit-leading (invalid) names from integer iterators', () => {
        const source = [
            'forvalues i = 1/3 {',
            "    local `i'_suffix 1",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        // "1_suffix" etc. are not valid Stata macro names and must not be injected.
        expect(symbols.localMacros.has('1_suffix')).toBe(false);
        expect(symbols.localMacros.has('2_suffix')).toBe(false);
    });

    it('does not fold a stale value when the list macro is redefined before the loop', () => {
        // Stata last-assignment-wins: at the loop `xs` is "b", so it defines
        // m_b, not m_a. First-def-wins would fold "a" — must not inject m_a.
        const source = [
            'local xs a',
            'local xs b',
            'foreach i of local xs {',
            "    local m_`i' 1",
            '}',
            "display `m_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('m_a')).toBe(false);
        expect(undefined_macros(source)).toContain('m_a');
    });

    it('does not expand constructed names inside a conditional block (may not execute)', () => {
        const source = [
            'foreach i in a b {',
            '    if (1 == 0) {',
            "        local `i'_c 1",
            '    }',
            '}',
            "display `a_c'",
        ].join('\n');
        const { symbols } = analyze(source);
        // The if-body may not run, so a_c/b_c must not be treated as defined.
        expect(symbols.localMacros.has('a_c')).toBe(false);
        expect(undefined_macros(source)).toContain('a_c');
    });

    it('injects nothing when the iteration set is empty (body never runs)', () => {
        const source = [
            'local empty',
            'local name x',
            'foreach i of local empty {',
            "    local `name' 1",
            '}',
            "display `x'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x')).toBe(false);
        expect(undefined_macros(source)).toContain('x');
    });

    it('injects nothing when the iteration list is dynamic', () => {
        const source = [
            'foreach i of varlist price mpg {',
            "    local `i'_x",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('price_x')).toBe(false);
        expect(symbols.localMacros.has('mpg_x')).toBe(false);
    });

    it('defines global macros constructed in a loop', () => {
        const source = [
            'foreach i in a b {',
            "    global g_`i'",
            '}',
            'display "${g_a}"',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.globalMacros.has('g_a')).toBe(true);
        expect(symbols.globalMacros.has('g_b')).toBe(true);
    });
});
