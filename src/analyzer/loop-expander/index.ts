/**
 * Loop macro expander: public entry point used by the analyzer.
 *
 * Given a foreach/forvalues node, the full token array, and the active loop
 * iterator frames, produce the concrete local/global macros defined by
 * constructed-name `local`/`global` statements in the loop body.
 */
import { Range } from 'vscode-languageserver-textdocument';
import { ControlFlowNode, StataNode, SymbolTable, Token } from '../../types';
import { BindingFrame, expand_template, extract_name_template } from './name-expander';

export { build_static_value_env } from './static-value-env';
export type { StaticValue, StaticValueEnv } from './static-value-env';
export { resolve_loop_value_set } from './value-set-resolver';
export type { IteratorValueSet } from './value-set-resolver';
export type { BindingFrame } from './name-expander';

export interface ExpandedLoopMacro {
    name: string;
    scope: 'local' | 'global';
    sourceRange: Range;
}

// Only descend into UNCONDITIONAL nested blocks. `frame X { … }` always
// executes its body, so a constructed name there is genuinely defined. We do
// NOT descend into conditional `if`/`else`/`while` bodies: their statements may
// not execute, so injecting their constructed names could falsely suppress a
// legitimate undefined-macro warning. Such names simply aren't expanded (a
// conservative miss — the pre-feature behavior).
const RECURSE_CONTROL_FLOW = new Set(['frame']);

function pos_le(
    a: { line: number; character: number },
    b: { line: number; character: number }
): boolean {
    return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

/**
 * Direct body statements that may be constructed-name definitions. Descends
 * into unconditional `frame` blocks, but NOT into conditional if/else/while
 * bodies (their statements may not execute — avoids false suppression), nor
 * into nested foreach/forvalues (each handles its own body), nor into
 * command-prefix blocks (documented v1 limitation).
 */
function collect_candidate_statements(body: StataNode[]): StataNode[] {
    const the_statements: StataNode[] = [];
    for (const my_node of body) {
        if (my_node.type === 'foreach' || my_node.type === 'forvalues') {
            continue;
        }
        if (RECURSE_CONTROL_FLOW.has(my_node.type) && 'body' in my_node && Array.isArray(my_node.body)) {
            the_statements.push(...collect_candidate_statements(my_node.body));
        } else {
            the_statements.push(my_node);
        }
    }
    return the_statements;
}

function statement_tokens(tokens: Token[], range: Range): Token[] {
    // Tokens are position-sorted; binary-search the first token at/after the
    // statement start so this is O(log n + k) per statement rather than O(n),
    // avoiding O(n^2) over a large loop body.
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pos_le(range.start, tokens[mid].range.start)) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    const out: Token[] = [];
    for (let i = lo; i < tokens.length; i++) {
        const my_tok = tokens[i];
        if (!pos_le(my_tok.range.start, range.end)) break;
        if (pos_le(my_tok.range.end, range.end)) {
            out.push(my_tok);
        }
    }
    return out;
}

export function expand_loop_body(
    node: ControlFlowNode,
    tokens: Token[],
    frames: BindingFrame[],
    symbols: Pick<SymbolTable, 'localMacros' | 'globalMacros'>
): ExpandedLoopMacro[] {
    // If any active loop has an empty iteration set, the (innermost) body never
    // executes, so no constructed name is actually defined. Expanding here —
    // even for a name that does not reference the empty iterator — would falsely
    // suppress a legitimate undefined-macro warning.
    if (frames.some((my_frame) => my_frame.values.length === 0)) {
        return [];
    }
    const the_expanded: ExpandedLoopMacro[] = [];
    for (const my_statement of collect_candidate_statements(node.body)) {
        const the_tokens = statement_tokens(tokens, my_statement.range);
        if (the_tokens.length === 0) continue;
        const template = extract_name_template(the_tokens);
        if (!template) continue;
        for (const my_name of expand_template(template, frames, symbols)) {
            the_expanded.push({ name: my_name, scope: template.scope, sourceRange: my_statement.range });
        }
    }
    return the_expanded;
}
