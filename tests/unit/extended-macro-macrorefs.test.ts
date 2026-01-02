import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

function is_placeholder_range(range: { start: any; end: any }): boolean {
    return (
        range.start.line === 0 &&
        range.start.character === 0 &&
        range.end.line === 0 &&
        range.end.character === 0
    );
}

describe('Extended macro function macroRefs ranges', () => {
    let my_lexer: StataLexer;
    let my_parser: StataParser;

    beforeEach(() => {
        my_lexer = new StataLexer();
        my_parser = new StataParser();
    });

    it('should populate macroRefs ranges for bare identifiers in list operations', () => {
        const my_source = "local result : list a - b";
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);

        const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
        );
        expect(my_macro_node).toBeDefined();
        expect(my_macro_node?.extendedFunction?.name).toBe('list');

        const my_refs = my_macro_node?.extendedFunction?.macroRefs || [];
        expect(my_refs.length).toBeGreaterThan(0);

        const my_a_ref = my_refs.find(r => r.name === 'a');
        const my_b_ref = my_refs.find(r => r.name === 'b');
        expect(my_a_ref).toBeDefined();
        expect(my_b_ref).toBeDefined();

        expect(is_placeholder_range(my_a_ref!.range)).toBe(false);
        expect(is_placeholder_range(my_b_ref!.range)).toBe(false);

        // Both refs are on the first (and only) line.
        expect(my_a_ref!.range.start.line).toBe(0);
        expect(my_b_ref!.range.start.line).toBe(0);

        // Ranges should have non-zero width.
        expect(my_a_ref!.range.end.character).toBeGreaterThan(my_a_ref!.range.start.character);
        expect(my_b_ref!.range.end.character).toBeGreaterThan(my_b_ref!.range.start.character);
    });

    it('should populate macroRefs ranges for explicit local/global macro tokens inside extended args', () => {
        const my_source = "local result : list `x' - $g";
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);

        const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
        );
        expect(my_macro_node).toBeDefined();
        expect(my_macro_node?.extendedFunction?.name).toBe('list');

        const my_refs = my_macro_node?.extendedFunction?.macroRefs || [];
        expect(my_refs.length).toBeGreaterThan(0);

        const my_x_ref = my_refs.find(r => r.name === 'x' && r.scope === 'local');
        const my_g_ref = my_refs.find(r => r.name === 'g' && r.scope === 'global');
        expect(my_x_ref).toBeDefined();
        expect(my_g_ref).toBeDefined();

        expect(is_placeholder_range(my_x_ref!.range)).toBe(false);
        expect(is_placeholder_range(my_g_ref!.range)).toBe(false);

        expect(my_x_ref!.range.end.character).toBeGreaterThan(my_x_ref!.range.start.character);
        expect(my_g_ref!.range.end.character).toBeGreaterThan(my_g_ref!.range.start.character);
    });
});
