/**
 * Property Tests: Formatter Continuation Lines Don't Affect Block Depth
 *
 * Feature: formatter-tabsize-respect
 * Property 3: Continuation Lines Don't Affect Block Depth
 * Validates: Requirements 2.1, 2.4
 *
 * For any block (if, foreach, etc.) where the opening brace appears on a
 * continuation line, the body content SHALL be indented at the correct
 * block depth, not affected by the continuation.
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
 * Generate simple statements for block bodies.
 */
const simple_statement_arb = fc.constantFrom(
    'gen x = 1',
    'display "hello"',
    'local y = 2',
    'replace x = 2',
    'summarize x'
);

/**
 * Generate condition parts for if statements.
 */
const condition_part_arb = fc.constantFrom(
    'a == 1',
    'b > 0',
    'c < 10',
    'x != 0',
    'y >= 5'
);

/**
 * Generate if blocks with continuation lines in the condition.
 * The opening brace appears on a continuation line.
 */
const if_with_continuation_arb = fc.tuple(
    condition_part_arb,
    condition_part_arb,
    simple_statement_arb
).map(([cond1, cond2, stmt]) => ({
    source: `if ${cond1} | ///
   ${cond2} {
${stmt}
}`,
    inner_statement: stmt,
    nesting_depth: 1,
}));

/**
 * Generate nested if blocks where the inner if has continuation lines.
 */
const nested_if_with_continuation_arb = fc.tuple(
    condition_part_arb,
    condition_part_arb,
    condition_part_arb,
    simple_statement_arb
).map(([outer_cond, inner_cond1, inner_cond2, stmt]) => ({
    source: `if ${outer_cond} {
if ${inner_cond1} | ///
   ${inner_cond2} {
${stmt}
}
}`,
    inner_statement: stmt,
    nesting_depth: 2,
}));

/**
 * Generate foreach blocks with continuation lines.
 */
const foreach_with_continuation_arb = fc.tuple(
    simple_statement_arb
).map(([stmt]) => ({
    source: `foreach v of varlist a ///
    b c {
${stmt}
}`,
    inner_statement: stmt,
    nesting_depth: 1,
}));

/**
 * Generate nested blocks with continuation lines at various levels.
 */
const nested_with_continuation_arb = fc.oneof(
    if_with_continuation_arb,
    nested_if_with_continuation_arb,
    foreach_with_continuation_arb
);

describe('Formatter Continuation Lines Block Depth Properties', () => {
    const formatter = new CodeFormatter();

    for_each_formatter_mode_property(
        'Property 3: Continuation lines in condition do not affect body indentation',
        fc.tuple(nested_with_continuation_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { source, inner_statement, nesting_depth } = block_info;

            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);

            const my_edits = formatter.format(my_doc, my_options, my_config);

            if (my_edits.length === 0) return true;

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');

            // Find the innermost statement line
            const stmt_keyword = inner_statement.split(' ')[0];
            const inner_line = my_lines.find(l => l.trimStart().startsWith(stmt_keyword));
            if (!inner_line) return true;  // Skip if statement not found

            // Calculate expected indentation: nesting_depth * tabSize spaces
            const expected_indent = nesting_depth * tab_size;
            const actual_indent = inner_line.length - inner_line.trimStart().length;

            // The body content should be indented at exactly nesting_depth * tabSize spaces
            // regardless of continuation lines in the condition
            expect(actual_indent).toBe(expected_indent);

            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 3b: Opening brace on continuation line - body at correct depth',
        fc.tuple(if_with_continuation_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { source, inner_statement } = block_info;

            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);

            const my_edits = formatter.format(my_doc, my_options, my_config);

            if (my_edits.length === 0) return true;

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');

            // Find the statement line inside the block
            const stmt_keyword = inner_statement.split(' ')[0];
            const inner_line = my_lines.find(l => l.trimStart().startsWith(stmt_keyword));
            if (!inner_line) return true;

            // Body should be at depth 1 (one level inside the if block)
            const expected_indent = 1 * tab_size;
            const actual_indent = inner_line.length - inner_line.trimStart().length;

            expect(actual_indent).toBe(expected_indent);

            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 3c: Nested block with continuation - inner body at correct depth',
        fc.tuple(nested_if_with_continuation_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { source, inner_statement } = block_info;

            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);

            const my_edits = formatter.format(my_doc, my_options, my_config);

            if (my_edits.length === 0) return true;

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');

            // Find the innermost statement
            const stmt_keyword = inner_statement.split(' ')[0];
            const inner_line = my_lines.find(l => l.trimStart().startsWith(stmt_keyword));
            if (!inner_line) return true;

            // Body should be at depth 2 (two levels of nesting)
            const expected_indent = 2 * tab_size;
            const actual_indent = inner_line.length - inner_line.trimStart().length;

            expect(actual_indent).toBe(expected_indent);

            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 3d: Specific case - tabSize 2 with continuation in nested if',
        fc.constant({ tab_size: 2 }),
        (mode: FormatterMode, { tab_size }) => {
            // This is the exact bug reproduction case from requirements 2.1
            const source = `if a {
if b | ///
   c {
replace x = 1
}
}`;

            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);

            const my_edits = formatter.format(my_doc, my_options, my_config);

            if (my_edits.length === 0) return true;

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');

            // Find the replace line (innermost content)
            const replace_line = my_lines.find(l => l.includes('replace'));
            if (!replace_line) return true;

            // Should be at 4 spaces (2 levels × 2 spaces)
            const expected_indent = 2 * tab_size;  // 2 * 2 = 4 spaces
            const actual_indent = replace_line.length - replace_line.trimStart().length;

            expect(actual_indent).toBe(expected_indent);

            return true;
        },
        1  // Only need to run once since it's a constant
    );

    for_each_formatter_mode_property(
        'Property 3e: Closing brace after continuation block at correct depth',
        fc.tuple(if_with_continuation_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { source } = block_info;

            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);

            const my_edits = formatter.format(my_doc, my_options, my_config);

            if (my_edits.length === 0) return true;

            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');

            // Find the closing brace line (should be at depth 0 for single-level block)
            const closing_brace_line = my_lines.find(l => l.trim() === '}');
            if (!closing_brace_line) return true;

            // Closing brace should be at depth 0 (same level as the if statement)
            const expected_indent = 0;
            const actual_indent = closing_brace_line.length - closing_brace_line.trimStart().length;

            expect(actual_indent).toBe(expected_indent);

            return true;
        },
        100
    );
});
