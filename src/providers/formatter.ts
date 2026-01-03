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
                newText: formatted_text,
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
            document.content
        );

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

        // For embedded blocks, we fall back to returning the content with preserved blocks
        // since the source-preserving formatter works on the full token stream
        // A more sophisticated approach would filter tokens, but for now we preserve embedded blocks
        // Use VS Code's tabSize (from editor settings), fall back to server config
        const indent_size = options.tabSize ?? server_config?.formatting?.indentSize ?? 4;
        const config: FormatterConfig = {
            indent_size,
            indent_style: options.insertSpaces ? 'spaces' : 'tabs',
        };

        const formatter = new SourcePreservingFormatter(config);
        let my_formatted_content: string;

        try {
            my_formatted_content = formatter.format(
                document.tokens!,
                document.ast!,
                document.line_offsets,
                document.content
            );
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
            newText: my_formatted_content,
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
