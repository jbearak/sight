// Feature: global-macro-execution-order, Property 6: Symbol Name Extraction Round-Trip
// Validates: Requirements 2.3, 2.4
//
// The provider recovers an undefined symbol's name and reference kind from the
// structured data the analyzer attaches (symbol_name / reference_kind), NOT by
// parsing the human-facing message prose. These properties pin that contract:
// for any macro name N, analyzing an undefined local (`N') or global ($N)
// reference yields a diagnostic whose symbol_name === N and reference_kind is
// 'local'/'global' — regardless of the message wording. See docs/superpowers/
// specs/2026-06-26-diagnostic-message-code-deduplication.md.

import * as fc from 'fast-check';
import { describe, it, beforeEach } from 'bun:test';
import { arbitrary_macro_name } from './generators/primitives';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Symbol Name Extraction Round-Trip Properties', () => {
    let analyzer: SemanticAnalyzer;
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        analyzer = new SemanticAnalyzer();
        lexer = new StataLexer();
        parser = new StataParser();
    });

    function analyze_document(my_source: string) {
        const my_lex_result = lexer.tokenize(my_source);
        const my_parse_result = parser.parse(my_lex_result.tokens);
        return analyzer.analyze(
            my_parse_result.ast,
            'file:///test.do',
            undefined,
            { undefined_macro_enabled: true },
            my_lex_result.tokens
        );
    }

    // Return the single UNDEFINED_MACRO diagnostic, or null if not exactly one.
    function single_undefined_macro(my_source: string) {
        const my_result = analyze_document(my_source);
        const the_errors = my_result.diagnostics.filter(
            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
        );
        return the_errors.length === 1 ? the_errors[0] : null;
    }

    /**
     * Property 6: Symbol Name Extraction Round-Trip
     *
     * For any valid macro name N, an undefined local (`N') or global ($N)
     * reference SHALL produce a diagnostic carrying symbol_name === N and the
     * matching reference_kind, sourced from structured data rather than prose.
     */
    describe('Property 6: Symbol Name Extraction Round-Trip', () => {
        it('attaches local macro name and kind to the diagnostic data', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    (macro_name) => {
                        const my_diag = single_undefined_macro(
                            `display \`${macro_name}'`
                        );
                        return !!my_diag
                            && my_diag.symbol_name === macro_name
                            && my_diag.reference_kind === 'local';
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('attaches global macro name and kind to the diagnostic data', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    (macro_name) => {
                        const my_diag = single_undefined_macro(
                            `display \${${macro_name}}`
                        );
                        return !!my_diag
                            && my_diag.symbol_name === macro_name
                            && my_diag.reference_kind === 'global';
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('round-trips the name independent of message wording', () => {
            // The guarantee is structural: the symbol_name matches the source
            // macro even though the message text no longer contains the words
            // "undefined" or "macro". We assert the name is present in the data
            // and (separately) that the message is the reworded form, proving
            // the data is the authoritative carrier.
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const my_source = use_local_format
                            ? `display \`${macro_name}'`
                            : `display \${${macro_name}}`;
                        const my_diag = single_undefined_macro(my_source);
                        if (!my_diag) return false;

                        const expected_kind = use_local_format
                            ? 'local'
                            : 'global';
                        const expected_message = use_local_format
                            ? `\`${macro_name}' is not defined`
                            : `$${macro_name} is not defined`;

                        return my_diag.symbol_name === macro_name
                            && my_diag.reference_kind === expected_kind
                            && my_diag.message === expected_message;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('round-trips names with underscores', () => {
            const name_with_underscore_gen = fc.tuple(
                fc.constantFrom('_', 'a', 'A'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,10}$/),
                fc.constant('_'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,10}$/)
            ).map(([first, middle, underscore, rest]) =>
                first + middle + underscore + rest
            ).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s.length > 0);

            fc.assert(
                fc.property(
                    name_with_underscore_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const my_diag = single_undefined_macro(
                            use_local_format
                                ? `display \`${macro_name}'`
                                : `display \${${macro_name}}`
                        );
                        return !!my_diag && my_diag.symbol_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('round-trips names starting with underscore', () => {
            const underscore_start_gen = fc.tuple(
                fc.constant('_'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,15}$/)
            ).map(([underscore, rest]) => underscore + rest)
             .filter(s => s.length > 0);

            fc.assert(
                fc.property(
                    underscore_start_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const my_diag = single_undefined_macro(
                            use_local_format
                                ? `display \`${macro_name}'`
                                : `display \${${macro_name}}`
                        );
                        return !!my_diag && my_diag.symbol_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('round-trips single character names', () => {
            const single_char_gen = fc.constantFrom(
                'a', 'b', 'c', 'x', 'y', 'z',
                'A', 'B', 'C', 'X', 'Y', 'Z',
                '_'
            );

            fc.assert(
                fc.property(
                    single_char_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const my_diag = single_undefined_macro(
                            use_local_format
                                ? `display \`${macro_name}'`
                                : `display \${${macro_name}}`
                        );
                        return !!my_diag && my_diag.symbol_name === macro_name;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('round-trips names with digits', () => {
            const name_with_digits_gen = fc.tuple(
                fc.constantFrom('a', 'b', 'c', '_', 'A', 'B', 'C'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,5}$/),
                fc.stringMatching(/^[0-9]{1,3}$/),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,5}$/)
            ).map(([first, middle, digits, rest]) =>
                first + middle + digits + rest
            ).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));

            fc.assert(
                fc.property(
                    name_with_digits_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const my_diag = single_undefined_macro(
                            use_local_format
                                ? `display \`${macro_name}'`
                                : `display \${${macro_name}}`
                        );
                        return !!my_diag && my_diag.symbol_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
