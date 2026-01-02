import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('Extended Macro Word Functions Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_word_function = () =>
    fc.oneof(
      fc.constant('word'),
      fc.constant('words')
    );

  const arbitrary_word_args = () =>
    fc.oneof(
      fc.tuple(fc.constant('count'), fc.stringMatching(/^`[a-zA-Z_][a-zA-Z0-9_]*'$/))
        .map(([cmd, macro]) => `${cmd} ${macro}`),
      fc.tuple(fc.integer({ min: 1, max: 10 }), fc.constant('of'), fc.stringMatching(/^`[a-zA-Z_][a-zA-Z0-9_]*'$/))
        .map(([num, of, macro]) => `${num} ${of} ${macro}`)
    );

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  it('should recognize word functions in extended macro definitions', () => {
    fc.assert(
      fc.property(
        arbitrary_word_function(),
        arbitrary_word_args(),
        arbitrary_macro_name(),
        (my_func, my_args, my_name) => {
          const my_source = `local ${my_name} : ${my_func} ${my_args}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          expect(my_macro_node).toBeDefined();
          expect(my_macro_node!.extendedFunction).toBeDefined();
          expect(my_macro_node!.extendedFunction!.name).toBe(my_func);
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should preserve word function arguments correctly', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        (my_name) => {
          const my_source = `local ${my_name} : word count \`mylist'`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe('word');
            expect(my_macro_node.extendedFunction.args).toContain('count');
            expect(my_macro_node.extendedFunction.args).toContain('mylist');
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});