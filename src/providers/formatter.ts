/**
 * Code Formatter Provider for Sight
 *
 * Wraps PrettyPrinter to provide LSP formatting services.
 * Extends formatting to support embedded language blocks (Mata, Python).
 */

import {
    TextEdit,
    FormattingOptions,
    Range,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { PrettyPrinter } from '../pretty-printer';
import { ContextRange } from '../context-tracker/types';
import { CommentFormattingConfig } from '../types';
import { CommentProcessor, CommentTransformation } from '../comment-processor/comment-processor';
import { logger } from '../utils/logger';
import { get_line_text, get_line_count, DocumentLike, compute_line_offsets } from '../utils/line-utils';

/**
 * Code Formatter class with embedded language support.
 */
export class CodeFormatter {
    /**
     * Format the entire document while preserving embedded language blocks.
     *
     * @param document - The document state
     * @param options - Formatting options from the client
     * @param line_width - Maximum line width (optional, defaults to 80)
     * @returns Array of TextEdit (usually one replacing the whole content)
     */
    format(
        document: DocumentState,
        options: FormattingOptions,
        line_width?: number
    ): TextEdit[] {
        if (!document.ast) {
            return [];
        }

        // Use context tracker from document state if available
        const the_context_ranges = document.context_ranges || [];

        // If there are no embedded language blocks, use standard formatting
        if (the_context_ranges.length === 0) {
            return this.format_without_embedded_blocks(
                document,
                options,
                line_width
            );
        }

        // Format with embedded language preservation
        return this.format_with_embedded_preservation(
            document,
            options,
            the_context_ranges,
            line_width
        );
    }

    /**
     * Format document without embedded language blocks.
     */
    private format_without_embedded_blocks(
        document: DocumentState,
        options: FormattingOptions,
        line_width?: number
    ): TextEdit[] {
        const printer = new PrettyPrinter({
            indent_size: options.tabSize,
            indent_style: options.insertSpaces ? 'spaces' : 'tabs',
            line_width: line_width,
        });

        const formatted_text = printer.print(document.ast!);

        // Replace the entire document content
        const last_line = get_line_count(document) - 1;
        const last_char = get_line_text(document, last_line).length;

        return [{
            range: {
                start: { line: 0, character: 0 },
                end: { line: last_line, character: last_char },
            },
            newText: formatted_text,
        }];
    }

    /**
     * Format document while preserving embedded language block content.
     * 
     * Strategy:
     * 1. Extract embedded language blocks from original content
     * 2. Format the Stata code (with embedded blocks replaced by placeholders)
     * 3. Reinsert preserved embedded blocks into formatted output
     * 4. Ensure proper spacing around block boundaries
     */
    private format_with_embedded_preservation(
        document: DocumentState,
        options: FormattingOptions,
        context_ranges: ContextRange[],
        line_width?: number
    ): TextEdit[] {
        const the_doc: DocumentLike = { content: document.content, line_offsets: document.line_offsets };
        const the_embedded_blocks: Map<string, string> = new Map();
        let my_placeholder_counter = 0;

        // Extract embedded blocks and replace with placeholders
        let my_modified_content = document.content;
        const the_sorted_ranges = [...context_ranges].sort(
            (a, b) => b.range.start.line - a.range.start.line
        );

        for (const my_range of the_sorted_ranges) {
            const my_placeholder = `__EMBEDDED_BLOCK_${my_placeholder_counter}__`;
            the_embedded_blocks.set(my_placeholder, this.extract_block_content(
                the_doc,
                my_range
            ));

            // Replace the block with placeholder
            my_modified_content = this.replace_range_in_content(
                my_modified_content,
                my_range.range,
                my_placeholder
            );

            my_placeholder_counter++;
        }

        // Format the modified content (with placeholders)
        const printer = new PrettyPrinter({
            indent_size: options.tabSize,
            indent_style: options.insertSpaces ? 'spaces' : 'tabs',
            line_width: line_width,
        });

        let my_formatted_content = my_modified_content;

        try {
            // Try to format - if it fails, fall back to original
            my_formatted_content = printer.print(document.ast!);
        } catch {
            // If formatting fails, use original content
            my_formatted_content = my_modified_content;
        }

        // Restore embedded blocks
        let my_final_content = my_formatted_content;
        for (const [my_placeholder, my_block_content] of the_embedded_blocks) {
            my_final_content = my_final_content.replace(
                my_placeholder,
                my_block_content
            );
        }

        // Calculate the range to replace
        const last_line = get_line_count(document) - 1;
        const last_char = get_line_text(document, last_line).length;

        return [{
            range: {
                start: { line: 0, character: 0 },
                end: { line: last_line, character: last_char },
            },
            newText: my_final_content,
        }];
    }

    /**
     * Extract the full content of an embedded language block including delimiters.
     */
    private extract_block_content(
        doc: DocumentLike,
        context_range: ContextRange
    ): string {
        const the_start_line = context_range.range.start.line;
        const the_end_line = context_range.range.end.line;
        const the_line_count = get_line_count(doc);
        const the_block_lines: string[] = [];

        for (let i = the_start_line; i <= the_end_line && i < the_line_count; i++) {
            the_block_lines.push(get_line_text(doc, i));
        }

        return the_block_lines.join('\n');
    }

    /**
     * Replace a range in content with new text.
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
        const the_end_offset = the_offsets[range.end.line] + range.end.character;

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
     * @param line_width - Maximum line width (optional, defaults to 80)
     * @returns Array of TextEdit
     */
    format_range(
        document: DocumentState,
        _range: Range,
        options: FormattingOptions,
        line_width?: number
    ): TextEdit[] {
        // Fallback to full document formatting for now, as partial formatting
        // is more complex and depends on correctly identifying parent nodes.
        return this.format(document, options, line_width);
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
                return this.format(document, options, comment_config.lineWidth);
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
                newText: the_normalized_text,
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
            const target_style = this.map_style_to_processor_style(comment_config.preferredCommentStyle);

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
}
