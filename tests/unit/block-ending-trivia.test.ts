import { describe, expect, test } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataNode, TriviaNode } from '../../src/types';

type NodeWithBlockEndingTrivia = StataNode & {
    body?: StataNode[];
    leadingTrivia?: TriviaNode[];
    trailingTrivia?: TriviaNode[];
    blockEndingTrivia?: TriviaNode[];
};

function parse_nodes(source: string): StataNode[] {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const result = parser.parse(lexer.tokenize(source).tokens);
    return result.ast.nodes;
}

function parse_result(source: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    return parser.parse(lexer.tokenize(source).tokens);
}

function as_block_node(node: StataNode | undefined): NodeWithBlockEndingTrivia {
    expect(node).toBeDefined();
    return node as NodeWithBlockEndingTrivia;
}

function block_comment_contents(node: NodeWithBlockEndingTrivia): string[] {
    return (node.blockEndingTrivia ?? []).map(t => t.content);
}

// Collect every comment's content anywhere in the tree (leading, trailing, or
// block-ending), so a "comment must never be dropped" assertion is independent
// of which owner the parser chose.
function collect_all_trivia(nodes: StataNode[]): string[] {
    const the_contents: string[] = [];
    const walk = (the_nodes: (StataNode | undefined)[]): void => {
        for (const my_node of the_nodes) {
            if (!my_node) continue;
            const my_typed = my_node as NodeWithBlockEndingTrivia;
            for (const t of my_typed.leadingTrivia ?? []) the_contents.push(t.content);
            for (const t of my_typed.blockEndingTrivia ?? []) the_contents.push(t.content);
            for (const t of my_typed.trailingTrivia ?? []) the_contents.push(t.content);
            if (my_typed.body) walk(my_typed.body);
        }
    };
    walk(nodes);
    return the_contents;
}

function expect_block_ending_comment(
    node: StataNode | undefined,
    expected_comments: string[]
): NodeWithBlockEndingTrivia {
    const block_node = as_block_node(node);
    expect(block_comment_contents(block_node)).toEqual(expected_comments);
    expect(block_node.trailingTrivia ?? []).toHaveLength(0);
    return block_node;
}

describe('block-ending trivia ownership', () => {
    test.each([
        {
            name: 'forvalues',
            source: 'forvalues i=1/2 {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'forvalues'),
        },
        {
            name: 'foreach',
            source: 'foreach x in a b {\n    display "`x\'"\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'foreach'),
        },
        {
            name: 'while',
            source: 'while 1 {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'while'),
        },
        {
            name: 'if',
            source: 'if 1 {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'if'),
        },
        {
            name: 'else',
            source: 'if 0 {\n    display 0\n}\nelse {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'else'),
        },
        {
            name: 'frame',
            source: 'frame scratch {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) => nodes.find(n => n.type === 'frame'),
        },
        {
            name: 'prefix brace block',
            source: 'capture {\n    display 1\n    * keep\n}\ndisplay 2',
            find: (nodes: StataNode[]) =>
                nodes.find(n => n.type === 'command' && n.name === '{'),
        },
    ])('$name comment before closer belongs to blockEndingTrivia', ({ source, find }) => {
        const nodes = parse_nodes(source);
        const block_node = expect_block_ending_comment(find(nodes), ['* keep']);
        const following_node = nodes[nodes.length - 1] as NodeWithBlockEndingTrivia;

        expect(block_node.body ?? []).toHaveLength(1);
        expect(following_node.type).toBe('command');
        expect(following_node.leadingTrivia ?? []).toHaveLength(0);
    });

    test('comment before program end belongs to program blockEndingTrivia', () => {
        const nodes = parse_nodes(
            'program define p\n    display 1\n    * keep\nend\ndisplay 2'
        );
        const program = expect_block_ending_comment(
            nodes.find(n => n.type === 'program'),
            ['* keep']
        );
        const following_node = nodes[nodes.length - 1] as NodeWithBlockEndingTrivia;

        expect(program.body ?? []).toHaveLength(1);
        expect(following_node.type).toBe('command');
        expect(following_node.leadingTrivia ?? []).toHaveLength(0);
    });

    test('empty-body block can own its only comment as blockEndingTrivia', () => {
        const nodes = parse_nodes('if 1 {\n    * only\n}\ndisplay 2');
        const block_node = expect_block_ending_comment(
            nodes.find(n => n.type === 'if'),
            ['* only']
        );

        expect(block_node.body ?? []).toHaveLength(0);
    });

    test('multiple consecutive comments before a closer stay in order', () => {
        const nodes = parse_nodes(
            'while 1 {\n    display 1\n    * first\n    // second\n}\ndisplay 2'
        );

        expect_block_ending_comment(
            nodes.find(n => n.type === 'while'),
            ['* first', '// second']
        );
    });

    test('nested blocks keep inner and outer block-ending comments separate', () => {
        const nodes = parse_nodes(
            'if 1 {\n    while 1 {\n        display 1\n        * inner\n    }\n    * outer\n}\ndisplay 2'
        );
        const outer = expect_block_ending_comment(
            nodes.find(n => n.type === 'if'),
            ['* outer']
        );
        const inner = expect_block_ending_comment(
            (outer.body ?? []).find(n => n.type === 'while'),
            ['* inner']
        );

        expect(inner.leadingTrivia ?? []).toHaveLength(0);
    });

    test('a continuation before the comment leaves the group intact (no split)', () => {
        // A `///` continuation interleaved with the trailing comment must NOT be
        // split: draining only the comment would reorder the continuation
        // relative to the comment across the closer. The whole group stays with
        // the following statement, preserving pre-existing order.
        const nodes = parse_nodes(
            'if 1 {\n    display 1\n    ///\n    * keep\n}\ndisplay 2'
        );
        const block_node = as_block_node(nodes.find(n => n.type === 'if'));
        const following_node = nodes[nodes.length - 1] as NodeWithBlockEndingTrivia;

        expect(block_node.blockEndingTrivia).toBeUndefined();
        expect((following_node.leadingTrivia ?? []).map(t => t.content)).toEqual([
            '///',
            '* keep',
        ]);
    });

    test('unclosed brace block does not populate blockEndingTrivia but keeps the comment', () => {
        const result = parse_result('if 1 {\n    display 1\n    * keep');
        const block_node = as_block_node(result.ast.nodes.find(n => n.type === 'if'));

        expect(block_node.blockEndingTrivia).toBeUndefined();
        // The comment must never be dropped on the recovery path.
        expect(collect_all_trivia(result.ast.nodes)).toContain('* keep');
    });

    test('program missing end does not populate blockEndingTrivia but keeps the comment', () => {
        const result = parse_result('program define p\n    display 1\n    * keep');
        const program = as_block_node(result.ast.nodes.find(n => n.type === 'program'));

        expect(program.blockEndingTrivia).toBeUndefined();
        expect(collect_all_trivia(result.ast.nodes)).toContain('* keep');
    });
});
