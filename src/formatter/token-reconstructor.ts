import { Token } from '../types';
import { IndentationInfo } from './indentation-analyzer';

export interface TokenProcessingState {
    current_line: number;
    current_column: number;
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
            current_column: 0,
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
                state.current_column = 0;
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
                    
                    if (indent_info.indent_delta !== 0) {
                        const adjusted_whitespace = this.apply_indent_delta(leading_whitespace, indent_info.indent_delta, config);
                        state.output_parts.push(adjusted_whitespace);
                    } else {
                        state.output_parts.push(leading_whitespace);
                    }
                    state.current_column = token_col; // Track original position for spacing calc
                } else {
                    // Generate new indentation
                    const indent_level = typeof indent_info === 'number' ? indent_info : (indent_info?.indent_level ?? 0);
                    const indent_str = this.make_indent(indent_level, config);
                    state.output_parts.push(indent_str);
                    state.current_column = token_col; // Track original position for spacing calc
                }
                state.at_line_start = false;
            } else if (!state.at_line_start && state.current_column < token_col) {
                // Preserve spacing between tokens on the same line
                const original_line = the_lines[state.current_line] || '';
                let spacing = original_line.substring(state.current_column, token_col);
                // Convert tabs to spaces if indent_style is spaces, BUT NOT if we're preserving whitespace
                // (e.g., for continuation line alignment)
                if (config.indent_style === 'spaces' && !should_preserve_whitespace) {
                    spacing = spacing.replace(/\t/g, ' '.repeat(config.indent_size));
                }
                state.output_parts.push(spacing);
                state.current_column = token_col;
            }

            // Output the token value
            state.output_parts.push(my_token.value);

            // Update position based on token content
            const newline_count = (my_token.value.match(/\n/g) || []).length;
            if (newline_count > 0) {
                state.current_line += newline_count;
                const last_newline_idx = my_token.value.lastIndexOf('\n');
                state.current_column = my_token.value.length - last_newline_idx - 1;
                state.at_line_start = my_token.value.endsWith('\n');
            } else {
                state.current_column += my_token.value.length;
                if (my_token.value.trim()) {
                    state.at_line_start = false;
                }
            }
        }

        return state.output_parts.join('');
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
}
