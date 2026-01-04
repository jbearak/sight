/**
 * Property Tests: Formatter Idempotency
 *
 * Feature: formatter-tabsize-respect
 * Property 2: Formatting Idempotency
 * Validates: Requirements 1.3
 *
 * For any valid tabSize (1-8) and any valid Stata source code, formatting
 * the output of formatting SHALL produce identical output:
 * format(format(source)) == format(source)
 */

import { describe, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { FormattingOptions } from 'vscode-languageserver';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';

function create_document_state(source: string): DocumentState {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    const parser = new StataParser();
    const parse_result = parser.parse(lex_result.tokens);
    const context_tracker = new ContextTracker();
    context_tracker.initialize_from_tokens(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: {
            localMacros: new Map(),
            globalMacros: new Map(),
            programs: new Map(),
            scalars: new Map(),
            matrices: new Map(),
            variables: new Map(),
        },
        diagnostics: [],
        context_ranges: [],
        context_tracker,
        forward_calls: [],
    };
}

/**
 * Arbitrary for valid tabSize values (1-8).
 */
const tab_size_arb = fc.integer({ min: 1, max: 8 });

/**
 * Generate simple Stata statements.
 */
const simple_statement_arb = fc.constantFrom(
    'gen x = 1',
    'display "hello"',
    'local y = 2',
    'replace x = 2',
    'summarize x',
    'regress y x',
    'drop x',
    'keep if x > 0'
);

/**
 * Generate nested if blocks with a specified depth.
 */
function generate_nested_blocks(depth: number, inner_statement: string): string {
    if (depth === 0) {
        return inner_statement;
    }
    const inner = generate_nested_blocks(depth - 1, inner_statement);
    return `if a {\n${inner}\n}`;
}

/**
 * Arbitrary for generating nested block structures.
 */
const nested_blocks_arb = fc.tuple(
    fc.integer({ min: 0, max: 3 }),  // nesting depth (0-3 levels)
    simple_statement_arb
).map(([depth, stmt]) => generate_nested_blocks(depth, stmt));

/**
 * Arbitrary for generating code with continuation lines.
 */
const continuation_code_arb = fc.constantFrom(
    'gen x = 1 + 2 + 3',
    `gen x = 1 ///
    + 2`,
    `if a == 1 ///
    & b == 2 {
display "yes"
}`,
    `foreach v of varlist a b c {
replace \`v' = 0
}`
);

/**
 * Arbitrary for generating various Stata code patterns.
 */
const stata_code_arb = fc.oneof(
    simple_statement_arb,
    nested_blocks_arb,
    continuation_code_arb
);

describe('Formatter Idempotency Properties', () => {
    const formatter = new CodeFormatter();

    for_each_formatter_mode_property(
        'Property 2: Formatting Idempotency - format(format(x)) == format(x)',
        fc.tuple(stata_code_arb, tab_size_arb),
        (mode: FormatterMode, [source, tab_size]) => {
            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };

            // First formatting pass
            const my_doc1 = create_document_state(source);
            const my_edits1 = formatter.format(my_doc1, my_options, my_config);

            // If no edits, the source is already formatted - idempotency trivially holds
            if (my_edits1.length === 0) {
                return true;
            }

            const my_formatted_once = my_edits1[0].newText;

            // Second formatting pass on the already-formatted output
            const my_doc2 = create_document_state(my_formatted_once);
            const my_edits2 = formatter.format(my_doc2, my_options, my_config);

            // If no edits on second pass, the formatted output is stable
            if (my_edits2.length === 0) {
                return true;
            }

            const my_formatted_twice = my_edits2[0].newText;

            // Idempotency: formatting twice should equal formatting once
            expect(my_formatted_twice).toBe(my_formatted_once);

            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 2b: Idempotency with various tabSize values',
        fc.tuple(
            fc.constantFrom(1, 2, 4, 8),  // Common tabSize values
            nested_blocks_arb
        ),
        (mode: FormatterMode, [tab_size, source]) => {
            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };

            // First formatting pass
            const my_doc1 = create_document_state(source);
            const my_edits1 = formatter.format(my_doc1, my_options, my_config);

            if (my_edits1.length === 0) {
                return true;
            }

            const my_formatted_once = my_edits1[0].newText;

            // Second formatting pass
            const my_doc2 = create_document_state(my_formatted_once);
            const my_edits2 = formatter.format(my_doc2, my_options, my_config);

            if (my_edits2.length === 0) {
                return true;
            }

            const my_formatted_twice = my_edits2[0].newText;

            expect(my_formatted_twice).toBe(my_formatted_once);

            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 2c: Idempotency with continuation lines',
        fc.tuple(continuation_code_arb, tab_size_arb),
        (mode: FormatterMode, [source, tab_size]) => {
            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };

            // First formatting pass
            const my_doc1 = create_document_state(source);
            const my_edits1 = formatter.format(my_doc1, my_options, my_config);

            if (my_edits1.length === 0) {
                return true;
            }

            const my_formatted_once = my_edits1[0].newText;

            // Second formatting pass
            const my_doc2 = create_document_state(my_formatted_once);
            const my_edits2 = formatter.format(my_doc2, my_options, my_config);

            if (my_edits2.length === 0) {
                return true;
            }

            const my_formatted_twice = my_edits2[0].newText;

            expect(my_formatted_twice).toBe(my_formatted_once);

            return true;
        },
        100
    );
});
