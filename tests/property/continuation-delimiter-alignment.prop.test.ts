/**
 * Property Tests: Continuation Delimiter Alignment
 *
 * Tests tab expansion properties for visual column preservation.
 * Feature: continuation-delimiter-alignment
 *
 * These tests verify that the formatter correctly expands tabs to spaces
 * while preserving visual column alignment in spacing between tokens.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

function create_document_state(source: string): DocumentState {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    const parser = new StataParser();
    const parse_result = parser.parse(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: new Map(),
        diagnostics: [],
    };
}

function create_config() {
    return {
        ...DEFAULT_SETTINGS,
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            mode: 'source-preserving' as const,
            preserve_alignment: false, // Don't preserve alignment so tabs get converted
        },
    };
}

/**
 * Calculate the visual column of a string, accounting for tab stops.
 * This is the reference implementation for testing.
 *
 * @param str - The string to measure
 * @param start_column - Starting column position
 * @param tab_width - Tab stop interval
 * @returns The ending visual column
 */
function calculate_visual_column(str: string, start_column: number, tab_width: number): number {
    let visual_column = start_column;
    for (const my_char of str) {
        if (my_char === '\t') {
            // Tab expands to next tab stop
            visual_column = Math.ceil((visual_column + 1) / tab_width) * tab_width;
        } else {
            visual_column += 1;
        }
    }
    return visual_column;
}

/**
 * Calculate the visual width of a spacing string (tabs + spaces).
 */
function calculate_visual_width(spacing: string, start_column: number, tab_width: number): number {
    return calculate_visual_column(spacing, start_column, tab_width) - start_column;
}

describe('Continuation Delimiter Alignment Properties', () => {
    const formatter = new CodeFormatter();

    /**
     * Property 1: Visual Column Preservation
     *
     * For any string containing tabs (with or without spaces), and for any
     * starting column, converting tabs to spaces should produce a string of
     * spaces that, when rendered, ends at the same visual column as the
     * original string with tabs.
     *
     * We test this by creating Stata code with tabs between tokens on the same
     * line, formatting it, and verifying the visual column of the second token
     * is preserved.
     *
     * Feature: continuation-delimiter-alignment, Property 1: Visual Column Preservation
     * Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2
     */
    it('Property 1: Visual column is preserved when converting tabs to spaces', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    // Generate a variable name for the first token
                    var_name: fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/),
                    // Generate spacing with tabs between tokens
                    tab_count: fc.integer({ min: 1, max: 3 }),
                    space_count: fc.integer({ min: 0, max: 4 }),
                }),
                async (data) => {
                    const tab_width = 4;
                    // Create spacing with tabs and spaces
                    const spacing = '\t'.repeat(data.tab_count) + ' '.repeat(data.space_count);

                    // Create source: "gen varname<tabs/spaces>= 1"
                    // The tabs are between the variable name and the equals sign
                    const my_source = `gen ${data.var_name}${spacing}= 1`;

                    // Calculate the starting column of the spacing
                    // "gen " is 4 characters, then the variable name
                    const spacing_start_col = 4 + data.var_name.length;

                    // Calculate expected visual column of "=" in original
                    const expected_equals_col = calculate_visual_column(
                        spacing,
                        spacing_start_col,
                        tab_width
                    );

                    const my_doc = create_document_state(my_source);
                    const my_config = create_config();
                    const options: FormattingOptions = { tabSize: tab_width, insertSpaces: true };
                    const my_result = await formatter.format(my_doc, options, my_config);

                    const formatted = my_result[0].newText;

                    // In the formatted output, find the position of "="
                    // Since tabs are converted to spaces, the character position equals visual column
                    const equals_idx = formatted.indexOf('=');
                    if (equals_idx === -1) return false;

                    // The visual column should be preserved
                    return equals_idx === expected_equals_col;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Tab Stop Configuration Respect
     *
     * For any tab width configuration and for any string containing tabs,
     * the tab expansion should use the configured tab width as the tab stop
     * interval. Different tab widths should produce different space counts
     * when the starting column is not aligned to both tab stops.
     *
     * Feature: continuation-delimiter-alignment, Property 2: Tab Stop Configuration Respect
     * Validates: Requirements 2.1
     */
    it('Property 2: Tab expansion respects configured tab width', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    // Generate a variable name that creates different alignments for different tab widths
                    var_len: fc.integer({ min: 1, max: 6 }),
                }),
                async (data) => {
                    const tab_width_4 = 4;
                    const tab_width_8 = 8;

                    // Create a variable name of specific length
                    const var_name = 'x'.repeat(data.var_len);

                    // Create source with a single tab between variable and equals
                    const my_source = `gen ${var_name}\t= 1`;

                    // Calculate the starting column of the tab
                    // "gen " is 4 characters, then the variable name
                    const tab_start_col = 4 + data.var_len;

                    // Calculate expected visual columns for different tab widths
                    const expected_col_4 = calculate_visual_column('\t', tab_start_col, tab_width_4);
                    const expected_col_8 = calculate_visual_column('\t', tab_start_col, tab_width_8);

                    // Format with tab_width=4
                    const my_doc_4 = create_document_state(my_source);
                    const my_config_4 = create_config();
                    const options_4: FormattingOptions = { tabSize: tab_width_4, insertSpaces: true };
                    const my_result_4 = await formatter.format(my_doc_4, options_4, my_config_4);
                    const formatted_4 = my_result_4[0].newText;

                    // Format with tab_width=8
                    const my_doc_8 = create_document_state(my_source);
                    const my_config_8 = create_config();
                    const options_8: FormattingOptions = { tabSize: tab_width_8, insertSpaces: true };
                    const my_result_8 = await formatter.format(my_doc_8, options_8, my_config_8);
                    const formatted_8 = my_result_8[0].newText;

                    // Find the position of "=" in both formatted outputs
                    const equals_idx_4 = formatted_4.indexOf('=');
                    const equals_idx_8 = formatted_8.indexOf('=');

                    if (equals_idx_4 === -1 || equals_idx_8 === -1) return false;

                    // Verify each formatter used the correct tab width
                    const correct_4 = equals_idx_4 === expected_col_4;
                    const correct_8 = equals_idx_8 === expected_col_8;

                    return correct_4 && correct_8;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Continuation line tab expansion uses correct output column
     *
     * When a continuation line has leading tab indentation that gets converted
     * to spaces, the tab expansion for spacing AFTER the first token must use
     * the actual output column (after space conversion), not the original
     * source column.
     *
     * This tests the bug where tabs between tokens on continuation lines
     * were expanded using the wrong starting column.
     *
     * Feature: continuation-delimiter-alignment, Property 3: Output Column Tracking
     * Validates: Requirements 1.2, 1.3, 3.1
     */
    it('Property 3: Continuation line tab expansion uses correct output column', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    // Generate content length to vary the position of the tab
                    content_len: fc.integer({ min: 1, max: 10 }),
                    // Number of tabs between content and marker
                    tab_count: fc.integer({ min: 1, max: 5 }),
                }),
                async (data) => {
                    const tab_width = 4;
                    const content = 'x'.repeat(data.content_len);
                    const tabs = '\t'.repeat(data.tab_count);

                    // Create a continuation line with:
                    // - Leading tab (indentation)
                    // - Content
                    // - Tabs (spacing to align marker)
                    // - Marker (///)
                    const my_source = `display "test" ///\n\t${content}${tabs}///`;

                    // Calculate expected visual column of /// on line 2:
                    // - Leading tab expands from col 0 to col 4 (with tab_width=4)
                    // - Content adds content_len characters
                    // - Tabs expand from that position
                    const after_indent = tab_width; // Leading tab expands to tab_width
                    const after_content = after_indent + data.content_len;
                    const expected_marker_col = calculate_visual_column(
                        tabs,
                        after_content,
                        tab_width
                    );

                    const my_doc = create_document_state(my_source);
                    const my_config = create_config();
                    const options: FormattingOptions = { tabSize: tab_width, insertSpaces: true };
                    const my_result = await formatter.format(my_doc, options, my_config);
                    const formatted = my_result[0].newText;

                    // Find the position of /// on the second line
                    const the_lines = formatted.split('\n');
                    if (the_lines.length < 2) return false;

                    const line2 = the_lines[1];
                    const marker_idx = line2.indexOf('///');
                    if (marker_idx === -1) return false;

                    // The marker should be at the expected visual column
                    // Since we converted to spaces, character position = visual column
                    if (marker_idx !== expected_marker_col) {
                        console.log(`FAIL: content_len=${data.content_len}, tab_count=${data.tab_count}`);
                        console.log(`  Source line 2: "\\t${content}${tabs}///"`);
                        console.log(`  Formatted line 2: "${line2}"`);
                        console.log(`  Expected marker at col ${expected_marker_col}, got ${marker_idx}`);
                        return false;
                    }
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
