import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

function analyze(source: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lr = lexer.tokenize(source);
    const pr = parser.parse(lr.tokens);
    return analyzer.analyze(
        pr.ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true },
        lr.tokens
    );
}

function undefined_macros(source: string): string[] {
    return analyze(source)
        .diagnostics.filter(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map(d => d.symbol_name ?? '');
}

describe('st_local / st_global declarations in Mata', () => {
    it('inline mata: st_local("name", value) declares a local', () => {
        const result = analyze('mata: st_local("foo", "1")\ndisplay `foo\'');
        expect(result.symbols.localMacros.has('foo')).toBe(true);
        expect(
            result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            )
        ).toHaveLength(0);
    });

    it('block-form st_local on its own line declares a local', () => {
        const src = 'mata\nst_local("foo", "1")\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('brace-style mata { } block declares a local', () => {
        const src = 'mata {\nst_local("foo", "1")\n}\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('st_global("NAME", value) declares a global', () => {
        const src = 'mata: st_global("G", "1")\ndisplay $G';
        expect(analyze(src).symbols.globalMacros.has('G')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('one-argument st_local("name") is a read, not a declaration', () => {
        const src = 'mata: st_local("foo")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('qualified/member st_local calls are not declarations', () => {
        const src = 'mata\nobj.st_local("foo", "1")\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('qualified/member st_global calls are not declarations', () => {
        const src = 'mata\nobj.st_global("G", "1")\nend\ndisplay $G';
        expect(analyze(src).symbols.globalMacros.has('G')).toBe(false);
        expect(undefined_macros(src)).toEqual(['G']);
    });

    it('inline Mata static/member st_local calls are not declarations', () => {
        const static_call = 'mata: obj::st_local("foo", "1")\ndisplay `foo\'';
        const member_call = 'mata: obj->st_local("bar", "1")\ndisplay `bar\'';

        expect(analyze(static_call).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(static_call)).toEqual(['foo']);
        expect(analyze(member_call).symbols.localMacros.has('bar')).toBe(false);
        expect(undefined_macros(member_call)).toEqual(['bar']);
    });

    it('inline Mata static/member st_global calls are not declarations', () => {
        const static_call = 'mata: obj::st_global("G", "1")\ndisplay $G';
        const member_call = 'mata: obj->st_global("H", "1")\ndisplay $H';

        expect(analyze(static_call).symbols.globalMacros.has('G')).toBe(false);
        expect(undefined_macros(static_call)).toEqual(['G']);
        expect(analyze(member_call).symbols.globalMacros.has('H')).toBe(false);
        expect(undefined_macros(member_call)).toEqual(['H']);
    });

    it('declaration is forward-only: reference before the call still warns', () => {
        const src = 'display `foo\'\nmata: st_local("foo", "1")';
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('reference after the call in the same file does not warn', () => {
        const src = 'mata: st_local("foo", "1")\ndisplay `foo\'';
        expect(undefined_macros(src)).toEqual([]);
    });

    it('same-line reference before setter warns under semicolon delimiter', () => {
        const src = '#delimit ;\ndisplay `foo\' ; mata: st_local("foo", "1") ;';
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('same-line reference after setter is defined under semicolon delimiter', () => {
        const src = '#delimit ;\nmata: st_local("foo", "1") ; display `foo\' ;';
        expect(undefined_macros(src)).toEqual([]);
    });

    it('setter before a later local remains the primary definition', () => {
        const src = 'mata: st_local("foo", "1")\ndisplay `foo\'\nlocal foo 2';
        const result = analyze(src);
        const macro = result.symbols.localMacros.get('foo');
        expect(macro).toBeDefined();
        expect(macro!.definition_line).toBe(0);
        expect(macro!.additional_definitions?.[0]?.line).toBe(2);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('global setter before a later global remains the primary definition', () => {
        const src = 'mata: st_global("G", "1")\ndisplay $G\nglobal G 2';
        const result = analyze(src);
        const macro = result.symbols.globalMacros.get('G');
        expect(macro).toBeDefined();
        expect(macro!.definition_line).toBe(0);
        expect(macro!.additional_definitions?.[0]?.line).toBe(2);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('non-literal (dynamic) name is not declared', () => {
        const src = 'mata: st_local(varname, "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('compound-quoted name is not declared (only simple double quotes)', () => {
        const src = 'mata: st_local(`"foo"\', "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
    });

    it('nested st_local: outer setter declares, inner reader does not', () => {
        const src = 'mata: st_local("outer", st_local("inner"))';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('outer')).toBe(true);
        expect(result.symbols.localMacros.has('inner')).toBe(false);
    });

    it('st_local text inside a Stata string literal is not a declaration', () => {
        const src = 'display "st_local(\\"foo\\", 1)"\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('declaration location points at the macro name literal', () => {
        const result = analyze('mata: st_local("foo", "1")');
        const macro = result.symbols.localMacros.get('foo');
        expect(macro).toBeDefined();
        // name literal "foo" starts at column 15 on line 0:
        // m a t a :  _ s  t  _  l  o  c  a  l  (  "
        // 0123456789...
        expect(macro!.location.range.start.line).toBe(0);
        expect(macro!.definition_line).toBe(0);
    });

    it('multiple distinct setters in one block each declare', () => {
        const src = 'mata\nst_local("a", "1")\nst_local("b", "2")\nend\ndisplay `a\' `b\'';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('a')).toBe(true);
        expect(result.symbols.localMacros.has('b')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('block-form setter declares when value starts with parenthesized expression', () => {
        const src = 'mata\nst_local("foo",("1"))\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('repeated setter for the same name records additional definitions', () => {
        const result = analyze(
            'mata\nst_local("foo", "first")\nst_local("foo", "second")\nend'
        );
        const macro = result.symbols.localMacros.get('foo');
        expect(macro).toBeDefined();
        // First definition wins; the second is recorded as additional.
        expect(macro!.definition_line).toBe(1);
        expect(macro!.additional_definitions?.[0]?.line).toBe(2);
    });

    it('whitespace before the parenthesis is tolerated', () => {
        const src = 'mata: st_local ("foo", "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('declares when the setter comma is on a continued line', () => {
        const src = 'mata: st_local("foo" ///\n, "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('does not cross a real newline while looking for the setter comma', () => {
        const src = 'mata: st_local("foo"\n, "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('declares through a prefix command (capture mata:)', () => {
        const src = 'capture mata: st_local("foo", "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('declares from a setter inside a program body', () => {
        const src =
            'program define p\n  mata: st_local("foo", "1")\n  display `foo\'\nend';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('inner braces in a plain block do not end the block early', () => {
        const src =
            'mata\nvoid f() {\n  x = 1\n}\nst_local("foo", "1")\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('does not declare setters inside uncalled Mata function bodies', () => {
        const src =
            'mata\nvoid f() {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside newline-braced Mata function bodies', () => {
        const src =
            'mata\nvoid f()\n{\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside function bodies with continued signatures', () => {
        const src =
            'mata\nvoid f( ///\n  real scalar x\n) {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside function bodies after blank lines before the brace', () => {
        const src =
            'mata\nvoid f()\n\n{\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside function bodies after comment lines before the brace', () => {
        const src =
            'mata\nvoid f()\n// comment\n{\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('still declares setters inside executed top-level Mata braces', () => {
        const src =
            'mata\nif (1) {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('mata mode resets after end (two separate blocks)', () => {
        const src =
            'mata\nst_local("a", "1")\nend\nmata\nst_local("b", "2")\nend';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('a')).toBe(true);
        expect(result.symbols.localMacros.has('b')).toBe(true);
    });

    it('declares from a plain block with inner braces under #delimit ;', () => {
        // Regression: under `#delimit ;` a newline lexes as WHITESPACE, so the
        // brace-style detector must require the `{` on the `mata` line, or it
        // mistakes an inner `{ }` for the block delimiter and exits early,
        // missing the trailing st_local.
        const src =
            '#delimit ;\nmata\n{\nreal scalar x ;\nx = 1 ;\n}\nst_local("foo", "1") ;\nend ;';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
    });
});
