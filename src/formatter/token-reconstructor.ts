import { Token } from '../types';
import { IndentationInfo } from './indentation-analyzer';

export interface TokenProcessingState {
    current_line: number;
    /** The column position in the original source (for extracting spacing) */
    source_column: number;
    /** The visual column position in the output (for tab expansion) */
    output_column: number;
    at_line_start: boolean;
    output_parts: string[];
}

export interface FormatterConfig {
    indent_size: number;
    indent_style: 'spaces' | 'tabs';
    preserve_alignment?: boolean;
}

export class TokenReconstructor {
    /**
     * Reconstruct source from tokens, applying indentation adjustments.
     * Uses token positions to preserve original spacing between tokens.
     */
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, number | IndentationInfo>,
        config: FormatterConfig,
        original_source: string
    ): string {
        const state: TokenProcessingState = {
            current_line: 0,
            source_column: 0,
            output_column: 0,
            at_line_start: true,
            output_parts: []
        };

        const the_lines = original_source.split('\n');

        for (const my_token of tokens) {
            if (my_token.type === 'EOF') continue;

            const token_line = my_token.range.start.line;
            const token_col = my_token.range.start.character;

            // Handle line changes
            while (state.current_line < token_line) {
                state.output_parts.push('\n');
                state.current_line++;
                state.source_column = 0;
                state.output_column = 0;
                state.at_line_start = true;
            }

            // Check if this line should preserve whitespace (for continuation alignment)
            const indent_info = line_indents.get(state.current_line);
            const should_preserve_whitespace = typeof indent_info === 'object' && indent_info.preserve_whitespace;

            // At line start, apply indentation
            if (state.at_line_start && my_token.value.trim()) {
                if (should_preserve_whitespace) {
                    // Preserve original whitespace, but apply delta if non-zero
                    const original_line = the_lines[state.current_line] || '';
                    const leading_whitespace = original_line.match(/^\s*/)?.[0] || '';
                    
                    let output_whitespace: string;
                    if (indent_info.indent_delta !== 0) {
                        output_whitespace = this.apply_indent_delta(leading_whitespace, indent_info.indent_delta, config);
                    } else {
                        output_whitespace = leading_whitespace;
                    }
                    state.output_parts.push(output_whitespace);
                    state.source_column = token_col; // Track original position for spacing extraction
                    state.output_column = this.calculate_visual_width(output_whitespace, config.indent_size);
                } else {
                    // Generate new indentation
                    const indent_level = typeof indent_info === 'number' ? indent_info : (indent_info?.indent_level ?? 0);
                    const indent_str = this.make_indent(indent_level, config);
                    state.output_parts.push(indent_str);
                    state.source_column = token_col; // Track original position for spacing extraction
                    state.output_column = indent_str.length; // Indent is all spaces or tabs
                }
                state.at_line_start = false;
            } else if (!state.at_line_start && state.source_column < token_col) {
                // Preserve spacing between tokens on the same line
                const original_line = the_lines[state.current_line] || '';
                let spacing = original_line.substring(state.source_column, token_col);
                // Convert tabs to spaces if indent_style is spaces, BUT NOT if we're preserving whitespace
                // (e.g., for continuation line alignment)
                if (config.indent_style === 'spaces' && !should_preserve_whitespace) {
                    // Use output_column (not source_column) for correct tab expansion
                    spacing = this.expand_tabs_to_spaces(spacing, state.output_column, config.indent_size);
                }
                state.output_parts.push(spacing);
                state.source_column = token_col;
                state.output_column += spacing.length;
            }

            // Output the token value
            state.output_parts.push(my_token.value);

            // Update position based on token content
            const newline_count = (my_token.value.match(/\n/g) || []).length;
            if (newline_count > 0) {
                state.current_line += newline_count;
                const last_newline_idx = my_token.value.lastIndexOf('\n');
                const chars_after_newline = my_token.value.length - last_newline_idx - 1;
                state.source_column = chars_after_newline;
                state.output_column = chars_after_newline;
                state.at_line_start = my_token.value.endsWith('\n');
            } else {
                state.source_column += my_token.value.length;
                state.output_column += my_token.value.length;
                if (my_token.value.trim()) {
                    state.at_line_start = false;
                }
            }
        }

        return state.output_parts.join('');
    }

    /**
     * Calculate the visual width of a string, accounting for tab stops.
     */
    private calculate_visual_width(str: string, tab_width: number): number {
        let visual_column = 0;
        const effective_tab_width = tab_width > 0 ? tab_width : 4;
        
        for (const my_char of str) {
            if (my_char === '\t') {
                visual_column = Math.ceil((visual_column + 1) / effective_tab_width) * effective_tab_width;
            } else {
                visual_column += 1;
            }
        }
        return visual_column;
    }

    private apply_indent_delta(original_whitespace: string, delta: number, config: FormatterConfig): string {
        if (delta === 0) return original_whitespace;
        
        if (delta > 0) {
            // Positive delta: prepend spaces
            const spaces_to_add = config.indent_style === 'tabs' ? '\t'.repeat(Math.ceil(delta / config.indent_size)) : ' '.repeat(delta);
            return spaces_to_add + original_whitespace;
        } else {
            // Negative delta: remove leading spaces with bounds checking
            const spaces_to_remove = Math.abs(delta);
            let remaining = original_whitespace;
            let removed = 0;
            
            // Remove spaces/tabs from the beginning
            for (let i = 0; i < remaining.length && removed < spaces_to_remove; i++) {
                const char = remaining[i];
                if (char === ' ') {
                    removed += 1;
                } else if (char === '\t') {
                    removed += config.indent_size;
                } else {
                    break;
                }
                
                if (removed <= spaces_to_remove) {
                    remaining = remaining.substring(1);
                    i--; // Adjust index since we removed a character
                }
            }
            
            return remaining;
        }
    }

    private make_indent(level: number, config: FormatterConfig): string {
        if (config.indent_style === 'tabs') {
            return '\t'.repeat(level);
        }
        return ' '.repeat(level * config.indent_size);
    }

    /**
     * Convert tabs to spaces while preserving visual column alignment.
     * Each tab expands to the next tab stop (multiples of tab_width).
     * 
     * @param spacing - The original spacing string (may contain tabs and spaces)
     * @param start_column - The visual column where this spacing begins
     * @param tab_width - The tab stop interval (typically indent_size)
     * @returns Spaces that produce the same visual width
     */
    private expand_tabs_to_spaces(
        spacing: string,
        start_column: number,
        tab_width: number
    ): string {
        // Defensive: treat negative start_column as 0
        let visual_column = Math.max(0, start_column);
        
        // Defensive: default to 4 if tab_width is zero or negative
        const effective_tab_width = tab_width > 0 ? tab_width : 4;
        
        for (const my_char of spacing) {
            if (my_char === '\t') {
                // Tab expands to next tab stop
                visual_column = Math.ceil((visual_column + 1) / effective_tab_width) * effective_tab_width;
            } else {
                visual_column += 1;
            }
        }
        
        // Return spaces to reach the same visual column
        const spaces_needed = visual_column - Math.max(0, start_column);
        return ' '.repeat(spaces_needed);
    }
}
