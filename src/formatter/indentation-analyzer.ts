import { StataAST, StataNode, ControlFlowNode, ProgramNode, CommandNode, TriviaNode, Token } from '../types';
import { ContinuationGroup } from './alignment-detector';

export interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
    preserve_whitespace: boolean;
    indent_delta: number;
    original_indent: number;
}

export class IndentationAnalyzer {
    private indentation_map: Map<number, IndentationInfo> = new Map();
    private current_depth = 0;
    private original_lines: string[] = [];
    private indent_size: number;

    constructor(indent_size: number = 4) {
        this.indent_size = indent_size;
    }

    private has_body(
        node: StataNode
    ): node is ControlFlowNode | ProgramNode | (CommandNode & { body: StataNode[] }) {
        return (
            (node.type === 'if' || node.type === 'else' || 
             node.type === 'foreach' || node.type === 'forvalues' || 
             node.type === 'while' || node.type === 'frame' ||
             node.type === 'program') ||
            (node.type === 'command' && 'body' in node && 
             Array.isArray(node.body))
        );
    }

    analyze(ast: StataAST, tokens?: Token[], alignment_info?: Map<number, ContinuationGroup>, original_source?: string): Map<number, IndentationInfo> {
        this.indentation_map.clear();
        this.current_depth = 0;
        this.original_lines = original_source ? original_source.split('\n') : [];

        for (const my_node of ast.nodes) {
            this.walk_node(my_node);
        }

        if (tokens) {
            this.process_continuations(tokens);
            this.process_comment_tokens(tokens);
        }

        if (alignment_info) {
            this.apply_alignment_preservation(alignment_info);
        }

        return this.indentation_map;
    }

    private calculate_indent_delta(line: number, target_indent_level: number): { delta: number; original_indent: number } {
        const original_line = this.original_lines[line] || '';
        const original_indent_match = original_line.match(/^(\s*)/);
        const original_indent_str = original_indent_match ? original_indent_match[1] : '';
        let column = 0;
        for (const ch of original_indent_str) {
            if (ch === '\t') {
                column += this.indent_size - (column % this.indent_size);
            } else {
                column += 1;
            }
        }
        const original_indent_spaces = column;
        const target_indent_spaces = target_indent_level * this.indent_size;
        const delta = target_indent_spaces - original_indent_spaces;
        return { delta, original_indent: original_indent_spaces };
    }

    private walk_node(node: StataNode): void {
        // Process leading trivia before the node
        this.process_node_trivia(node);

        // Handle embedded_block nodes specially (Mata/Python blocks)
        if (node.type === 'embedded_block') {
            this.process_embedded_block_node(node);
            return;
        }

        if (this.is_block_node(node)) {
            if (node.type === 'command' && (node as CommandNode).name === '{') {
                this.process_command_brace_block(node);
            } else {
                this.process_block_node(node as ControlFlowNode | ProgramNode);
            }
        } else {
            this.process_regular_node(node);
        }
    }

    private has_trivia(node: StataNode): boolean {
        return 'leadingTrivia' in node || 'trailingTrivia' in node;
    }

    private process_node_trivia(node: StataNode): void {
        if (!this.has_trivia(node)) return;

        // Cast to access trivia properties
        const node_with_trivia = node as StataNode & {
            leadingTrivia?: TriviaNode[];
            trailingTrivia?: TriviaNode[];
        };

        // Process leading trivia - these should be indented at the current depth
        if (node_with_trivia.leadingTrivia) {
            for (const my_trivia of node_with_trivia.leadingTrivia) {
                if (my_trivia.type === 'comment') {
                    const trivia_line = my_trivia.range.start.line;
                    // Only set if not already set (don't override block markers)
                    if (!this.indentation_map.has(trivia_line)) {
                        const { delta, original_indent } = this.calculate_indent_delta(trivia_line, this.current_depth);
                        this.set_indentation(trivia_line, this.current_depth, false, false, false, false, delta, original_indent);
                    }
                }
            }
        }

        // Process trailing trivia - these should also be at current depth
        if (node_with_trivia.trailingTrivia) {
            for (const my_trivia of node_with_trivia.trailingTrivia) {
                if (my_trivia.type === 'comment') {
                    const trivia_line = my_trivia.range.start.line;
                    // Only set if not already set
                    if (!this.indentation_map.has(trivia_line)) {
                        const { delta, original_indent } = this.calculate_indent_delta(trivia_line, this.current_depth);
                        this.set_indentation(trivia_line, this.current_depth, false, false, false, false, delta, original_indent);
                    }
                }
            }
        }
    }

    private is_block_node(node: StataNode): boolean {
        return node.type === 'program' ||
               node.type === 'if' ||
               node.type === 'else' ||
               node.type === 'foreach' ||
               node.type === 'forvalues' ||
               node.type === 'while' ||
               node.type === 'frame' ||
               node.type === 'embedded_block' ||
               (node.type === 'command' && node.name === '{');
    }

    private process_block_node(node: ControlFlowNode | ProgramNode): void {
        const start_line = node.range.start.line;
        const end_line = node.range.end.line;

        const start_delta_info = this.calculate_indent_delta(start_line, this.current_depth);
        this.set_indentation(start_line, this.current_depth, false, true, false, false, start_delta_info.delta, start_delta_info.original_indent);

        this.current_depth++;

        // Process body nodes (trivia is processed in walk_node)
        const the_body = node.body;
        for (const my_child of the_body) {
            // Special case: if a child starts on the same line as the parent block,
            // it should be at the parent's indentation level, not indented.
            // This handles "else if" where the "if" is on the same line as "else".
            const child_start_line = my_child.range.start.line;
            if (child_start_line === start_line && this.is_block_node(my_child)) {
                // Temporarily restore parent depth for this child
                this.current_depth--;
                this.walk_node(my_child);
                this.current_depth++;
            } else {
                this.walk_node(my_child);
            }
        }

        this.current_depth--;

        if (end_line !== start_line) {
            const end_delta_info = this.calculate_indent_delta(end_line, this.current_depth);
            this.set_indentation(end_line, this.current_depth, false, false, true, false, end_delta_info.delta, end_delta_info.original_indent);
        }
    }

    /**
     * Process embedded_block nodes (Mata/Python blocks).
     * Sets start and end line depths at current_depth without recursing into content.
     */
    private process_embedded_block_node(node: StataNode): void {
        const start_line = node.range.start.line;
        const end_line = node.range.end.line;

        // Set indentation for the start line (mata/python) at current depth
        const start_delta_info = this.calculate_indent_delta(start_line, this.current_depth);
        this.set_indentation(start_line, this.current_depth, false, true, false, false, 
            start_delta_info.delta, start_delta_info.original_indent);

        // Set indentation for the end line (end) at current depth (same as start)
        if (end_line !== start_line) {
            const end_delta_info = this.calculate_indent_delta(end_line, this.current_depth);
            this.set_indentation(end_line, this.current_depth, false, false, true, false, 
                end_delta_info.delta, end_delta_info.original_indent);
        }

        // Do NOT recurse into embedded block content - it's a different language
    }

    private process_command_brace_block(node: StataNode): void {
        const start_line = node.range.start.line;
        const end_line = node.range.end.line;

        // Set indentation for the start line (opening brace) at current depth
        const start_delta_info = this.calculate_indent_delta(start_line, this.current_depth);
        this.set_indentation(start_line, this.current_depth, false, true, false, false, start_delta_info.delta, start_delta_info.original_indent);

        // Increase depth for interior lines
        this.current_depth++;

        // If the node has a body, process child nodes
        if (this.has_body(node)) {
            for (const my_child of node.body) {
                this.walk_node(my_child);
            }
        } else {
            // Fallback: set indentation for interior lines (between start and end)
            for (let line = start_line + 1; line < end_line; line++) {
                const { delta, original_indent } = this.calculate_indent_delta(line, this.current_depth);
                this.set_indentation(line, this.current_depth, false, false, false, false, delta, original_indent);
            }
        }

        // Decrease depth back to original
        this.current_depth--;

        // Set indentation for the end line (closing brace) at current depth
        if (end_line !== start_line) {
            const end_delta_info = this.calculate_indent_delta(end_line, this.current_depth);
            this.set_indentation(end_line, this.current_depth, false, false, true, false, end_delta_info.delta, end_delta_info.original_indent);
        }
    }

    private process_regular_node(node: StataNode): void {
        const start_line = node.range.start.line;
        const { delta, original_indent } = this.calculate_indent_delta(start_line, this.current_depth);
        this.set_indentation(start_line, this.current_depth, false, false, false, false, delta, original_indent);
    }

    private process_continuations(tokens: Token[]): void {
        let continuation_indent = 0;
        let in_continuation = false;
        let base_delta = 0;

        for (const my_token of tokens) {
            if (my_token.type === 'CONTINUATION') {
                if (!in_continuation) {
                    const base_info = this.indentation_map.get(my_token.range.start.line);
                    continuation_indent = base_info ? base_info.indent_level + 1 : 1;
                    base_delta = base_info ? base_info.indent_delta : 0;
                    in_continuation = true;
                }

                const next_line = my_token.range.start.line + 1;
                const existing = this.indentation_map.get(next_line);
                if (!existing || !existing.is_block_start) {
                    const { original_indent } = this.calculate_indent_delta(next_line, continuation_indent);
                    this.set_indentation(next_line, continuation_indent, true, false, false, false, base_delta, original_indent);
                }
            } else if (my_token.type !== 'WHITESPACE') {
                // Reset continuation state on non-whitespace, non-continuation token
                // Check if we've moved to a new line that doesn't have a continuation marker
                if (in_continuation) {
                    const current_line = my_token.range.start.line;
                    const previous_line = current_line - 1;
                    const has_continuation_on_previous = tokens.some(t =>
                        t.type === 'CONTINUATION' && t.range.start.line === previous_line
                    );
                    if (!has_continuation_on_previous) {
                        in_continuation = false;
                    }
                }
            }
        }
    }

    /**
     * Process standalone comment tokens that weren't attached to AST nodes.
     * These are comments that appear between statements in a block.
     * We find the nearest preceding line with indentation and use that level.
     */
    private process_comment_tokens(tokens: Token[]): void {
        for (const my_token of tokens) {
            if (my_token.type === 'COMMENT_LINE' || my_token.type === 'COMMENT_BLOCK') {
                const comment_line = my_token.range.start.line;
                // Only process if not already set
                if (!this.indentation_map.has(comment_line)) {
                    // Find the nearest preceding line with indentation info
                    const indent_level = this.find_context_indent(comment_line);
                    const { delta, original_indent } = this.calculate_indent_delta(comment_line, indent_level);
                    this.set_indentation(comment_line, indent_level, false, false, false, false, delta, original_indent);
                }
            }
        }
    }

    /**
     * Find the indentation level for a line by looking at surrounding context.
     * Looks for the nearest preceding line with indentation info.
     */
    private find_context_indent(line: number): number {
        // Look backwards for the nearest line with indentation
        for (let my_line = line - 1; my_line >= 0; my_line--) {
            const info = this.indentation_map.get(my_line);
            if (info) {
                // If the preceding line is a block start, the comment should be indented inside
                if (info.is_block_start) {
                    return info.indent_level + 1;
                }
                return info.indent_level;
            }
        }

        // Default to no indentation (e.g., comments at start of file)
        return 0;
    }

    /**
     * Apply alignment preservation based on continuation groups.
     */
    private apply_alignment_preservation(alignment_info: Map<number, ContinuationGroup>): void {
        for (const group of alignment_info.values()) {
            for (const line of group.aligned_lines) {
                const existing = this.indentation_map.get(line);
                if (existing) {
                    existing.preserve_whitespace = true;
                }
            }
        }
    }

    private set_indentation(
        line: number,
        indent_level: number,
        is_continuation: boolean,
        is_block_start: boolean,
        is_block_end: boolean,
        preserve_whitespace: boolean = false,
        indent_delta: number = 0,
        original_indent: number = 0
    ): void {
        const existing = this.indentation_map.get(line);
        // Don't overwrite block start/end markers with regular indentation
        // BUT allow continuation indentation to update the indent level
        if (existing && (existing.is_block_start || existing.is_block_end) && !is_block_start && !is_block_end && !is_continuation) {
            return;
        }
        // For continuations on block end lines, preserve the block_end flag but update indent
        if (existing && existing.is_block_end && is_continuation) {
            existing.indent_level = indent_level;
            existing.is_continuation = true;
            existing.indent_delta = indent_delta;
            existing.original_indent = original_indent;
            return;
        }
        this.indentation_map.set(line, {
            line,
            indent_level,
            is_continuation,
            is_block_start,
            is_block_end,
            preserve_whitespace,
            indent_delta,
            original_indent
        });
    }
}
