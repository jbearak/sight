import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

function undefined_macro_diagnostics(code: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    const result = analyzer.analyze(
        parse_result.ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true },
        lexer_result.tokens
    );
    return result.diagnostics.filter(
        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
    );
}

describe('st_local / st_global definition-position properties', () => {
    // Property A: a reference after an `st_local` setter is not undefined.
    it('Property A: reference after the setter produces no warning', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `mata: st_local("${name}", "1")\ndisplay \`${name}'`;
                expect(undefined_macro_diagnostics(code)).toHaveLength(0);
            })
        );
    });

    // Property B: a reference before the setter warns exactly once (forward-only).
    it('Property B: reference before the setter warns (forward-only)', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `display \`${name}'\nmata: st_local("${name}", "1")`;
                const diags = undefined_macro_diagnostics(code);
                expect(diags).toHaveLength(1);
                expect(diags[0].symbol_name).toBe(name);
            })
        );
    });

    // Property C: the one-argument read form never declares the macro.
    it('Property C: one-argument read form does not declare', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `mata: st_local("${name}")\ndisplay \`${name}'`;
                const diags = undefined_macro_diagnostics(code);
                expect(diags).toHaveLength(1);
                expect(diags[0].symbol_name).toBe(name);
            })
        );
    });

    // Property D: st_global setter suppresses the global reference warning.
    it('Property D: st_global setter declares a global', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `mata: st_global("${name}", "1")\ndisplay $${name}`;
                expect(undefined_macro_diagnostics(code)).toHaveLength(0);
            })
        );
    });

    // Property E: a setter before a later Stata definition is the effective
    // first definition for references between the two definitions.
    it('Property E: setter keeps source-order precedence over later local', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `mata: st_local("${name}", "1")\ndisplay \`${name}'\nlocal ${name} 2`;
                expect(undefined_macro_diagnostics(code)).toHaveLength(0);
            })
        );
    });

    // Property F: continuation trivia inside the argument list does not hide
    // the setter comma.
    it('Property F: continued setter argument list declares the local', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `mata: st_local("${name}" ///\n, "1")\ndisplay \`${name}'`;
                expect(undefined_macro_diagnostics(code)).toHaveLength(0);
            })
        );
    });

    // Property G: same physical line is not enough; under `#delimit ;`, a
    // reference before a later setter remains a forward reference.
    it('Property G: same-line reference before setter warns', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), name => {
                const code = `#delimit ;\ndisplay \`${name}' ; mata: st_local("${name}", "1") ;`;
                const diags = undefined_macro_diagnostics(code);
                expect(diags).toHaveLength(1);
                expect(diags[0].symbol_name).toBe(name);
            })
        );
    });
});
