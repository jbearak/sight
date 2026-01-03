/**
 * Property Tests: Formatter TabSize Indentation Depth Correctness
 *
 * Feature: formatter-tabsize-respect
 * Property 1: Indentation Depth Correctness
 * Validates: Requirements 1.2, 2.2, 2.3
 *
 * For any valid tabSize (1-8) and any nesting depth, the formatter SHALL
 * indent content at exactly `depth * tabSize` spaces.
 */

import { describe, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
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
 * Generate a simple statement that can be used inside blocks.
 */
const simple_statement_arb = fc.constantFrom(
    'gen x = 1',
    'display "hello"',
    'local y = 2',
    'replace x = 2',
    'summarize x'
);

/**
 * Generate nested if blocks with a specified depth.
 * Each level wraps the inner content in an if block.
 */
function generate_nested_blocks(depth: number, inner_statement: string): string {
    if (depth === 0) {
        return inner_statement;
    }
    const inner = generate_nested_blocks(depth - 1, inner_statement);
    const inner_lines = inner.split('\n');
    const indented_inner = inner_lines.join('\n');
    return `if a {\n${indented_inner}\n}`;
}

/**
 * Arbitrary for generating nested block structures with varying depths.
 */
const nested_blocks_arb = fc.tuple(
    fc.integer({ min: 1, max: 4 }),  // nesting depth (1-4 levels)
    simple_statement_arb
).map(([depth, stmt]) => ({
    depth,
    source: generate_nested_blocks(depth, stmt),
    inner_statement: stmt,
}));

/**
 * Arbitrary for valid tabSize values (1-8).
 */
const tab_size_arb = fc.integer({ min: 1, max: 8 });

describe('Formatter TabSize Indentation Depth Properties', () => {
    const formatter = new CodeFormatter();

    for_each_formatter_mode_property(
        'Property 1: Indentation Depth Correctness - depth * tabSize spaces',
        fc.tuple(nested_blocks_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { depth, source, inner_statement } = block_info;
            
            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);
            
            const my_edits = formatter.format(my_doc, my_options, my_config);
            
            if (my_edits.length === 0) return true;
            
            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');
            
            // Find the innermost statement line
            const inner_line = my_lines.find(l => l.includes(inner_statement.split(' ')[0]));
            if (!inner_line) return true;  // Skip if statement not found
            
            // Calculate expected indentation: depth levels * tabSize spaces
            const expected_indent = depth * tab_size;
            const actual_indent = inner_line.length - inner_line.trimStart().length;
            
            // The innermost content should be indented at exactly depth * tabSize spaces
            expect(actual_indent).toBe(expected_indent);
            
            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 1b: Closing braces at correct depth',
        fc.tuple(nested_blocks_arb, tab_size_arb),
        (mode: FormatterMode, [block_info, tab_size]) => {
            const { depth, source } = block_info;
            
            const my_config = create_formatter_config(mode);
            const my_options: FormattingOptions = { tabSize: tab_size, insertSpaces: true };
            const my_doc = create_document_state(source);
            
            const my_edits = formatter.format(my_doc, my_options, my_config);
            
            if (my_edits.length === 0) return true;
            
            const my_formatted = my_edits[0].newText;
            const my_lines = my_formatted.split('\n');
            
            // Find all closing brace lines and verify their indentation
            // Track depth by counting opening and closing braces
            let current_depth = 0;
            for (const my_line of my_lines) {
                const trimmed = my_line.trim();
                
                // Opening brace increases depth after the line
                if (trimmed.endsWith('{')) {
                    current_depth++;
                }
                // Closing brace should be at current_depth - 1
                else if (trimmed === '}') {
                    current_depth--;
                    const expected_indent = current_depth * tab_size;
                    const actual_indent = my_line.length - my_line.trimStart().length;
                    
                    // Closing brace should be at its block's depth
                    expect(actual_indent).toBe(expected_indent);
                }
            }
            
            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'Property 1c: Two levels deep with tabSize 2 gives 4 spaces',
        fc.constant({ depth: 2, tab_size: 2 }),
        (mode: FormatterMode, { depth, tab_size }) => {
            const source = `if a {
if b {
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
            
            const expected_indent = depth * tab_size;  // 2 * 2 = 4 spaces
            const actual_indent = replace_line.length - replace_line.trimStart().length;
            
            expect(actual_indent).toBe(expected_indent);
            
            return true;
        },
        1  // Only need to run once since it's a constant
    );

    for_each_formatter_mode_property(
        'Property 1d: Two levels deep with tabSize 4 gives 8 spaces',
        fc.constant({ depth: 2, tab_size: 4 }),
        (mode: FormatterMode, { depth, tab_size }) => {
            const source = `if a {
if b {
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
            
            const expected_indent = depth * tab_size;  // 2 * 4 = 8 spaces
            const actual_indent = replace_line.length - replace_line.trimStart().length;
            
            expect(actual_indent).toBe(expected_indent);
            
            return true;
        },
        1  // Only need to run once since it's a constant
    );
});
