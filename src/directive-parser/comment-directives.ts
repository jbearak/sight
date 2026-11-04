/**
 * Comment directives the semantic analyzer honors: `ignore`,
 * `ignore-next`, the declaration directives (`local`, `global`,
 * `scalar`, `matrix`, `program`), and `variables`.
 *
 * These rules are per comment token, unlike the line-based cross-file
 * directives in ./index.ts. The analyzer applies them to diagnostics,
 * and `sight parse --json` reports them on each comment, so both read
 * the same functions here and cannot drift apart.
 */

import { is_valid_identifier } from '../analyzer/option-argument-parser';
import { StataNode, Token, TriviaNode } from '../types';
import {
    DECLARATION_DIRECTIVE_PATTERN,
    VARIABLES_DIRECTIVE_PATTERN,
    has_ignore_directive,
    has_ignore_next_directive,
} from '../utils/directives';
import { LineSpan, next_statement_line_span } from '../utils/statement-span';

export type DeclarationDirectiveType =
    | 'local'
    | 'global'
    | 'scalar'
    | 'matrix'
    | 'program';

export type IgnoreDirectiveKind = 'ignore' | 'ignore_next';

export interface TokenDeclarationDirective {
    type: DeclarationDirectiveType;
    names: string[];
}

export interface TokenIgnoreDirective {
    kind: IgnoreDirectiveKind;
    /**
     * Lines the token rule suppresses, or undefined when no statement
     * follows a standalone or `ignore-next` directive.
     */
    lines: LineSpan | undefined;
}

/**
 * Split a directive's raw argument string into declared identifiers,
 * dropping blanks and any token that is not a valid Stata identifier.
 * The identifier check guards against artifacts such as the
 * terminating `;` that `#delimit ;` mode lexes into a trailing `*`
 * comment (e.g. `* sight: local foo ;` would otherwise register a bogus
 * symbol named `;`).
 */
export function parse_directive_identifier_list(raw: string): string[] {
    return raw
        .split(/\s+/)
        .filter(name => name.length > 0 && is_valid_identifier(name));
}

/**
 * True when nothing but whitespace precedes the comment at
 * `tokens[comment_index]` on its line.
 */
export function is_standalone_comment_token(
    tokens: Token[],
    comment_index: number
): boolean {
    const comment = tokens[comment_index];
    const line = comment.range.start.line;

    for (let i = comment_index - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.range.start.line !== line) {
            break;
        }
        if (token.type === 'WHITESPACE') {
            continue;
        }
        return false;
    }

    return true;
}

/**
 * Declaration directive (`local`/`global`/`scalar`/`matrix`/`program`)
 * carried by a line comment token, standalone or trailing code. The
 * pattern is anchored to the comment token's own text, which begins at
 * `//` or `*`. `/* ... *\/` block comments lex as COMMENT_BLOCK, never
 * COMMENT_LINE, so a directive-looking line inside one stays inert.
 * `names` may be empty when no argument is a valid identifier.
 */
export function declaration_directive_of(
    token: Token
): TokenDeclarationDirective | undefined {
    if (token.type !== 'COMMENT_LINE') {
        return undefined;
    }
    const my_match = token.value.match(DECLARATION_DIRECTIVE_PATTERN);
    if (!my_match) {
        return undefined;
    }
    return {
        type: my_match[1] as DeclarationDirectiveType,
        names: parse_directive_identifier_list(my_match[2]),
    };
}

/**
 * Names declared by a `variables` directive (`var`, `vars`, `variable`
 * are aliases) in a line comment token, standalone or trailing.
 */
export function variables_directive_of(token: Token): string[] | undefined {
    if (token.type !== 'COMMENT_LINE') {
        return undefined;
    }
    return variables_directive_names(token.value.trim());
}

function variables_directive_names(content: string): string[] | undefined {
    const my_match = content.match(VARIABLES_DIRECTIVE_PATTERN);
    return my_match ? parse_directive_identifier_list(my_match[1]) : undefined;
}

/**
 * Token rule for `ignore` and `ignore-next` in a line comment token.
 * A standalone `ignore` and any `ignore-next` suppress every physical
 * line of the next logical statement (a block header through its
 * opener, never the body). A trailing `ignore` suppresses its own line.
 */
export function ignore_directive_of(
    tokens: Token[],
    index: number
): TokenIgnoreDirective | undefined {
    const token = tokens[index];
    if (token.type !== 'COMMENT_LINE') {
        return undefined;
    }
    const content = token.value.trim();
    if (has_ignore_directive(content)) {
        if (is_standalone_comment_token(tokens, index)) {
            return {
                kind: 'ignore',
                lines: next_statement_line_span(tokens, index),
            };
        }
        const my_line = token.range.start.line;
        return {
            kind: 'ignore',
            lines: { start_line: my_line, end_line: my_line },
        };
    }
    if (has_ignore_next_directive(content)) {
        return {
            kind: 'ignore_next',
            lines: next_statement_line_span(tokens, index),
        };
    }
    return undefined;
}

/**
 * AST rule for `ignore` and `ignore-next` in a trivia comment: suppress
 * the first line of `following_node`, the statement the comment
 * precedes. Only the first line, by design: a control-flow node's range
 * spans its whole body. Returns undefined when the trivia is not an
 * ignore directive or nothing follows it.
 */
export function trivia_ignore_target_line(
    trivia: TriviaNode,
    following_node: StataNode | undefined
): number | undefined {
    const content = trivia.content.trim();
    if (
        following_node &&
        (has_ignore_directive(content) || has_ignore_next_directive(content))
    ) {
        return following_node.range.start.line;
    }
    return undefined;
}

/** Names declared by a `variables` directive in a trivia comment. */
export function trivia_variables_names(trivia: TriviaNode): string[] | undefined {
    return variables_directive_names(trivia.content.trim());
}

/**
 * Node types whose leading trivia carries directives. `frame` and
 * embedded `mata`/`python` blocks are absent: their leading comments
 * reach the next statement through the token rule only.
 */
const LEADING_DIRECTIVE_NODE_TYPES: ReadonlySet<StataNode['type']> = new Set([
    'command',
    'program',
    'macro_def',
    'directive',
    'syntax',
    'if',
    'else',
    'foreach',
    'forvalues',
    'while',
]);

/**
 * The child statement list to recurse into for directive extraction:
 * program bodies, control-flow bodies (including `frame`), and prefix
 * brace-command blocks (`capture { ... }`).
 */
function directive_recursion_body(node: StataNode): StataNode[] | undefined {
    switch (node.type) {
        case 'program':
        case 'frame':
        case 'if':
        case 'else':
        case 'foreach':
        case 'forvalues':
        case 'while':
            return node.body;
        case 'command':
            return node.body ?? undefined;
        default:
            return undefined;
    }
}

/**
 * Visit every leading and block-ending trivia comment in `nodes` (and
 * nested bodies) with the statement it precedes. Leading trivia
 * precedes its own node. Block-ending trivia (a comment on its own line
 * just before a block's closer) precedes the statement after the block:
 * the next sibling, or, for the last child, the statement after all the
 * enclosing closers (`outer_successor`). That is undefined when nothing
 * follows.
 */
export function walk_directive_trivia(
    nodes: StataNode[],
    visit: (trivia: TriviaNode, following_node: StataNode | undefined) => void,
    outer_successor?: StataNode
): void {
    for (let my_index = 0; my_index < nodes.length; my_index++) {
        const node = nodes[my_index];

        if (
            LEADING_DIRECTIVE_NODE_TYPES.has(node.type) &&
            'leadingTrivia' in node &&
            node.leadingTrivia
        ) {
            for (const my_trivia of node.leadingTrivia) {
                visit(my_trivia, node);
            }
        }

        const following_node = nodes[my_index + 1] ?? outer_successor;

        if ('blockEndingTrivia' in node && node.blockEndingTrivia) {
            for (const my_trivia of node.blockEndingTrivia) {
                visit(my_trivia, following_node);
            }
        }

        const the_child_body = directive_recursion_body(node);
        if (the_child_body) {
            walk_directive_trivia(the_child_body, visit, following_node);
        }
    }
}
