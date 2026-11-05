/**
 * Property Tests: Formatting Keeps Strings and Words Together
 *
 * The lexer splits a string with an embedded macro into string pieces
 * around the macro token, and a word such as `` `p'`i' `` or
 * `` x`i' `` into several tokens. Stata splits arguments at
 * whitespace, so formatting must:
 * - leave the source text of every string with embedded macros
 *   unchanged;
 * - add no space between tokens that touch in the source, and remove
 *   none between separate arguments.
 */

import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from './helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode_property,
    FormatterMode,
} from './helpers/formatter-test-utils';
import {
    arbitrary_macro_name,
    arbitrary_non_reserved_identifier,
} from './generators';

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

/** Format, and check that formatting the result again changes nothing. */
function format_idempotent(source: string, mode: FormatterMode): string {
    const once = format(source, mode);
    expect(format(once, mode)).toBe(once);
    return once;
}

// ============================================================================
// Generators
// ============================================================================

/**
 * Identifiers that read as plain words in any argument position: not a
 * qualifier keyword, and not `of`, which expression spacing treats as
 * a keyword.
 */
const word_identifier_arb = arbitrary_non_reserved_identifier()
    .filter((my_name) => my_name !== 'of');

/** Macro references: local, nested, `=exp', $name, and ${name}. */
const macro_ref_arb: fc.Arbitrary<string> = fc.oneof(
    arbitrary_macro_name().map((my_name) => `\`${my_name}'`),
    fc.tuple(arbitrary_macro_name(), arbitrary_macro_name())
        .map(([my_outer, my_inner]) => `\`${my_outer}\`${my_inner}''`),
    arbitrary_macro_name().map((my_name) => `\`=${my_name}+1'`),
    arbitrary_macro_name().map((my_name) => `$${my_name}`),
    arbitrary_macro_name().map((my_name) => `\${${my_name}}`)
);

/**
 * Text between macros in a string, including the operators and
 * punctuation that expression spacing would pad. Leaves out the
 * characters that end a string or start a macro or comment.
 */
const STRING_TEXT_CHARS = [
    ...'abcXYZ019_ =+-*,.()<>!&|:#%',
];

function string_text_arb(extra_chars: string[]): fc.Arbitrary<string> {
    return fc.array(
        fc.constantFrom(...STRING_TEXT_CHARS, ...extra_chars),
        { minLength: 1, maxLength: 6 }
    ).map((the_chars) => the_chars.join(''));
}

/** String content with at least one embedded macro reference. */
function string_content_arb(extra_chars: string[]): fc.Arbitrary<string> {
    return fc.array(
        fc.oneof(string_text_arb(extra_chars), macro_ref_arb),
        { minLength: 1, maxLength: 6 }
    ).chain((the_pieces) => fc.tuple(
        fc.constant(the_pieces),
        macro_ref_arb,
        fc.nat({ max: the_pieces.length })
    )).map(([the_pieces, my_macro, my_index]) => [
        ...the_pieces.slice(0, my_index),
        my_macro,
        ...the_pieces.slice(my_index),
    ].join(''));
}

/**
 * Strings with embedded macros: "..." strings, and compound strings,
 * which can contain double quotes (Stata has no escape for a quote in
 * a "..." string).
 */
const string_with_macros_arb: fc.Arbitrary<string> = fc.oneof(
    string_content_arb([]).map((my_content) => `"${my_content}"`),
    string_content_arb(['"']).map((my_content) => `\`"${my_content}"'`)
);

/** A word containing a macro, made of touching tokens: `p'`i', x`i'. */
const macro_word_arb: fc.Arbitrary<string> = fc.array(
    fc.oneof(word_identifier_arb, macro_ref_arb),
    { minLength: 0, maxLength: 3 }
).chain((the_atoms) => fc.tuple(
    fc.constant(the_atoms),
    macro_ref_arb,
    fc.nat({ max: the_atoms.length })
)).map(([the_atoms, my_macro, my_index]) => [
    ...the_atoms.slice(0, my_index),
    my_macro,
    ...the_atoms.slice(my_index),
].join(''));

/** A command argument: a word, a string, or both touching. */
const argument_arb: fc.Arbitrary<string> = fc.array(
    fc.oneof(word_identifier_arb, macro_ref_arb, string_with_macros_arb),
    { minLength: 1, maxLength: 3 }
).map((the_atoms) => the_atoms.join(''));

/** Arguments, each with the run of spaces that comes before it. */
const separated_arguments_arb = fc.array(
    fc.tuple(fc.integer({ min: 1, max: 3 }), argument_arb),
    { minLength: 1, maxLength: 4 }
);

// ============================================================================
// Property 1: strings with embedded macros keep their source text
// ============================================================================

/** Statements, already formatted, that contain the string S. */
const STRING_CONTEXTS: Array<(my_string: string) => string> = [
    (s) => `display ${s}\n`,
    (s) => `display x ${s}, nonl\n`,
    (s) => `quietly display ${s}\n`,
    (s) => `mycmd ${s} ${s}\n`,
    (s) => `gen s = ${s}\n`,
    (s) => `assert s == ${s}\n`,
    (s) => `reg y x, title(${s})\n`,
    (s) => `if ${s} == "x" display ${s}\n`,
    (s) => `foreach v in ${s} "c" {\n    display ${s}\n}\n`,
];

describe('Property: strings with embedded macros keep their text', () => {
    for_each_formatter_mode_property(
        'formatting leaves strings with embedded macros unchanged',
        fc.tuple(
            string_with_macros_arb,
            fc.integer({ min: 0, max: STRING_CONTEXTS.length - 1 })
        ),
        (mode, [my_string, my_context_index]) => {
            const source = STRING_CONTEXTS[my_context_index](my_string);
            expect(format_idempotent(source, mode)).toBe(source);
        },
        200
    );
});

// ============================================================================
// Property 2: touching tokens stay touching, separate arguments separate
// ============================================================================

describe('Property: formatting keeps the spaces between arguments', () => {
    for_each_formatter_mode_property(
        'no space is added between touching tokens or removed between arguments',
        separated_arguments_arb,
        (mode, the_arguments) => {
            const source = 'mycmd' + the_arguments
                .map(([my_spaces, my_argument]) =>
                    ' '.repeat(my_spaces) + my_argument)
                .join('') + '\n';
            // AST mode puts one space between arguments; the
            // source-preserving formatter keeps the source's spacing.
            const expected = mode === 'ast'
                ? `mycmd ${the_arguments.map(([, a]) => a).join(' ')}\n`
                : source;
            expect(format_idempotent(source, mode)).toBe(expected);
        },
        200
    );

    for_each_formatter_mode_property(
        'words built from a macro stay whole in expressions and options',
        fc.tuple(macro_word_arb, macro_word_arb, macro_word_arb, macro_word_arb),
        (mode, [my_first, my_second, my_third, my_fourth]) => {
            const source =
                `replace ${my_first} = ${my_second} + ${my_third} ` +
                `if ${my_fourth} == 1\n` +
                `reg ${my_first} ${my_second}, ` +
                `title(${my_third} ${my_fourth})\n`;
            expect(format_idempotent(source, mode)).toBe(source);
        },
        200
    );
});
