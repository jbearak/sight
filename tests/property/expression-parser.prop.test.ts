/**
 * Property tests for the expression parser and the statement structure
 * built on it.
 *
 * - Round trip: a random expression tree, printed with only the
 *   parentheses Stata's precedence requires, parses back to the same tree.
 * - Robustness: arbitrary token soup never throws, and every node has a
 *   range inside its input.
 * - Statements: generated commands with qualifiers in any order stay one
 *   node each, with the qualifiers in the right fields.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { parse_expression } from '../../src/expression-parser';
import { Range } from 'vscode-languageserver-textdocument';
import { ExpressionNode, Token } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

// ---------------------------------------------------------------------------
// Expression trees

type Tree =
    | { kind: 'variable'; name: string }
    | { kind: 'number'; text: string }
    | { kind: 'missing'; text: string }
    | { kind: 'string'; value: string }
    | { kind: 'macro'; scope: 'local' | 'global'; name: string }
    | { kind: 'unary'; op: '-' | '!'; operand: Tree }
    | { kind: 'binary'; op: string; left: Tree; right: Tree }
    | { kind: 'call'; name: string; args: Tree[] }
    | { kind: 'subscript'; name: string; index: Tree };

/**
 * Names the parser gives special meaning to, or that the lexer treats as
 * block keywords, are not plain variables.
 */
const SPECIAL_NAMES = new Set([
    '_n', '_N', '_pi', '_rc', '_cons', '_b', '_se', '_coef',
    'r', 'e', 's', 'c', 'mata', 'python', 'end', 'local', 'global',
]);

const plain_name = arbitrary_non_reserved_identifier()
    .filter((name) => !SPECIAL_NAMES.has(name));

const BINARY_OPS = ['|', '&', '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '^'];

const leaf: fc.Arbitrary<Tree> = fc.oneof(
    plain_name.map((name): Tree => ({ kind: 'variable', name })),
    fc.oneof(
        fc.integer({ min: 0, max: 100000 }).map(String),
        fc.constantFrom('1.5', '.5', '1e3', '2.25e-2'),
    ).map((text): Tree => ({ kind: 'number', text })),
    fc.constantFrom('.', '.a', '.m', '.z').map((text): Tree => ({ kind: 'missing', text })),
    fc.stringMatching(/^[a-z ]{0,6}$/).map((value): Tree => ({ kind: 'string', value })),
    fc.tuple(fc.constantFrom<'local' | 'global'>('local', 'global'), plain_name)
        .map(([scope, name]): Tree => ({ kind: 'macro', scope, name })),
);

const tree: fc.Arbitrary<Tree> = fc.letrec<{ node: Tree }>((tie) => ({
    node: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        leaf,
        fc.tuple(fc.constantFrom<'-' | '!'>('-', '!'), tie('node'))
            .map(([op, operand]): Tree => ({ kind: 'unary', op, operand })),
        fc.tuple(fc.constantFrom(...BINARY_OPS), tie('node'), tie('node'))
            .map(([op, left, right]): Tree => ({ kind: 'binary', op, left, right })),
        fc.tuple(plain_name, fc.array(tie('node'), { minLength: 0, maxLength: 3 }))
            .map(([name, args]): Tree => ({ kind: 'call', name, args })),
        fc.tuple(plain_name, tie('node'))
            .map(([name, index]): Tree => ({ kind: 'subscript', name, index })),
    ),
})).node;

/** Precedence levels: higher binds tighter. */
const PRECEDENCE: Record<string, number> = {
    '|': 1, '&': 2,
    '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
    '+': 4, '-': 4, '*': 5, '/': 5,
};
const UNARY_PRECEDENCE = 6;
const POWER_PRECEDENCE = 7;
const PRIMARY_PRECEDENCE = 8;

interface Printed {
    text: string;
    precedence: number;
    /** A prefix chain ending in a primary, e.g. `-!x` (valid as an exponent). */
    simple_unary: boolean;
}

function wrap(printed: Printed): string {
    return `(${printed.text})`;
}

/** Print with only the parentheses that Stata's precedence needs. */
function print(node: Tree): Printed {
    switch (node.kind) {
        case 'variable':
            return { text: node.name, precedence: PRIMARY_PRECEDENCE, simple_unary: false };
        case 'number':
        case 'missing':
            return { text: node.text, precedence: PRIMARY_PRECEDENCE, simple_unary: false };
        case 'string':
            return { text: `"${node.value}"`, precedence: PRIMARY_PRECEDENCE, simple_unary: false };
        case 'macro':
            return {
                text: node.scope === 'local' ? `\`${node.name}'` : `\${${node.name}}`,
                precedence: PRIMARY_PRECEDENCE,
                simple_unary: false,
            };
        case 'call':
            return {
                text: `${node.name}(${node.args.map((a) => print(a).text).join(', ')})`,
                precedence: PRIMARY_PRECEDENCE,
                simple_unary: false,
            };
        case 'subscript':
            return {
                text: `${node.name}[${print(node.index).text}]`,
                precedence: PRIMARY_PRECEDENCE,
                simple_unary: false,
            };
        case 'unary': {
            const operand = print(node.operand);
            const inner = operand.precedence < UNARY_PRECEDENCE ? wrap(operand) : operand.text;
            // A space keeps `- -x` from lexing as the `--` operator.
            return {
                text: `${node.op} ${inner}`,
                precedence: UNARY_PRECEDENCE,
                simple_unary: operand.precedence === PRIMARY_PRECEDENCE || operand.simple_unary,
            };
        }
        case 'binary': {
            const left = print(node.left);
            const right = print(node.right);
            if (node.op === '^') {
                // Left of `^` must be a primary or another `^`; right may
                // also be a signed primary (`2^-1`).
                const left_text = left.precedence >= POWER_PRECEDENCE ? left.text : wrap(left);
                const right_ok = right.precedence === PRIMARY_PRECEDENCE || right.simple_unary;
                return {
                    text: `${left_text} ^ ${right_ok ? right.text : wrap(right)}`,
                    precedence: POWER_PRECEDENCE,
                    simple_unary: false,
                };
            }
            const precedence = PRECEDENCE[node.op];
            const left_text = left.precedence < precedence ? wrap(left) : left.text;
            const right_text = right.precedence <= precedence ? wrap(right) : right.text;
            return {
                text: `${left_text} ${node.op} ${right_text}`,
                precedence,
                simple_unary: false,
            };
        }
    }
}

/** Reduce a parsed node to the generator's shape, dropping paren nodes. */
function to_tree(node: ExpressionNode): Tree | string {
    switch (node.kind) {
        case 'paren':
            return to_tree(node.expression);
        case 'variable':
            return node.parts ? `composite:${node.name}` : { kind: 'variable', name: node.name };
        case 'number':
            return { kind: 'number', text: node.text };
        case 'missing':
            return { kind: 'missing', text: node.text };
        case 'string': {
            const [part] = node.parts;
            const value = part === undefined ? '' : part.kind === 'text' ? part.value : '?';
            return node.parts.length <= 1 ? { kind: 'string', value } : 'string-with-macros';
        }
        case 'macro_ref':
            return node.name !== undefined && node.form === 'name'
                ? { kind: 'macro', scope: node.scope, name: node.name }
                : `macro:${node.form}`;
        case 'unary':
            return { kind: 'unary', op: node.op === '!' ? '!' : '-', operand: to_tree(node.operand) as Tree };
        case 'binary':
            return {
                kind: 'binary',
                op: node.op,
                left: to_tree(node.left) as Tree,
                right: to_tree(node.right) as Tree,
            };
        case 'call':
            return { kind: 'call', name: node.name, args: node.args.map((a) => to_tree(a) as Tree) };
        case 'subscript':
            return node.target.kind === 'variable' && node.indices.length === 1
                ? { kind: 'subscript', name: node.target.name, index: to_tree(node.indices[0]) as Tree }
                : 'subscript-shape';
        default:
            return `${node.kind}`;
    }
}

function lex_expression(text: string): Token[] {
    return new StataLexer()
        .tokenize(`gen x = ${text}`)
        .tokens.slice(3)
        .filter((t) => t.type !== 'EOF');
}

// ---------------------------------------------------------------------------
// Range checks

function compare_positions(a: Range['start'], b: Range['start']): number {
    return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

/** Visit every expression node (and string/name parts) depth-first. */
function each_node(node: ExpressionNode, visit: (n: { range: Range }) => void): void {
    visit(node);
    const children: ExpressionNode[] = [];
    switch (node.kind) {
        case 'unary': children.push(node.operand); break;
        case 'binary': children.push(node.left, node.right); break;
        case 'call': children.push(...node.args); break;
        case 'subscript': children.push(node.target, ...node.indices); break;
        case 'paren': children.push(node.expression); break;
        case 'varlist': children.push(...node.items); break;
        case 'variable_range': children.push(node.from, node.to); break;
        case 'string':
            for (const my_part of node.parts) visit(my_part);
            break;
        case 'variable':
            for (const my_part of node.parts ?? []) visit(my_part);
            break;
        case 'macro_ref':
            if (node.expression) children.push(node.expression);
            break;
        default:
            break;
    }
    for (const my_child of children) {
        each_node(my_child, visit);
    }
}

// ---------------------------------------------------------------------------

describe('expression parser properties', () => {
    it('parses a tree printed with minimal parentheses back to the same tree', () => {
        fc.assert(
            fc.property(tree, (my_tree) => {
                const text = print(my_tree).text;
                const node = parse_expression(lex_expression(text));
                expect(to_tree(node)).toEqual(my_tree);
            }),
            { numRuns: 300 }
        );
    });

    const soup_token = fc.oneof(
        fc.constantFrom(
            '+', '-', '*', '/', '^', '!', '~', '==', '!=', '~=', '<', '>', '<=', '>=',
            '&', '|', '(', ')', '[', ']', ',', '.', '.a', '"s"', '`"c"\'', '_n', '_b',
            'r', 'L', '#', '1', '2.5', '`m\'', '$g', '`=1\'', 'f', ':', '='
        ),
        plain_name,
    );
    const soup = fc.array(
        fc.tuple(soup_token, fc.constantFrom('', ' ')),
        { minLength: 0, maxLength: 25 }
    ).map((my_parts) => my_parts.map(([token, gap]) => token + gap).join(''));

    it('never throws and keeps every range inside the input', () => {
        fc.assert(
            fc.property(soup, (my_text) => {
                const tokens = lex_expression(my_text).filter(
                    (t) => t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'COMMENT_LINE'
                );
                const node = parse_expression(tokens);
                if (tokens.length === 0) {
                    expect(node.kind).toBe('unparsed');
                    return;
                }
                const start = tokens[0].range.start;
                const end = tokens[tokens.length - 1].range.end;
                each_node(node, (my_node) => {
                    expect(compare_positions(my_node.range.start, my_node.range.end)).toBeLessThanOrEqual(0);
                    expect(compare_positions(start, my_node.range.start)).toBeLessThanOrEqual(0);
                    expect(compare_positions(my_node.range.end, end)).toBeLessThanOrEqual(0);
                });
            }),
            { numRuns: 500 }
        );
    });
});

// ---------------------------------------------------------------------------
// Statements

interface GeneratedStatement {
    text: string;
    if_text?: string;
    in_text?: string;
    weight_keyword?: string;
    options: string[];
}

const qualifier = fc.record({
    if_name: fc.option(plain_name, { nil: undefined }),
    in_range: fc.option(fc.constantFrom('1/10', 'f/l', '-5/l', '3'), { nil: undefined }),
    weight: fc.option(fc.tuple(fc.constantFrom('aw', 'fw', 'pw', 'iw'), plain_name), { nil: undefined }),
    order: fc.shuffledSubarray(['if', 'in', 'weight'], { minLength: 3, maxLength: 3 }),
    options: fc.array(plain_name, { maxLength: 2 }),
    prefix: fc.constantFrom('', 'quietly ', 'capture noisily ', 'svy: '),
    by: fc.option(plain_name, { nil: undefined }),
    command: fc.constantFrom('regress', 'summarize', 'tabulate', 'list'),
    varlist: fc.array(plain_name, { minLength: 1, maxLength: 3 }),
});

const statement: fc.Arbitrary<GeneratedStatement> = qualifier.map((q) => {
    const the_parts: string[] = [q.prefix];
    if (q.by !== undefined) {
        the_parts.push(`by ${q.by}: `);
    }
    the_parts.push(q.command, ' ', q.varlist.join(' '));
    for (const my_kind of q.order) {
        if (my_kind === 'if' && q.if_name !== undefined) {
            the_parts.push(` if ${q.if_name} > 1`);
        } else if (my_kind === 'in' && q.in_range !== undefined) {
            the_parts.push(` in ${q.in_range}`);
        } else if (my_kind === 'weight' && q.weight !== undefined) {
            the_parts.push(` [${q.weight[0]}=${q.weight[1]}]`);
        }
    }
    if (q.options.length > 0) {
        the_parts.push(', ', q.options.join(' '));
    }
    return {
        text: the_parts.join(''),
        if_text: q.if_name !== undefined ? `${q.if_name} > 1` : undefined,
        in_text: q.in_range,
        weight_keyword: q.weight?.[0],
        options: q.options,
    };
});

describe('statement structure properties', () => {
    it('keeps each generated statement as one command node with its qualifiers', () => {
        fc.assert(
            fc.property(fc.array(statement, { minLength: 1, maxLength: 6 }), (my_statements) => {
                const source = my_statements.map((s) => s.text).join('\n');
                const { tokens } = new StataLexer().tokenize(source);
                const { ast } = new StataParser({ structured: true }).parse(tokens);
                expect(ast.nodes).toHaveLength(my_statements.length);
                my_statements.forEach((my_statement, i) => {
                    const node = ast.nodes[i];
                    if (node.type !== 'command') {
                        throw new Error(`expected command, got ${node.type}`);
                    }
                    expect(node.ifExpression).toBe(my_statement.if_text);
                    expect(node.inExpression).toBe(my_statement.in_text);
                    expect(node.weight?.keyword).toBe(my_statement.weight_keyword);
                    expect((node.options ?? []).map((o) => o.name)).toEqual(my_statement.options);
                    expect(node.range.start.line).toBe(i);
                    if (my_statement.if_text !== undefined) {
                        expect(node.if_ast?.kind).toBe('binary');
                    }
                });
            }),
            { numRuns: 200 }
        );
    });
});
