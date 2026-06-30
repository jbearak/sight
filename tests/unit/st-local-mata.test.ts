import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

function analyze(source: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(source);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(
        parse_result.ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true },
        lexer_result.tokens
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

    it('mata utility one-liners do not open a block', () => {
        // `mata clear` / `mata describe` are not `mata` ... `end` blocks; the
        // following ordinary text must not be scanned as Mata setters.
        expect(
            analyze('mata clear\nst_local("foo", "1")').symbols.localMacros.has(
                'foo'
            )
        ).toBe(false);
        expect(
            analyze('mata describe\nst_local("foo", "1")').symbols.localMacros
                .has('foo')
        ).toBe(false);
    });

    it('continuation-joined brace opener is a brace block (closes at })', () => {
        // `mata ///` then `{` is `mata {` logically, so the block ends at `}`;
        // a setter after `}` is outside the block and must not be declared.
        const src = 'mata ///\n{\nx = 1\n}\nst_local("foo", "1")';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
    });

    it('st_global("NAME", value) declares a global', () => {
        const src = 'mata: st_global("G", "1")\ndisplay $G';
        expect(analyze(src).symbols.globalMacros.has('G')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('an st_global setter for a system global does not shadow it', () => {
        // System globals are always defined; an `st_global("S_DATE", ...)`
        // setter must not make an EARLIER `$S_DATE` reference report undefined.
        const src = 'display "$S_DATE"\nmata: st_global("S_DATE", "x")';
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

    it('does not promote a Mata setter over an args macro', () => {
        // `args x` makes `x` visible from the start of scope
        // (definition_line 0). A later Mata setter must not become the
        // primary and reintroduce a forward-reference warning for the
        // earlier `` `x' ``.
        const src = 'display `x\'\nmata: st_local("x", "1")\nargs x';
        const result = analyze(src);
        const macro = result.symbols.localMacros.get('x');
        expect(macro).toBeDefined();
        expect(macro!.definition_line).toBe(0);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('does not promote over an args macro via a same-line column tie', () => {
        // The Mata setter (line 0) and the args macro share effective line 0
        // (args is synthetic), but the args name sits farther right on a later
        // physical line. The column tie-break must not promote the setter:
        // args stays primary (its location is the `args` name, line 1).
        const src = 'mata: st_local("x", "1")\nargs                         x';
        const macro = analyze(src).symbols.localMacros.get('x');
        expect(macro).toBeDefined();
        expect(macro!.location.range.start.line).toBe(1);
    });

    it('a continued setter does not win a same-line tie over an earlier local', () => {
        // Under `#delimit ;` an earlier `local foo` shares the call line with a
        // continued `mata: st_local( ///` whose name literal lands on the next
        // physical line. The column tie-break must not compare that later-line
        // literal against the local's column; the earlier local stays primary.
        const src =
            '#delimit ;\n      local foo = "a" ; mata: st_local( ///\n"foo", "1") ;';
        const macro = analyze(src).symbols.localMacros.get('foo');
        expect(macro).toBeDefined();
        expect(macro!.location.range.start.line).toBe(1);
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

    it('nested two-argument st_local in value position also declares', () => {
        // The inner call is itself a two-argument setter that executes and
        // sets `inner`, so both macros are genuinely defined.
        const src = 'mata: st_local("outer", st_local("inner", "x"))';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('outer')).toBe(true);
        expect(result.symbols.localMacros.has('inner')).toBe(true);
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
        expect(macro!.location.range.start.character).toBe(15);
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

    it('plain block setter declares when the name is on the next line', () => {
        // Mata block calls may wrap across lines without `///`.
        const src = 'mata\nst_local(\n    "foo", "1")\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('brace block setter declares when the name is on the next line', () => {
        const src = 'mata {\nst_local(\n    "foo", "1")\n}\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('inline mata: does not cross a bare newline to the name literal', () => {
        // Inline `mata:` ends at the newline (no `///`), unlike block forms.
        const src = 'mata: st_local(\n    "foo", "1")\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('plain block setter declares when the paren is on the next line', () => {
        // The `(` itself may wrap to a line after `st_local` in a block.
        const src = 'mata\nst_local\n("foo", "1")\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('does not leak Mata mode past a #delimit ; plain block end', () => {
        // Under `#delimit ;` the closing `end` lexes as a WORD, not
        // END_MATA. The scan must still close the block so a later
        // `st_local(...)` in ordinary code is not misread as a setter.
        const src =
            '#delimit ;\nmata ;\nst_local("inside", "1") ;\nend ;\n' +
            'st_local("outside", "2") ;';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('inside')).toBe(true);
        expect(result.symbols.localMacros.has('outside')).toBe(false);
    });

    it('closes a #delimit ; block when end follows a function body brace', () => {
        // The closing `end` directly follows a top-level `}` (RBRACE), with no
        // intervening `;`. The block must still close so a later setter in
        // ordinary code is not misread.
        const src =
            '#delimit ;\nmata ;\nvoid f() {\n  x = 1 ;\n}\nend ;\n' +
            'st_local("outside", "1") ;';
        const result = analyze(src);
        expect(result.symbols.localMacros.has('outside')).toBe(false);
    });

    it('does not treat `end =` as a #delimit ; block terminator', () => {
        // `end` used as an operand (not a standalone statement) must not close
        // the block, or a later in-block setter would be missed.
        const src =
            '#delimit ;\nmata ;\nend = 1 ;\nst_local("inside", "1") ;\nend ;';
        expect(analyze(src).symbols.localMacros.has('inside')).toBe(true);
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

    it('scopes a setter inside a program body to the program', () => {
        const src =
            'program define p\n  mata: st_local("foo", "1")\nend';
        const macro = analyze(src).symbols.localMacros.get('foo');
        expect(macro?.containingScope).toBe('program');
    });

    it('scopes a top-level setter to the dofile', () => {
        const macro = analyze('mata: st_local("foo", "1")').symbols
            .localMacros.get('foo');
        expect(macro?.containingScope).toBe('dofile');
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

    it('does not declare setters when a function header is continued outside parens', () => {
        // `void ///` on its own line before `f() {` — the `///` continuation
        // keeps the header together so the body is recognized as a function.
        const src =
            'mata\nvoid ///\nf() {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters when a struct header is continued outside braces', () => {
        const src =
            'mata\nstruct ///\nS {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
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

    it('treats a block comment between header tokens as a separator', () => {
        // `void/*c*/f()` must still parse as a function header (not `voidf()`),
        // so the body is recognized as a definition and its setter is skipped.
        const src =
            'mata\nvoid/*c*/f() {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside an inline mata: function body', () => {
        // Inline `mata:` emits no whitespace tokens, so the header collector
        // must still separate `void` and `f` rather than seeing `voidf()`.
        const src = 'mata: void f() { st_local("foo", "1") }';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
    });

    it('still declares setters inside executed top-level Mata braces', () => {
        const src =
            'mata\nif (1) {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
        expect(undefined_macros(src)).toEqual([]);
    });

    it('ignores parentheses inside string literals in a block header', () => {
        // The `)` in the condition string must not unbalance the header scan
        // and pull the preceding `struct` statement into the `if` header (which
        // would misclassify the executed block as a struct-definition body).
        const src =
            'mata\nstruct S scalar s\nif (s == ")") {\n  st_local("foo", "1")\n}\nend';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
    });

    it('does not declare setters inside a Mata struct body', () => {
        const src =
            'mata\nstruct S {\n  st_local("foo", "1")\n}\nend\ndisplay `foo\'';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
        expect(undefined_macros(src)).toEqual(['foo']);
    });

    it('does not declare setters inside a Mata class body', () => {
        const src = 'mata\nclass C {\n  st_local("foo", "1")\n}\nend';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(false);
    });

    it('declares in an executed #delimit ; block after a struct statement', () => {
        // The header scan must stop at the embedded `;` separator; otherwise
        // it pulls the preceding `struct` declaration into the `if` header and
        // mistakes the executed block for a type-definition body.
        const src =
            '#delimit ;\nmata ;\nstruct S scalar s ;\n' +
            'if (1) { st_local("foo", "1") ; }\nend ;';
        expect(analyze(src).symbols.localMacros.has('foo')).toBe(true);
    });

    it('declares a top-level setter after a struct definition', () => {
        // The struct-body skip must not over-suppress later top-level setters.
        const src =
            'mata\nstruct S {\n  real scalar x\n}\nst_local("foo", "1")\nend\ndisplay `foo\'';
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

    it('declares in a second #delimit ; plain block (mata re-entry)', () => {
        // Under `#delimit ;` only the first `mata` lexes as MATA_START; later
        // openers come through as WORDs. A standalone `mata` statement must
        // re-enter a plain block so the second block's setters are found.
        const src =
            '#delimit ;\nmata ;\nst_local("a", "1") ;\nend ;\n' +
            'mata ;\nst_local("b", "2") ;\nend ;';
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
