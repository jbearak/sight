import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('List Function Operations Property Tests', () => {
    let my_lexer: StataLexer;
    let my_parser: StataParser;

    beforeEach(() => {
        my_lexer = new StataLexer();
        my_parser = new StataParser();
    });

    const arbitrary_list_operation = () =>
        fc.oneof(
            fc.constant('sizeof'),
            fc.constant('posof'),
            fc.constant('sort'),
            fc.constant('uniq'),
            fc.constant('dups'),
            fc.constant('clean'),
            fc.constant('retok'),
            fc.constant('in'),
            fc.constant('&'),
            fc.constant('|'),
            fc.constant('-')
        );

    const arbitrary_macro_name = () =>
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

    it('should recognize all list operations in extended macro functions', () => {
        fc.assert(fc.property(
            arbitrary_list_operation(),
            arbitrary_macro_name(),
            arbitrary_macro_name(),
            (operation, macro_name, result_name) => {
                const source = `local ${result_name} : list ${operation} ${macro_name}`;
                const lex_result = my_lexer.tokenize(source);
                const parse_result = my_parser.parse(lex_result.tokens);

                const macro_nodes = parse_result.ast.nodes.filter(
                    (node): node is MacroDefNode => node.type === 'macro_def'
                );
                expect(macro_nodes).toHaveLength(1);
                
                const node = macro_nodes[0];
                expect(node.extendedFunction).toBeDefined();
                expect(node.extendedFunction!.name).toBe('list');
                expect(node.extendedFunction!.args).toContain(operation);
            }
        ));
    });

    it('should handle binary operations correctly', () => {
        const binary_ops = ['&', '|', '-', 'in'];
        fc.assert(fc.property(
            fc.constantFrom(...binary_ops),
            arbitrary_macro_name(),
            arbitrary_macro_name(),
            (operation, macro_a, macro_b) => {
                const source = `local result : list ${macro_a} ${operation} ${macro_b}`;
                const lex_result = my_lexer.tokenize(source);
                const parse_result = my_parser.parse(lex_result.tokens);

                const macro_nodes = parse_result.ast.nodes.filter(
                    (node): node is MacroDefNode => node.type === 'macro_def'
                );
                const node = macro_nodes[0];
                expect(node.extendedFunction!.name).toBe('list');
                expect(node.extendedFunction!.args).toContain(operation);
                expect(node.extendedFunction!.args).toContain(macro_a);
                expect(node.extendedFunction!.args).toContain(macro_b);
            }
        ));
    });

    it('should handle unary operations correctly', () => {
        const unary_ops = ['sizeof', 'sort', 'uniq', 'dups', 'clean', 'retok'];
        fc.assert(fc.property(
            fc.constantFrom(...unary_ops),
            arbitrary_macro_name(),
            (operation, macro_name) => {
                const source = `local result : list ${operation} ${macro_name}`;
                const lex_result = my_lexer.tokenize(source);
                const parse_result = my_parser.parse(lex_result.tokens);

                const macro_nodes = parse_result.ast.nodes.filter(
                    (node): node is MacroDefNode => node.type === 'macro_def'
                );
                const node = macro_nodes[0];
                expect(node.extendedFunction!.name).toBe('list');
                expect(node.extendedFunction!.args).toContain(operation);
                expect(node.extendedFunction!.args).toContain(macro_name);
            }
        ));
    });

    it('should register list functions in symbol table', () => {
        fc.assert(fc.property(
            arbitrary_list_operation(),
            arbitrary_macro_name(),
            arbitrary_macro_name(),
            (operation, result_name, source_name) => {
                const source = `local ${result_name} : list ${operation} ${source_name}`;
                const lex_result = my_lexer.tokenize(source);
                const parse_result = my_parser.parse(lex_result.tokens);

                const macro_nodes = parse_result.ast.nodes.filter(
                    (node): node is MacroDefNode => node.type === 'macro_def'
                );
                const node = macro_nodes[0];
                expect(node.name).toBe(result_name);
                expect(node.scope).toBe('local');
                expect(node.extendedFunction).toBeDefined();
            }
        ));
    });
});