import { StataNode, SyntaxNode } from '../types';

/**
 * The statements nested directly in `node`, or undefined when it has
 * none: a program's body, a loop, `if`, `else`, `while`, or `frame`
 * block's body (prefixed or not, e.g. `capture foreach … {`), or a
 * brace block's (`quietly { … }`, `capture noisily { … }`, a bare
 * `{ … }`), which the parser keeps as a command named `{`.
 *
 * Walkers that recurse into bodies use this so that none of them
 * forgets the brace-block form.
 */
export function nested_statements(node: StataNode): StataNode[] | undefined {
    switch (node.type) {
        case 'program':
        case 'if':
        case 'else':
        case 'foreach':
        case 'forvalues':
        case 'while':
        case 'frame':
        case 'command':
            return node.body;
        default:
            return undefined;
    }
}

/**
 * The `syntax` statements a program's signature comes from: those at
 * the top of `body`, or, when the body has exactly one `syntax` in
 * all and it is inside brace or `frame` blocks (`quietly { syntax … }`),
 * that one.
 * With several `syntax` statements and any of them nested (say one per
 * if/else branch), it stays the top-level ones, which may be none, as
 * which branch runs is not known.
 */
export function program_signature_syntax_nodes(body: StataNode[]): SyntaxNode[] {
    const the_top_level: SyntaxNode[] = [];
    for (const my_node of body) {
        if (my_node.type === 'syntax') {
            the_top_level.push(my_node);
        }
    }
    let my_syntax_count = 0;
    let my_in_brace_block: SyntaxNode | undefined;
    const visit = (the_nodes: StataNode[], in_brace_blocks_only: boolean): void => {
        for (const my_node of the_nodes) {
            if (my_node.type === 'syntax') {
                my_syntax_count++;
                if (in_brace_blocks_only) {
                    my_in_brace_block = my_node;
                }
                continue;
            }
            const the_body = my_node.type === 'program'
                ? undefined
                : nested_statements(my_node);
            if (the_body) {
                // A brace block or `frame` block always runs its body
                const is_block = my_node.type === 'command' || my_node.type === 'frame';
                visit(the_body, in_brace_blocks_only && is_block);
            }
        }
    };
    visit(body, true);
    if (my_syntax_count === 1 && my_in_brace_block !== undefined) {
        return [my_in_brace_block];
    }
    return the_top_level;
}
