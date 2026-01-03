import { StataAST, StataNode, ControlFlowNode, ProgramNode, TriviaNode, Token } from '../types';

export interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
}

export class IndentationAnalyzer {
    private indentation_map: Map<number, IndentationInfo> = new Map();
    private current_depth = 0;

    analyze(ast: StataAST, tokens?: Token[]): Map<number, IndentationInfo> {
        this.indentation_map.clear();
        this.current_depth = 0;

        for (const my_node of ast.nodes) {
            this.walk_node(my_node);
        }

        if (tokens) {
            this.process_continuations(tokens);
        }

        return this.indentation_map;
    }

    private walk_node(node: StataNode): void {
        if (this.is_block_node(node)) {
            this.process_block_node(node as ControlFlowNode | ProgramNode);
        } else {
            this.process_regular_node(node);
        }
    }

    private is_block_node(node: StataNode): boolean {
        return node.type === 'program' ||
               node.type === 'if' ||
               node.type === 'else' ||
               node.type === 'foreach' ||
               node.type === 'forvalues' ||
               node.type === 'while' ||
               node.type === 'frame';
    }

    private process_block_node(node: ControlFlowNode | ProgramNode): void {
        const start_line = node.range.start.line;
        const end_line = node.range.end.line;

        this.set_indentation(start_line, this.current_depth, false, true, false);

        this.current_depth++;

        // Process body nodes
        const the_body = node.body;
        for (const my_child of the_body) {
            this.walk_node(my_child);
        }

        this.current_depth--;

        if (end_line !== start_line) {
            this.set_indentation(end_line, this.current_depth, false, false, true);
        }
    }

    private process_regular_node(node: StataNode): void {
        const start_line = node.range.start.line;
        this.set_indentation(start_line, this.current_depth, false, false, false);
    }

    private process_continuations(tokens: Token[]): void {
        let continuation_indent = 0;
        let in_continuation = false;

        for (const my_token of tokens) {
            if (my_token.type === 'CONTINUATION') {
                if (!in_continuation) {
                    const base_info = this.indentation_map.get(my_token.range.start.line);
                    continuation_indent = base_info ? base_info.indent_level + 1 : 1;
                    in_continuation = true;
                }

                const next_line = my_token.range.start.line + 1;
                const existing = this.indentation_map.get(next_line);
                if (!existing || !existing.is_block_start) {
                    this.set_indentation(next_line, continuation_indent, true, false, false);
                }
            } else if (my_token.type !== 'WHITESPACE') {
                // Reset continuation state on non-whitespace, non-continuation token
                // but only if we're on a new line
                if (in_continuation && my_token.range.start.line > 0) {
                    in_continuation = false;
                }
            }
        }
    }

    private set_indentation(line: number, indent_level: number, is_continuation: boolean, is_block_start: boolean, is_block_end: boolean): void {
        const existing = this.indentation_map.get(line);
        // Don't overwrite block start/end markers with regular indentation
        if (existing && (existing.is_block_start || existing.is_block_end) && !is_block_start && !is_block_end) {
            return;
        }
        this.indentation_map.set(line, {
            line,
            indent_level,
            is_continuation,
            is_block_start,
            is_block_end
        });
    }
}
