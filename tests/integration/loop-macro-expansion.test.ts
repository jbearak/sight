import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsConnection, DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

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

    function diagnostic_codes(source: string): StataDiagnosticCode[] {
        return analyze(source).diagnostics.map((d) => d.code);
    }

    async function provider_diagnostic_codes(source: string) {
        const uri = 'file:///test.do';
        const document_store = new DocumentStore();
        await document_store.open(uri, source, 1);
        const connection: DiagnosticsConnection = {
            sendDiagnostics: () => {},
        };
        const diagnostics_provider = new DiagnosticsProvider(connection);
        const config: StataLSPConfig = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                enabled: true,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning',
                },
            },
        };
        const diagnostics = await diagnostics_provider.get_diagnostics(
            document_store.get(uri)!,
            config,
        );
        return diagnostics.map((d) => d.code);
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

    it('expands against the pre-loop helper value even when the body redefines it', () => {
        // The helper `suffix` is statically known before the loop (foo). A body
        // redefinition must not retroactively make the pre-loop value look
        // dynamic (it previously did, via a shared MacroSymbol object in the
        // pre-loop snapshot), which would drop the expansion and emit a false
        // undefined-macro warning for the post-loop references.
        const source = [
            'local suffix foo',
            'foreach i in a b {',
            "    local prefix_`i'_`suffix'",
            '    local suffix bar',
            '}',
            "display `prefix_a_foo'",
            "display `prefix_b_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('prefix_a_foo')).toBe(true);
        expect(symbols.localMacros.has('prefix_b_foo')).toBe(true);
        const undef = undefined_macros(source);
        expect(undef).not.toContain('prefix_a_foo');
        expect(undef).not.toContain('prefix_b_foo');
    });

    it('does not expand a static loop nested inside a conditional block', () => {
        // The `if 0` block may not execute, so x_a must not be injected — a
        // reference after the block must still warn.
        const source = [
            'if 0 {',
            '    foreach i in a b {',
            "        local x_`i'",
            '    }',
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
    });

    it('expands static inner-loop names inside a dynamic outer loop', () => {
        // `foreach` does not create a local-macro scope in Stata. The outer loop
        // value set is dynamic, but the constructed names only depend on the
        // static inner iterator, so they remain tractable and visible afterward.
        const source = [
            'foreach v of varlist somevar {',
            '    foreach i in a b {',
            "        local x_`i'",
            '    }',
            "    display `x_a'",
            '}',
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(true);
        expect(symbols.localMacros.has('x_b')).toBe(true);
        expect(undefined_macros(source)).not.toContain('x_a');
    });

    it('keeps an earlier body-literal definition as the primary on collision', () => {
        // The loop constructs the name `a`, colliding with the literal `local a`
        // defined earlier in the same body. The literal (line 1) must stay the
        // primary so the reference on line 2 is in scope, not flagged forward.
        const source = [
            'foreach i in a {',
            '    local a = 1',
            "    display `a'",
            "    local `i'",
            '}',
        ].join('\n');
        expect(undefined_macros(source)).not.toContain('a');
    });

    it('does not fragment an adjacent macro-ref list item', () => {
        // `foreach i in a`m'` is ONE runtime value (a + m), not two. The old
        // loopSpec reconstruction split it into `a` and `m`, fabricating x_a/x_b.
        const source = [
            'local m b',
            "foreach i in a`m' {",
            "    local x_`i'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
    });

    it('does not fabricate a name from a forward-defined helper macro', () => {
        // `suffix` captures `` `i' `` while `i` is still undefined (Stata freezes
        // suffix = ""), and `i` is defined only AFTER. Folding suffix must not
        // reach forward to `i`'s later value and fabricate x_old — Stata defines
        // x_ , so an `x_old` reference must still warn.
        const source = [
            "local suffix `i'",
            'local i old',
            'foreach z in a b {',
            "    local x_`suffix'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
    });

    it('skips a constructed name when the body reassigns the iterator before it', () => {
        // Stata defines x_b (the reassigned value), not x_a (the loop binding);
        // we conservatively skip rather than fabricate x_a.
        const source = [
            'foreach i in a {',
            '    local i b',
            "    local x_`i'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
    });

    it('skips a constructed name when the body reassigns a helper before it', () => {
        // `suffix` is "foo" before the loop but reassigned to "bar" BEFORE the
        // constructed name, so the pre-loop value is stale there. Stata defines
        // x_bar; we conservatively skip rather than fabricate x_foo.
        const source = [
            'local suffix foo',
            'foreach z in a {',
            '    local suffix bar',
            "    local x_`suffix'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
    });

    it('stores a #delimit ; macro value without embedded whitespace tokens', () => {
        // In `#delimit ;` mode the lexer emits WHITESPACE tokens; the stored
        // macro value must collapse them to single spaces (not embed the raw
        // run, nor a `\n`), so a value-set backed by this macro splits cleanly
        // instead of mis-parsing.
        const source = [
            '#delimit ;',
            'local xs a   b ;',
        ].join('\n');
        const { symbols } = analyze(source);
        const xs = symbols.localMacros.get('xs');
        expect(xs?.value).toBe('a b');
        expect(xs?.value).not.toContain('\n');
    });

    it('makes constructed names visible from the defining statement', () => {
        const source = [
            'foreach i in a b {',
            "    local `i'_x = 1",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        const ax = symbols.localMacros.get('a_x');
        expect(ax).toBeDefined();
        expect(ax!.definition_line).toBe(1);
    });

    it('allows a later same-body reference to a constructed name', () => {
        const source = [
            'foreach i in a b {',
            "    local `i'_x = 1",
            "    display `a_x'",
            '}',
        ].join('\n');
        expect(undefined_macros(source)).not.toContain('a_x');
    });

    it('allows the nested macro-reference shape from the same loop body', async () => {
        const source = [
            'foreach my_x in a b {',
            "    local `my_x'_exists 1",
            "    display ``my_x'_exists'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('a_exists')).toBe(true);
        expect(symbols.localMacros.has('b_exists')).toBe(true);
        const codes = diagnostic_codes(source);
        expect(codes).not.toContain(StataDiagnosticCode.UNDEFINED_MACRO);
        expect(codes).not.toContain(StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL);
        const provider_codes = await provider_diagnostic_codes(source);
        expect(provider_codes).not.toContain(StataDiagnosticCode.UNDEFINED_MACRO);
        expect(provider_codes).not.toContain(StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL);
    });

    it('still warns for a reference before the constructed definition statement', () => {
        const source = [
            'foreach i in a b {',
            "    display `a_x'",
            "    local `i'_x = 1",
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

    it('expands a static inner loop inside a dynamic outer loop body', () => {
        const source = [
            'levelsof survey',
            "foreach survey in `r(levels)' {",
            '    local vars m10 cm_lastbirth',
            '    foreach v of local vars {',
            "        capture confirm variable `v'",
            '        local `v\'_exists = _rc == 0',
            '    }',
            "    if (`m10_exists' == 1) {",
            '        display "ok"',
            '    }',
            '}',
        ].join('\n');
        expect(undefined_macros(source)).not.toContain('m10_exists');
    });

    it('keeps dynamic-outer-loop expansions visible after the outer loop', () => {
        // Stata locals are scoped to the do-file/program, not to loop blocks.
        // The outer iterator is dynamic, but the constructed name only uses the
        // static inner iterator, so `m10_exists' is intentionally visible after
        // the outer loop as well.
        const source = [
            'levelsof survey',
            "foreach survey in `r(levels)' {",
            '    local vars m10',
            '    foreach v of local vars {',
            '        local `v\'_exists = 1',
            '    }',
            '}',
            "display `m10_exists'",
        ].join('\n');
        expect(undefined_macros(source)).not.toContain('m10_exists');
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

    it('poisons a helper reassigned inside a skipped if-body', () => {
        // The `if` body may not run, but if it does it reassigns `suffix`, so at
        // the later constructed name `suffix` is no longer guaranteed to be the
        // pre-loop "old". The expander must NOT fold the stale value into x_old.
        const source = [
            'local suffix old',
            'foreach i in a {',
            '    if 1 {',
            '        local suffix new',
            '    }',
            "    local x_`suffix'",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('poisons a helper reassigned inside a skipped while-body', () => {
        const source = [
            'local suffix old',
            'foreach i in a {',
            '    while (1) {',
            '        local suffix new',
            '    }',
            "    local x_`suffix'",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('poisons a helper reassigned inside a nested loop', () => {
        // The nested loop reassigns `suffix`, so the later constructed name in
        // the outer body cannot be folded from the pre-loop value.
        const source = [
            'local suffix old',
            'foreach i in a {',
            '    foreach j in p {',
            "        local suffix `j'",
            '    }',
            "    local x_`suffix'",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('does not falsely suppress when a nested loop reassigns via a constructed name', () => {
        // The nested loop reassigns `suffix` through a CONSTRUCTED name
        // (`` local `j' ``, j -> "suffix"), so its (re)definition target is
        // unknown in the outer frame context. The later outer template
        // `` x_`suffix' `` must therefore NOT fold the stale pre-loop value and
        // inject `x_old`, which would falsely suppress `display `x_old''.
        const source = [
            'local suffix old',
            'foreach i in a {',
            '    foreach j in suffix {',
            "        local `j' new",
            '    }',
            "    local x_`suffix' = 1",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('does not falsely suppress when a skipped constructed redef has an unknown target', () => {
        // `` local `i' bar `` is skipped because `i` was just reassigned, but
        // its concrete target (`` `i' `` -> "suffix") is unknown, so it may have
        // reassigned `suffix`. The later `` x_`suffix' `` must therefore NOT
        // fold the stale pre-loop value and inject `x_foo` (Stata defines
        // `x_bar`), which would falsely suppress `display `x_foo''.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    local i suffix',
            "    local `i' bar",
            "    local x_`suffix' 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('conservatively misses iterator-only templates after an unresolved redefinition', () => {
        // The nested loop's `` z_`j' `` is unresolvable in the outer frame, so
        // its (re)definition target is unknown. That unknown target could be ANY
        // macro — including the iterator `i` itself (Stata lets a body reassign
        // its own loop variable) — so `` y_`i' `` after it cannot be soundly
        // expanded either. We conservatively skip it (a miss: `y_a`/`y_b` warn
        // as undefined) rather than risk fabricating a name the way an
        // iterator-reassigning body would (a false suppression). See the
        // false-suppression regression tests above.
        const source = [
            'foreach i in a b {',
            "    foreach j in `i' {",
            "        local z_`j' = 1",
            '    }',
            "    local y_`i' = 1",
            '}',
            "display `y_a'",
            "display `y_b'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('y_a')).toBe(false);
        expect(symbols.localMacros.has('y_b')).toBe(false);
        expect(undefined_macros(source)).toContain('y_a');
    });

    it('does not falsely suppress a constructed-name increment target', () => {
        // `` local ++x_`i' `` reassigns `x_1` (to an unknown incremented value),
        // but its target name is constructed, so it is an unknown-target
        // redefinition. A later `` y_`x_1' `` must NOT fold the stale pre-loop
        // `x_1 = 3` and inject `y_3` (Stata increments x_1 to 4, defining y_4),
        // which would falsely suppress `display `y_3''.
        const source = [
            'local x_1 3',
            'forvalues i = 1/1 {',
            "    local ++x_`i'",
            "    local y_`x_1' foo",
            '}',
            "display `y_3'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('y_3')).toBe(false);
        expect(undefined_macros(source)).toContain('y_3');
    });

    it('does not falsely suppress when a body reassigns its own loop iterator', () => {
        // `` local `target' b `` reassigns `i` (target -> "i"), but is skipped
        // as an unknown-target redefinition. The later iterator-only
        // `` y_`i' `` must NOT be injected as `y_a` (Stata defines `y_b`), which
        // would falsely suppress `display `y_a''.
        const source = [
            'foreach i in a {',
            '    local target i',
            "    local `target' b",
            "    local y_`i' = 1",
            '}',
            "display `y_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('y_a')).toBe(false);
        expect(undefined_macros(source)).toContain('y_a');
    });

    it('does not fold a helper that captured the loop iterator inside the loop', () => {
        // `` local suffix `i' `` inside `foreach i` captures the iterator, so
        // `suffix`'s runtime value is the last iteration's binding ("b"),
        // unknown statically (the stored `i` is the stale pre-loop "old"). A
        // later `foreach j of local suffix` must therefore treat `suffix` as
        // dynamic, NOT fold it to "old" and inject `x_old` (which would falsely
        // suppress `display `x_old''; Stata defines `x_b`).
        const source = [
            'local i old',
            'foreach i in a b {',
            "    local suffix `i'",
            '}',
            'foreach j of local suffix {',
            "    local x_`j' = 1",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('still folds a constant helper assigned inside a loop', () => {
        // A helper whose value does NOT capture the iterator is constant across
        // iterations, so it remains foldable (no over-suppression).
        const source = [
            'foreach i in a b {',
            '    local k myval',
            '}',
            "foreach j in `k' {",
            "    local x_`j' = 1",
            '}',
            "display `x_myval'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_myval')).toBe(true);
        expect(undefined_macros(source)).not.toContain('x_myval');
    });

    it('does not fold a pre-existing macro reused as a loop iterator after the loop', () => {
        // `i` pre-exists ("old"), then `foreach i in a b` reassigns it to the
        // iteration values, leaving "b" in scope. A later `foreach j of local i`
        // must NOT fold the stale pre-loop "old" and inject `x_old` (Stata's
        // final `i` is "b"), which would falsely suppress `display `x_old''.
        const source = [
            'local i old',
            'foreach i in a b {',
            '}',
            'foreach j of local i {',
            "    local x_`j' = 1",
            '}',
            "display `x_old'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_old')).toBe(false);
        expect(undefined_macros(source)).toContain('x_old');
    });

    it('does not poison the wrong macro when a nested loop reuses the iterator name', () => {
        // The nested loop reuses `i`, so inside it `` `i' `` is the INNER
        // binding ("suffix"), not the outer "a". `` local `i' bar `` therefore
        // reassigns `suffix` at runtime. The outer `` x_`suffix' `` must not
        // fold the stale pre-loop "foo" and inject `x_foo` (Stata defines
        // `x_bar`), which would falsely suppress `display `x_foo''.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    foreach i in suffix {',
            "        local `i' bar",
            '    }',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('poisons a helper a positional macro-creating command reassigns', () => {
        // `` gettoken suffix rest : mylist `` reassigns `suffix` (a positional
        // target, not a `local()` option). A LATER `` x_`suffix' `` must not
        // fold the stale pre-loop "foo" and inject `x_foo`, which would falsely
        // suppress `display `x_foo''.
        const source = [
            'local suffix foo',
            'foreach i in a b {',
            '    gettoken suffix rest : mylist',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('still expands an iterator-only template after a positional macro-creating command', () => {
        // The gettoken target (`suffix`) is poisoned in execution order, but a
        // later iterator-only `` m_`i' `` folds no pre-loop helper, so it keeps
        // expanding — only the helper it touches is poisoned, not the whole loop.
        const source = [
            'local suffix foo',
            'foreach i in a b {',
            '    gettoken suffix rest : mylist',
            "    local m_`i' = 1",
            '}',
            "display `m_a'",
            "display `m_b'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('m_a')).toBe(true);
        expect(symbols.localMacros.has('m_b')).toBe(true);
        expect(undefined_macros(source)).not.toContain('m_a');
    });

    it('does not resolve a shadowed nested iterator to a pre-loop value', () => {
        // `i` pre-exists ("old") AND the nested loop reuses `i`. Inside the
        // nested loop `` `i' `` is the inner binding ("suffix"), so `` local `i'
        // bar `` reassigns `suffix`. The poison walk must treat `` `i' `` as
        // unresolvable (not fall back to the outer frame "a" NOR the pre-loop
        // "old"), so the outer `` x_`suffix' `` is not injected as the stale
        // `x_foo` (Stata defines `x_bar`).
        const source = [
            'local i old',
            'local suffix foo',
            'foreach i in a {',
            '    foreach i in suffix {',
            "        local `i' bar",
            '    }',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('poisons a helper redefined inside a block-prefix body', () => {
        // `` capture { local suffix new } `` reassigns `suffix`, but the body is
        // a CommandNode body the poison walk previously skipped. A later
        // `` x_`suffix' `` must not fold the stale "foo" and inject `x_foo`.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    capture {',
            '        local suffix new',
            '    }',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('does not fold an outer iterator a nested loop reused and clobbered', () => {
        // The inner `foreach i in b` reuses (and clobbers) the outer iterator
        // `i`, leaving it "b". A later `` x_`i' `` must not fold the outer frame
        // "a" and inject `x_a` (Stata defines `x_b`).
        const source = [
            'foreach i in a {',
            '    foreach i in b {',
            '    }',
            "    local x_`i' = 1",
            '}',
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(undefined_macros(source)).toContain('x_a');
    });

    it('poisons a caller helper a program reassigns via c_local', () => {
        // `setsfx` writes `suffix` back into the caller via `c_local`. A later
        // `` x_`suffix' `` must not fold the stale pre-loop "foo" and inject
        // `x_foo`.
        const source = [
            'program define setsfx',
            '    c_local suffix bar',
            'end',
            'local suffix foo',
            'foreach i in a b {',
            '    setsfx',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('poisons a dynamic macro-creating target', () => {
        // `` levelsof rep78, local(`i') `` (re)defines a macro whose name is the
        // iterator value, unknown statically. A later `` x_`suffix' `` must not
        // fold the stale "foo" and inject `x_foo`.
        const source = [
            'local suffix foo',
            'foreach i in suffix {',
            "    levelsof rep78, local(`i')",
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('poisons a global cleared by macro drop', () => {
        // `macro drop suffix` clears the global. A later `` x_${suffix} `` must
        // not fold the stale "foo" and inject `x_foo`.
        const source = [
            'global suffix foo',
            'foreach i in a b {',
            '    macro drop suffix',
            '    local x_${suffix} = 1',
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('treats macro drop _all as an unknown redefinition', () => {
        const source = [
            'global suffix foo',
            'foreach i in a b {',
            '    macro drop _all',
            '    local x_${suffix} = 1',
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('does not fold a local that only exists in another (program) scope', () => {
        // `local list` is defined inside a program, so it is NOT visible at the
        // top level. A top-level `foreach i of local list` must not fold it into
        // a static value set and inject x_a / x_b.
        const source = [
            'program define myprog',
            '    local list a b',
            'end',
            'foreach i of local list {',
            "    local x_`i'",
            '}',
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
        expect(undefined_macros(source)).toContain('x_a');
    });

    it('still folds a top-level local iteration list (active scope)', () => {
        // Regression guard for the scope change: a local in the ACTIVE scope is
        // still folded normally.
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

    it('does not fold a list macro defined inside a conditional block', () => {
        // `if 0 { local xs a }` may not run, so at the loop `xs` has no
        // guaranteed value. Folding it as ["a"] would make the loop look static
        // and inject x_a, falsely suppressing `display `x_a'`.
        const source = [
            'if 0 {',
            '    local xs a',
            '}',
            'foreach i of local xs {',
            "    local x_`i'",
            '}',
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(undefined_macros(source)).toContain('x_a');
    });

    it('does not fold a name helper defined inside a conditional block', () => {
        // `suffix` is only defined inside an if-body that may not run, so a
        // constructed name interpolating it cannot be folded to x_a / x_b.
        const source = [
            'if 0 {',
            '    local suffix x',
            '}',
            'foreach i in a b {',
            "    local `i'_`suffix'",
            '}',
            "display `a_x'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('a_x')).toBe(false);
        expect(symbols.localMacros.has('b_x')).toBe(false);
        expect(undefined_macros(source)).toContain('a_x');
    });

    it('does not fold a helper defined inside a dynamic loop body', () => {
        // The outer `of varlist` loop may iterate zero times, so `local xs a`
        // inside it is not guaranteed; the later static loop must not fold it.
        const source = [
            'foreach v of varlist somevar {',
            '    local xs a',
            '}',
            'foreach i of local xs {',
            "    local x_`i'",
            '}',
            "display `x_a'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(undefined_macros(source)).toContain('x_a');
    });

    it('skips a constructed name when a command reassigns the helper before it', () => {
        // `levelsof ..., local(suffix)` reassigns `suffix` at runtime to an
        // unknown value, so the following `local x_`suffix'` defines an unknown
        // name — NOT x_foo from the stale pre-loop value. Must not inject x_foo.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    levelsof rep78, local(suffix)',
            "    local x_`suffix'",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('skips a constructed name when a command reassigns a global helper before it', () => {
        const source = [
            'global suffix foo',
            'foreach i in a {',
            '    levelsof rep78, global(suffix)',
            "    local x_${suffix}",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('promotes the earlier expanded definition to the primary location on collision', () => {
        // The constructed `local `i' 1` (line 1) runs BEFORE the literal
        // `local a 2` (line 2). Cross-file call-site filtering reads the PRIMARY
        // location.range.start.line, so the earliest definition must become the
        // primary location (not just definition_line); the later literal is
        // demoted to additional_definitions.
        const source = [
            'foreach i in a {',
            "    local `i' 1",
            '    local a 2',
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        const a = symbols.localMacros.get('a');
        expect(a).toBeDefined();
        expect(a!.location.range.start.line).toBe(1);
        expect(a!.definition_line).toBe(1);
        expect(a!.additional_definitions?.some((d) => d.line === 2)).toBe(true);
    });

    it('marks an expanded concrete name as redefined for a later template', () => {
        // `foreach i in suffix` binds i = "suffix", so `local `i' bar` reassigns
        // the helper `suffix` (foo -> bar). The following `local x_`suffix'`
        // therefore defines x_bar at runtime, NOT x_foo. The expander must treat
        // the expanded name `suffix` as redefined and conservatively skip the
        // later template, rather than fold the stale pre-loop value into x_foo
        // and falsely suppress a reference to it.
        const source = [
            'local suffix foo',
            'foreach i in suffix {',
            "    local `i' bar",
            "    local x_`suffix'",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('uses the earlier expanded definition as the effective scope on collision', () => {
        // The constructed `local `i' 1` runs (line 2) BEFORE the literal
        // `local a 2` (line 4), so at the reference (line 3) `a' is already
        // defined. is_macro_defined reads only the primary definition line, so
        // the expanded (earlier) location must lower the primary markers; the
        // later literal must not win and flag a forward/undefined reference.
        const source = [
            'foreach i in a {',
            "    local `i' 1",
            "    display `a'",
            '    local a 2',
            '}',
        ].join('\n');
        expect(undefined_macros(source)).not.toContain('a');
    });

    it('poisons helpers reassigned by Mata setters before constructed names', () => {
        // `st_local("suffix", "bar")` runs before `local x_`suffix'`, so
        // Stata defines x_bar, not x_foo. The loop expander must not fold the
        // stale pre-loop suffix=foo value and inject x_foo.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    mata: st_local("suffix", "bar")',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('does not poison when a read-only Mata st_local has a subscript comma', () => {
        // `st_local(names[1,2])` is a one-argument READ: the comma is a Mata
        // subscript separator, not the st_local argument separator. It declares
        // nothing and must not be misread as an unknown setter that poisons the
        // later constructed `x_foo`.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    mata: st_local(names[1,2])',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(true);
        expect(undefined_macros(source)).not.toContain('x_foo');
    });

    it('treats a dynamic two-arg Mata setter with a bracketed name as unknown', () => {
        // `st_local(names[1], "bar")` IS a two-argument setter whose target is
        // dynamic (unknown). The separating comma sits at bracket depth 0, so it
        // must still be found and poison the later constructed name.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    mata: st_local(names[1], "bar")',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('treats dynamic Mata setter targets as unknown redefinitions', () => {
        // The first argument to st_local() may evaluate to any macro name. Once a
        // loop body writes an unknown target, later constructed names must be
        // skipped rather than folded from stale pre-loop helpers.
        const source = [
            'local suffix foo',
            'foreach i in a {',
            '    mata: st_local(target, "bar")',
            "    local x_`suffix' = 1",
            '}',
            "display `x_foo'",
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });

    it('keeps semicolon-mode cross-line value tokens separated at column 0', () => {
        // In `#delimit ;` mode a newline is ordinary whitespace, so an
        // unindented continuation token must still be separated. `local xs a`
        // then `b ;` is "a b", not "ab" (which would corrupt any
        // `foreach ... of local xs` expansion).
        const source = [
            '#delimit ;',
            'local xs a',
            'b ;',
        ].join('\n');
        const { symbols } = analyze(source);
        const xs = symbols.localMacros.get('xs');
        expect(xs?.value).toBe('a b');
        expect(xs?.value).not.toContain('\n');
    });

    it('joins an unindented /// continuation in a loop specification', () => {
        // Stata removes the `///` newline and keeps only indentation, so an
        // unindented continuation joins: `foreach i in a///`\n`b {` is the single
        // value `ab`. The expander must see one value `ab` (=> x_ab), not two
        // values `a`/`b` (=> x_a/x_b).
        const source = [
            'foreach i in a///',
            'b {',
            "    local x_`i'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_ab')).toBe(true);
        expect(symbols.localMacros.has('x_a')).toBe(false);
        expect(symbols.localMacros.has('x_b')).toBe(false);
    });

    it('separates an indented /// continuation in a loop specification', () => {
        // An indented `///` continuation keeps a single separating space, so
        // `foreach i in a///`\n`    b {` is two values `a` and `b` (=> x_a/x_b).
        const source = [
            'foreach i in a///',
            '    b {',
            "    local x_`i'",
            '}',
        ].join('\n');
        const { symbols } = analyze(source);
        expect(symbols.localMacros.has('x_a')).toBe(true);
        expect(symbols.localMacros.has('x_b')).toBe(true);
        expect(symbols.localMacros.has('x_ab')).toBe(false);
    });
});
