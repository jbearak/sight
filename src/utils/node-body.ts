import { StataNode } from '../types';

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
