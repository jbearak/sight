import { CommandNode, StataNode, SyntaxNode } from '../types';

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
 * The statements of one kind that describe a program's interface,
 * such as its `syntax` or `args`: those at the top of `body`, or, when
 * the body has exactly one in all and it is inside brace or `frame`
 * blocks (`quietly { syntax … }`), that one. With several and any of
 * them nested (say one per if/else branch), it stays the top-level
 * ones, which may be none, as which branch runs is not known.
 */
function program_interface_statements<T extends StataNode>(
    body: StataNode[],
    is_wanted: (node: StataNode) => node is T
): T[] {
    const the_top_level: T[] = body.filter(is_wanted);
    let my_count = 0;
    let my_in_block: T | undefined;
    const visit = (the_nodes: StataNode[], in_blocks_only: boolean): void => {
        for (const my_node of the_nodes) {
            if (is_wanted(my_node)) {
                my_count++;
                if (in_blocks_only) {
                    my_in_block = my_node;
                }
                continue;
            }
            const the_body = my_node.type === 'program'
                ? undefined
                : nested_statements(my_node);
            if (the_body) {
                // A brace block or `frame` block always runs its body
                const is_block = my_node.type === 'command' || my_node.type === 'frame';
                visit(the_body, in_blocks_only && is_block);
            }
        }
    };
    visit(body, true);
    if (my_count === 1 && my_in_block !== undefined) {
        return [my_in_block];
    }
    return the_top_level;
}

/** The `syntax` statements a program's signature comes from. */
export function program_signature_syntax_nodes(body: StataNode[]): SyntaxNode[] {
    return program_interface_statements(
        body,
        (node): node is SyntaxNode => node.type === 'syntax'
    );
}

/** The `args` statements a program's positional arguments come from. */
export function program_args_commands(body: StataNode[]): CommandNode[] {
    return program_interface_statements(
        body,
        (node): node is CommandNode => node.type === 'command' && node.name === 'args'
    );
}
