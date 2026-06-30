import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import type { SymbolTable } from '../../src/types';

// Guard test for issue #135 review finding M-4.
//
// Invariant under test: for every entry in a symbol's
// `additional_definitions` array, the top-level `line` field MUST equal
// `location.range.start.line`. Consumers rely on this invariant:
//   - `has_definition_in_window` (src/scope-resolver/visible-symbols.ts:48)
//     compares `.line` against window thresholds.
//   - `format_redefinition_footer` (src/providers/hover.ts:847) displays
//     `.line + 1` as the same-file footer line number, which must match
//     the LSP location the hit resolves to.
//
// The invariant holds trivially for single-line commands (node.range and
// the name's range share a start line). These cases pin the invariant so
// a future parser change enabling multi-line varlists cannot silently
// regress `line` vs. `location.range.start.line`.

describe('analyzer - additional_definitions line invariant', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(
            ast,
            'file:///a.do',
            undefined,
            undefined,
            tokens,
        );
    }

    function assert_invariant(
        symbols: SymbolTable,
        map_name: 'localMacros' | 'globalMacros' | 'scalars' | 'matrices' | 'programs',
    ): void {
        const my_map = symbols[map_name] as Map<string, {
            additional_definitions?: Array<{
                line: number;
                location: { range: { start: { line: number } } };
            }>;
        }>;
        let my_extras_seen = 0;
        for (const my_symbol of my_map.values()) {
            for (const my_extra of my_symbol.additional_definitions ?? []) {
                my_extras_seen += 1;
                expect(my_extra.line).toBe(my_extra.location.range.start.line);
            }
        }
        // Ensure the scenario actually produced extras; otherwise the
        // invariant check is vacuous.
        expect(my_extras_seen).toBeGreaterThan(0);
    }

    it('tempvar redeclaration respects the invariant', () => {
        const source = ['tempvar foo', 'tempvar foo'].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'localMacros');
    });

    it('unab redeclaration respects the invariant', () => {
        const source = [
            'gen x = 1',
            'unab my_mac : x',
            'unab my_mac : x',
        ].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'localMacros');
    });

    it('scalar redeclaration respects the invariant', () => {
        const source = ['scalar s = 1', 'scalar s = 2'].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'scalars');
    });

    it('matrix redeclaration respects the invariant', () => {
        const source = ['matrix m = (1, 2)', 'matrix m = (3, 4)'].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'matrices');
    });

    it('program redeclaration respects the invariant', () => {
        const source = [
            'program define p',
            'end',
            'program define p',
            'end',
        ].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'programs');
    });

    it('local macro redeclaration respects the invariant', () => {
        const source = [
            'local foo = "first"',
            'local foo = "second"',
        ].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'localMacros');
    });

    // Mata setter redeclaration where one definition is a continued inline
    // setter whose macro-name literal lands on a later physical line than
    // the `st_local` call. There, `definition_line` (call line) and
    // `location.range.start.line` (name-literal line) diverge — the case
    // that previously broke the invariant for the extra entry.
    it('continued Mata st_local redeclaration respects the invariant', () => {
        const source = [
            'mata: st_local("foo", "1")',
            'mata: st_local( ///',
            '    "foo", "2")',
        ].join('\n');
        const analysis = analyze(source);
        assert_invariant(analysis.symbols, 'localMacros');
    });
});
