/**
 * Shared test utilities for text edit operations and AST traversal.
 */

import { TextEdit } from 'vscode-languageserver';
import { StataNode, CommandNode } from '../../../src/types';

/**
 * Apply text edits to source to get formatted result.
 * Handles multiple edits by sorting in reverse order to avoid index shifting.
 */
export function apply_edits(source: string, edits: TextEdit[]): string {
    if (edits.length === 0) return source;

    let result = source;
    const sorted_edits = [...edits].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
    });
    for (const my_edit of sorted_edits) {
        const the_lines = result.split('\n');
        const start_line = my_edit.range.start.line;
        const end_line = my_edit.range.end.line;
        const start_char = my_edit.range.start.character;
        const end_char = my_edit.range.end.character;

        const before = the_lines.slice(0, start_line).join('\n') +
            (start_line > 0 ? '\n' : '') +
            (the_lines[start_line]?.substring(0, start_char) ?? '');
        const after = (the_lines[end_line]?.substring(end_char) ?? '') +
            (end_line < the_lines.length - 1
                ? '\n' + the_lines.slice(end_line + 1).join('\n')
                : '');

        result = before + my_edit.newText + after;
    }
    return result;
}

/**
 * Recursively find all command nodes in an AST.
 */
export function find_command_nodes(nodes: StataNode[]): CommandNode[] {
    const the_commands: CommandNode[] = [];
    for (const my_node of nodes) {
        if (my_node.type === 'command') {
            the_commands.push(my_node);
            if (my_node.body) {
                the_commands.push(...find_command_nodes(my_node.body));
            }
        } else if (my_node.type === 'if' || my_node.type === 'else') {
            the_commands.push(...find_command_nodes(my_node.body));
            if (my_node.type === 'if' && my_node.else_body) {
                the_commands.push(...find_command_nodes(my_node.else_body));
            }
        } else if (
            my_node.type === 'foreach' ||
            my_node.type === 'forvalues' ||
            my_node.type === 'while'
        ) {
            the_commands.push(...find_command_nodes(my_node.body));
        } else if (my_node.type === 'program') {
            the_commands.push(...find_command_nodes(my_node.body));
        }
    }
    return the_commands;
}
