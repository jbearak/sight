import { Token } from '../types';

export interface TokenProcessingState {
    current_line: number;
    current_column: number;
    at_line_start: boolean;
    output_parts: string[];
}

export interface FormatterConfig {
    indent_size: number;
    indent_style: 'spaces' | 'tabs';
}

export class TokenReconstructor {
    /**
     * Reconstruct source from tokens, applying indentation adjustments.
     * Uses token positions to preserve original spacing between tokens.
     */
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, number>,
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

            // At line start, apply indentation
            if (state.at_line_start && my_token.value.trim()) {
                const indent_level = line_indents.get(state.current_line) ?? 0;
                const indent_str = this.make_indent(indent_level, config);
                state.output_parts.push(indent_str);
                // After applying indentation, set current_column to the token's original position
                // This ensures we don't try to "preserve spacing" between our new indent and the token
                // The indentation replaces ALL leading whitespace
                state.current_column = token_col;
                state.at_line_start = false;
            } else if (!state.at_line_start && state.current_column < token_col) {
                // Preserve spacing between tokens on the same line
                const original_line = the_lines[state.current_line] || '';
                const spacing = original_line.substring(state.current_column, token_col);
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

    private make_indent(level: number, config: FormatterConfig): string {
        if (config.indent_style === 'tabs') {
            return '\t'.repeat(level);
        }
        return ' '.repeat(level * config.indent_size);
    }
}
