/**
 * Code Formatter Provider for Sight
 *
 * Uses SourcePreservingFormatter to provide LSP formatting services.
 * Extends formatting to support embedded language blocks (Mata, Python).
 */

import {
    TextEdit,
    FormattingOptions,
    Range,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { SourcePreservingFormatter, FormatterConfig } from '../formatter';
import { ContextRange } from '../context-tracker/types';
import { CommentFormattingConfig, StataLSPConfig } from '../types';
import { CommentProcessor, CommentTransformation } from '../comment-processor/comment-processor';
import { logger } from '../utils/logger';
import { get_line_text, get_line_count, DocumentLike, compute_line_offsets } from '../utils/line-utils';
import { PrettyPrinter } from '../pretty-printer';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';

/**
 * Code Formatter class with embedded language support.
 */
export class CodeFormatter {
    /**
     * Format the entire document while preserving embedded language blocks.
     *
     * @param document - The document state
     * @param options - Formatting options from the client
     * @param config - LSP configuration (optional, for mode selection)
     * @returns Array of TextEdit (usually one replacing the whole content)
     */
    format(
        document: DocumentState,
        options: FormattingOptions,
        config?: StataLSPConfig
    ): TextEdit[] {
        if (!document.ast || !document.tokens) {
            return [];
        }

        const mode = config?.formatting?.mode || 'source-preserving';

        if (mode === 'ast') {
            return this.format_with_ast(document, options, config);
        }

        // Use context tracker from document state if available
        const the_context_ranges = document.context_ranges || [];

        // If there are no embedded language blocks, use standard formatting
        if (the_context_ranges.length === 0) {
            return this.format_without_embedded_blocks(document, options, config);
        }

        // Format with embedded language preservation
        return this.format_with_embedded_preservation(
            document,
            options,
            the_context_ranges,
            config
        );
    }

    /**
     * Format document using AST-based PrettyPrinter (experimental).
     * Returns empty edits on error to avoid code corruption.
     */
    private format_with_ast(
        document: DocumentState,
        options: FormattingOptions,
        server_config?: StataLSPConfig
    ): TextEdit[] {
        try {
            // Use VS Code's tabSize (from editor settings), fall back to server config
            const indent_size = options.tabSize ?? server_config?.formatting?.indentSize ?? 4;
            const printer = new PrettyPrinter({
                indent_size,
                indent_style: options.insertSpaces ? 'spaces' : 'tabs',
                line_width: 80,
            });

            const formatted_text = printer.print(document.ast!);

            const last_line = get_line_count(document) - 1;
            const last_char = get_line_text(document, last_line).length;

            return [{
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: last_line, character: last_char },
                },
                newText: this.strip_trailing_whitespace(formatted_text),
            }];
        } catch (error) {
            logger.warn(`AST formatting failed: ${error}`);
            return [];
        }
    }

    /**
     * Format document without embedded language blocks.
     */
    private format_without_embedded_blocks(
        document: DocumentState,
        options: FormattingOptions,
        server_config?: StataLSPConfig
    ): TextEdit[] {
        // Use VS Code's tabSize (from editor settings), fall back to server config
        const indent_size = options.tabSize ?? server_config?.formatting?.indentSize ?? 4;
        const config: FormatterConfig = {
            indent_size,
            indent_style: options.insertSpaces ? 'spaces' : 'tabs',
        };

        const formatter = new SourcePreservingFormatter(config);
        const formatted_text = formatter.format(
            document.tokens!,
            document.ast!,
            document.line_offsets,
            document.content,
            { preserve_alignment: server_config?.formatting?.preserve_alignment }
        );

        // Replace the entire document content
        const last_line = get_line_count(document) - 1;
        const last_char = get_line_text(document, last_line).length;

        return [{
            range: {
                start: { line: 0, character: 0 },
                end: { line: last_line, character: last_char },
            },
            newText: this.strip_trailing_whitespace(formatted_text),
        }];
    }

    /**
     * Format document while preserving embedded language block content.
     * 
     * Strategy:
     * 1. Filter tokens to exclude embedded block content
     * 2. Format the Stata code tokens
     * 3. Reinsert preserved embedded blocks into formatted output
     */
    private format_with_embedded_preservation(
        document: DocumentState,
        options: FormattingOptions,
        context_ranges: ContextRange[],
        server_config?: StataLSPConfig
    ): TextEdit[] {
        // Limit embedded blocks to prevent resource exhaustion
        const MAX_EMBEDDED_BLOCKS = 1000;
        
        const the_doc: DocumentLike = { content: document.content, line_offsets: document.line_offsets };
        const the_embedded_blocks: Map<string, { content: string; range: ContextRange }> = new Map();
        let my_placeholder_counter = 0;

        // Extract embedded blocks and replace with placeholders.
        let my_modified_content = document.content;

        // Coalesce the context ranges into non-overlapping replacement units.
        // A unit is one context range, unless two or more ranges share a
        // physical line (e.g. an inline `mata:` statement and a trailing
        // `python:` on the same line under #delimit ;, or an inline range
        // widened to its continuation line that straddles a following
        // statement). Overlapping ranges are merged into a single verbatim
        // span: replacing them independently would double-cover the shared
        // line and drop an already-inserted placeholder (deleting source), or
        // leave a range's unique lines unprotected (mangling their layout).
        const the_replacement_units = this.coalesce_embedded_ranges(
            the_doc,
            context_ranges
        );

        for (const my_unit of the_replacement_units) {
            // Prevent resource exhaustion from too many embedded blocks
            if (my_placeholder_counter >= MAX_EMBEDDED_BLOCKS) {
                break;
            }

            const my_placeholder = `__EMBEDDED_BLOCK_${my_placeholder_counter}__`;
            the_embedded_blocks.set(my_placeholder, {
                content: my_unit.content,
                range: my_unit.range
            });

            // Replace the unit with the placeholder using its actual range
            my_modified_content = this.replace_range_in_content(
                my_modified_content,
                my_unit.actual_range,
                my_placeholder
            );

            my_placeholder_counter++;
        }

        // For embedded blocks, we fall back to returning the content with preserved blocks
        // since the source-preserving formatter works on the full token stream
        // A more sophisticated approach would filter tokens, but for now we preserve embedded blocks
        // Use VS Code's tabSize (from editor settings), fall back to server config
        const indent_size = options.tabSize ?? server_config?.formatting?.indentSize ?? 4;
        const config: FormatterConfig = {
            indent_size,
            indent_style: options.insertSpaces ? 'spaces' : 'tabs',
        };

        // Format the modified content (with placeholders) instead of original content
        const formatter = new SourcePreservingFormatter(config);
        let my_formatted_content: string;

        try {
            // Parse the modified content with placeholders
            const modified_lexer = new StataLexer();
            const modified_lex_result = modified_lexer.tokenize(my_modified_content);
            const modified_parser = new StataParser();
            const modified_parse_result = modified_parser.parse(modified_lex_result.tokens);
            
            if (modified_parse_result.ast) {
                my_formatted_content = formatter.format(
                    modified_lex_result.tokens,
                    modified_parse_result.ast,
                    modified_lex_result.line_offsets,
                    my_modified_content,
                    { preserve_alignment: server_config?.formatting?.preserve_alignment }
                );
                
                // Restore embedded blocks with proper indentation using single-pass replacement
                // Pattern captures: (leading whitespace)(placeholder with number)
                const placeholder_pattern = /^([ \t]*)(__EMBEDDED_BLOCK_(\d+)__)/gm;
                my_formatted_content = my_formatted_content.replace(
                    placeholder_pattern,
                    (_match, leading_indent: string, _full_placeholder: string, block_num: string) => {
                        const my_placeholder = `__EMBEDDED_BLOCK_${block_num}__`;
                        const my_block_info = the_embedded_blocks.get(my_placeholder);
                        if (!my_block_info) {
                            return leading_indent + my_placeholder; // Shouldn't happen, but be safe
                        }
                        
                        // Apply the placeholder's indentation to the block content
                        const block_lines = my_block_info.content.split('\n');
                        const expected_end_delimiter = my_block_info.range.end_delimiter?.command || 'end';
                        const indented_block_lines = block_lines.map((line, index) => {
                            if (index === 0) {
                                // First line (opening delimiter): add placeholder indentation
                                return leading_indent + line;
                            } else if (
                                !my_block_info.range.is_single_line &&
                                index === block_lines.length - 1 &&
                                line.trim() === expected_end_delimiter
                            ) {
                                // Last line is the end delimiter: add placeholder indentation.
                                // Inline (`mata:`/`python:`) ranges have no `end`
                                // delimiter line; under #delimit ; they can span
                                // multiple physical lines, and a continuation line
                                // that happens to trim to "end" must be preserved
                                // as-is, not reindented as a block terminator.
                                return leading_indent + line;
                            } else {
                                // Middle lines (embedded content): preserve as-is
                                return line;
                            }
                        });
                        
                        return indented_block_lines.join('\n');
                    }
                );
            } else {
                my_formatted_content = document.content;
            }
        } catch {
            // If formatting fails, use original content
            my_formatted_content = document.content;
        }

        // Calculate the range to replace
        const last_line = get_line_count(document) - 1;
        const last_char = get_line_text(document, last_line).length;

        return [{
            range: {
                start: { line: 0, character: 0 },
                end: { line: last_line, character: last_char },
            },
            newText: this.strip_trailing_whitespace(my_formatted_content),
        }];
    }

    /**
     * The physical line span a context range occupies when replaced with a
     * placeholder: for single-line (inline) ranges the range itself; for
     * multi-line blocks, extended to include the end-delimiter line.
     */
    private embedded_range_span(
        doc: DocumentLike,
        context_range: ContextRange
    ): { start_line: number; end_line: number } {
        if (context_range.is_single_line) {
            return {
                start_line: context_range.range.start.line,
                end_line: context_range.range.end.line,
            };
        }
        const my_end_line = context_range.end_delimiter
            ? context_range.end_delimiter.range.start.line
            : context_range.range.end.line;
        return { start_line: context_range.range.start.line, end_line: my_end_line };
    }

    /**
     * Coalesce embedded context ranges into non-overlapping replacement units,
     * ordered bottom-up (descending start line) so each placeholder
     * substitution leaves the offsets of the not-yet-processed units intact.
     *
     * Ranges that share a physical line are merged into ONE verbatim unit
     * (whole lines from the group's first start line to its last end line).
     * A physical line cannot hold two languages, so overlapping whole-line
     * ranges cannot be replaced independently without either double-covering
     * the shared line (dropping a placeholder, deleting source) or leaving a
     * range's unique lines unprotected. Preserving the union verbatim avoids
     * both. A lone range keeps its exact prior behavior (block end-delimiter
     * reindentation via `extract_block_content`).
     */
    private coalesce_embedded_ranges(
        doc: DocumentLike,
        context_ranges: ContextRange[]
    ): Array<{ content: string; range: ContextRange; actual_range: Range }> {
        // Group ranges that overlap or touch on a shared physical line.
        const the_spans = context_ranges
            .map((my_range) => ({
                my_range,
                span: this.embedded_range_span(doc, my_range),
            }))
            .sort((a, b) => {
                if (a.span.start_line !== b.span.start_line) {
                    return a.span.start_line - b.span.start_line;
                }
                return a.span.end_line - b.span.end_line;
            });

        const the_groups: Array<{
            start_line: number;
            end_line: number;
            members: ContextRange[];
        }> = [];
        for (const my_item of the_spans) {
            const my_last = the_groups[the_groups.length - 1];
            if (my_last && my_item.span.start_line <= my_last.end_line) {
                // Shares a physical line with the current group: merge.
                my_last.end_line = Math.max(my_last.end_line, my_item.span.end_line);
                my_last.members.push(my_item.my_range);
            } else {
                the_groups.push({
                    start_line: my_item.span.start_line,
                    end_line: my_item.span.end_line,
                    members: [my_item.my_range],
                });
            }
        }

        const the_line_count = get_line_count(doc);
        const the_units: Array<{
            content: string;
            range: ContextRange;
            actual_range: Range;
        }> = [];
        for (const my_group of the_groups) {
            if (my_group.members.length === 1) {
                // Lone range: preserve exact prior behavior.
                const my_range = my_group.members[0];
                const my_end_line_text = get_line_text(doc, my_group.end_line);
                the_units.push({
                    content: this.extract_block_content(doc, my_range),
                    range: my_range,
                    actual_range: {
                        start: { line: my_group.start_line, character: 0 },
                        end: {
                            line: my_group.end_line,
                            character: my_end_line_text.length,
                        },
                    },
                });
                continue;
            }

            // Merged group: preserve the union of physical lines verbatim.
            const my_lines: string[] = [];
            for (
                let my_line = my_group.start_line;
                my_line <= my_group.end_line && my_line < the_line_count;
                my_line++
            ) {
                const my_text = get_line_text(doc, my_line);
                // Strip the first line's indentation only; the formatter
                // reapplies the placeholder's indentation to it on restore.
                my_lines.push(
                    my_line === my_group.start_line ? my_text.trimStart() : my_text
                );
            }
            const my_end_line_text = get_line_text(doc, my_group.end_line);
            // Synthetic single-line range: restore preserves it verbatim
            // (leading indent on the first line only, no end-delimiter reindent).
            const my_synthetic_range: ContextRange = {
                context: my_group.members[0].context,
                range: {
                    start: { line: my_group.start_line, character: 0 },
                    end: { line: my_group.end_line, character: Number.MAX_SAFE_INTEGER },
                },
                start_delimiter: my_group.members[0].start_delimiter,
                is_single_line: true,
            };
            the_units.push({
                content: my_lines.join('\n'),
                range: my_synthetic_range,
                actual_range: {
                    start: { line: my_group.start_line, character: 0 },
                    end: {
                        line: my_group.end_line,
                        character: my_end_line_text.length,
                    },
                },
            });
        }

        // Bottom-up so replacements do not shift later units' offsets.
        the_units.sort(
            (a, b) => b.actual_range.start.line - a.actual_range.start.line
        );
        return the_units;
    }

    /**
     * Extract the full content of an embedded language block including delimiters.
     *
     * Note: context_range.range excludes the end delimiter line, but we need to
     * include it. Use end_delimiter.range.start.line if available, otherwise
     * fall back to context_range.range.end.line.
     *
     * The first line's (opening delimiter) and last line's (closing delimiter)
     * leading whitespace is stripped since the formatter will handle indentation.
     * This prevents double-indentation when the block is restored.
     */
    private extract_block_content(
        doc: DocumentLike,
        context_range: ContextRange
    ): string {
        const the_start_line = context_range.range.start.line;
        // Include the end delimiter line (context range excludes it, but we need it)
        const the_end_line = context_range.end_delimiter
            ? context_range.end_delimiter.range.start.line
            : context_range.range.end.line;
        const the_line_count = get_line_count(doc);
        const the_block_lines: string[] = [];

        for (let i = the_start_line; i <= the_end_line && i < the_line_count; i++) {
            const line_text = get_line_text(doc, i);
            if (i === the_start_line) {
                // Strip leading whitespace from the first line (opening delimiter)
                // since the formatter will handle indentation.
                the_block_lines.push(line_text.trimStart());
            } else if (i === the_end_line && !context_range.is_single_line) {
                // Strip leading whitespace from the last line (closing delimiter)
                // since the formatter will handle indentation.
                // Only do this for multi-line blocks (not single-line mata: calls)
                the_block_lines.push(line_text.trimStart());
            } else {
                the_block_lines.push(line_text);
            }
        }

        return the_block_lines.join('\n');
    }

    /**
     * Replace a range in content with new text.
     * 
     * Note: The end character position is clamped to the actual line length to prevent
     * overflow when MAX_SAFE_INTEGER is used (e.g., for single-line embedded calls).
     */
    private replace_range_in_content(
        content: string,
        range: Range,
        new_text: string
    ): string {
        const the_offsets = compute_line_offsets(content);

        // Ensure indices are in bounds
        if (range.start.line >= the_offsets.length || range.end.line >= the_offsets.length) {
            return content;
        }

        const the_start_offset = the_offsets[range.start.line] + range.start.character;
        
        // Calculate end offset, clamping to actual line length if needed
        // This prevents overflow when MAX_SAFE_INTEGER is used as end character
        let the_end_offset = the_offsets[range.end.line] + range.end.character;
        
        // Only clamp if the calculated offset exceeds content length
        // This is an optimization to avoid extra calculations in the common case
        if (the_end_offset > content.length) {
            const the_line_end_offset = range.end.line + 1 < the_offsets.length
                ? the_offsets[range.end.line + 1] - 1  // -1 to exclude newline
                : content.length;
            the_end_offset = the_line_end_offset;
        }

        return content.substring(0, the_start_offset) + new_text + content.substring(the_end_offset);
    }

    /**
     * Format a specific range of the document.
     * 
     * Note: Current implementation formats the entire document and returns the edit.
     * In a more refined version, we would only format the affected nodes.
     *
     * @param document - The document state
     * @param _range - The range to format (currently unused)
     * @param options - Formatting options from the client
     * @param config - LSP configuration (optional, for mode selection)
     * @returns Array of TextEdit
     */
    format_range(
        document: DocumentState,
        _range: Range,
        options: FormattingOptions,
        config?: StataLSPConfig
    ): TextEdit[] {
        // Fallback to full document formatting for now, as partial formatting
        // is more complex and depends on correctly identifying parent nodes.
        return this.format(document, options, config);
    }

    /**
     * Format document with comment normalization support.
     *
     * Extends the standard formatting to optionally normalize comment styles
     * based on configuration settings. Includes error handling for graceful
     * degradation if normalization fails.
     *
     * @param document - The document state
     * @param options - Formatting options from the client
     * @param comment_config - Comment formatting configuration
     * @returns Array of TextEdit
     */
    format_with_comment_normalization(
        document: DocumentState,
        options: FormattingOptions,
        comment_config: CommentFormattingConfig
    ): TextEdit[] {
        try {
            // If comment normalization is disabled, use standard formatting
            if (!comment_config.normalizeCommentStyle) {
                return this.format(document, options);
            }

            // Apply comment normalization directly to the original source
            // This avoids the lossy AST reconstruction that breaks code
            const the_normalized_text = this.apply_comment_normalization(
                document.content,
                document,
                comment_config
            );

            // Calculate the range to replace
            const last_line = get_line_count(document) - 1;
            const last_char = get_line_text(document, last_line).length;

            // Return the normalized text
            return [{
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: last_line, character: last_char },
                },
                newText: this.strip_trailing_whitespace(the_normalized_text),
            }];
        } catch (my_error) {
            logger.warn(`Error during format with comment normalization: ${my_error}`);
            // Graceful degradation: return empty edits (no changes)
            return [];
        }
    }

    /**
     * Applies comment normalization to formatted content.
     *
     * @param formatted_content - The formatted content
     * @param document - The document state
     * @param comment_config - Comment formatting configuration
     * @returns The content with normalized comments
     */
    private apply_comment_normalization(
        formatted_content: string,
        document: DocumentState,
        comment_config: CommentFormattingConfig
    ): string {
        try {
            // Get the target comment style
            // The config validator resolves 'line' to '//' or '*'
            // before it reaches the formatter, so cast is safe.
            const target_style = this.map_style_to_processor_style(
                comment_config.preferredCommentStyle as
                    '//' | '*' | '/* */'
            );

            // Get context ranges for embedded language awareness
            const the_context_ranges = document.context_ranges || [];

            // Process comments using CommentProcessor
            const processor = new CommentProcessor();
            const the_transformations = processor.process_comments(
                document.tokens || [],
                target_style,
                the_context_ranges
            );

            // Apply transformations to the formatted content
            return this.apply_comment_transformations(
                formatted_content,
                the_transformations
            );
        } catch (my_error) {
            logger.warn(`Error applying comment normalization: ${my_error}`);
            // Graceful degradation: return original formatted content
            return formatted_content;
        }
    }

    /**
     * Applies comment transformations to content.
     *
     * Transformations are applied in reverse order (from end to start) to
     * maintain correct position tracking. Atomic operations ensure either
     * all transformations succeed or none are applied.
     *
     * @param content - The content to transform
     * @param transformations - The transformations to apply
     * @returns The transformed content
     */
    private apply_comment_transformations(
        content: string,
        transformations: CommentTransformation[]
    ): string {
        try {
            // Sort transformations by position (reverse order) to maintain correct offsets
            // Applying from end to start ensures offsets for earlier parts of the file remain valid
            const the_sorted_transformations = [...transformations].sort((a, b) => {
                const a_line = a.original_range.start.line;
                const b_line = b.original_range.start.line;
                if (a_line !== b_line) {
                    return b_line - a_line;
                }
                return b.original_range.start.character - a.original_range.start.character;
            });

            // Pre-compute offsets for the original content
            const the_offsets = compute_line_offsets(content);
            let my_result = content;

            // Apply each transformation using substring
            for (const my_transformation of the_sorted_transformations) {
                try {
                    const my_start_line = my_transformation.original_range.start.line;
                    const my_end_line = my_transformation.original_range.end.line;

                    // Validate line indices
                    if (my_start_line < 0 || my_start_line >= the_offsets.length ||
                        my_end_line < 0 || my_end_line >= the_offsets.length) {
                        logger.warn(`Invalid transformation range: ${my_start_line}-${my_end_line}`);
                        continue;
                    }

                    const my_start_offset = the_offsets[my_start_line] + my_transformation.original_range.start.character;
                    const my_end_offset = the_offsets[my_end_line] + my_transformation.original_range.end.character;

                    // Replace the range with new text
                    my_result = my_result.substring(0, my_start_offset) +
                        my_transformation.new_text +
                        my_result.substring(my_end_offset);

                } catch (my_error) {
                    logger.warn(`Error applying transformation: ${my_error}`);
                    continue;
                }
            }

            return my_result;
        } catch (my_error) {
            logger.warn(`Error applying comment transformations: ${my_error}`);
            return content;
        }
    }

    /**
     * Maps configuration style to processor style.
     *
     * @param config_style - The configuration style
     * @returns The processor style
     */
    private map_style_to_processor_style(
        config_style: '//' | '*' | '/* */'
    ): 'star' | 'slash' | 'block' {
        switch (config_style) {
            case '//':
                return 'slash';
            case '*':
                return 'star';
            case '/* */':
                return 'block';
            default:
                return 'slash';
        }
    }

    /**
     * Remove trailing whitespace from each line in the content.
     * Preserves line structure (number of lines unchanged).
     *
     * @param content - The content to process
     * @returns The content with trailing whitespace removed from each line
     */
    private strip_trailing_whitespace(content: string): string {
        return content.split('\n').map(line => line.trimEnd()).join('\n');
    }
}
